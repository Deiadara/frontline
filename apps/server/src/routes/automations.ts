import {
  AUTOMATION_KINDS,
  LEADER_HOLD_MESSAGES,
  NO_RIGHT_HAND_TEXT,
  SaveAutomationRequestSchema,
  automationPowers,
  automationRungRefusal,
  findUnit,
  officerIsInjured,
  type AutomationsResponse,
  type Base,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { ownBase } from './own-base.js';
import { officerDuty } from '../crew/duty.js';
import { workingOfficer } from '../crew/roster.js';
import { automationCooldownMs } from '../automations/runners.js';

/**
 * §C2b: the Right Hand's standing orders.
 *
 * Two routes, because there are two questions: what may I do and what am I doing (`GET`), and
 * this is what I want a slot to do (`POST`). The ladder is answered by the server on both, so a
 * client that asks for a rung it has not earned is refused rather than trusted.
 */
export function registerAutomationRoutes(app: FastifyInstance): void {
  /*
   * The ladder, as the wire shape rather than the shared one.
   *
   * `AutomationPowers` has `readonly` arrays and the response schema does not, which is right on
   * both sides: the shared type is a value nobody may edit, and a parsed response is a plain
   * object. Copied once here instead of loosening either.
   */
  const readPowers = (technologies: readonly string[]): AutomationsResponse['powers'] => {
    const powers = automationPowers(technologies);
    return {
      ...powers,
      orders: [...powers.orders],
      // On the clock the world is running on, so the countdown the screen draws is the real one.
      cooldownMs: automationCooldownMs(powers.cooldownMs),
    };
  };

  app.get('/automations', { preHandler: app.authenticate }, (request): AutomationsResponse => {
    const base = ownBase(app, request.currentUser.id);
    const now = new Date();
    const powers = readPowers(base.research.technologies);
    return {
      powers,
      slots: app.repos.automations.forBase(base.id),
      officers: namableOfficers(app, base, now),
      serverNow: now.toISOString(),
    };
  });

  app.post('/automations', { preHandler: app.authenticate }, (request): AutomationsResponse => {
    const body = parseBody(SaveAutomationRequestSchema, request.body);
    const base = ownBase(app, request.currentUser.id);
    const now = new Date();
    const powers = readPowers(base.research.technologies);

    const pastTheLadder = automationRungRefusal(powers, body);
    if (pastTheLadder !== null) throw new AppError('FORBIDDEN', pastTheLadder);
    /*
     * Exactly one way of saying who goes.
     *
     * A slot carrying both a named party and a size is a slot whose behaviour depends on which
     * branch the runner happens to read first, which is the kind of thing that is only ever found
     * by a player wondering why their orders were ignored.
     */
    const named = Object.keys(body.force).length > 0;
    // Switching an order off is never refused for its party (bug pass, 2026-10-06): a party every
    // unit of which has been retired reads as empty, and refusing "neither" kept the order on.
    if (body.enabled && named === (body.unitSlots !== null)) {
      throw new AppError('VALIDATION_ERROR', 'Name a party or a size, not both and not neither');
    }
    /*
     * A party is units, and this is the door that says so (bug pass, 2026-09-24).
     *
     * `POST /missions` keys its own `force` on the unit catalogue, so a key naming no sheet never
     * reaches it. This one takes `z.record(z.string(), ...)` on the wire, and the runner then asks
     * `base.army[unitId] < count`: for a key that is also a name on `Object.prototype`
     * (`constructor`, `toString`, `valueOf`) that reads a *function*, the comparison is `NaN < 1`,
     * which is false, and the party counts as at home. A crew with an empty roster launched a real
     * job, won it, and banked the XP and every mission tally behind it, once a cooldown, for ever.
     *
     * Refused rather than filtered: a party the caller did not ask for is not the party they asked
     * for, and an empty one would be the "neither" the line above already refuses.
     */
    const unknown = Object.keys(body.force).filter((unitId) => findUnit(unitId) === undefined);
    // On switching on only, like the officer check below: anything that names no unit is dropped
    // when the slot is read back (`withoutRetiredUnits`), so an order switched off with one stored
    // can never run on it.
    if (body.enabled && unknown.length > 0) {
      throw new AppError('VALIDATION_ERROR', `No such unit: ${unknown.join(', ')}`);
    }

    // The officer named has to be one of this crew's (2026-09-28). The slot used to store any id at
    // all, and a stranger's officer only surfaced as a stall at the first tick; `POST /missions`
    // answers a leader who is not on the bench with the same 404.
    const namedOfficer =
      body.officerId === null || body.officerId === undefined
        ? undefined
        : base.commanders.find((officer) => officer.id === body.officerId);
    // Only when switching on (bug pass, 2026-10-06): an officer released at the Bar stays named on
    // the slot, and refusing the switch-off kept the order on, which locks the mission board to
    // the Right Hand while the runner stalls on every tick.
    if (body.enabled && body.officerId !== null && body.officerId !== undefined && !namedOfficer) {
      throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
    }
    // Nobody with no chair leads anything (2026-09-28), so an order switched on naming one would
    // stall on every tick. Refused here instead, where the player can still fix it. Switching an
    // order *off* is never refused, whoever it names.
    if (body.enabled && namedOfficer?.role === null) {
      throw new AppError('MISSION_REFUSED', `${namedOfficer.name} ${LEADER_HOLD_MESSAGES.bench}`);
    }
    // The runner stalls every slot while nobody fit sits in the Right Hand's chair (2026-09-29),
    // so switching one on then is refused here, where the player can see why.
    if (body.enabled && workingOfficer(base.commanders, 'right_hand', now) === undefined) {
      throw new AppError('FORBIDDEN', NO_RIGHT_HAND_TEXT);
    }

    const held = app.repos.automations.get(base.id, body.slot);
    app.repos.automations.put({
      id: held?.id ?? randomUUID(),
      baseId: base.id,
      slot: body.slot,
      kind: AUTOMATION_KINDS[0],
      enabled: body.enabled,
      order: body.order,
      // Switching a slot on starts its sequence at the top rather than wherever it was left, so
      // "one mission then two battles" means that from the press, not from a month ago.
      step: held?.enabled === body.enabled ? (held?.step ?? 0) : 0,
      force: body.force,
      officerId: body.officerId,
      unitSlots: body.unitSlots,
      optimiseFor: body.optimiseFor,
      // A slot that is being rewritten keeps whatever it has out: turning it off does not recall
      // a party, it stops the next one going.
      missionId: held?.missionId ?? null,
      restingSince: held?.restingSince ?? null,
      stalled: null,
    });

    const slots = app.repos.automations.forBase(base.id);
    app.repos.history.record({
      actorId: request.currentUser.id,
      baseId: base.id,
      kind: 'automation.saved',
      payload: { slot: body.slot, enabled: body.enabled, order: body.order },
    });
    return {
      powers,
      slots,
      officers: namableOfficers(app, base, now),
      serverNow: now.toISOString(),
    };
  });
}

/**
 * Who the order sheets may name: officers on the books, not out on something else, not hurt. A
 * picker offering somebody the runner would then refuse is a picker that lies.
 *
 * A slot's own leader is kept while out on that slot's run (maintainer, 2026-10-06), marked `out`:
 * dropping them left a running order's dropdown reading "Choose the officer who leads".
 */
function namableOfficers(
  app: FastifyInstance,
  base: Base,
  now: Date,
): AutomationsResponse['officers'] {
  const named = new Set(app.repos.automations.forBase(base.id).map((slot) => slot.officerId));
  return base.commanders.flatMap((one) => {
    const out =
      officerDuty(app.repos, base, one, now) !== null || officerIsInjured(one.injuredUntil, now);
    return out && !named.has(one.id) ? [] : [{ id: one.id, name: one.name, role: one.role, out }];
  });
}
