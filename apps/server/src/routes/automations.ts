import {
  AUTOMATION_KINDS,
  SaveAutomationRequestSchema,
  automationPowers,
  officerIsInjured,
  type AutomationsResponse,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { ownBase } from './own-base.js';
import { officerDuty } from '../crew/duty.js';
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
      // Only officers who could actually be named: on the books, not out on something else, not
      // hurt. A picker offering somebody the runner would then refuse is a picker that lies.
      officers: base.commanders
        .filter(
          (one) =>
            officerDuty(app.repos, base, one, now) === null &&
            !officerIsInjured(one.injuredUntil, now),
        )
        .map((one) => ({ id: one.id, name: one.name, role: one.role })),
      serverNow: now.toISOString(),
    };
  });

  app.post('/automations', { preHandler: app.authenticate }, (request): AutomationsResponse => {
    const body = parseBody(SaveAutomationRequestSchema, request.body);
    const base = ownBase(app, request.currentUser.id);
    const now = new Date();
    const powers = readPowers(base.research.technologies);

    if (!powers.unlocked) {
      throw new AppError('FORBIDDEN', 'The Open Door, on the Right Hand track, opens this');
    }
    if (body.slot >= powers.slots) {
      throw new AppError('FORBIDDEN', 'You have not earned that slot yet');
    }
    if (!powers.orders.includes(body.order)) {
      throw new AppError('FORBIDDEN', 'You have not earned that order yet');
    }
    if (body.unitSlots !== null && !powers.bestFit) {
      throw new AppError('FORBIDDEN', 'Naming a size instead of a party is a later rung');
    }
    if (body.optimiseFor !== null && !powers.optimise) {
      throw new AppError('FORBIDDEN', 'Chasing one resource is a later rung');
    }
    /*
     * Exactly one way of saying who goes.
     *
     * A slot carrying both a named party and a size is a slot whose behaviour depends on which
     * branch the runner happens to read first, which is the kind of thing that is only ever found
     * by a player wondering why their orders were ignored.
     */
    const named = Object.keys(body.force).length > 0;
    if (named === (body.unitSlots !== null)) {
      throw new AppError('VALIDATION_ERROR', 'Name a party or a size, not both and not neither');
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
      officers: base.commanders
        .filter(
          (one) =>
            officerDuty(app.repos, base, one, now) === null &&
            !officerIsInjured(one.injuredUntil, now),
        )
        .map((one) => ({ id: one.id, name: one.name, role: one.role })),
      serverNow: now.toISOString(),
    };
  });
}
