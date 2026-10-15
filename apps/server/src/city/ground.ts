import {
  LAMPS_COOLDOWN_MS,
  MAX_LOCATION_LEVEL,
  NOISE_SWITCH_COOLDOWN_MS,
  PAMPHLET_SWAP_CAPS,
  PAMPHLET_SWAP_COOLDOWN_MS,
  findLocation,
  findUnit,
  groundStateOf,
  isHeldBy,
  lampsLit,
  isCombatUnit,
  isUnitUnlocked,
  reactorChangesAt,
  spendResources,
  type Base,
  type GroundState,
  type Location,
  type LocationControl,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { adminCaps, adminWaives } from '../admin/mode.js';
import { AppError } from '../errors.js';
import { tallyLampsThrown, tallyReactorChosen } from '../feats/tally.js';
import { unlockContextFor } from '../units/muster.js';

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

/**
 * When a switch may next be thrown, or null when it may be thrown now: the Tolling Tower's, or
 * Lampman's Row's at its own cooldown (`LAMPS_COOLDOWN_MS`), which keeps its state in the same
 * fields.
 */
export function switchChangesAt(
  state: GroundState,
  now: Date,
  cooldownMs: number = NOISE_SWITCH_COOLDOWN_MS,
): string | null {
  if (state.switchedAt === null) return null;
  const at = Date.parse(state.switchedAt) + cooldownMs;
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
  return location.bonuses.some((bonus) => bonus.kind === kind);
}

/** The location and its row, for a holder doing something on its sheet. Refused in the player's words. */
function heldGround(
  repos: Repositories,
  base: Base,
  locationId: string,
  kind: 'noise_switch' | 'pamphlets' | 'lamps_switch' | 'reactor_choice',
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

/**
 * Lights or puts out Lampman's Row's lamps (`POST /city/lamps`, maintainer 2026-10-09). Holder
 * only, and not within `LAMPS_COOLDOWN_MS` of the last throw. Asking for the state the lamps are
 * already in is refused, since it would spend the cooldown on nothing. Out is the switch thrown
 * (`lampsLit`), so a capture, which clears the switch, hands the lamps over lit.
 */
export function throwLamps(
  repos: Repositories,
  base: Base,
  locationId: string,
  lit: boolean,
  now: Date,
): LocationControl {
  const { location, control } = heldGround(repos, base, locationId, 'lamps_switch', 'lamps');
  if (lampsLit(control) === lit) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `The lamps on ${location.name} are already ${lit ? 'lit' : 'out'}`,
    );
  }
  const changesAt = switchChangesAt(groundStateOf(control), now, LAMPS_COOLDOWN_MS);
  if (changesAt !== null) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `The lamps were changed recently. They can be changed again in ${timeLeft(changesAt, now)}`,
    );
  }
  const next: LocationControl = { ...control, switchedOn: !lit, switchedAt: now.toISOString() };
  repos.city.put(next);
  tallyLampsThrown(repos, base.id);
  return next;
}

/**
 * Names the Reactor Shed's RADIOACTIVE unit (`POST /city/reactor`, maintainer 2026-10-14). Holder
 * only; a unit type the crew can field (unlocked, and one that fights); and not within
 * `REACTOR_LOCK_MS` of the last choice. Naming the unit already chosen is refused, since it would
 * spend the lock on nothing.
 */
export function chooseReactor(
  repos: Repositories,
  base: Base,
  locationId: string,
  unitId: string,
  now: Date,
): LocationControl {
  const { location, control } = heldGround(repos, base, locationId, 'reactor_choice', 'reactor');
  const unit = findUnit(unitId);
  if (!unit || !isCombatUnit(unit) || !isUnitUnlocked(unit, unlockContextFor(repos, base))) {
    throw new AppError('PLACE_UNAVAILABLE', 'You cannot field that unit');
  }
  const state = groundStateOf(control);
  if (state.reactorUnit === unitId) {
    throw new AppError('PLACE_UNAVAILABLE', `${unit.name} are already Radioactive`);
  }
  const changesAt = reactorChangesAt(state.reactorChosenAt, now);
  if (changesAt !== null) {
    throw new AppError(
      'PLACE_UNAVAILABLE',
      `${location.name}'s choice is locked. It can be changed again in ${timeLeft(changesAt, now)}`,
    );
  }
  const next: LocationControl = {
    ...control,
    reactorUnit: unitId,
    reactorChosenAt: now.toISOString(),
  };
  repos.city.put(next);
  tallyReactorChosen(repos, base.id);
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
  /** Testing mode: the swap is quoted and not charged (`admin/mode.ts`), like every other price. */
  admin = false,
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
  // The one price in the game that still charged in testing mode (bug pass, 2026-10-11).
  if (base.resources.caps < PAMPHLET_SWAP_CAPS && !adminWaives('cannot_afford', admin)) {
    throw new AppError('INSUFFICIENT_RESOURCES', `A swap costs ${PAMPHLET_SWAP_CAPS} caps`);
  }
  const paid: Base = {
    ...base,
    resources: spendResources(base.resources, { caps: adminCaps(PAMPHLET_SWAP_CAPS, admin) }),
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
