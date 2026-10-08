import {
  MAX_LOCATION_LEVEL,
  NOISE_SWITCH_COOLDOWN_MS,
  PAMPHLET_SWAP_CAPS,
  PAMPHLET_SWAP_COOLDOWN_MS,
  baseBonusesOf,
  findLocation,
  findUnit,
  groundStateOf,
  isHeldBy,
  spendResources,
  type Base,
  type GroundState,
  type Location,
  type LocationControl,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { AppError } from '../errors.js';

/**
 * Arca's switches and pins (maintainer, 2026-10-06): what a holder does on a location's own
 * sheet. The Tolling Tower's switch and the Pamphlet Wall's pins live on the control row, so a
 * change of hands takes them with the ground (`putControl`).
 *
 * Every refusal here is worded for the player. The client greys the control off the view's
 * fields (`switch`, `pamphlets` in `city/view.ts`) and shows what slips past beside the button,
 * so these only ever read on a race or a stale screen.
 */

/** How many pins the wall takes: one per level. */
export function pamphletCapacity(control: LocationControl): number {
  return control.level;
}

/**
 * Whether the pins may be set: once after a capture and once after each upgrade. A pin, once set,
 * is locked until the next level (maintainer, 2026-10-06), so the level the pins were last set at
 * sitting below the row's level is the whole of the rule. A fresh row reads 0 and is open.
 */
export function pamphletsUnlocked(control: LocationControl): boolean {
  return groundStateOf(control).pamphletsPinnedAt < control.level;
}

/** When the tower's switch may next be thrown, or null when it may be thrown now. */
export function switchChangesAt(state: GroundState, now: Date): string | null {
  if (state.switchedAt === null) return null;
  const at = Date.parse(state.switchedAt) + NOISE_SWITCH_COOLDOWN_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}

/** When a pin may next be swapped for caps, or null when it may be swapped now. */
export function swapAvailableAt(state: GroundState, now: Date): string | null {
  if (state.pamphletsSwappedAt === null) return null;
  const at = Date.parse(state.pamphletsSwappedAt) + PAMPHLET_SWAP_COOLDOWN_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}

/** Whether a wall is full at its top level: the one state a paid swap is offered in. */
export function swappable(control: LocationControl): boolean {
  return (
    control.level >= MAX_LOCATION_LEVEL &&
    groundStateOf(control).pamphlets.length >= pamphletCapacity(control)
  );
}

function hasBonus(location: Location, kind: string): boolean {
  return baseBonusesOf(location).some((bonus) => bonus.kind === kind);
}

/** The location and its row, for a holder doing something on its sheet. Refused in the player's words. */
function heldGround(
  repos: Repositories,
  base: Base,
  locationId: string,
  kind: 'noise_switch' | 'pamphlets',
  what: string,
): { location: Location; control: LocationControl } {
  const location = findLocation(locationId);
  const control = repos.city.control(locationId);
  if (!location || !control) throw new AppError('NOT_FOUND', 'No such location');
  if (!hasBonus(location, kind)) {
    throw new AppError('PLACE_UNAVAILABLE', `${location.name} has no ${what}`);
  }
  if (!isHeldBy(control, base.id)) {
    throw new AppError('PLACE_UNAVAILABLE', `You do not hold ${location.name}`);
  }
  return { location, control };
}

/** Wording for a wait, in whole hours or minutes, as a refusal reads it back. */
function timeLeft(until: string, now: Date): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - now.getTime()) / 60_000));
  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Throws the Tolling Tower's switch (`POST /city/switch`). Holder only, and not within
 * `NOISE_SWITCH_COOLDOWN_MS` of the last throw. Setting it to where it already stands is refused
 * too, since it would spend the cooldown on nothing.
 */
export function throwSwitch(
  repos: Repositories,
  base: Base,
  locationId: string,
  on: boolean,
  now: Date,
): LocationControl {
  const { location, control } = heldGround(repos, base, locationId, 'noise_switch', 'switch');
  const state = groundStateOf(control);
  if (state.switchedOn === on) {
    throw new AppError('PLACE_UNAVAILABLE', `${location.name} is already ${on ? 'on' : 'off'}`);
  }
  const changesAt = switchChangesAt(state, now);
  if (changesAt !== null) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `The switch was thrown recently. It can be thrown again in ${timeLeft(changesAt, now)}`,
    );
  }
  const next: LocationControl = { ...control, switchedOn: on, switchedAt: now.toISOString() };
  repos.city.put(next);
  return next;
}

/** A pin names a unit the game has, and no unit twice. */
function checkPins(pins: readonly string[], capacity: number): void {
  /*
   * The full set or nothing (maintainer, 2026-10-07).
   *
   * A short set used to be allowed and still stamped the wall at its level, which at level 5 was a
   * door that locked behind the holder: the free re-pin wants a level above the current one and
   * there is none, and the paid swap wants a full set. A wall pinned with one unit of three could
   * never be changed again, and nothing on the sheet said why. Refused at the door instead, which
   * is the only place the player can still do something about it.
   */
  if (pins.length !== capacity) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `The wall takes ${capacity} pin${capacity === 1 ? '' : 's'}, all of them at once`,
    );
  }
  if (new Set(pins).size !== pins.length) {
    throw new AppError('VALIDATION_ERROR', 'A unit can only be pinned once');
  }
  for (const unitId of pins) {
    if (!findUnit(unitId)) throw new AppError('VALIDATION_ERROR', `No such unit: ${unitId}`);
  }
}

/**
 * Sets every pin on a Pamphlet Wall at once (`POST /city/pamphlets`). Open once after a capture
 * and once after each upgrade; the set is then locked at this level (`pamphletsPinnedAt`).
 */
export function pinPamphlets(
  repos: Repositories,
  base: Base,
  locationId: string,
  pins: readonly string[],
): LocationControl {
  const { location, control } = heldGround(repos, base, locationId, 'pamphlets', 'wall');
  if (!pamphletsUnlocked(control)) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `The pins on ${location.name} are set until the wall's next level`,
    );
  }
  checkPins(pins, pamphletCapacity(control));
  const next: LocationControl = {
    ...control,
    pamphlets: [...pins],
    pamphletsPinnedAt: control.level,
  };
  repos.city.put(next);
  return next;
}

/**
 * Changes one pin on a full wall at its top level (`POST /city/pamphlets/swap`), for
 * `PAMPHLET_SWAP_CAPS`, once every `PAMPHLET_SWAP_COOLDOWN_MS`. Answers with the row and the
 * crew as charged.
 */
export function swapPamphlet(
  repos: Repositories,
  base: Base,
  locationId: string,
  swap: { from: string; to: string },
  now: Date,
): { control: LocationControl; base: Base } {
  const { location, control } = heldGround(repos, base, locationId, 'pamphlets', 'wall');
  const state = groundStateOf(control);
  if (!swappable(control)) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `A pin can be swapped only when ${location.name} is at level ${MAX_LOCATION_LEVEL} with every pin set`,
    );
  }
  const available = swapAvailableAt(state, now);
  if (available !== null) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `A pin was swapped recently. Another can be swapped in ${timeLeft(available, now)}`,
    );
  }
  if (!state.pamphlets.includes(swap.from)) {
    throw new AppError('VALIDATION_ERROR', 'That unit is not pinned on the wall');
  }
  const pins = state.pamphlets.map((unitId) => (unitId === swap.from ? swap.to : unitId));
  checkPins(pins, pamphletCapacity(control));
  if (base.resources.caps < PAMPHLET_SWAP_CAPS) {
    throw new AppError('INSUFFICIENT_RESOURCES', `A swap costs ${PAMPHLET_SWAP_CAPS} caps`);
  }
  const paid: Base = {
    ...base,
    resources: spendResources(base.resources, { caps: PAMPHLET_SWAP_CAPS }),
  };
  const next: LocationControl = {
    ...control,
    pamphlets: pins,
    pamphletsSwappedAt: now.toISOString(),
  };
  repos.bases.updateResources(paid.id, paid.resources);
  repos.city.put(next);
  return { control: next, base: paid };
}
