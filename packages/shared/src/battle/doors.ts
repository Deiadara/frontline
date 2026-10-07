import type { EnvLabelId } from '../city/labels.js';
import {
  CONDEMNED_PER_LEVEL,
  LAST_CHANCE_PERCENT,
  PAPERCUT_ARMOR,
  SAINT_CONGREGATION_CAP,
} from '../city/reliquary.js';

/**
 * What a unit's door buys it at each level the crew holds (Reliquary, maintainer 2026-10-06 and
 * 2026-10-07). The player-facing words are `doorSteps` on the unit spec; this is the same ladder
 * by number, and the engine reads it off `doorLevels[unitId]` from the crew's effects.
 *
 * Every step below is cumulative: a level-4 Shrine pays levels 2, 3 and 4 together. A crew that
 * lost the door keeps the unit and fights it at level 0, which pays nothing.
 */
export interface DoorPerks {
  /** Flat points on the sheet before any percentage, like Faith. */
  offense: number;
  vitality: number;
  /** Flat points on the ratings, inside the 100 cap. */
  range: number;
  evasion: number;
  speed: number;
  stealth: number;
  /** Holds the Line while more than half of the stack stands (`holdsTheLine`). */
  stalwart: boolean;
  /** The enemy fires on this stack before the line behind it (`tauntPull`). */
  taunts: boolean;
  /** INSPIRATION: every other unit in the force ignores the labels that are bad for it. */
  inspiration: boolean;
  /** Labels this unit no longer suffers from, read in `effectiveStats`. */
  ignoredLabels: readonly EnvLabelId[];
  /** Labels that count as good ground for this unit: the bad reading flips sign. */
  homeLabels: readonly EnvLabelId[];
  /** LAST CHANCE: odds in percent that a dying body strikes once more. 0 when it does not. */
  lastChancePercent: number;
  /** SPECTACLE: the unit's kills pay infamy twice. */
  spectacle: boolean;
  /** PAPERCUT: armour stripped off every enemy unit by each round this unit fires. 0 without it. */
  papercutArmor: number;
  /** BLOWOUT: a dying body deals its offense to enemy units covering up to its own unit slots. */
  blowout: boolean;
  /** Per unit slot fighting beside this unit, flat on offense and vitality, to the cap. */
  congregationPerSlot: number;
  congregationCap: number;
}

export const NO_DOOR_PERKS: DoorPerks = {
  offense: 0,
  vitality: 0,
  range: 0,
  evasion: 0,
  speed: 0,
  stealth: 0,
  stalwart: false,
  taunts: false,
  inspiration: false,
  ignoredLabels: [],
  homeLabels: [],
  lastChancePercent: 0,
  spectacle: false,
  papercutArmor: 0,
  blowout: false,
  congregationPerSlot: 0,
  congregationCap: 0,
};

type DoorStep = Partial<DoorPerks>;

/** Levels 2 to 5 of each door, in order; level 1 is the door itself and pays nothing extra. */
const DOOR_LADDERS: Readonly<Record<string, readonly [DoorStep, DoorStep, DoorStep, DoorStep]>> = {
  the_saint: [
    { stalwart: true },
    { evasion: 10, speed: 10, stealth: 10 },
    { inspiration: true },
    { congregationPerSlot: 1, congregationCap: SAINT_CONGREGATION_CAP },
  ],
  the_condemned: [
    { offense: CONDEMNED_PER_LEVEL, vitality: CONDEMNED_PER_LEVEL },
    { offense: CONDEMNED_PER_LEVEL, vitality: CONDEMNED_PER_LEVEL },
    { offense: CONDEMNED_PER_LEVEL, vitality: CONDEMNED_PER_LEVEL },
    {
      offense: CONDEMNED_PER_LEVEL,
      vitality: CONDEMNED_PER_LEVEL,
      lastChancePercent: LAST_CHANCE_PERCENT,
    },
  ],
  the_crimson_dancer: [
    { offense: 100, vitality: 100 },
    { spectacle: true },
    { ignoredLabels: ['crammed', 'wet'], evasion: 100 },
    { papercutArmor: PAPERCUT_ARMOR },
  ],
  juggernauts: [
    { range: 20 },
    { vitality: 100, homeLabels: ['wet', 'cold', 'snowy'] },
    { offense: 50, taunts: true },
    { blowout: true },
  ],
};

/** The unit ids that have a door ladder. */
export const DOOR_UNIT_IDS: readonly string[] = Object.keys(DOOR_LADDERS);

/**
 * Everything a door at `level` pays this unit, the steps summed. Numbers add, flags and label
 * lists accumulate, so a level-5 Condemned is +120 and a level-5 Dancer still ignores the mud.
 */
export function doorPerks(unitId: string, level: number): DoorPerks {
  const ladder = DOOR_LADDERS[unitId];
  if (!ladder || level < 2) return NO_DOOR_PERKS;
  const out: DoorPerks = { ...NO_DOOR_PERKS, ignoredLabels: [], homeLabels: [] };
  for (const step of ladder.slice(0, Math.min(4, level - 1))) {
    out.offense += step.offense ?? 0;
    out.vitality += step.vitality ?? 0;
    out.range += step.range ?? 0;
    out.evasion += step.evasion ?? 0;
    out.speed += step.speed ?? 0;
    out.stealth += step.stealth ?? 0;
    out.stalwart ||= step.stalwart ?? false;
    out.taunts ||= step.taunts ?? false;
    out.inspiration ||= step.inspiration ?? false;
    out.ignoredLabels = [...out.ignoredLabels, ...(step.ignoredLabels ?? [])];
    out.homeLabels = [...out.homeLabels, ...(step.homeLabels ?? [])];
    out.lastChancePercent = Math.max(out.lastChancePercent, step.lastChancePercent ?? 0);
    out.spectacle ||= step.spectacle ?? false;
    out.papercutArmor = Math.max(out.papercutArmor, step.papercutArmor ?? 0);
    out.blowout ||= step.blowout ?? false;
    out.congregationPerSlot += step.congregationPerSlot ?? 0;
    out.congregationCap = Math.max(out.congregationCap, step.congregationCap ?? 0);
  }
  return out;
}

/** The door level a crew holds for a unit, 0 when it holds none. */
export function doorLevelOf(
  doorLevels: Readonly<Record<string, number>> | undefined,
  unitId: string,
): number {
  return Math.max(0, Math.floor(doorLevels?.[unitId] ?? 0));
}
