import {
  CISTERN_YIELD_PER_LEVEL,
  RESOURCE_KEYS,
  buildingProduction,
  characterXpBonus,
  districtDefense,
  hardshipReduction,
  moraleTarget,
  populationCapacity,
  powerGrid,
  researchTimeReduction,
  storageCapacity,
  type Building,
  type BuildingKind,
  type PartialResources,
} from '@frontline/shared';

/**
 * What a structure is *worth*, as one line the plot dialog can quote at two levels.
 *
 * §A1 gives every structure a job and the catalogue writes that job down in prose, which answers
 * "what is this for" and not "what do I get for the four hundred caps". A player deciding between
 * two upgrades is asking the second question, and until this existed the only way to answer it was
 * to buy the level and go and look at the readouts underneath the district.
 *
 * Every figure comes from the same shared function the server settles with — `storageCapacity`,
 * `districtDefense`, `powerGrid` and the rest — evaluated against a district with this structure at
 * the level in question. Nothing here has its own formula, and nothing here knows a constant the
 * game does not: a rebalance in `@frontline/shared` moves this line without anybody remembering to.
 */

export interface StructureBonus {
  /** What the number is, e.g. `Beds`. */
  label: string;
  /** The number itself, already formatted. */
  value: string;
}

/** The district as it would be with `kind` standing at `level`. */
export function districtWith(
  buildings: readonly Building[],
  kind: BuildingKind,
  level: number,
): Building[] {
  const standing = buildings.find((building) => building.kind === kind);
  if (standing) {
    return buildings.map((building) =>
      building.kind === kind ? { ...building, level } : building,
    );
  }
  // A level-0 preview is the district exactly as it is. Appending a row for it would be harmless
  // arithmetic today and a trap the first time something counts structures rather than levels.
  if (level <= 0) return [...buildings];
  return [
    ...buildings,
    { id: `preview-${kind}`, kind, level, modifications: [], damage: 0, garrisons: 0 },
  ];
}

const round = (value: number): string => Math.round(value).toLocaleString();

/** An hourly rate, to one decimal where the rate is small enough for one to matter. */
function perHour(rates: PartialResources): string {
  const parts = RESOURCE_KEYS.flatMap((key) => {
    const rate = rates[key] ?? 0;
    if (rate === 0) return [];
    const shown = Math.abs(rate) < 10 ? rate.toFixed(1) : String(Math.round(rate));
    return [`${shown} ${key === 'highQualityMetal' ? 'alloy' : key}`];
  });
  return parts.length === 0 ? 'nothing yet' : `${parts.join(', ')} / hr`;
}

/**
 * The one line each structure answers with.
 *
 * A structure whose whole job is a district-wide percentage quotes the percentage; one that makes
 * something quotes the rate; the Nexus quotes the ceiling it holds everything else at, because that
 * *is* what a Nexus level buys. There is an entry for every kind — a missing one would leave the
 * dialog for that structure quietly saying less than the others, which is the failure mode a
 * `Record` keyed on the union makes impossible.
 */
const LINES: Record<BuildingKind, (buildings: readonly Building[]) => StructureBonus> = {
  nexus: (buildings) => ({
    label: 'Caps every other structure at',
    value: `level ${buildings.find((b) => b.kind === 'nexus')?.level ?? 0}`,
  }),
  quarters: (buildings) => ({
    label: 'Beds, and where morale settles',
    value: `${round(populationCapacity(buildings))} · morale ${round(moraleTarget(buildings))}`,
  }),
  greenhouse: (buildings) => ({
    label: 'Grows',
    value: perHour(buildingProduction('greenhouse', buildings)),
  }),
  scrapyard: (buildings) => ({
    label: 'Salvages',
    value: perHour(buildingProduction('scrapyard', buildings)),
  }),
  garage: (buildings) => ({
    label: 'Refines',
    value: perHour(buildingProduction('garage', buildings)),
  }),
  apothecary: (buildings) => ({
    label: 'Holds, of each material',
    value: round(storageCapacity(buildings)),
  }),
  cistern: (buildings) => ({
    label: 'Treated water',
    value: `+${(buildings.find((b) => b.kind === 'cistern')?.level ?? 0) * CISTERN_YIELD_PER_LEVEL}% yield · ${round(populationCapacity(buildings))} beds`,
  }),
  generator: (buildings) => {
    const grid = powerGrid(buildings);
    return { label: 'Supplies', value: `${round(grid.supply)} against ${round(grid.draw)} drawn` };
  },
  gate: (buildings) => ({
    label: 'A raider has to beat',
    value: `${round(districtDefense(buildings))} defence`,
  }),
  lab: (buildings) => ({
    label: 'Off every research clock',
    value: `${round(researchTimeReduction(buildings))}%`,
  }),
  gauntlet: (buildings) => ({
    label: 'On every character XP award',
    value: `+${round(characterXpBonus(buildings))}%`,
  }),
  infirmary: (buildings) => ({
    label: 'Off a missed payday or a starved week',
    value: `${round(hardshipReduction(buildings))}%`,
  }),
};

/** What `kind` at `level` is worth to this district. */
export function structureBonus(
  kind: BuildingKind,
  buildings: readonly Building[],
  level: number,
): StructureBonus {
  return LINES[kind](districtWith(buildings, kind, level));
}
