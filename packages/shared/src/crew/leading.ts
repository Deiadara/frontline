import type { OfficerRole } from '../roles.js';
import { leading, type CrewEffects } from './effects.js';

/**
 * What a chair's research is worth when the officer sitting in it leads (maintainer, 2026-09-28).
 *
 * The `lead_*` perk channels (`effects.ts`) pay the whole crew the moment *any* officer leads, and
 * that is the right shape for a perk: a person brought a habit, and the habit is the crew's. A
 * rung on an officer's own track is a different promise. The Raid Boss track is about the Raid
 * Boss "becoming better", and the Field Commander's about the army fighting better under a
 * commander, so both pay only while the officer in **that chair** is the one leading, and the
 * Raid Boss's pay him alone.
 *
 * Two scopes, because the maintainer asked for rungs "for missions" beside rungs "for fights".
 * A `mission` rung pays on a battle job taken off the board and nowhere else. A `fight` rung pays
 * in every fight the engine settles, a battle job included: a declared battle is a fight and so
 * is the one at the end of a job, and the Raid Boss's armour does not come off because the road
 * there was a contract. {@link scopesOf} is the one place that reading lives.
 *
 * Kept as a list on the fold rather than as one number per channel, because the number depends
 * on who is leading and the fold is built before anybody is named. `researchEffects` files each
 * rung under its track's role, and the settlers ask for a role and a context at the moment they
 * know both.
 */

/** Where a chair's rung pays: a battle job off the board only, or any fight the engine settles. */
export type LeaderScope = 'mission' | 'fight';

/** What is being settled: a battle job off the board, or a declared battle. */
export type FightContext = 'mission' | 'battle';

export type LeaderBonus =
  /** The officer's own sheet, in the engine's units: damage and hit points as percentages... */
  | { kind: 'leader_self'; scope: LeaderScope; stat: 'offense' | 'vitality'; percent: number }
  /** ...and armour in flat points, which may carry a person past `OFFICER_ARMOR_CAP`. */
  | { kind: 'leader_self'; scope: LeaderScope; stat: 'armor'; flat: number }
  /** How much more of the enemy's fire the officer draws, on top of `OFFICER_TARGET_SHARE`. */
  | { kind: 'leader_taunt'; scope: LeaderScope; percent: number }
  /** Every unit on the officer's side, on the crew's ordinary offense channel. */
  | { kind: 'leader_party'; scope: LeaderScope; stat: 'offense'; percent: number };

/** One rung's promise, filed under the chair whose track it sits on. */
export interface ChairLead {
  role: OfficerRole;
  bonus: LeaderBonus;
}

/** The scopes a context spends. A battle job is a mission *and* a fight; a declared battle is a fight. */
export function scopesOf(context: FightContext): readonly LeaderScope[] {
  return context === 'mission' ? ['mission', 'fight'] : ['fight'];
}

/** The rungs that pay for this chair in this context. Empty for the Overseer, who has no chair. */
export function chairLeadsFor(
  effects: Pick<CrewEffects, 'chairLeads'>,
  role: OfficerRole | null,
  context: FightContext,
): LeaderBonus[] {
  if (role === null) return [];
  const scopes = scopesOf(context);
  return effects.chairLeads
    .filter((lead) => lead.role === role && scopes.includes(lead.bonus.scope))
    .map((lead) => lead.bonus);
}

/** What the chair and its rungs do to the leader's own sheet, in the terms `officerBattleStats` takes. */
export interface OfficerSheetBonus {
  offensePercent: number;
  vitalityPercent: number;
  armorFlat: number;
  /** Extra share of the enemy's fire, as a percentage of `OFFICER_TARGET_SHARE`. */
  targetSharePercent: number;
  /**
   * What the seat multiplies the finished figure by, after the percentages (the Raid Boss's
   * {@link RAID_BOSS_SEAT_TIMES}). One for every other chair.
   */
  offenseTimes: number;
  vitalityTimes: number;
}

export const NO_SHEET_BONUS: Readonly<OfficerSheetBonus> = {
  offensePercent: 0,
  vitalityPercent: 0,
  armorFlat: 0,
  targetSharePercent: 0,
  offenseTimes: 1,
  vitalityTimes: 1,
};

/**
 * What the Raid Boss's seat is worth on its own (maintainer, 2026-09-28): in every fight he
 * leads, whatever the attribute table calculates for his damage and his hit points is doubled.
 * That is the whole of what the chair does as a chair; the track's rungs come on top of it.
 * Research needs no rung finished for it, which is why it is here and not on the fold.
 */
export const RAID_BOSS_SEAT_TIMES = 2;

export function officerSheetBonusFor(
  effects: Pick<CrewEffects, 'chairLeads'>,
  role: OfficerRole | null,
  context: FightContext,
): OfficerSheetBonus {
  const bonus: OfficerSheetBonus = { ...NO_SHEET_BONUS };
  if (role === 'raid_boss') {
    bonus.offenseTimes = RAID_BOSS_SEAT_TIMES;
    bonus.vitalityTimes = RAID_BOSS_SEAT_TIMES;
  }
  for (const lead of chairLeadsFor(effects, role, context)) {
    if (lead.kind === 'leader_taunt') bonus.targetSharePercent += lead.percent;
    else if (lead.kind === 'leader_self') {
      if (lead.stat === 'armor') bonus.armorFlat += lead.flat;
      else if (lead.stat === 'offense') bonus.offensePercent += lead.percent;
      else bonus.vitalityPercent += lead.percent;
    }
  }
  return bonus;
}

/** What the rungs put on every unit the chair leads, as points of the crew's offense channel. */
export function partyOffenseFor(
  effects: Pick<CrewEffects, 'chairLeads'>,
  role: OfficerRole | null,
  context: FightContext,
): number {
  let percent = 0;
  for (const lead of chairLeadsFor(effects, role, context)) {
    if (lead.kind === 'leader_party') percent += lead.percent;
  }
  return percent;
}

/**
 * The fold a side fights on when this chair's officer leads it.
 *
 * {@link leading} first, because an officer in a chair is an officer, and the crew-wide `lead_*`
 * channels are owed as before; then the chair's own rungs on top. A `null` role is an officer
 * with no chair, who spends the crew's channels and none of a track's.
 */
export function leadingAs(
  effects: CrewEffects,
  role: OfficerRole | null,
  context: FightContext,
): CrewEffects {
  const led = leading(effects);
  const party = partyOffenseFor(effects, role, context);
  return party === 0 ? led : { ...led, unitOffensePercent: led.unitOffensePercent + party };
}
