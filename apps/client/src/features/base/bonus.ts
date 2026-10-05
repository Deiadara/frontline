import {
  VEHICLES,
  RESOURCE_KEYS,
  basePayrollCapacity,
  buildingProduction,
  structureProductionRates,
  casualtyRecoveryShare,
  gateDefensePercent,
  heldDefense,
  generatorTimeDiscount,
  infirmaryRecoveryPercent,
  payrollBonusPercent,
  unitSlotCapacity,
  labResearchCostCut,
  storageCapacity,
  storageCapacityFor,
  timeSavingPercent,
  suppliesOnlyCut,
  musterSpeedAfterTaper,
  musterSuppliesReduction,
  musterTimeReduction,
  type Building,
  type BuildingKind,
  type CrewYield,
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
 * Every figure comes from the same shared function the server settles with: `storageCapacity`,
 * `gateDefensePercent`, `musterTimeReduction` and the rest: evaluated against a district with this
 * structure at the level in question. Nothing here has its own formula, and nothing here knows a constant the
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
  return [...buildings, { id: `preview-${kind}`, kind, level, modifications: [] }];
}

const round = (value: number): string => Math.round(value).toLocaleString();

/** An hourly rate, to one decimal where the rate is small enough for one to matter. */
/**
 * What a structure makes an hour: its share of the settle's rates when the crew's yield is known,
 * and the structure and its cards alone when it is not (a `/me` from before the field).
 */
function made(kind: BuildingKind, buildings: readonly Building[], crew?: CrewYield) {
  return crew
    ? structureProductionRates(kind, buildings, crew)
    : buildingProduction(kind, buildings);
}

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
 * *is* what a Nexus level buys. There is an entry for every kind: a missing one would leave the
 * dialog for that structure quietly saying less than the others, which is the failure mode a
 * `Record` keyed on the union makes impossible.
 */
const LINES: Record<
  BuildingKind,
  (
    buildings: readonly Building[],
    level?: number,
    /** §F2: what the crew's own storage bonus (perks and the Lab) adds, for the one line that has a ceiling in it. */
    crewStoragePercent?: number,
    /** The crew's half of the production rates (`/me`), for the three lines that make something. */
    crewYield?: CrewYield,
  ) => StructureBonus
> = {
  nexus: (buildings) => {
    const level = buildings.find((b) => b.kind === 'nexus')?.level ?? 0;
    // And the payroll book its levels add (maintainer, 2026-10-01), which was on no line: what
    // `basePayrollCapacity` holds over the bare book, before the Quarters' and the cards' percent.
    const payroll = basePayrollCapacity(level) - basePayrollCapacity(0);
    return {
      label: 'Authorises every other structure up to',
      value: `Nexus ${level} · +${round(payroll)} caps payroll`,
    };
  },
  quarters: (buildings) => ({
    label: 'Unit slots for the district, and what the payroll book stretches to',
    value: `${round(unitSlotCapacity(buildings))} unit slots · +${round(payrollBonusPercent(buildings))}% payroll`,
  }),
  greenhouse: (buildings, _level, _storage, crew) => ({
    label: 'Grows, and off the supplies a recruit eats',
    // As the bench takes it: `musterCost` tapers the Greenhouse and its cards toward 70% off the
    // line (`suppliesLineCut`, maintainer 2026-10-01). Read with no cost cut beside it, which this
    // dialog does not know; beside one, the Units chip prints the same or a fraction less.
    value: `${perHour(made('greenhouse', buildings, crew))} · -${round(suppliesOnlyCut(0, musterSuppliesReduction(buildings)))}%`,
  }),
  scrapyard: (buildings, _level, _storage, crew) => ({
    label: 'Salvages',
    value: perHour(made('scrapyard', buildings, crew)),
  }),
  /*
   * §B11: the Garage gives nothing passively, so its line is about what its level *opens*.
   *
   * It used to quote what it produced, and once that was removed it read "nothing yet" at every
   * level: a structure whose plate says the same thing at 1 and at 20 tells a player their build
   * bought nothing. What a level actually buys here is machines, and `requiresGarageLevel` runs
   * from 1 to 12, so the honest line is how much of the catalogue is open.
   */
  garage: (buildings) => {
    const level = buildings.find((b) => b.kind === 'garage')?.level ?? 0;
    const open = VEHICLES.filter((spec) => spec.requiresGarageLevel <= level).length;
    return {
      label: 'Machines the yard can build',
      value: `${open} of ${VEHICLES.length}`,
    };
  },
  /*
   * Three shelves, three figures, the same way the stockpile panel says it (`BasePanel.tsx:167`).
   *
   * `storageCapacity` is the **bulk** shelf, which is what scrap and planks get; oil and supplies
   * get two thirds of it and HQ metal a third (`STORAGE_SHARES`). Quoting the bulk under a label
   * that said "of each material" overstated the metal ceiling threefold, so a player banking alloy
   * against an Apothecary 5 read 2,162 here and watched the standing bar cap at 721.
   */
  apothecary: (buildings, _level, crewStoragePercent = 0) => {
    // ...and with the crew's own storage bonus on it, which is what the settle fills the store to.
    const bulk = storageCapacity(buildings, crewStoragePercent);
    return {
      label: 'Holds of each: scrap and planks · oil and supplies · HQ metal',
      value: [
        bulk,
        storageCapacityFor(buildings, 'oil', bulk),
        storageCapacityFor(buildings, 'highQualityMetal', bulk),
      ]
        .map(round)
        .join(' · '),
    };
  },
  /*
   * Both halves, because the Generator has had two jobs since the production split.
   *
   * It quoted the build-clock discount alone, which was the whole truth while the Scrapyard made
   * the oil. The Generator is the only source of oil in the game now, and a player pressing the
   * plot that refines fuel was told about somebody else's build queue and nothing about the fuel.
   * Same shape as the Greenhouse above: what it makes, then what it takes off a clock.
   */
  generator: (buildings, _level, _storage, crew) => ({
    // Points that join the cards' and the crew's own on one sum (2026-10-01), so the line says so.
    label: 'Refines, and off every other structure’s build clock, added to your crew’s',
    // The discount is quoted against a structure that is not the Generator: it never discounts its
    // own next level.
    value: `${perHour(made('generator', buildings, crew))} · ${round(generatorTimeDiscount('quarters', buildings))}%`,
  }),
  gate: (buildings) => ({
    label: 'A raider has to beat, and a spy has to see past',
    // What the fight reads: `gateDefensePercent` through the held-ground curve. `districtDefense` is
    // only asked whether a Gate stands (wiring audit, 2026-10-01). Its points against spies are not
    // printed: spy strength is not public (maintainer, 2026-10-01).
    value: `+${round(heldDefense(gateDefensePercent(buildings)))}% defence`,
  }),
  // The Lab's level cuts the price and opens a tier every two levels; its cards still cut the
  // clock (maintainer ruling P7-C, 2026-10-02).
  lab: (buildings) => ({
    label: 'Off every research price, and a tier of programmes every two levels',
    // A tenth, because it moves in halves: a Lab at 1 is 1.5%, not 2.
    value: `${Math.round(labResearchCostCut(buildings) * 10) / 10}%`,
  }),
  gauntlet: (buildings) => ({
    label: 'Off every unit’s muster clock',
    // The Gauntlet's figure is a speed, which `musterSecondsFor` tapers and divides the clock by, so
    // 40 of it is 29% off the clock (bug pass and taper, 2026-10-01).
    value: `${timeSavingPercent(musterSpeedAfterTaper(musterTimeReduction(buildings)))}%`,
  }),
  infirmary: (buildings) => ({
    label: 'Of the fallen back on their feet after a win',
    // Its four a level are medic points, and the share they walk home is the curve's (wiring audit,
    // 2026-10-01): a level 10 Infirmary is 40 points and 28%.
    value: `${round(casualtyRecoveryShare(infirmaryRecoveryPercent(buildings)))}%`,
  }),
};

/** What `kind` at `level` is worth to this district. */
export function structureBonus(
  kind: BuildingKind,
  buildings: readonly Building[],
  level: number,
  /** §F2: the crew's storage channel, which the Apothecary's ceiling is filled to. */
  crewStoragePercent = 0,
  /** The crew's half of the production rates, off `/me`. */
  crewYield?: CrewYield,
): StructureBonus {
  return LINES[kind](districtWith(buildings, kind, level), level, crewStoragePercent, crewYield);
}
