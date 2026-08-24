import { districtEffects, withBonus, withReduction } from './effects.js';
import { BUILDING_CATALOG, type BuildingKind } from './kinds.js';
import { buildingLevel, type Building } from './state.js';

/**
 * The district's power grid (§A1: the Generator's whole job).
 *
 * Power is deliberately **not** a resource. Nothing banks it, nothing spends it, and it never
 * appears in the stockpile: the Generator burns oil to hold the grid up, and the only question the
 * grid ever answers is whether supply covers what the district is drawing *right now*. That keeps
 * oil as the one thing being counted: the board's reading, and the reason there is no sixth
 * resource key.
 *
 * A district that outgrows its Generator does not stop. It **browns out**: everything keeps
 * running, proportionally slower, until somebody raises the Generator. A hard stop would be a wall
 * a player could hit while offline and come back to nothing; a brownout is a number sliding the
 * wrong way, which is a problem they can see and act on.
 */

/** Supply one Generator level holds up, in the abstract units the catalogue's draws are in. */
export const POWER_SUPPLY_PER_GENERATOR_LEVEL = 26;

/**
 * How a structure's draw grows with its level: +50% of its level-1 draw per level.
 *
 * Sub-linear against the Generator's linear supply on purpose. A level-20 district draws about
 * 10.5x what a level-1 one does while the Generator supplies 20x, so the Generator runs a level or
 * two ahead of the pack rather than needing to be the only thing anyone ever upgrades.
 */
export const POWER_DRAW_LEVEL_GROWTH = 0.5;

/** Oil per hour one Generator level burns. The standing cost of having the lights on. */
export const OIL_BURN_PER_GENERATOR_LEVEL = 1.5;

/** What `kind` at `level` draws, before district-wide modifications. */
export function buildingPowerDraw(kind: BuildingKind, level: number): number {
  if (level <= 0) return 0;
  return BUILDING_CATALOG[kind].basePowerDraw * (1 + (level - 1) * POWER_DRAW_LEVEL_GROWTH);
}

export interface PowerGrid {
  supply: number;
  draw: number;
  /** Supply minus draw. Negative in a brownout. */
  headroom: number;
  /** 1 when the grid covers everything; the fraction of full output otherwise. */
  ratio: number;
  brownout: boolean;
  /** Oil per hour the Generator burns to supply this. */
  oilPerHour: number;
}

/**
 * The grid as it stands. A district with no Generator has no supply and therefore runs at
 * {@link MIN_BROWNOUT_RATIO} rather than at zero: hand-cranked, candle-lit and slow, but alive.
 */
export const MIN_BROWNOUT_RATIO = 0.1;

export function powerGrid(buildings: readonly Building[]): PowerGrid {
  const effects = districtEffects(buildings);
  const generatorLevel = buildingLevel(buildings, 'generator');

  const supply = withBonus(
    generatorLevel * POWER_SUPPLY_PER_GENERATOR_LEVEL,
    effects.power_supply_percent,
  );
  const draw = withReduction(
    buildings.reduce((total, b) => total + buildingPowerDraw(b.kind, b.level), 0),
    effects.power_draw_reduction,
  );

  const ratio = draw <= 0 ? 1 : Math.min(1, Math.max(MIN_BROWNOUT_RATIO, supply / draw));

  // Fuel is burnt for the load actually being carried, not for the Generator's nameplate.
  //
  // Burning the full rate regardless would punish exactly the thing the design wants players to
  // do, build the Generator ahead of the district, and it would starve a brand-new crew, whose
  // one structure draws a fraction of what their first Generator can supply. A fully loaded
  // Generator still burns its full rate, which is where the cost is supposed to bite.
  const load = supply <= 0 ? 0 : Math.min(1, draw / supply);

  return {
    supply: Math.round(supply),
    draw: Math.round(draw),
    headroom: Math.round(supply - draw),
    ratio,
    brownout: ratio < 1,
    oilPerHour: withReduction(
      generatorLevel * OIL_BURN_PER_GENERATOR_LEVEL * load,
      effects.fuel_efficiency,
    ),
  };
}

/**
 * Whether raising `kind` to `level` would leave the district short of power.
 *
 * Reported, not refused. A player who wants to run a brownout for a while to get the Lab up is
 * making a trade, not a mistake, and the district view says plainly what it will cost them.
 */
export function wouldBrownOut(
  kind: BuildingKind,
  level: number,
  buildings: readonly Building[],
): boolean {
  // Measured from what is *standing*, not from `level - 1`. The two are the same for the only
  // caller that exists today, the dialog, asking about the next level, and they are not the same
  // for anything asking further ahead. Reading the district is the answer that stays right.
  const added =
    buildingPowerDraw(kind, level) - buildingPowerDraw(kind, buildingLevel(buildings, kind));
  const grid = powerGrid(buildings);
  return grid.draw + added > grid.supply;
}
