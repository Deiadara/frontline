import { applyPerkBonus, discounted, noCrewEffects, type CrewEffects } from '../crew/effects.js';
import { describePerkBonus, type PerkBonus } from '../crew/perks.js';
import {
  OFFICER_MARKS,
  OFFICER_MARK_CEILING,
  OFFICER_MARK_FLOOR,
  markAtLeast,
  markIndex,
  type OfficerMark,
} from '../crew/marks.js';
import { OFFICER_ROLES, OFFICER_ROLE_LABELS, type OfficerRole } from '../roles.js';
import type { PartialResources } from '../resources.js';

/**
 * Research, as nineteen tracks (board brief 2026-09-03, §C).
 *
 * One track per officer role, ten rungs each. A track is that officer's trade written down: what
 * the Cartographer knows about crossing the city, what the Chief Medic knows about who comes back.
 * The Lab used to hold a flat tree of fifteen programmes on five themes nobody was attached to;
 * this is the same machinery pointed at the people the player actually hires.
 *
 * ## Three things gate a rung
 *
 * The **track's own officer** has to be in their chair, at a mark (§C1b, §C2a). The **Head of
 * Research** has to be in theirs for anything at all (§C1c), and past the third rung they have a
 * mark of their own to clear (§C2e). And the rung below has to be finished, so a track is climbed
 * rather than cherry-picked.
 *
 * ## Marks gate, points pay
 *
 * A mark is a threshold and a label, and that is the whole of what it does here (§C3b). Every
 * number that actually moves is computed from the underlying score: the Head of Research's cuts the
 * clock ({@link researchTimeCutPercent}), the track officer's cuts the bill
 * ({@link trackCostCutPercent}). Train one attribute and the figures move the same afternoon; the
 * letter moves in a week, which is what makes it worth printing.
 *
 * ## The curve
 *
 * {@link TRACK_MARKS} is deliberately convex: three single-band steps to open, then twos, then
 * threes, topping out at `S` and never `S+` (§C2b to §C2d). A crew that has just hired somebody
 * lands around `F+`, so the first three rungs of every track are open to a fresh recruit and the
 * rest is a reason to keep them.
 */

/** Ten rungs per track (§C1e). */
export const RESEARCH_TRACK_STEPS = 10;

/**
 * The mark the track's own officer needs, by rung (§C2a to §C2d).
 *
 * Indices on the twenty one band ladder: 0, 1, 2, 3, 5, 7, 10, 13, 16, 19. The gaps run
 * 1,1,1,2,2,3,3,3,3, which is the "not harsh early, harder late" the brief asks for and is a curve
 * rather than a slope. The top is `S` exactly: `S+` is reserved and nothing may ask for it.
 */
export const TRACK_MARKS: readonly OfficerMark[] = [
  'F-',
  'F',
  'F+',
  'E-',
  'E+',
  'D',
  'C',
  'B',
  'A',
  'S',
];

/**
 * What the Head of Research has to be, and from which rung (§C2e).
 *
 * Three thresholds, taking effect after the 3rd, 5th and 7th item. Each sits one band above the
 * track requirement at the rung where it starts, so the Head is the binding gate on rungs 4, 6 and
 * 8 and the track's own officer is the binding gate on 5, 7, 9 and 10. Neither sheet is decoration
 * and neither dominates (§C1d).
 */
export const HEAD_MARK_THRESHOLDS: readonly {
  readonly afterStep: number;
  readonly mark: OfficerMark;
}[] = [
  { afterStep: 3, mark: 'E' },
  { afterStep: 5, mark: 'D+' },
  { afterStep: 7, mark: 'B+' },
];

/** The mark the track officer needs for a rung. Rungs are 1-based. */
export function requiredTrackMark(step: number): OfficerMark {
  return TRACK_MARKS[Math.min(TRACK_MARKS.length, Math.max(1, step)) - 1] as OfficerMark;
}

/** The mark the Head of Research needs for a rung, or `null` on the first three. */
export function requiredHeadMark(step: number): OfficerMark | null {
  let needed: OfficerMark | null = null;
  for (const threshold of HEAD_MARK_THRESHOLDS) {
    if (step > threshold.afterStep) needed = threshold.mark;
  }
  return needed;
}

/**
 * What a rung pays out.
 *
 * Any bonus a perk or a piece of ground can pay ({@link PerkBonus}: every channel the crew fold
 * already reads, a tier or one unit's own stats, flat points on every officer in a group, a
 * resource an hour, vision, syringes, training sessions), plus three grants no perk makes: another
 * crew out on a job at once, another chair at the Bar, another fight called at once. A rung is
 * folded into the same struct territory, crew attributes and the Garage all write into, so a
 * finished rung is wired into every consumer that already reads those effects with no new
 * parameter threaded anywhere. `unlocks` is set on the rungs that also open something the crew can
 * lay or buy; it is the words for it, because the catalogues that own those things import this
 * module and cannot be imported back.
 *
 * ## Why not a percentage on every rung
 *
 * It was one channel and one percentage per rung, sized by depth. Ten rungs of `+N% build speed`
 * is a slider, and a slider is not a reason to climb: the board asked for rewards a player would
 * plan a crew around. So the deep rungs open doors (a second crew out, a fourth fight called), the
 * middle ones favour a kind of unit or lift the other officers, and the percentages are kept where
 * a percentage is the honest shape of the thing.
 */
export type ResearchBonus =
  | PerkBonus
  /** Another crew out on a job at the same time (§E). */
  | { kind: 'mission_slots'; flat: number }
  /** Another chair at the Bar: one more officer on the books. */
  | { kind: 'recruit_slots'; flat: number }
  /** Another fight called and pending at once. */
  | { kind: 'declarations'; flat: number };

export interface ResearchPayout {
  bonus: ResearchBonus;
  unlocks?: string;
}

/**
 * The kinds of payout, and which bonus is which (§C4a, widened by the board on 2026-09-04).
 *
 * Held as a table rather than as a comment so `research.tracks.test.ts` can assert that every one
 * of the 190 rungs lands in one of them. A ninth family cannot be added by accident: a bonus kind
 * with no entry here fails the same test.
 */
export const PAYOUT_FAMILIES = [
  'unlock',
  'thrift',
  'yield',
  'battle',
  'counterintel',
  'travel',
  'people',
  'command',
] as const;
export type PayoutFamily = (typeof PAYOUT_FAMILIES)[number];

/**
 * Which family each bonus kind belongs to.
 *
 * `intel` is filed under `counterintel` with its mirror: the Head Spy's and the Scout's tracks are
 * about the quiet war in both directions. `people` is what lifts the officers or seats another;
 * `command` is what widens what the crew may have going at once.
 */
const KIND_FAMILY: Readonly<Record<ResearchBonus['kind'], PayoutFamily>> = {
  research_speed: 'thrift',
  build_speed: 'thrift',
  training_speed: 'thrift',
  training_cost: 'thrift',
  build_cost: 'thrift',
  wage_discount: 'thrift',
  payroll_step_discount: 'thrift',
  market_discount: 'thrift',
  black_market_discount: 'thrift',
  refit_discount: 'thrift',
  vehicle_parts: 'thrift',
  building_cost: 'thrift',
  building_credit: 'thrift',

  production: 'yield',
  storage_capacity: 'yield',
  loot_capacity: 'yield',
  recruit_pool: 'yield',
  resource: 'yield',
  resource_yield: 'yield',
  mission_spoils: 'yield',
  salvage_refund: 'yield',
  population: 'yield',
  xp_gain: 'yield',
  infamy_gain: 'yield',

  defense_percent: 'battle',
  unit_offense: 'battle',
  unit_vitality: 'battle',
  unit_armor: 'battle',
  unit_tier: 'battle',
  unit_kind: 'battle',
  unit_morale: 'battle',
  unit_speed: 'battle',
  unit_stealth: 'battle',
  cohesion: 'battle',
  casualty_recovery: 'battle',
  intimidation: 'battle',
  allied_offense: 'battle',
  gate_defense: 'battle',
  whole_district: 'battle',
  battle_stims: 'battle',
  lead_offense: 'battle',
  lead_evasion: 'battle',
  lead_armor: 'battle',
  lead_morale: 'battle',
  lead_loot: 'battle',
  lead_arrival: 'travel',

  intel_resistance: 'counterintel',
  intel: 'counterintel',

  travel_speed: 'travel',
  mission_speed: 'travel',
  vision: 'travel',

  officer_group: 'people',
  officer_attribute: 'people',
  officer_threshold: 'people',
  recruit_slots: 'people',
  training_sessions: 'people',

  mission_slots: 'command',
  declarations: 'command',

  // The 2026-09-09 rules. Filed by what they change rather than by being new: a road is `travel`
  // whether it is bought in minutes or in percent, and a mark on a sheet is `battle`.
  road_shortcut: 'travel',
  carriers_fight: 'battle',
  any_ride: 'travel',
  unit_mark: 'battle',
  steady_nerve: 'battle',
  scout_parties: 'counterintel',
};

export function payoutFamily(payout: ResearchPayout): PayoutFamily {
  if (payout.unlocks !== undefined) return 'unlock';
  return KIND_FAMILY[payout.bonus.kind];
}

export interface ResearchItemSpec {
  id: string;
  track: OfficerRole;
  /** 1 to {@link RESEARCH_TRACK_STEPS}. */
  step: number;
  name: string;
  description: string;
  payout: ResearchPayout;
  cost: PartialResources;
  /** The catalogue clock, before the Lab, the crew and the Head of Research take their cuts. */
  minutes: number;
  requiresMark: OfficerMark;
  requiresHeadMark: OfficerMark | null;
}

const roundTo = (value: number, unit: number): number => Math.round(value / unit) * unit;

/**
 * What a rung costs, from its depth alone.
 *
 * A formula rather than 190 hand-written prices: the numbers are meant to read as one ladder, and
 * a table that long drifts the moment somebody retunes half of it. High quality metal appears from
 * the fourth rung, which is also where the Head of Research's own mark starts to bite.
 */
export function researchItemCost(step: number): PartialResources {
  const cost: PartialResources = {
    caps: roundTo(600 * step ** 1.35, 50),
    scrap: roundTo(400 * step ** 1.25, 50),
  };
  if (step >= 4) cost.highQualityMetal = roundTo(30 * (step - 3) ** 1.3, 10);
  return cost;
}

/** The catalogue clock for a rung, in minutes: 45 at the bottom of a track, 270 at the top. */
export function researchItemMinutes(step: number): number {
  return 20 + 25 * step;
}

/** One rung as it is written in the catalogue below. Everything else is derived. */
interface TrackEntry {
  name: string;
  blurb: string;
  bonus: ResearchBonus;
  /** Set on the rungs that also open something. The words are the thing's own name. */
  unlocks?: string;
}

/** `Dead Drops` becomes `tech_dead_drops`, which is how the fifteen older ids were already spelled. */
function idOf(name: string): string {
  return `tech_${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;
}

function buildTrack(track: OfficerRole, entries: readonly TrackEntry[]): ResearchItemSpec[] {
  return entries.map((entry, index) => {
    const step = index + 1;
    return {
      id: idOf(entry.name),
      track,
      step,
      name: entry.name,
      description: entry.blurb,
      payout:
        entry.unlocks === undefined
          ? { bonus: entry.bonus }
          : { bonus: entry.bonus, unlocks: entry.unlocks },
      cost: researchItemCost(step),
      minutes: researchItemMinutes(step),
      requiresMark: requiredTrackMark(step),
      requiresHeadMark: requiredHeadMark(step),
    };
  });
}

/** What each track is about, in the one line the rail prints under its name. */
export const RESEARCH_TRACK_BLURBS: Readonly<Record<OfficerRole, string>> = {
  head_spy: 'What they never find out, and what you do.',
  lead_engineer: 'What is standing, how fast it went up, and what it cost.',
  finance_officer: 'What everything costs and what you actually pay.',
  head_of_growth: 'More of everything, off the same ground.',
  field_commander: 'How much of what you brought is really in the fight.',
  head_of_research: 'Everything the Lab does, done sooner.',
  wetware_chief: 'Meat improved, at a price.',
  fabricator: 'Making the thing, out of whatever there is.',
  salvager: 'There is nothing new. There is only what somebody left.',
  right_hand: 'The room runs whether you are in it or not.',
  cartographer: 'How long it takes to get anywhere.',
  trader: 'What you can get for what you have.',
  security_officer: 'Getting in should cost them.',
  chief_medic: 'How many of them come back.',
  instructor_of_the_young: 'How fast a body becomes a soldier.',
  raid_boss: 'Going and taking it.',
  scout: 'Knowing before you go.',
  consigliere: 'What is said, and what is meant.',
  professor: 'Somebody has to sit with the files.',
};

const CATALOGUE: readonly ResearchItemSpec[] = [
  ...buildTrack('head_spy', [
    {
      name: 'Dead Drops',
      blurb: 'A brick, the gap behind it, and two people who never meet.',
      bonus: { kind: 'intel_resistance', percent: 4 },
    },
    {
      name: 'Cut-Outs',
      blurb: 'Every message passes through somebody who can name neither end.',
      bonus: { kind: 'intel_resistance', percent: 5 },
    },
    {
      name: 'Traffic Analysis',
      blurb: 'You do not need to read it. You need to know who is talking to whom.',
      bonus: { kind: 'intel', percent: 6 },
    },
    {
      name: 'Two Sets of Eyes',
      blurb: 'Never one watcher on anything, so nothing waits on one person coming home.',
      // A second scouting party out at once, which the door's one limit otherwise refuses. One,
      // matching the Watchtower and the Second Glass: doubling the rate is the whole of it, and
      // three sources of the same permission is already a crew that sees everything.
      bonus: { kind: 'scout_parties', flat: 1 },
    },
    {
      name: 'Legend Building',
      blurb: 'A whole life on paper, for somebody who has never existed.',
      bonus: { kind: 'unit_stealth', percent: 6 },
    },
    {
      name: 'One-Time Pads',
      blurb: 'Slow, unbreakable, and everybody hates carrying the books.',
      bonus: { kind: 'intel_resistance', percent: 10 },
    },
    {
      name: 'Turned Runners',
      blurb: 'Their courier still runs their route. He stops here first.',
      bonus: { kind: 'vision', districts: 1 },
    },
    {
      name: 'Compartmentation',
      blurb: 'Nobody knows more than the next name up. Not even you.',
      bonus: { kind: 'officer_group', group: 'mental', flat: 2 },
    },
    {
      name: 'False Traffic',
      blurb: 'A whole second district that does not exist, chattering away all night.',
      bonus: { kind: 'intel_resistance', percent: 14 },
    },
    {
      name: 'The Long Silence',
      blurb: 'For a week the wire says nothing at all, and that is the loudest thing on it.',
      bonus: { kind: 'unit_kind', unitId: 'ghosts', stat: 'offense', percent: 20 },
    },
  ]),

  ...buildTrack('lead_engineer', [
    {
      name: 'Load Tables',
      blurb: 'Somebody finally wrote down what each beam actually carries.',
      bonus: { kind: 'build_speed', percent: 4 },
    },
    {
      name: 'Site Discipline',
      blurb: 'Tools go back. It saves an hour a day and nobody believes it until it does.',
      bonus: { kind: 'build_speed', percent: 5 },
    },
    {
      name: 'Formwork Reuse',
      blurb: 'The same moulds, twelve pours, if you clean them.',
      bonus: { kind: 'build_cost', percent: 6 },
    },
    {
      name: 'Bracing Standards',
      blurb: 'One drawing for every corner, so no corner is somebody guessing.',
      bonus: { kind: 'building_cost', building: 'gate', percent: 15 },
    },
    {
      name: 'Prefabrication',
      blurb: 'Made flat on the ground and stood up in an afternoon.',
      /*
       * The Gauntlet, priced a level lower for ever (`building_credit`).
       *
       * A level is 28% of the bill at any height (`BUILDING_COST_GROWTH`), so this is worth about
       * what the track's own `building_cost` rung is worth on the Gate, and it is worth it just as
       * much at level 18 as at level 2. One level, not two: two is a strictly better perk than
       * anything else on this track and the ladder is meant to be climbed rather than skipped.
       */
      bonus: { kind: 'building_credit', building: 'gauntlet', levels: 1 },
    },
    {
      name: 'Cold Joints',
      blurb: "Where yesterday's pour meets today's, and how not to leave a seam.",
      bonus: { kind: 'gate_defense', percent: 12 },
    },
    {
      name: 'Critical Path',
      blurb: 'Every build is planned backwards from the day it has to be standing.',
      bonus: { kind: 'build_speed', percent: 12 },
    },
    {
      name: 'Tolerance Stacking',
      blurb: 'Six parts, each within a millimetre, and the seventh will not go on. Now it does.',
      bonus: { kind: 'building_cost', building: 'nexus', percent: 20 },
    },
    {
      name: 'Rebar Schedules',
      blurb: 'Steel in the concrete, laid to a drawing rather than to a mood.',
      bonus: { kind: 'defense_percent', percent: 9 },
    },
    {
      name: 'The Standing Order',
      blurb: 'A structure is finished when the file is closed, and not before.',
      bonus: { kind: 'build_speed', percent: 18 },
    },
  ]),

  ...buildTrack('finance_officer', [
    {
      name: 'Double Entry',
      blurb: 'Two columns. It is astonishing how much stops going missing.',
      bonus: { kind: 'wage_discount', percent: 4 },
    },
    {
      name: 'Bulk Contracts',
      blurb: 'Buy for the quarter, not for the week.',
      bonus: { kind: 'market_discount', percent: 5 },
    },
    {
      name: 'Wage Bands',
      blurb: 'Everybody knows what the job pays before they ask what it pays.',
      bonus: { kind: 'wage_discount', percent: 6 },
    },
    {
      name: 'Depreciation',
      blurb: 'A machine is worth less every month, and now the books say so.',
      bonus: { kind: 'vehicle_parts', percent: 10 },
    },
    {
      name: 'Payroll Netting',
      blurb: 'One transfer instead of forty. Forty fees become one.',
      bonus: { kind: 'payroll_step_discount', percent: 10 },
    },
    {
      name: 'Unit Costing',
      blurb: 'What one soldier costs to put in the field, to the cap.',
      bonus: { kind: 'training_cost', percent: 8 },
    },
    {
      name: 'Hedged Stock',
      blurb: 'Half the scrap bought forward, so a bad month is only half a bad month.',
      bonus: { kind: 'resource', resource: 'caps', perHour: 12 },
    },
    {
      name: 'Audit Trail',
      blurb: 'Somebody checks. That is the whole of the intervention.',
      bonus: { kind: 'wage_discount', percent: 10 },
    },
    {
      name: 'Capital Rationing',
      blurb: 'Three projects, money for two, and a rule for choosing.',
      bonus: { kind: 'build_cost', percent: 10 },
    },
    {
      name: 'The Ledger Closes',
      blurb: 'Every cap accounted for, every month, without exception.',
      bonus: { kind: 'resource', resource: 'caps', perHour: 30 },
    },
  ]),

  ...buildTrack('head_of_growth', [
    {
      name: 'Shift Rotation',
      blurb: 'Three watches instead of two. Nothing stands idle between them.',
      bonus: { kind: 'production', percent: 5 },
    },
    {
      name: 'Word of Mouth',
      blurb: 'People come because somebody they trust told them to.',
      bonus: { kind: 'recruit_pool', percent: 8 },
    },
    {
      name: 'Yield Records',
      blurb: 'What each line made, every day, on a board where everyone sees it.',
      bonus: { kind: 'resource_yield', resource: 'supplies', percent: 8 },
    },
    {
      name: 'Open Intake',
      blurb: 'The door is open two nights a week and the room is warm.',
      bonus: { kind: 'population', flat: 20 },
    },
    {
      name: 'Line Balancing',
      blurb: 'Somebody finally timed every station and moved the slow one.',
      bonus: { kind: 'production', percent: 8 },
    },
    {
      name: 'Overflow Yards',
      blurb: 'Ground nobody was using, fenced and drained.',
      bonus: { kind: 'storage_capacity', percent: 12 },
    },
    {
      name: 'Apprentice Pipeline',
      blurb: 'Every hand teaches the next one, on the clock.',
      bonus: { kind: 'training_sessions', flat: 1 },
    },
    {
      name: 'Continuous Casting',
      blurb: 'The line does not stop between batches any more.',
      bonus: { kind: 'resource', resource: 'scrap', perHour: 20 },
    },
    {
      name: 'Second Site',
      blurb: 'A yard on the far side of the district, running the same hours.',
      bonus: { kind: 'production', percent: 12 },
    },
    {
      name: 'The Growth Curve',
      blurb: 'It compounds. That is the whole trick and it takes a year to see.',
      bonus: { kind: 'recruit_slots', flat: 1 },
    },
  ]),

  ...buildTrack('field_commander', [
    {
      name: 'Order of March',
      blurb: 'Who walks where, so the column does not arrive in pieces.',
      bonus: { kind: 'cohesion', percent: 4 },
    },
    {
      name: 'Standing Signals',
      blurb: 'Three flags, and everyone knows what they mean under fire.',
      bonus: { kind: 'cohesion', percent: 5 },
    },
    {
      name: 'Fire Discipline',
      blurb: 'Nobody shoots until the word, and then everybody does.',
      bonus: { kind: 'unit_tier', tier: 'rabble', stat: 'offense', percent: 6 },
    },
    {
      name: 'Reserve Doctrine',
      blurb: 'A third of the force does nothing at all until it matters.',
      bonus: { kind: 'unit_morale', flat: 3 },
    },
    {
      name: 'Frontage Drill',
      blurb: 'Widening the line without thinning it, practised until it is dull.',
      bonus: { kind: 'cohesion', percent: 9 },
    },
    {
      name: 'Rally Points',
      blurb: 'Everybody knows where to run to, so running is not a rout.',
      bonus: { kind: 'unit_morale', flat: 5 },
    },
    {
      name: 'Combined Arms',
      blurb: 'The heavy holds, the fast flanks, and neither of them goes alone.',
      bonus: { kind: 'unit_tier', tier: 'heavy', stat: 'offense', percent: 10 },
    },
    {
      name: 'Night Movement',
      blurb: 'Arriving somewhere they were not looking, at an hour they were not up.',
      bonus: { kind: 'travel_speed', percent: 8 },
    },
    {
      name: 'Echelon Attack',
      blurb: 'One flank hits first. The other hits the response to it.',
      bonus: { kind: 'allied_offense', percent: 10 },
    },
    {
      name: 'The Whole Force',
      blurb: 'Every body you brought is in the fight, which almost never happens.',
      bonus: { kind: 'declarations', flat: 1 },
    },
  ]),

  ...buildTrack('head_of_research', [
    {
      name: 'Reading Room',
      blurb: 'Somewhere quiet, with the files in it, and a rule about noise.',
      bonus: { kind: 'research_speed', percent: 5 },
    },
    {
      name: 'Index Cards',
      blurb: 'Nobody looks for the same thing twice.',
      bonus: { kind: 'research_speed', percent: 6 },
    },
    {
      name: 'Bench Notebooks',
      blurb: 'Written down as it happens, not remembered afterwards.',
      bonus: { kind: 'xp_gain', percent: 5 },
    },
    {
      name: 'Peer Review',
      blurb: 'Somebody who was not there reads it before anybody believes it.',
      bonus: { kind: 'research_speed', percent: 8 },
    },
    {
      name: 'Instrument Calibration',
      blurb: 'Every gauge checked against one gauge, monthly.',
      bonus: { kind: 'officer_group', group: 'technical', flat: 2 },
    },
    {
      name: 'Field Debriefs',
      blurb: 'The people who used it tell you what actually happened to it.',
      bonus: { kind: 'intel', percent: 8 },
    },
    {
      name: 'Long Programmes',
      blurb: 'Three projects that nobody is allowed to interrupt for anything.',
      bonus: { kind: 'research_speed', percent: 12 },
    },
    {
      name: 'The Archive',
      blurb: 'Twenty years of somebody else failing, catalogued and cross-referenced.',
      bonus: { kind: 'officer_group', group: 'mental', flat: 3 },
    },
    {
      name: 'Shared Bench',
      blurb: 'The chemist and the engineer at the same table, on purpose.',
      bonus: { kind: 'build_speed', percent: 8 },
    },
    {
      name: 'The Method',
      blurb: 'Guess, test, discard, write it down. It sounds like nothing at all.',
      bonus: { kind: 'research_speed', percent: 18 },
    },
  ]),

  ...buildTrack('wetware_chief', [
    {
      name: 'Clean Room',
      blurb: 'Half of what kills an implant is dust.',
      bonus: { kind: 'casualty_recovery', percent: 5 },
    },
    {
      name: 'Nerve Mapping',
      blurb: 'Which wire goes where in this body, not in the manual.',
      bonus: { kind: 'unit_speed', percent: 5 },
    },
    {
      name: 'Rejection Protocols',
      blurb: 'The body says no. There is a way to argue with it.',
      bonus: { kind: 'casualty_recovery', percent: 7 },
    },
    {
      name: 'Reflex Shunts',
      blurb: 'A shortcut past the brain for the things the brain is slow at.',
      bonus: { kind: 'unit_tier', tier: 'specialist', stat: 'offense', percent: 8 },
    },
    {
      name: 'Load-Bearing Frames',
      blurb: 'Bone is not the strongest thing that can be in there.',
      bonus: { kind: 'unit_tier', tier: 'heavy', stat: 'vitality', percent: 8 },
    },
    {
      name: 'Pain Gating',
      blurb: 'Not switched off. Turned down, and only on the day.',
      bonus: { kind: 'unit_morale', flat: 5 },
    },
    {
      name: 'Subdermal Plate',
      blurb: 'Under the skin, over the parts that matter.',
      bonus: { kind: 'unit_armor', percent: 6 },
    },
    {
      name: 'Salvage Grafts',
      blurb: "Somebody else's arm, and it works.",
      bonus: { kind: 'battle_stims', flat: 1 },
    },
    {
      name: 'Neural Redundancy',
      blurb: 'Two paths for every signal, so one of them can be cut.',
      bonus: { kind: 'unit_tier', tier: 'wonder', stat: 'vitality', percent: 12 },
    },
    {
      name: 'The Second Body',
      blurb: 'By the end there is not much of the first one left.',
      bonus: { kind: 'unit_kind', unitId: 'juggernauts', stat: 'vitality', percent: 20 },
    },
  ]),

  ...buildTrack('fabricator', [
    {
      name: 'Jigs and Fixtures',
      blurb: 'Held the same way every time, so it comes out the same way every time.',
      bonus: { kind: 'training_cost', percent: 5 },
    },
    {
      name: 'Tool Steel',
      blurb: 'Harder than the thing it cuts, and it stays that way.',
      bonus: { kind: 'build_cost', percent: 5 },
    },
    {
      name: 'Batch Runs',
      blurb: 'Forty of them, then set up for the next thing. Never one at a time.',
      bonus: { kind: 'training_cost', percent: 7 },
    },
    {
      name: 'Standard Parts',
      blurb: 'One thread, one gauge, one size of bolt. It took two years to agree on.',
      bonus: { kind: 'refit_discount', percent: 10 },
      unlocks: 'the Plated Overnight battle boost',
    },
    {
      name: 'Cold Forming',
      blurb: 'Shaped without heat, which is most of the cost gone.',
      bonus: { kind: 'build_cost', percent: 9 },
    },
    {
      name: 'Reimagining',
      blurb: 'Three drawings that suit nothing, read together until a fourth falls out.',
      bonus: { kind: 'salvage_refund', percent: 8 },
      unlocks: 'the Reimagining bench on the Blueprints page',
    },
    {
      name: 'Investment Casting',
      blurb: 'A wax model, a shell around it, and a part with no seam anywhere.',
      bonus: { kind: 'unit_tier', tier: 'rabble', stat: 'armor', percent: 8 },
    },
    {
      name: 'Hard Chrome',
      blurb: 'A tenth of a millimetre that triples how long the thing lasts.',
      bonus: { kind: 'unit_armor', percent: 8 },
    },
    {
      name: 'Numerical Control',
      blurb: "The machine reads the drawing. Nobody's hand is anywhere in it.",
      bonus: { kind: 'build_speed', percent: 10 },
    },
    {
      name: 'The Master Pattern',
      blurb: 'One perfect part, and every other one measured against it.',
      bonus: { kind: 'unit_kind', unitId: 'ironsides', stat: 'armor', percent: 15 },
    },
  ]),

  ...buildTrack('salvager', [
    {
      name: 'Sorted Salvage',
      blurb: 'Two extra bins and a rule about which one things go in.',
      bonus: { kind: 'storage_capacity', percent: 6 },
    },
    {
      name: 'Torch Discipline',
      blurb: 'Cut where it comes apart, not where it looks easy.',
      bonus: { kind: 'loot_capacity', percent: 6 },
    },
    {
      name: 'Magnet Sweeps',
      blurb: 'The yard, once a week, on a rope.',
      bonus: { kind: 'resource', resource: 'scrap', perHour: 6 },
    },
    {
      name: 'Alloy Reclamation',
      blurb: 'The good metal is in there. It is just mixed with everything else.',
      bonus: { kind: 'resource_yield', resource: 'scrap', percent: 10 },
    },
    {
      name: 'Yard Discipline',
      blurb: 'Everybody who works a site can hold one. That is how the site stays yours.',
      // The porters take a place in the line at half strength (`carriers_fight`, `CARRIER_STRENGTH`).
      // The fifth rung rather than the tenth: it is a permission rather than a magnitude, so a deep
      // rung would be a door that opens once and pays nothing further, and the track's own late
      // rungs are the ones that should carry the big figures.
      bonus: { kind: 'carriers_fight' },
    },
    {
      name: 'Dry Storage',
      blurb: 'Rain is what turns salvage into rust.',
      bonus: { kind: 'storage_capacity', percent: 12 },
    },
    {
      name: 'Deep Sites',
      blurb: 'The places that are hard to get into are the places nobody has been.',
      bonus: { kind: 'mission_spoils', percent: 8 },
    },
    {
      name: 'Furnace Runs',
      blurb: 'Everything unusable, once a month, into one pour.',
      bonus: { kind: 'resource', resource: 'highQualityMetal', perHour: 2 },
    },
    {
      name: 'Haul Rigging',
      blurb: 'The truck comes back full because somebody loaded it properly.',
      // A mark on one sheet rather than fifteen percent on one of its eleven numbers. Haulers were
      // the only carrier in the roster without `picker`, and this is the rung that makes them the
      // crew that goes through the ground on the way out (`PICKER_EXTRA_LOAD`).
      bonus: { kind: 'unit_mark', unitId: 'haulers', mark: 'picker' },
    },
    {
      name: 'Nothing Wasted',
      blurb: 'By now the yard puts out more than the district takes in.',
      bonus: { kind: 'salvage_refund', percent: 15 },
    },
  ]),

  ...buildTrack('right_hand', [
    {
      name: 'Standing Orders',
      blurb: 'Written down once, so nobody has to ask twice.',
      bonus: { kind: 'wage_discount', percent: 4 },
    },
    {
      name: 'Duty Roster',
      blurb: 'Everybody knows what they are doing tomorrow.',
      bonus: { kind: 'cohesion', percent: 5 },
    },
    {
      name: 'The Open Door',
      blurb: 'An hour a day when anybody can say anything.',
      bonus: { kind: 'unit_morale', flat: 3 },
    },
    {
      name: 'Second-in-Command',
      blurb: 'Somebody who can say yes while you are away.',
      bonus: { kind: 'officer_group', group: 'social', flat: 2 },
    },
    {
      name: 'Loyalty Bonuses',
      blurb: 'Paid for staying, not for arriving.',
      bonus: { kind: 'wage_discount', percent: 8 },
    },
    {
      name: 'Grievance Process',
      blurb: 'It goes somewhere. That is most of what people want.',
      bonus: { kind: 'recruit_pool', percent: 10 },
    },
    {
      name: 'The Word Goes Round',
      blurb: 'Nobody has to be told twice, and nobody hears it wrong.',
      bonus: { kind: 'cohesion', percent: 10 },
    },
    {
      name: 'Field Promotions',
      blurb: 'The good ones move up on the day, not at the quarter.',
      bonus: { kind: 'officer_attribute', attribute: 'leadership', flat: 4 },
    },
    {
      name: 'Succession Planning',
      blurb: 'Two deep in every chair, including yours.',
      bonus: { kind: 'recruit_slots', flat: 1 },
    },
    {
      name: 'The House Holds',
      blurb: 'You could be gone a month and find it exactly as you left it.',
      bonus: { kind: 'whole_district', percent: 15 },
    },
  ]),

  ...buildTrack('cartographer', [
    {
      name: 'Street Survey',
      blurb: 'Every road walked and drawn, including the ones that stop.',
      bonus: { kind: 'travel_speed', percent: 5 },
    },
    {
      name: 'Route Cards',
      blurb: 'One card per run, with the turns on it and nothing else.',
      bonus: { kind: 'mission_speed', percent: 6 },
    },
    {
      name: 'Curfew Tables',
      blurb: 'When the bridge is open, and when the patrol is on it.',
      // Two minutes flat rather than a third percentage on a track that already had two of them.
      // Half the Tram Depot's four: this is a timetable, not eight roads under one roof, and it is
      // the rung at which a crew stops walking round a closed bridge.
      bonus: { kind: 'road_shortcut', minutes: 2 },
    },
    {
      name: 'Bearing Marks',
      blurb: 'Painted on walls, meaningless to anybody who has not been told.',
      bonus: { kind: 'unit_speed', percent: 6 },
    },
    {
      name: 'Underground Routes',
      blurb: 'The tunnels are on the map now. Most of them.',
      bonus: { kind: 'vision', districts: 1 },
    },
    {
      name: 'Cache Points',
      blurb: 'Water and fuel where the map says, so nobody carries either.',
      bonus: { kind: 'loot_capacity', percent: 8 },
    },
    {
      name: 'Night Navigation',
      blurb: 'Getting there in the dark without a light.',
      bonus: { kind: 'unit_stealth', percent: 8 },
    },
    {
      name: 'Alternate Approaches',
      blurb: 'Three ways in, so one of them being watched is not a problem.',
      bonus: { kind: 'mission_speed', percent: 12 },
    },
    {
      name: 'Load Plans',
      blurb: 'Somebody has worked out how the thing that does not fit goes on the thing that does.',
      // The ninth rung of the track about crossing the city, and the one thing crossing it could
      // not do. Waives `no_ride` (`any_ride`): a Colossus takes a seat, and the column stops being
      // held to its 15. Deep on purpose, because it is the whole answer to a rule rather than a
      // share of one.
      bonus: { kind: 'any_ride' },
    },
    {
      name: 'The Whole City',
      blurb: 'There is no part of it you cannot cross in an afternoon.',
      bonus: { kind: 'mission_slots', flat: 1 },
    },
  ]),

  ...buildTrack('trader', [
    {
      name: 'Scales and Measures',
      blurb: 'Your scale, checked, and theirs, checked against yours.',
      bonus: { kind: 'market_discount', percent: 5 },
    },
    {
      name: 'Standing Buyers',
      blurb: 'Three people who will always take it, at a price you know.',
      bonus: { kind: 'mission_spoils', percent: 6 },
    },
    {
      name: 'Credit Lines',
      blurb: 'Paid at the end of the month, which is worth a discount.',
      bonus: { kind: 'wage_discount', percent: 5 },
    },
    {
      name: 'Warehouse Rotation',
      blurb: 'Oldest out first, so nothing rots at the back.',
      bonus: { kind: 'storage_capacity', percent: 10 },
    },
    {
      name: 'Convoy Terms',
      blurb: 'They carry it. You pay less because you insured it.',
      bonus: { kind: 'mission_speed', percent: 8 },
    },
    {
      name: 'Grade Sorting',
      blurb: 'Three grades of the same scrap, three prices.',
      bonus: { kind: 'resource_yield', resource: 'scrap', percent: 12 },
    },
    {
      name: 'Forward Buying',
      blurb: 'Pay now for a delivery in spring.',
      bonus: { kind: 'market_discount', percent: 10 },
    },
    {
      name: 'Broker Network',
      blurb: 'Somebody in every district who owes you a call.',
      bonus: { kind: 'black_market_discount', percent: 12 },
    },
    {
      name: 'Bonded Storage',
      blurb: 'Held, sealed, and not yours until it is.',
      bonus: { kind: 'storage_capacity', percent: 15 },
    },
    {
      name: 'The Better Price',
      blurb: 'Everybody comes to you first, which is worth more than the margin.',
      bonus: { kind: 'resource', resource: 'caps', perHour: 40 },
    },
  ]),

  ...buildTrack('security_officer', [
    {
      name: 'Pressure Plates',
      blurb: 'Two boards, a hinge, and a rule about which stairwell nobody uses.',
      bonus: { kind: 'defense_percent', percent: 5 },
      unlocks: 'the Pressure Plates trap',
    },
    {
      name: 'Watch Schedules',
      blurb: 'Somebody awake, always, and never the same somebody.',
      bonus: { kind: 'intel_resistance', percent: 6 },
    },
    {
      name: 'Sally Ports',
      blurb: 'A door you can come out of, which is not the same as a door.',
      bonus: { kind: 'unit_tier', tier: 'rabble', stat: 'armor', percent: 6 },
    },
    {
      name: 'Shaped Charges',
      blurb: 'The same explosive, pointed. It is entirely a question of what shape the hole is.',
      bonus: { kind: 'gate_defense', percent: 10 },
      unlocks: 'the Buried Shell trap and the Shaped For This boost',
    },
    {
      name: 'Vetting',
      blurb: 'Who they were before they walked in here.',
      bonus: { kind: 'intel_resistance', percent: 9 },
    },
    {
      name: 'Standing Orders Under Fire',
      blurb: 'Every position knows what it does when the one beside it goes quiet.',
      // The cascade term, cut (`steady_nerve`). The sixth rung of the defence track rather than a
      // third `defense_percent`: a district that holds because nobody panicked is a different thing
      // from a district that holds because the wall is thicker, and the track had two walls already.
      bonus: { kind: 'steady_nerve' },
    },
    {
      name: 'Demolition Doctrine',
      blurb: 'Every approach surveyed, cut and re-cut, on the assumption it will be needed.',
      bonus: { kind: 'unit_tier', tier: 'heavy', stat: 'armor', percent: 10 },
      unlocks: 'the Prepared Collapse trap and The Colossus Walks boost',
    },
    {
      name: 'Layered Defence',
      blurb: 'The wall is the third thing they hit, not the first.',
      bonus: { kind: 'gate_defense', percent: 18 },
    },
    {
      name: 'Counter-Surveillance',
      blurb: 'Watching the people who are watching.',
      bonus: { kind: 'intel_resistance', percent: 14 },
    },
    {
      name: 'The Hard District',
      blurb: 'They go and hit somebody else instead, which is the point.',
      bonus: { kind: 'whole_district', percent: 20 },
    },
  ]),

  ...buildTrack('chief_medic', [
    {
      name: 'Field Triage',
      blurb: 'Deciding fast who can wait is most of the job.',
      bonus: { kind: 'casualty_recovery', percent: 6 },
    },
    {
      name: 'Clean Water',
      blurb: 'It is not glamorous and it halves the sick list.',
      bonus: { kind: 'unit_vitality', percent: 4 },
    },
    {
      name: 'Stretcher Drill',
      blurb: 'Off the ground and moving in ninety seconds.',
      bonus: { kind: 'casualty_recovery', percent: 8 },
    },
    {
      name: 'Blood Bank',
      blurb: 'Cold storage, cross-matched, and everybody on the books is typed.',
      bonus: { kind: 'battle_stims', flat: 1 },
    },
    {
      name: 'Antiseptics',
      blurb: 'Boiled instruments, and the surgeon washes first.',
      bonus: { kind: 'unit_vitality', percent: 6 },
    },
    {
      name: 'Forward Aid Posts',
      blurb: 'Treatment where they fell, not where the ward is.',
      bonus: { kind: 'casualty_recovery', percent: 12 },
    },
    {
      name: 'Trauma Theatre',
      blurb: 'A room in the Infirmary that nobody is allowed to use for anything else.',
      bonus: { kind: 'building_cost', building: 'infirmary', percent: 25 },
    },
    {
      name: 'Convalescence',
      blurb: 'Back on the line when they are ready, not when they are needed.',
      bonus: { kind: 'unit_morale', flat: 5 },
    },
    {
      name: 'Prosthetics Bench',
      blurb: 'A hand that works is a person who stays.',
      bonus: { kind: 'officer_group', group: 'physical', flat: 2 },
    },
    {
      name: 'Nobody Left',
      blurb: 'Everybody who can be brought back is brought back.',
      bonus: { kind: 'casualty_recovery', percent: 20 },
    },
  ]),

  ...buildTrack('instructor_of_the_young', [
    {
      name: 'Drill Yard',
      blurb: 'Flat ground, marked out, used every morning.',
      bonus: { kind: 'training_speed', percent: 5 },
    },
    {
      name: 'Two-Week Basics',
      blurb: 'Everything anybody has to know, in a fortnight.',
      bonus: { kind: 'training_speed', percent: 7 },
    },
    {
      name: 'Live Rounds',
      blurb: 'Expensive, and there is no substitute for them.',
      bonus: { kind: 'unit_tier', tier: 'rabble', stat: 'offense', percent: 6 },
    },
    {
      name: 'Section Leaders',
      blurb: 'One in eight of them can teach the other seven.',
      bonus: { kind: 'training_sessions', flat: 1 },
    },
    {
      name: 'Graded Ranges',
      blurb: 'Nobody moves up until they hit the target.',
      bonus: { kind: 'unit_kind', unitId: 'snipers', stat: 'offense', percent: 12 },
    },
    {
      name: 'Night Exercises',
      blurb: 'The first time in the dark should not be the real time.',
      bonus: { kind: 'unit_morale', flat: 4 },
    },
    {
      name: 'Cadre System',
      blurb: 'The veterans train the intake and then go back to their units.',
      bonus: { kind: 'training_speed', percent: 12 },
    },
    {
      name: 'Standard Syllabus',
      blurb: 'One course, one book, no favourites.',
      bonus: { kind: 'training_cost', percent: 12 },
    },
    {
      name: 'Continuation Training',
      blurb: 'Nobody is finished. Everybody trains, monthly.',
      bonus: { kind: 'unit_tier', tier: 'specialist', stat: 'vitality', percent: 10 },
    },
    {
      name: 'The Intake',
      blurb: 'They arrive as bodies and leave six weeks later as soldiers.',
      bonus: { kind: 'training_sessions', flat: 2 },
    },
  ]),

  ...buildTrack('raid_boss', [
    {
      name: 'Door Work',
      blurb: 'Getting through it in one go, loudly.',
      bonus: { kind: 'unit_kind', unitId: 'breakers', stat: 'offense', percent: 10 },
    },
    {
      name: 'Split Loads',
      blurb: 'Nobody carries everything, so nobody is caught with everything.',
      bonus: { kind: 'loot_capacity', percent: 6 },
    },
    {
      name: 'Reputation',
      blurb: 'Half of them do not fight, because of who is standing in the door.',
      bonus: { kind: 'intimidation', flat: 2 },
    },
    {
      name: 'Snatch Teams',
      blurb: 'In, out and away before anybody has decided anything.',
      bonus: { kind: 'unit_speed', percent: 7 },
    },
    {
      name: 'Overwhelming Force',
      blurb: 'Three times what is needed, so that it is over in a minute.',
      bonus: { kind: 'unit_offense', percent: 6 },
    },
    {
      name: 'Loading Drill',
      blurb: 'The truck is packed in four minutes, every time.',
      bonus: { kind: 'loot_capacity', percent: 12 },
    },
    {
      name: 'The Example',
      blurb: 'One place, made an example of, and the next six pay without being asked.',
      bonus: { kind: 'infamy_gain', percent: 10 },
    },
    {
      name: 'Breaching Order',
      blurb: 'Who goes in first, and what they do in the first two seconds.',
      bonus: { kind: 'unit_tier', tier: 'heavy', stat: 'offense', percent: 12 },
    },
    {
      name: 'Fence Network',
      blurb: 'Everything moves within a day. Nothing sits in the yard.',
      bonus: { kind: 'black_market_discount', percent: 10 },
    },
    {
      name: 'The Name',
      blurb: 'Nobody counts what you brought. They count who is leading it.',
      bonus: { kind: 'declarations', flat: 1 },
    },
  ]),

  ...buildTrack('scout', [
    {
      name: 'Point Work',
      blurb: 'One person, four hundred metres ahead, and quiet.',
      bonus: { kind: 'unit_stealth', percent: 5 },
    },
    {
      name: 'Pace Counting',
      blurb: 'Distance without a map, in the dark.',
      bonus: { kind: 'travel_speed', percent: 6 },
    },
    {
      name: 'Observation Posts',
      blurb: 'Somewhere you can watch a road all day without being seen.',
      bonus: { kind: 'intel', percent: 8 },
    },
    {
      name: 'Track Reading',
      blurb: 'Who went through, how many, and how long ago.',
      bonus: { kind: 'intel', percent: 10 },
    },
    {
      name: 'Light Order',
      blurb: 'Nothing carried that is not needed. Nothing that rattles.',
      bonus: { kind: 'unit_speed', percent: 6 },
    },
    {
      name: 'Hide Discipline',
      blurb: 'A day in a hole without moving.',
      bonus: { kind: 'unit_stealth', percent: 10 },
    },
    {
      name: 'Runner Relays',
      blurb: 'The report gets back in an hour instead of in a day.',
      bonus: { kind: 'mission_speed', percent: 8 },
    },
    {
      name: 'Route Reconnaissance',
      blurb: 'The way in is walked before anybody has to use it.',
      bonus: { kind: 'vision', districts: 1 },
    },
    {
      name: 'Counter-Tracking',
      blurb: 'Going back over your own trail and taking it apart.',
      bonus: { kind: 'intel_resistance', percent: 10 },
    },
    {
      name: 'Eyes On',
      blurb: 'There is nothing in this district you do not already know about.',
      bonus: { kind: 'vision', districts: 2 },
    },
  ]),

  ...buildTrack('consigliere', [
    {
      name: 'The Quiet Word',
      blurb: 'Before it is a problem, rather than after.',
      bonus: { kind: 'wage_discount', percent: 4 },
    },
    {
      name: 'Reading the Room',
      blurb: 'Who is uncomfortable, and about what.',
      bonus: { kind: 'intel_resistance', percent: 5 },
    },
    {
      name: 'Favours Owed',
      blurb: 'A ledger nobody writes down.',
      bonus: { kind: 'recruit_pool', percent: 8 },
    },
    {
      name: 'Terms in Advance',
      blurb: 'Agreed before anybody is in a position to want more.',
      bonus: { kind: 'market_discount', percent: 6 },
    },
    {
      name: 'Deniability',
      blurb: 'Arranged so that it was never said.',
      bonus: { kind: 'intel_resistance', percent: 8 },
    },
    {
      name: 'Backchannels',
      blurb: 'A way to talk to somebody you are not talking to.',
      bonus: { kind: 'black_market_discount', percent: 8 },
    },
    {
      name: 'Sitting Down',
      blurb: 'Both sides, one table, and somebody neutral pouring.',
      bonus: { kind: 'allied_offense', percent: 8 },
    },
    {
      name: 'The Long View',
      blurb: "This year's enemy is next year's supplier.",
      bonus: { kind: 'officer_group', group: 'social', flat: 3 },
    },
    {
      name: 'Insulation',
      blurb: 'Nothing that happens downstairs reaches this floor.',
      bonus: { kind: 'intel_resistance', percent: 12 },
    },
    {
      name: 'Nothing in Writing',
      blurb: 'There is no document anywhere with your name on it.',
      bonus: { kind: 'recruit_slots', flat: 1 },
    },
  ]),

  ...buildTrack('professor', [
    {
      name: 'Reading Lists',
      blurb: 'What to read, in what order, and what to skip.',
      bonus: { kind: 'research_speed', percent: 4 },
    },
    {
      name: 'Lecture Series',
      blurb: 'Two hours a week, and everybody is better at their job.',
      bonus: { kind: 'training_speed', percent: 5 },
    },
    {
      name: 'Marginalia',
      blurb: 'The notes in the margin are worth more than the book they are in.',
      bonus: { kind: 'xp_gain', percent: 6 },
    },
    {
      name: 'Working Papers',
      blurb: 'Circulated before they are finished, which is the point of them.',
      bonus: { kind: 'research_speed', percent: 7 },
    },
    {
      name: 'Seminar',
      blurb: 'Six people arguing about one page.',
      bonus: { kind: 'officer_group', group: 'mental', flat: 2 },
    },
    {
      name: 'Citation Index',
      blurb: 'Who read what, and what it changed.',
      bonus: { kind: 'intel', percent: 8 },
    },
    {
      name: 'Applied Sections',
      blurb: 'The theory goes down to the workshop the same week.',
      bonus: { kind: 'build_speed', percent: 8 },
    },
    {
      name: 'Retrospectives',
      blurb: 'Every project, afterwards, honestly.',
      bonus: { kind: 'xp_gain', percent: 12 },
    },
    {
      name: 'The Reading Year',
      blurb: 'One long project nobody is allowed to hurry.',
      bonus: { kind: 'officer_attribute', attribute: 'encyclopedia', flat: 5 },
    },
    {
      name: 'First Principles',
      blurb: 'Beginning from nothing and arriving somewhere nobody expected.',
      bonus: { kind: 'research_speed', percent: 15 },
    },
  ]),
];

export const RESEARCH_ITEMS: readonly ResearchItemSpec[] = CATALOGUE;

const BY_ID = new Map(CATALOGUE.map((spec) => [spec.id, spec]));
const BY_TRACK = new Map<OfficerRole, ResearchItemSpec[]>(
  OFFICER_ROLES.map((role) => [role, CATALOGUE.filter((spec) => spec.track === role)]),
);

export function findResearchItem(id: string): ResearchItemSpec | undefined {
  return BY_ID.get(id);
}

/** One track, bottom rung first. */
export function itemsInTrack(track: OfficerRole): readonly ResearchItemSpec[] {
  return BY_TRACK.get(track) ?? [];
}

/** How many rungs of a track this crew has finished. */
export function trackProgress(known: readonly string[], track: OfficerRole): number {
  return itemsInTrack(track).filter((spec) => known.includes(spec.id)).length;
}

/**
 * §G1: the rung the Blueprints page asks about.
 *
 * Exported as a predicate rather than as a bare id so the page has one thing to call and this
 * module keeps the right to move the item to another track without breaking it. The trade itself
 * (three pages in, one page out) is the Blueprints page's, not this module's.
 */
export const REIMAGINING_RESEARCH_ID = 'tech_reimagining';

export function isReimaginingResearched(known: readonly string[]): boolean {
  return known.includes(REIMAGINING_RESEARCH_ID);
}

/** Everything a finished rung opens, in the words the catalogue gives it. */
export function researchUnlocks(known: readonly string[]): string[] {
  return known.flatMap((id) => {
    const unlocks = findResearchItem(id)?.payout.unlocks;
    return unlocks === undefined ? [] : [unlocks];
  });
}

/**
 * What the finished rungs are worth, as one crew fold.
 *
 * Folded by the caller into the same struct everything else lands in (`mergeCrewEffects`), so a
 * rung needs no wiring of its own: whatever already reads `buildSpeedPercent`, a tier's armour or
 * the chairs at the Bar gets research's contribution to it for free. Ids the catalogue does not
 * know are skipped: a save may carry a rung that was retired.
 */
export function researchEffects(known: readonly string[]): CrewEffects {
  const total = noCrewEffects();
  for (const id of known) {
    const spec = findResearchItem(id);
    if (spec) applyResearchBonus(total, spec.payout.bonus);
  }
  return total;
}

/** One rung into a fold: the three grants here, everything else through the perk fold. */
export function applyResearchBonus(into: CrewEffects, bonus: ResearchBonus): CrewEffects {
  switch (bonus.kind) {
    case 'mission_slots':
      into.missionSlotsFlat += bonus.flat;
      return into;
    case 'recruit_slots':
      into.recruitSlotsFlat += bonus.flat;
      return into;
    case 'declarations':
      into.declarationsFlat += bonus.flat;
      return into;
    default:
      return applyPerkBonus(into, bonus);
  }
}

/** "+1 crew out on a job at once": the three grants in words. Everything else is a perk's line. */
export function describeResearchBonus(bonus: ResearchBonus): string {
  switch (bonus.kind) {
    case 'mission_slots':
      return `+${bonus.flat} ${bonus.flat === 1 ? 'crew' : 'crews'} out on a job at once`;
    case 'recruit_slots':
      return `+${bonus.flat} ${bonus.flat === 1 ? 'chair' : 'chairs'} at the Bar`;
    case 'declarations':
      return `+${bonus.flat} ${bonus.flat === 1 ? 'fight' : 'fights'} called at once`;
    default:
      return describePerkBonus(bonus);
  }
}

/**
 * What one rung does, in the words a player reads.
 *
 * Here rather than at the route because it was written twice once already and the two copies
 * disagreed: the route folded the channel through a label table and the e2e fixture printed the
 * raw key, so every screenshot of the Lab said `+8% PRODUCTIONPERCENT` while the running game said
 * `+8% what the district makes`.
 */
export function describeResearchPayout(spec: ResearchItemSpec): string {
  const effect = describeResearchBonus(spec.payout.bonus);
  return spec.payout.unlocks === undefined ? effect : `Opens ${spec.payout.unlocks}, and ${effect}`;
}

/**
 * §C3a: how much of a research clock the Head of Research takes off, as a percentage.
 *
 * Reads their **points**, never their mark (§C3b). The scale is the mark scale's own: nothing at
 * the measured floor of 10, and {@link MAX_RESEARCH_TIME_CUT} at the trainable ceiling of 100. So
 * a freshly hired Head sitting around 20 buys 5%, one trained to 50 buys 20%, and one at the
 * ceiling buys 45%.
 *
 * The return is not rounded. A single point in the weakest attribute the chair reads moves this by
 * about four hundredths of a percentage point, which is invisible on screen and is not invisible in
 * the arithmetic: the duration is computed from this number and rounded once, at the end.
 */
export const MAX_RESEARCH_TIME_CUT = 45;

export function researchTimeCutPercent(points: number): number {
  const above = Math.max(0, Math.min(OFFICER_MARK_CEILING, points) - OFFICER_MARK_FLOOR);
  return (above / (OFFICER_MARK_CEILING - OFFICER_MARK_FLOOR)) * MAX_RESEARCH_TIME_CUT;
}

/**
 * §C1d: what the track's own officer takes off the bill for their own track.
 *
 * The second half of "both sheets matter". The Head of Research buys time, the specialist buys
 * price, and both read points rather than marks, so a track is cheaper the better the person
 * running it is and not merely open or shut.
 */
export const MAX_RESEARCH_COST_CUT = 30;

export function trackCostCutPercent(points: number): number {
  const above = Math.max(0, Math.min(OFFICER_MARK_CEILING, points) - OFFICER_MARK_FLOOR);
  return (above / (OFFICER_MARK_CEILING - OFFICER_MARK_FLOOR)) * MAX_RESEARCH_COST_CUT;
}

/** A rung's price with the track officer's cut already taken off it. */
export function researchItemPrice(
  spec: ResearchItemSpec,
  costCutPercent: number,
): PartialResources {
  return discounted(spec.cost, costCutPercent);
}

/** Everything that can stop a rung being started, in the order a player can act on. */
export const RESEARCH_ITEM_REFUSALS = [
  'unknown_item',
  'already_known',
  'needs_previous_step',
  'no_head_of_research',
  'no_track_officer',
  'track_mark_too_low',
  'head_mark_too_low',
] as const;
export type ResearchItemRefusal = (typeof RESEARCH_ITEM_REFUSALS)[number];

/** Who is sitting where, as far as this module needs to know. Marks only: no points on the wire. */
export interface ChairMarks {
  /** The mark of the officer in the track's own chair, or `null` if the chair is empty. */
  trackMark: OfficerMark | null;
  /** The Head of Research's mark, or `null` if nobody holds the post. */
  headMark: OfficerMark | null;
}

/**
 * The first reason this rung cannot be started, or `null`.
 *
 * Ordered the way the fiction is: does the thing exist, is it already done, is the one below it
 * done, is anybody in the chairs, and only then are they good enough. Affordability is deliberately
 * not here: it is the caller's, because the price depends on a score this module never sees.
 */
export function researchItemRefusal(
  id: string,
  known: readonly string[],
  chairs: ChairMarks,
): ResearchItemRefusal | null {
  const spec = findResearchItem(id);
  if (!spec) return 'unknown_item';
  if (known.includes(id)) return 'already_known';

  const below = itemsInTrack(spec.track).find((other) => other.step === spec.step - 1);
  if (below && !known.includes(below.id)) return 'needs_previous_step';

  if (chairs.headMark === null) return 'no_head_of_research';
  if (chairs.trackMark === null) return 'no_track_officer';
  if (!markAtLeast(chairs.trackMark, spec.requiresMark)) return 'track_mark_too_low';
  if (spec.requiresHeadMark !== null && !markAtLeast(chairs.headMark, spec.requiresHeadMark)) {
    return 'head_mark_too_low';
  }
  return null;
}

/** The refusal in the player's own words. */
export function describeResearchItemRefusal(
  refusal: ResearchItemRefusal,
  spec: ResearchItemSpec,
): string {
  switch (refusal) {
    case 'unknown_item':
      return 'No such research';
    case 'already_known':
      return 'Already done';
    case 'needs_previous_step': {
      const below = itemsInTrack(spec.track).find((other) => other.step === spec.step - 1);
      return `Finish ${below?.name ?? 'the rung below'} first`;
    }
    case 'no_head_of_research':
      return `Needs a ${OFFICER_ROLE_LABELS.head_of_research}`;
    case 'no_track_officer':
      return `Needs a ${OFFICER_ROLE_LABELS[spec.track]}`;
    case 'track_mark_too_low':
      return `Your ${OFFICER_ROLE_LABELS[spec.track]} must be ${spec.requiresMark} or better`;
    case 'head_mark_too_low':
      return `Your ${OFFICER_ROLE_LABELS.head_of_research} must be ${spec.requiresHeadMark} or better`;
  }
}

/** The highest mark anything asks for. Never `S+` (§C2d), and asserted in the tests. */
export function hardestRequiredMark(): OfficerMark {
  const hardest = Math.max(
    ...TRACK_MARKS.map(markIndex),
    ...HEAD_MARK_THRESHOLDS.map((threshold) => markIndex(threshold.mark)),
  );
  return OFFICER_MARKS[hardest] as OfficerMark;
}
