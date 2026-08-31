import {
  CAPTURED_GATE_MAX_LEVEL,
  CAPTURED_GATE_START_LEVEL,
  CITY_DISTRICTS,
  capturedGateDefensePercent,
  capturedGateIntelResistancePercent,
  CapturedGateSchema,
  capturedGateCost,
  capturedGateRefusal,
  capturedGateSeconds,
  findDistrict,
  spendResources,
  type Base,
  type CapturedGate,
  type CapturedGateRefusal,
  type CapturedGateView,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * §B7: the gate on a district a crew has taken whole (board request).
 *
 * Three things live here: who has access, how a gate is raised, and when that work lands.
 */

/**
 * Whether this crew holds every location in a district.
 *
 * The gate is deliberately not in the list, and cannot be: it is its own `BattleTarget` kind
 * rather than a location, so "excluding gate, you cannot really capture that" is true by
 * construction rather than by a clause somebody has to keep remembering.
 *
 * A district with no locations answers false. There is no such district today, and a district that
 * is captured by owning nothing would be a strange thing to hand a free wall to.
 */
export function holdsDistrictWhole(
  repos: Repositories,
  baseId: string,
  districtId: string,
): boolean {
  const district = findDistrict(districtId);
  if (!district || district.locations.length === 0) return false;
  const controls = repos.city.controls();
  return district.locations.every((location) => {
    const holder = controls.get(location.id)?.holder;
    return holder?.kind === 'crew' && holder.baseId === baseId;
  });
}

/** Every district this crew holds outright, in city order. */
export function districtsHeldWhole(repos: Repositories, baseId: string): string[] {
  const controls = repos.city.controls();
  return CITY_DISTRICTS.filter(
    (district) =>
      district.locations.length > 0 &&
      district.locations.every((location) => {
        const holder = controls.get(location.id)?.holder;
        return holder?.kind === 'crew' && holder.baseId === baseId;
      }),
  ).map((district) => district.id);
}

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
    })
  );
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
): RaiseGateResult {
  const holds = holdsDistrictWhole(repos, base.id, districtId);
  const gate = repos.capturedGates.find(districtId) ?? gateFor(repos, districtId);
  const refusal = capturedGateRefusal({ holdsDistrict: holds, gate, stock: base.resources });
  if (refusal) return { kind: 'refused', reason: refusal };

  const toLevel = gate.level + 1;
  const started: CapturedGate = {
    districtId,
    level: gate.level,
    upgradingTo: toLevel,
    upgradingUntil: new Date(now.getTime() + capturedGateSeconds(toLevel) * 1000).toISOString(),
  };
  const paid = { ...base, resources: spendResources(base.resources, capturedGateCost(toLevel)) };

  repos.capturedGates.put(started);
  repos.bases.updateResources(paid.id, paid.resources);
  return { kind: 'started', gate: started, base: paid };
}

/**
 * Lands every captured gate whose work is done. Returns how many.
 *
 * Called from the world clock and from the city read, like every other settle: a gate finishing
 * has to happen at its mark whether or not its owner is looking, because what it changes is how
 * hard the ground is for *somebody else* to take.
 */
export function settleCapturedGates(repos: Repositories, now: Date): number {
  const due = repos.capturedGates.due(now.toISOString());
  for (const gate of due) {
    repos.capturedGates.put({
      districtId: gate.districtId,
      level: gate.upgradingTo ?? gate.level,
      upgradingTo: null,
      upgradingUntil: null,
    });
  }
  return due.length;
}

/**
 * Every captured gate this crew can see and act on, for the city screen.
 *
 * One per district held outright and none for the rest, because "you hold all of it" is the whole
 * condition: a crew looking at a district they have half-taken should see no gate to raise, which
 * is the thing that makes taking the last location worth doing.
 */
export function capturedGatesFor(repos: Repositories, base: Base, now: Date): CapturedGateView[] {
  return districtsHeldWhole(repos, base.id).map((districtId) => {
    const gate = gateFor(repos, districtId);
    const atCeiling = gate.level >= CAPTURED_GATE_MAX_LEVEL;
    const next = gate.level + 1;
    const refusal = capturedGateRefusal({
      holdsDistrict: true,
      gate,
      stock: base.resources,
    });
    return {
      districtId,
      districtName: findDistrict(districtId)?.name ?? districtId,
      level: gate.level,
      nextCost: atCeiling ? null : capturedGateCost(next),
      nextSeconds: atCeiling ? null : capturedGateSeconds(next),
      upgradingUntil: gate.upgradingUntil,
      defensePercent: capturedGateDefensePercent(gate.level),
      intelResistancePercent: capturedGateIntelResistancePercent(gate.level),
      refusal: refusal === null ? null : GATE_REFUSALS[refusal],
      ...(now ? {} : {}),
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
