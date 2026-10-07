import {
  chairPassiveOf,
  type GatePricing,
  CAPTURED_GATE_MAX_LEVEL,
  CAPTURED_GATE_START_LEVEL,
  capturedGateDefensePercent,
  CapturedGateSchema,
  capturedGateCost,
  capturedGateRefusal,
  buildBoostPercent,
  gateIsBroken,
  capturedGateSeconds,
  findDistrict,
  spendResources,
  type Base,
  type CapturedGate,
  type CapturedGateRefusal,
  type CapturedGateView,
  cancelRefund,
  cancelWindowOpen,
  type PartialResources,
} from '@frontline/shared';
import { adminCost, adminSeconds, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { creditBase, refuseWaste } from '../district/stores.js';
import { settleEach } from '../world/guard.js';
import { tallyGateLevelRaised } from '../feats/tally.js';
import { holdsDistrictWhole, districtsHeldWhole, wholeHolderOf } from './holding.js';

/**
 * §B7: the gate on a district a crew has taken whole (maintainer request).
 *
 * Three things live here: who has access, how a gate is raised, and when that work lands.
 */

/*
 * `holdsDistrictWhole` and `districtsHeldWhole` live in `./holding.ts` since the faction ruling
 * (2026-10-07): a district is whole for a crew when its table holds every location. Re-exported
 * here because every reader of the gate imported them from this module.
 */
export { holdsDistrictWhole, districtsHeldWhole } from './holding.js';

/**
 * The gate as it stands, creating it at level 1 the first time somebody holds the ground.
 *
 * Lazily rather than at the moment of capture, for the reason everything else in this server is
 * lazy: the alternative is a hook on every path that can change who holds a location, and one of
 * those paths is a battle settling from a background tick. A gate nobody has looked at yet and a
 * gate at level 1 are the same gate.
 */
export function gateFor(repos: Repositories, districtId: string): CapturedGate {
  return (
    repos.capturedGates.find(districtId) ??
    CapturedGateSchema.parse({
      districtId,
      level: CAPTURED_GATE_START_LEVEL,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    })
  );
}

/**
 * §A4: a broken gate does not survive the district being broken up (maintainer request).
 *
 * The rule the maintainer asked for, in two halves that only mean anything together. A gate that has
 * been kicked in is down for {@link GATE_BREACH_HOURS} hours, and for those hours the holder is
 * playing without a door. If they lose so much as one location inside the district while it is
 * open, they no longer hold the district outright, and the wall goes back to where a new holder
 * would find it: **level 1**, with any work in progress abandoned.
 *
 * The breach is the whole condition. Losing a location behind a gate that is *standing* changes
 * nothing about the gate, because the gate belongs to the ground rather than to the crew (see the
 * module doc above) and whoever takes the district next inherits what the last holder built. It is
 * only while the door is off its hinges that the wall is on the line with it.
 *
 * `heldWholeBefore` has to be taken *before* the write that changes hands: the predicate is about
 * the state the write destroys, and reading it afterwards always answers false.
 *
 * Returns whether the gate was actually put back, so a caller can say so.
 */
export function resetGateOnDistrictLost(
  repos: Repositories,
  input: { districtId: string; holderBaseId: string; heldWholeBefore: boolean; now: Date },
): boolean {
  if (!input.heldWholeBefore) return false;
  if (!gateIsBroken(repos.sieges.gate(input.districtId), input.now)) return false;
  if (holdsDistrictWhole(repos, input.holderBaseId, input.districtId)) return false;

  repos.capturedGates.put({
    districtId: input.districtId,
    level: CAPTURED_GATE_START_LEVEL,
    upgradingTo: null,
    upgradingUntil: null,
    upgradingSince: null,
  });
  return true;
}

/**
 * Calls off a raise of this district's captured gate, refunding nobody (maintainer, 2026-10-06).
 *
 * For ground in the district changing hands (`putControl`): the work was the old holder's, and the
 * crew that takes the ground takes the gate as it stands, without the half-built level and without
 * the materials paid for it.
 */
export function dropGateRaise(repos: Repositories, districtId: string): void {
  const gate = repos.capturedGates.find(districtId);
  if (!gate || gate.upgradingTo === null) return;
  repos.capturedGates.put({
    ...gate,
    upgradingTo: null,
    upgradingUntil: null,
    upgradingSince: null,
    upgradePaid: null,
  });
}

export type RaiseGateResult =
  | { kind: 'refused'; reason: CapturedGateRefusal }
  | { kind: 'started'; gate: CapturedGate; base: Base };

/**
 * Starts raising a captured gate, charging for it up front.
 *
 * Paid at the order rather than on completion, exactly as a build in the crew's own district is:
 * a queued structure has already been paid for, and a wall somebody is standing in front of should
 * not be cancellable for a refund.
 */
export function raiseCapturedGate(
  repos: Repositories,
  base: Base,
  districtId: string,
  now: Date,
  /** Testing mode: five seconds and nothing charged, like a build at home (`admin/mode.ts`). */
  admin = false,
): RaiseGateResult {
  const holds = holdsDistrictWhole(repos, base.id, districtId);
  const gate = repos.capturedGates.find(districtId) ?? gateFor(repos, districtId);
  const pricing = gatePricingFor(repos, base, now);
  const refusal = capturedGateRefusal({
    holdsDistrict: holds,
    gate,
    stock: base.resources,
    pricing,
  });
  if (refusal && !adminWaives(refusal, admin)) return { kind: 'refused', reason: refusal };

  const toLevel = gate.level + 1;
  /*
   * §B4: the Generator's burn reaches this gate too (maintainer request).
   *
   * "All building upgrades" is what the burn promises, and a captured gate is a building upgrade:
   * it is raised with the Gate's own cost and clock and it is the same work. It is not in the
   * district's `buildQueue`, which is what `boostedQueue` re-times, so it has to read the burn
   * itself or the promise would quietly be "all upgrades except the ones on ground you took".
   *
   * Applied at the order like the queue's, not at the settle: the burn buys the clock you start,
   * so a gate ordered inside the two hours keeps its short clock even if the burn runs out first.
   */
  const seconds = adminSeconds(gateRaiseSeconds(base, toLevel, now), admin);
  const charge = adminCost(capturedGateCost(toLevel, pricing), admin);
  const started: CapturedGate = {
    districtId,
    level: gate.level,
    upgradingTo: toLevel,
    upgradingUntil: new Date(now.getTime() + seconds * 1000).toISOString(),
    upgradingSince: now.toISOString(),
    upgradePaid: charge,
  };
  const paid = {
    ...base,
    resources: spendResources(base.resources, charge),
  };

  repos.capturedGates.put(started);
  repos.bases.updateResources(paid.id, paid.resources);
  return { kind: 'started', gate: started, base: paid };
}

/**
 * The crew's discounts on a gate raise (maintainer, 2026-10-05): its home district's build-cost
 * cards, its own points off a build (the general and the Gate's own), and its Engineer, read the
 * way a build at home reads them (`district/build.ts`).
 */
function gatePricingFor(repos: Repositories, base: Base, now: Date): GatePricing {
  const effects = standingEffectsFor(repos, base, now);
  return {
    buildings: base.buildings,
    crewCostPercent: effects.buildCostPercent + (effects.buildingCostPercent.gate ?? 0),
    engineerPercent: chairPassiveOf(effects, 'engineer', 'building_cost'),
  };
}

/**
 * Lands every captured gate whose work is done. Returns how many.
 *
 * Called from the world clock and from the city read, like every other settle: a gate finishing
 * has to happen at its mark whether or not its owner is looking, because what it changes is how
 * hard the ground is for *somebody else* to take.
 */
export function settleCapturedGates(repos: Repositories, now: Date): number {
  const finished = repos.capturedGates.due(now.toISOString());
  /*
   * Not ahead of a fight at the gate that came first (bug pass, 2026-10-06), as location upgrades
   * wait: gates settle before battles, so after a restart over both a raise finished after a
   * fight's mark already counted in that fight. It waits for the fight; the next settle lands it.
   * Read only when something is due, because this runs on the city read too.
   */
  const firstFight = new Map<string, number>();
  if (finished.length > 0) {
    for (const battle of repos.sieges.pending()) {
      if (battle.target.kind !== 'gate') continue;
      const mark = Date.parse(battle.scheduledFor);
      const known = firstFight.get(battle.target.districtId);
      if (known === undefined || mark < known) firstFight.set(battle.target.districtId, mark);
    }
  }
  const due = finished.filter((gate) => {
    const fight = firstFight.get(gate.districtId);
    return fight === undefined || fight > Date.parse(gate.upgradingUntil ?? '');
  });
  return settleEach(
    repos,
    'captured gates',
    due,
    (gate) => gate.districtId,
    (gate) => {
      const level = gate.upgradingTo ?? gate.level;
      repos.capturedGates.put({
        districtId: gate.districtId,
        level,
        upgradingTo: null,
        upgradingUntil: null,
        upgradingSince: null,
      });
      // P8-C: counted for whoever answers for the district when the level lands: its one
      // holder, or the named defender of a table holding it together.
      const district = findDistrict(gate.districtId);
      const holder = district ? wholeHolderOf(repos, district) : null;
      if (holder?.kind === 'crew') tallyGateLevelRaised(repos, holder.baseId, level - gate.level);
    },
  );
}

/**
 * Every captured gate this crew can see and act on, for the city screen.
 *
 * One per district held outright and none for the rest, because "you hold all of it" is the whole
 * condition: a crew looking at a district they have half-taken should see no gate to raise, which
 * is the thing that makes taking the last location worth doing.
 */
/**
 * The clock a raise ordered at `now` runs on: the Gate's own, with §B4's burn taken off it.
 *
 * One function, because the card quotes it and the raise starts it. They were two, and the card's
 * half did not read the burn: a crew with a Generator running was shown the full clock and handed a
 * shorter one, which is the one thing a clock on a button must not do.
 */
export function gateRaiseSeconds(base: Base, toLevel: number, now: Date): number {
  const off = buildBoostPercent(base.economy.buildBoostUntil, now);
  return Math.round(capturedGateSeconds(toLevel) * (1 - off / 100));
}

export function capturedGatesFor(repos: Repositories, base: Base, now: Date): CapturedGateView[] {
  const pricing = gatePricingFor(repos, base, now);
  return districtsHeldWhole(repos, base.id).map((districtId) => {
    const gate = gateFor(repos, districtId);
    const atCeiling = gate.level >= CAPTURED_GATE_MAX_LEVEL;
    const next = gate.level + 1;
    const refusal = capturedGateRefusal({
      holdsDistrict: true,
      gate,
      stock: base.resources,
      pricing,
    });
    return {
      districtId,
      districtName: findDistrict(districtId)?.name ?? districtId,
      level: gate.level,
      nextCost: atCeiling ? null : capturedGateCost(next, pricing),
      nextSeconds: atCeiling ? null : gateRaiseSeconds(base, next, now),
      upgradingUntil: gate.upgradingUntil,
      upgradingSince: gate.upgradingSince,
      defensePercent: capturedGateDefensePercent(gate.level),
      refusal: refusal === null ? null : GATE_REFUSALS[refusal],
    };
  });
}

/** Why a gate cannot be raised, in the player's words. */
const GATE_REFUSALS: Record<CapturedGateRefusal, string> = {
  not_held: 'You do not hold all of it',
  already_working: 'Work is already under way',
  at_ceiling: 'It will not go any higher',
  cannot_afford: 'You cannot pay for it',
};

export type GateCancelOutcome =
  | { kind: 'refused'; reason: 'not_held' | 'nothing_running' | 'window_closed' }
  | { kind: 'cancelled'; gate: CapturedGate; base: Base; refund: PartialResources };

/**
 * Call off the level being raised (maintainer request, 2026-09-12; `time/cancel.ts`): inside the first
 * tenth since it began, with ninety percent of the price back, as far as the stores have room
 * (warned about first: maintainer ruling, 2026-09-28). A raise written before the start was
 * recorded has no tenth to measure and finishes as it was going to.
 */
export function cancelGateRaise(
  repos: Repositories,
  base: Base,
  districtId: string,
  now: Date,
  acceptWaste?: boolean,
  /** Testing mode took nothing for the raise, so it hands nothing back. */
  admin = false,
): GateCancelOutcome {
  if (!holdsDistrictWhole(repos, base.id, districtId))
    return { kind: 'refused', reason: 'not_held' };
  const gate = gateFor(repos, districtId);
  if (gate.upgradingTo === null || gate.upgradingUntil === null || gate.upgradingSince === null) {
    return { kind: 'refused', reason: 'nothing_running' };
  }
  const since = Date.parse(gate.upgradingSince);
  if (!cancelWindowOpen(since, Date.parse(gate.upgradingUntil) - since, now.getTime())) {
    return { kind: 'refused', reason: 'window_closed' };
  }
  // What the order was charged, not the price read again now (2026-10-05): the price takes the
  // Engineer, and a cut seated for the order and gone by the cancel would refund past the charge.
  const refund = adminCost(
    cancelRefund(gate.upgradePaid ?? capturedGateCost(gate.upgradingTo)),
    admin,
  );
  const credit = creditBase(repos, base, refund, now);
  refuseWaste(credit, acceptWaste);
  const cleared: CapturedGate = {
    ...gate,
    upgradingTo: null,
    upgradingUntil: null,
    upgradingSince: null,
    upgradePaid: null,
  };
  const repaid: Base = { ...base, resources: credit.resources };
  repos.capturedGates.put(cleared);
  repos.bases.updateResources(repaid.id, repaid.resources);
  return { kind: 'cancelled', gate: cleared, base: repaid, refund };
}
