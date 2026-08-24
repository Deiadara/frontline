import {
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  canAfford,
  spendResources,
  upgradeCost,
  upgradeNote,
  type Base,
  type Location,
  type LocationControl,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Working a location up a level (§A4).
 *
 * The board-game half of the city: a location is captured at 1, and what it is worth is whatever
 * the holder has since poured into it. Three upgrades, each dearer than the last, each an authored
 * sentence about what actually changed on the ground — and all of it lost the moment somebody
 * takes the location off you, which is `resetOnCapture` in `battle/resolve.ts` rather than here.
 *
 * Deliberately shaped exactly like fortifying (`actions.ts`): a clock on the control row, charged
 * up front, banked lazily on the next read. Two mechanics that behave the same way are one mechanic
 * a player has to learn.
 */

/** How long a level takes to work up. Longer at each step, like the price. */
export const UPGRADE_BASE_SECONDS = 900;
export const UPGRADE_SECONDS_SCALE: readonly number[] = [1, 1.8, 3];

export function upgradeSeconds(kind: Location['kind'], level: number): number {
  const step = Math.min(UPGRADE_SECONDS_SCALE.length, Math.max(1, level)) - 1;
  const weight = LOCATION_CATALOG[kind].baseDefense / 4;
  return Math.round(UPGRADE_BASE_SECONDS * (UPGRADE_SECONDS_SCALE[step] as number) * (1 + weight));
}

export const UPGRADE_REFUSALS = {
  not_yours: 'You do not hold that',
  at_ceiling: 'That is as far as it goes',
  already_working: 'Work is already under way there',
  cannot_afford: 'You cannot cover that',
} as const;
export type UpgradeRefusal = keyof typeof UPGRADE_REFUSALS;

export type UpgradeOutcome =
  | { kind: 'refused'; reason: UpgradeRefusal }
  | { kind: 'started'; control: LocationControl; base: Base; note: string; until: string };

/** Banks a finished upgrade. Called on every read of the city, the way every clock here settles. */
export function settleUpgrade(control: LocationControl, now: Date): LocationControl {
  if (control.upgradingUntil === null) return control;
  if (Date.parse(control.upgradingUntil) > now.getTime()) return control;
  return {
    ...control,
    level: Math.min(MAX_LOCATION_LEVEL, control.level + 1),
    upgradingUntil: null,
  };
}

export function startUpgrade(
  repos: Repositories,
  args: { base: Base; location: Location; control: LocationControl; now: Date },
): UpgradeOutcome {
  const { base, location, control, now } = args;

  if (control.holder.kind !== 'faction' || control.holder.baseId !== base.id) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  if (control.upgradingUntil !== null) return { kind: 'refused', reason: 'already_working' };

  const cost = upgradeCost(location.kind, control.level);
  const note = upgradeNote(location.kind, control.level);
  if (!cost || !note) return { kind: 'refused', reason: 'at_ceiling' };
  if (!canAfford(base.resources, cost)) return { kind: 'refused', reason: 'cannot_afford' };

  const until = new Date(
    now.getTime() + upgradeSeconds(location.kind, control.level) * 1000,
  ).toISOString();
  const upgraded: LocationControl = { ...control, upgradingUntil: until };
  const paid: Base = { ...base, resources: spendResources(base.resources, cost) };

  repos.city.put(upgraded);
  repos.bases.updateResources(paid.id, paid.resources);
  return { kind: 'started', control: upgraded, base: paid, note, until };
}
