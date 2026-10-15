import { doorRuleSteps } from '../battle/doors.js';
import { PERK_CATALOG } from '../crew/perks.js';
import { UNIT_RULES, type UnitRuleId } from '../units/rules.js';
import { UNIT_MODIFIERS, type UnitModifierId } from '../units/stats.js';
import { EVERY_LOCATION } from './atlas.js';

/**
 * A tag a unit can be handed and does not carry on its sheet (maintainer, 2026-10-09): SAFE
 * DISTANCE off Box Nine, DRUNK off the Mess Room, GOOD BOY off the Kennels, ROOFTOP off the
 * Repeater Mast, PERCEPTION off the Old Dome, the second rung of AD HOC ARMY off the Crate Ring,
 * and since 2026-10-14 the rules a door pays by level (PAPERCUT off a level-5 Crimson Stage) and
 * the marks an officer's perk brings (Opening Volley off a Kennel Master). The card draws one the
 * crew has not unlocked greyed out with a cross, and says how to.
 *
 * Every source that can hand a unit a rule is folded here, so a grant added elsewhere is on the
 * card the day it is written: the location bonuses as the map places them (`Location.bonuses`),
 * the door ladders (`doorRuleSteps`), and
 * the perk book. `old-dome.test.ts` pins the list per unit.
 */
export interface LevelTag {
  /** The rule the tag is, as the card's rules list names it. Absent on a modifier's tag. */
  ruleId?: UnitRuleId;
  /**
   * The modifier the tag is, when a location hands over a modifier rather than a rule (Arch
   * Nineteen's golden Terror for the Hollow Men, 2026-10-13), and whether it comes in gold.
   */
  modifierId?: UnitModifierId;
  golden?: true;
  label: string;
  description: string;
  /** The location that grants it, and the level it does so from. Absent on a perk's tag. */
  locationId?: string;
  level?: number;
  /** How to unlock it, in a few words: "Hold Box Nine at level 5". */
  unlock: string;
  /**
   * For a rung of a rule the unit already carries: the level its rule has to report before the
   * tag counts as granted (AD HOC ARMY II, at the ring's 5). Absent for a mark the ground hands
   * over, which is granted exactly when the rule is on the card at all.
   */
  ruleLevel?: number;
}

const unlockAt = (name: string, level: number): string =>
  level <= 1 ? `Hold ${name}` : `Hold ${name} at level ${level}`;

/** Every level tag on the map, built once: by unit id. */
const BY_UNIT: ReadonlyMap<string, readonly LevelTag[]> = (() => {
  const out = new Map<string, LevelTag[]>();
  /**
   * One tag per thing granted, per unit: two places handing a unit the same rule print one chip
   * whose hover names both ways to it, rather than two chips that say the same word.
   */
  const add = (unitId: string, tag: LevelTag): void => {
    const held = out.get(unitId) ?? [];
    const same = held.find(
      (one) =>
        one.ruleId === tag.ruleId &&
        one.modifierId === tag.modifierId &&
        one.golden === tag.golden &&
        one.ruleLevel === tag.ruleLevel,
    );
    if (same)
      same.unlock = `${same.unlock}, or ${tag.unlock.charAt(0).toLowerCase()}${tag.unlock.slice(1)}`;
    else out.set(unitId, [...held, tag]);
  };
  const rule = (ruleId: UnitRuleId) => ({
    ruleId,
    label: UNIT_RULES[ruleId].label,
    description: UNIT_RULES[ruleId].description,
  });
  for (const location of EVERY_LOCATION) {
    for (const bonus of location.bonuses) {
      const level = bonus.fromLevel ?? 1;
      if (bonus.kind === 'unit_mark') {
        add(bonus.unitId, {
          ...rule(bonus.mark),
          locationId: location.id,
          level,
          unlock: unlockAt(location.name, level),
        });
      }
      if (bonus.kind === 'unit_modifier') {
        add(bonus.unitId, {
          modifierId: bonus.modifier,
          ...(bonus.golden ? { golden: true as const } : {}),
          label: UNIT_MODIFIERS[bonus.modifier].label,
          description: UNIT_MODIFIERS[bonus.modifier].description,
          locationId: location.id,
          level,
          unlock: unlockAt(location.name, level),
        });
      }
      if (bonus.kind === 'ad_hoc_army') {
        add('the_geppetto', {
          ruleId: 'ad_hoc_army',
          label: 'Ad Hoc Army II',
          description: 'He makes two robots a round instead of one.',
          locationId: location.id,
          level: 5,
          unlock: unlockAt(location.name, 5),
          ruleLevel: 5,
        });
      }
      // A door's ladder, by the level each rule on it is first paid (`battle/doors.ts`).
      if (bonus.kind === 'unit_door') {
        for (const step of doorRuleSteps(bonus.unitId)) {
          add(bonus.unitId, {
            ...rule(step.ruleId),
            locationId: location.id,
            level: step.level,
            unlock: unlockAt(location.name, step.level),
          });
        }
      }
    }
  }
  // A mark an officer brings with a perk: hidden until somebody with it is on the books.
  for (const perk of PERK_CATALOG) {
    if (perk.bonus.kind === 'unit_mark') {
      add(perk.bonus.unitId, {
        ...rule(perk.bonus.mark),
        unlock: `An officer with the ${perk.name} perk`,
      });
    }
  }
  return out;
})();

/** The tags this unit can gain, in map order, then the perk book's. Empty for most of the roster. */
export function levelTagsFor(unitId: string): readonly LevelTag[] {
  return BY_UNIT.get(unitId) ?? [];
}

/** Whether a card's rules already carry this tag: granted, so it draws as any other rule. */
export function levelTagGranted(
  tag: LevelTag,
  rules: readonly { id: string; level?: number | undefined }[],
  /** The card's modifiers, for a modifier's tag: granted when one of that name, gold if gold. */
  modifiers: readonly { label: string; golden?: boolean | undefined }[] = [],
): boolean {
  if (tag.modifierId !== undefined) {
    return modifiers.some(
      (one) => one.label === tag.label && (tag.golden !== true || one.golden === true),
    );
  }
  return rules.some(
    (rule) =>
      rule.id === tag.ruleId && (tag.ruleLevel === undefined || (rule.level ?? 0) >= tag.ruleLevel),
  );
}
