import { CHANNEL_LABELS, discounted, type EffectChannel } from '../crew/effects.js';
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
 * One {@link EffectChannel}, which is the same struct territory, crew attributes and the Garage all
 * write into, so a finished rung is wired into every consumer that already reads those effects with
 * no new parameter threaded anywhere. `unlocks` is set on the four rungs that also open something
 * the crew can lay or buy; it is the words for it, because the catalogues that own those things
 * import this module and cannot be imported back.
 */
export interface ResearchPayout {
  channel: EffectChannel;
  unlocks?: string;
}

/**
 * The six kinds of payout the brief allows (§C4a), and which channel is which.
 *
 * Held as a table rather than as a comment so `research.tracks.test.ts` can assert that every one
 * of the 190 rungs lands in one of the six. A seventh family cannot be added by accident: a channel
 * with no entry here fails the same test.
 */
export const PAYOUT_FAMILIES = [
  'unlock',
  'thrift',
  'yield',
  'battle',
  'counterintel',
  'travel',
] as const;
export type PayoutFamily = (typeof PAYOUT_FAMILIES)[number];

/**
 * Which family each channel belongs to.
 *
 * `intelYieldPercent` is filed under `counterintel` with its mirror. The brief's line is "make the
 * crew harder to spy on", and yield is the other half of the same trade: the Head Spy's and the
 * Scout's tracks are about the quiet war in both directions, and splitting the pair across two
 * families would have put "what a scout brings back" under "boost something in battle", which is
 * not what it is.
 */
const CHANNEL_FAMILY: Partial<Record<EffectChannel, PayoutFamily>> = {
  researchSpeedPercent: 'thrift',
  buildSpeedPercent: 'thrift',
  trainingSpeedPercent: 'thrift',
  trainingCostPercent: 'thrift',
  buildCostPercent: 'thrift',
  wageDiscountPercent: 'thrift',

  productionPercent: 'yield',
  storageCapacityPercent: 'yield',
  lootCapacityPercent: 'yield',
  recruitPoolPercent: 'yield',

  defensePercent: 'battle',
  unitOffensePercent: 'battle',
  unitVitalityPercent: 'battle',
  unitMoraleFlat: 'battle',
  unitSpeedPercent: 'battle',
  unitStealthPercent: 'battle',
  cohesionPercent: 'battle',
  casualtyRecoveryPercent: 'battle',
  intimidationFlat: 'battle',

  intelResistancePercent: 'counterintel',
  intelYieldPercent: 'counterintel',

  travelSpeedPercent: 'travel',
};

export function payoutFamily(payout: ResearchPayout): PayoutFamily {
  if (payout.unlocks !== undefined) return 'unlock';
  const family = CHANNEL_FAMILY[payout.channel];
  if (!family) throw new Error(`no payout family for ${payout.channel}`);
  return family;
}

export interface ResearchItemSpec {
  id: string;
  track: OfficerRole;
  /** 1 to {@link RESEARCH_TRACK_STEPS}. */
  step: number;
  name: string;
  description: string;
  payout: ResearchPayout;
  magnitude: number;
  cost: PartialResources;
  /** The catalogue clock, before the Lab, the crew and the Head of Research take their cuts. */
  minutes: number;
  requiresMark: OfficerMark;
  requiresHeadMark: OfficerMark | null;
}

/** Percentage channels and flat ones are not on the same scale, so they do not share a curve. */
function magnitudeFor(step: number, channel: EffectChannel): number {
  return CHANNEL_LABELS[channel].unit === 'flat' ? 1 + Math.ceil(step / 2) : 2 + step;
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
  channel: EffectChannel;
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
          ? { channel: entry.channel }
          : { channel: entry.channel, unlocks: entry.unlocks },
      magnitude: magnitudeFor(step, entry.channel),
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
      channel: 'intelResistancePercent',
    },
    {
      name: 'Cut-Outs',
      blurb: 'Every message passes through somebody who can name neither end.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Traffic Analysis',
      blurb: 'You do not need to read it. You need to know who is talking to whom.',
      channel: 'intelYieldPercent',
    },
    {
      name: 'Back Alleys',
      blurb: 'Routes nobody watches, walked until they are quicker than the road.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Legend Building',
      blurb: 'A whole life on paper, for somebody who has never existed.',
      channel: 'unitStealthPercent',
    },
    {
      name: 'One-Time Pads',
      blurb: 'Slow, unbreakable, and everybody hates carrying the books.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Turned Runners',
      blurb: 'Their courier still runs their route. He stops here first.',
      channel: 'intelYieldPercent',
    },
    {
      name: 'Compartmentation',
      blurb: 'Nobody knows more than the next name up. Not even you.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'False Traffic',
      blurb: 'A whole second district that does not exist, chattering away all night.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'The Long Silence',
      blurb: 'For a week the wire says nothing at all, and that is the loudest thing on it.',
      channel: 'intelResistancePercent',
    },
  ]),

  ...buildTrack('lead_engineer', [
    {
      name: 'Load Tables',
      blurb: 'Somebody finally wrote down what each beam actually carries.',
      channel: 'buildSpeedPercent',
    },
    {
      name: 'Site Discipline',
      blurb: 'Tools go back. It saves an hour a day and nobody believes it until it does.',
      channel: 'buildSpeedPercent',
    },
    {
      name: 'Formwork Reuse',
      blurb: 'The same moulds, twelve pours, if you clean them.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Bracing Standards',
      blurb: 'One drawing for every corner, so no corner is somebody guessing.',
      channel: 'defensePercent',
    },
    {
      name: 'Prefabrication',
      blurb: 'Made flat on the ground and stood up in an afternoon.',
      channel: 'buildSpeedPercent',
    },
    {
      name: 'Cold Joints',
      blurb: "Where yesterday's pour meets today's, and how not to leave a seam.",
      channel: 'defensePercent',
    },
    {
      name: 'Critical Path',
      blurb: 'Every build is planned backwards from the day it has to be standing.',
      channel: 'buildSpeedPercent',
    },
    {
      name: 'Tolerance Stacking',
      blurb: 'Six parts, each within a millimetre, and the seventh will not go on. Now it does.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Rebar Schedules',
      blurb: 'Steel in the concrete, laid to a drawing rather than to a mood.',
      channel: 'defensePercent',
    },
    {
      name: 'The Standing Order',
      blurb: 'A structure is finished when the file is closed, and not before.',
      channel: 'buildSpeedPercent',
    },
  ]),

  ...buildTrack('finance_officer', [
    {
      name: 'Double Entry',
      blurb: 'Two columns. It is astonishing how much stops going missing.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Bulk Contracts',
      blurb: 'Buy for the quarter, not for the week.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Wage Bands',
      blurb: 'Everybody knows what the job pays before they ask what it pays.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Depreciation',
      blurb: 'A machine is worth less every month, and now the books say so.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Payroll Netting',
      blurb: 'One transfer instead of forty. Forty fees become one.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Unit Costing',
      blurb: 'What one soldier costs to put in the field, to the cap.',
      channel: 'trainingCostPercent',
    },
    {
      name: 'Hedged Stock',
      blurb: 'Half the scrap bought forward, so a bad month is only half a bad month.',
      channel: 'storageCapacityPercent',
    },
    {
      name: 'Audit Trail',
      blurb: 'Somebody checks. That is the whole of the intervention.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Capital Rationing',
      blurb: 'Three projects, money for two, and a rule for choosing.',
      channel: 'buildCostPercent',
    },
    {
      name: 'The Ledger Closes',
      blurb: 'Every cap accounted for, every month, without exception.',
      channel: 'wageDiscountPercent',
    },
  ]),

  ...buildTrack('head_of_growth', [
    {
      name: 'Shift Rotation',
      blurb: 'Three watches instead of two. Nothing stands idle between them.',
      channel: 'productionPercent',
    },
    {
      name: 'Word of Mouth',
      blurb: 'People come because somebody they trust told them to.',
      channel: 'recruitPoolPercent',
    },
    {
      name: 'Yield Records',
      blurb: 'What each line made, every day, on a board where everyone sees it.',
      channel: 'productionPercent',
    },
    {
      name: 'Open Intake',
      blurb: 'The door is open two nights a week and the room is warm.',
      channel: 'recruitPoolPercent',
    },
    {
      name: 'Line Balancing',
      blurb: 'Somebody finally timed every station and moved the slow one.',
      channel: 'productionPercent',
    },
    {
      name: 'Overflow Yards',
      blurb: 'Ground nobody was using, fenced and drained.',
      channel: 'storageCapacityPercent',
    },
    {
      name: 'Apprentice Pipeline',
      blurb: 'Every hand teaches the next one, on the clock.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Continuous Casting',
      blurb: 'The line does not stop between batches any more.',
      channel: 'productionPercent',
    },
    {
      name: 'Second Site',
      blurb: 'A yard on the far side of the district, running the same hours.',
      channel: 'productionPercent',
    },
    {
      name: 'The Growth Curve',
      blurb: 'It compounds. That is the whole trick and it takes a year to see.',
      channel: 'productionPercent',
    },
  ]),

  ...buildTrack('field_commander', [
    {
      name: 'Order of March',
      blurb: 'Who walks where, so the column does not arrive in pieces.',
      channel: 'cohesionPercent',
    },
    {
      name: 'Standing Signals',
      blurb: 'Three flags, and everyone knows what they mean under fire.',
      channel: 'cohesionPercent',
    },
    {
      name: 'Fire Discipline',
      blurb: 'Nobody shoots until the word, and then everybody does.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Reserve Doctrine',
      blurb: 'A third of the force does nothing at all until it matters.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Frontage Drill',
      blurb: 'Widening the line without thinning it, practised until it is dull.',
      channel: 'cohesionPercent',
    },
    {
      name: 'Rally Points',
      blurb: 'Everybody knows where to run to, so running is not a rout.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Combined Arms',
      blurb: 'The heavy holds, the fast flanks, and neither of them goes alone.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Night Movement',
      blurb: 'Arriving somewhere they were not looking, at an hour they were not up.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Echelon Attack',
      blurb: 'One flank hits first. The other hits the response to it.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'The Whole Force',
      blurb: 'Every body you brought is in the fight, which almost never happens.',
      channel: 'cohesionPercent',
    },
  ]),

  ...buildTrack('head_of_research', [
    {
      name: 'Reading Room',
      blurb: 'Somewhere quiet, with the files in it, and a rule about noise.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Index Cards',
      blurb: 'Nobody looks for the same thing twice.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Bench Notebooks',
      blurb: 'Written down as it happens, not remembered afterwards.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Peer Review',
      blurb: 'Somebody who was not there reads it before anybody believes it.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Instrument Calibration',
      blurb: 'Every gauge checked against one gauge, monthly.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Field Debriefs',
      blurb: 'The people who used it tell you what actually happened to it.',
      channel: 'intelYieldPercent',
    },
    {
      name: 'Long Programmes',
      blurb: 'Three projects that nobody is allowed to interrupt for anything.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'The Archive',
      blurb: 'Twenty years of somebody else failing, catalogued and cross-referenced.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Shared Bench',
      blurb: 'The chemist and the engineer at the same table, on purpose.',
      channel: 'buildSpeedPercent',
    },
    {
      name: 'The Method',
      blurb: 'Guess, test, discard, write it down. It sounds like nothing at all.',
      channel: 'researchSpeedPercent',
    },
  ]),

  ...buildTrack('wetware_chief', [
    {
      name: 'Clean Room',
      blurb: 'Half of what kills an implant is dust.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Nerve Mapping',
      blurb: 'Which wire goes where in this body, not in the manual.',
      channel: 'unitSpeedPercent',
    },
    {
      name: 'Rejection Protocols',
      blurb: 'The body says no. There is a way to argue with it.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Reflex Shunts',
      blurb: 'A shortcut past the brain for the things the brain is slow at.',
      channel: 'unitSpeedPercent',
    },
    {
      name: 'Load-Bearing Frames',
      blurb: 'Bone is not the strongest thing that can be in there.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'Pain Gating',
      blurb: 'Not switched off. Turned down, and only on the day.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Subdermal Plate',
      blurb: 'Under the skin, over the parts that matter.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'Salvage Grafts',
      blurb: "Somebody else's arm, and it works.",
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Neural Redundancy',
      blurb: 'Two paths for every signal, so one of them can be cut.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'The Second Body',
      blurb: 'By the end there is not much of the first one left.',
      channel: 'unitVitalityPercent',
    },
  ]),

  ...buildTrack('fabricator', [
    {
      name: 'Jigs and Fixtures',
      blurb: 'Held the same way every time, so it comes out the same way every time.',
      channel: 'trainingCostPercent',
    },
    {
      name: 'Tool Steel',
      blurb: 'Harder than the thing it cuts, and it stays that way.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Batch Runs',
      blurb: 'Forty of them, then set up for the next thing. Never one at a time.',
      channel: 'trainingCostPercent',
    },
    {
      name: 'Standard Parts',
      blurb: 'One thread, one gauge, one size of bolt. It took two years to agree on.',
      channel: 'trainingCostPercent',
      unlocks: 'the Plated Overnight battle boost',
    },
    {
      name: 'Cold Forming',
      blurb: 'Shaped without heat, which is most of the cost gone.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Reimagining',
      blurb: 'Three drawings that suit nothing, read together until a fourth falls out.',
      channel: 'buildCostPercent',
      unlocks: 'the Reimagining bench on the Blueprints page',
    },
    {
      name: 'Investment Casting',
      blurb: 'A wax model, a shell around it, and a part with no seam anywhere.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Hard Chrome',
      blurb: 'A tenth of a millimetre that triples how long the thing lasts.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'Numerical Control',
      blurb: "The machine reads the drawing. Nobody's hand is anywhere in it.",
      channel: 'buildSpeedPercent',
    },
    {
      name: 'The Master Pattern',
      blurb: 'One perfect part, and every other one measured against it.',
      channel: 'trainingCostPercent',
    },
  ]),

  ...buildTrack('salvager', [
    {
      name: 'Sorted Salvage',
      blurb: 'Two extra bins and a rule about which one things go in.',
      channel: 'storageCapacityPercent',
    },
    {
      name: 'Torch Discipline',
      blurb: 'Cut where it comes apart, not where it looks easy.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Magnet Sweeps',
      blurb: 'The yard, once a week, on a rope.',
      channel: 'productionPercent',
    },
    {
      name: 'Alloy Reclamation',
      blurb: 'The good metal is in there. It is just mixed with everything else.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Stripping Order',
      blurb: 'Wiring first, then glass, then the frame. Never the other way round.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Dry Storage',
      blurb: 'Rain is what turns salvage into rust.',
      channel: 'storageCapacityPercent',
    },
    {
      name: 'Deep Sites',
      blurb: 'The places that are hard to get into are the places nobody has been.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Furnace Runs',
      blurb: 'Everything unusable, once a month, into one pour.',
      channel: 'productionPercent',
    },
    {
      name: 'Haul Rigging',
      blurb: 'The truck comes back full because somebody loaded it properly.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Nothing Wasted',
      blurb: 'By now the yard puts out more than the district takes in.',
      channel: 'productionPercent',
    },
  ]),

  ...buildTrack('right_hand', [
    {
      name: 'Standing Orders',
      blurb: 'Written down once, so nobody has to ask twice.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Duty Roster',
      blurb: 'Everybody knows what they are doing tomorrow.',
      channel: 'cohesionPercent',
    },
    {
      name: 'The Open Door',
      blurb: 'An hour a day when anybody can say anything.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Second-in-Command',
      blurb: 'Somebody who can say yes while you are away.',
      channel: 'cohesionPercent',
    },
    {
      name: 'Loyalty Bonuses',
      blurb: 'Paid for staying, not for arriving.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Grievance Process',
      blurb: 'It goes somewhere. That is most of what people want.',
      channel: 'recruitPoolPercent',
    },
    {
      name: 'The Word Goes Round',
      blurb: 'Nobody has to be told twice, and nobody hears it wrong.',
      channel: 'cohesionPercent',
    },
    {
      name: 'Field Promotions',
      blurb: 'The good ones move up on the day, not at the quarter.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Succession Planning',
      blurb: 'Two deep in every chair, including yours.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'The House Holds',
      blurb: 'You could be gone a month and find it exactly as you left it.',
      channel: 'cohesionPercent',
    },
  ]),

  ...buildTrack('cartographer', [
    {
      name: 'Street Survey',
      blurb: 'Every road walked and drawn, including the ones that stop.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Route Cards',
      blurb: 'One card per run, with the turns on it and nothing else.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Curfew Tables',
      blurb: 'When the bridge is open, and when the patrol is on it.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Bearing Marks',
      blurb: 'Painted on walls, meaningless to anybody who has not been told.',
      channel: 'unitSpeedPercent',
    },
    {
      name: 'Underground Routes',
      blurb: 'The tunnels are on the map now. Most of them.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Cache Points',
      blurb: 'Water and fuel where the map says, so nobody carries either.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Night Navigation',
      blurb: 'Getting there in the dark without a light.',
      channel: 'unitStealthPercent',
    },
    {
      name: 'Alternate Approaches',
      blurb: 'Three ways in, so one of them being watched is not a problem.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Dead Reckoning',
      blurb: 'No landmarks, no light, and still arriving.',
      channel: 'unitSpeedPercent',
    },
    {
      name: 'The Whole City',
      blurb: 'There is no part of it you cannot cross in an afternoon.',
      channel: 'travelSpeedPercent',
    },
  ]),

  ...buildTrack('trader', [
    {
      name: 'Scales and Measures',
      blurb: 'Your scale, checked, and theirs, checked against yours.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Standing Buyers',
      blurb: 'Three people who will always take it, at a price you know.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Credit Lines',
      blurb: 'Paid at the end of the month, which is worth a discount.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Warehouse Rotation',
      blurb: 'Oldest out first, so nothing rots at the back.',
      channel: 'storageCapacityPercent',
    },
    {
      name: 'Convoy Terms',
      blurb: 'They carry it. You pay less because you insured it.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Grade Sorting',
      blurb: 'Three grades of the same scrap, three prices.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Forward Buying',
      blurb: 'Pay now for a delivery in spring.',
      channel: 'buildCostPercent',
    },
    {
      name: 'Broker Network',
      blurb: 'Somebody in every district who owes you a call.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Bonded Storage',
      blurb: 'Held, sealed, and not yours until it is.',
      channel: 'storageCapacityPercent',
    },
    {
      name: 'The Better Price',
      blurb: 'Everybody comes to you first, which is worth more than the margin.',
      channel: 'buildCostPercent',
    },
  ]),

  ...buildTrack('security_officer', [
    {
      name: 'Pressure Plates',
      blurb: 'Two boards, a hinge, and a rule about which stairwell nobody uses.',
      channel: 'defensePercent',
      unlocks: 'the Pressure Plates trap',
    },
    {
      name: 'Watch Schedules',
      blurb: 'Somebody awake, always, and never the same somebody.',
      channel: 'defensePercent',
    },
    {
      name: 'Sally Ports',
      blurb: 'A door you can come out of, which is not the same as a door.',
      channel: 'defensePercent',
    },
    {
      name: 'Shaped Charges',
      blurb: 'The same explosive, pointed. It is entirely a question of what shape the hole is.',
      channel: 'defensePercent',
      unlocks: 'the Buried Shell trap and the Shaped For This boost',
    },
    {
      name: 'Vetting',
      blurb: 'Who they were before they walked in here.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Hardened Approaches',
      blurb: 'Everything that could be cover for them, taken away.',
      channel: 'defensePercent',
    },
    {
      name: 'Demolition Doctrine',
      blurb: 'Every approach surveyed, cut and re-cut, on the assumption it will be needed.',
      channel: 'defensePercent',
      unlocks: 'the Prepared Collapse trap and The Colossus Walks boost',
    },
    {
      name: 'Layered Defence',
      blurb: 'The wall is the third thing they hit, not the first.',
      channel: 'defensePercent',
    },
    {
      name: 'Counter-Surveillance',
      blurb: 'Watching the people who are watching.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'The Hard District',
      blurb: 'They go and hit somebody else instead, which is the point.',
      channel: 'defensePercent',
    },
  ]),

  ...buildTrack('chief_medic', [
    {
      name: 'Field Triage',
      blurb: 'Deciding fast who can wait is most of the job.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Clean Water',
      blurb: 'It is not glamorous and it halves the sick list.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'Stretcher Drill',
      blurb: 'Off the ground and moving in ninety seconds.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Blood Bank',
      blurb: 'Cold storage, cross-matched, and everybody on the books is typed.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Antiseptics',
      blurb: 'Boiled instruments, and the surgeon washes first.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'Forward Aid Posts',
      blurb: 'Treatment where they fell, not where the ward is.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Trauma Theatre',
      blurb: 'A room in the Infirmary that nobody is allowed to use for anything else.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'Convalescence',
      blurb: 'Back on the line when they are ready, not when they are needed.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Prosthetics Bench',
      blurb: 'A hand that works is a person who stays.',
      channel: 'casualtyRecoveryPercent',
    },
    {
      name: 'Nobody Left',
      blurb: 'Everybody who can be brought back is brought back.',
      channel: 'casualtyRecoveryPercent',
    },
  ]),

  ...buildTrack('instructor_of_the_young', [
    {
      name: 'Drill Yard',
      blurb: 'Flat ground, marked out, used every morning.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Two-Week Basics',
      blurb: 'Everything anybody has to know, in a fortnight.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Live Rounds',
      blurb: 'Expensive, and there is no substitute for them.',
      channel: 'trainingCostPercent',
    },
    {
      name: 'Section Leaders',
      blurb: 'One in eight of them can teach the other seven.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Graded Ranges',
      blurb: 'Nobody moves up until they hit the target.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Night Exercises',
      blurb: 'The first time in the dark should not be the real time.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'Cadre System',
      blurb: 'The veterans train the intake and then go back to their units.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Standard Syllabus',
      blurb: 'One course, one book, no favourites.',
      channel: 'trainingCostPercent',
    },
    {
      name: 'Continuation Training',
      blurb: 'Nobody is finished. Everybody trains, monthly.',
      channel: 'unitVitalityPercent',
    },
    {
      name: 'The Intake',
      blurb: 'They arrive as bodies and leave six weeks later as soldiers.',
      channel: 'trainingSpeedPercent',
    },
  ]),

  ...buildTrack('raid_boss', [
    {
      name: 'Door Work',
      blurb: 'Getting through it in one go, loudly.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Split Loads',
      blurb: 'Nobody carries everything, so nobody is caught with everything.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'Reputation',
      blurb: 'Half of them do not fight, because of who is standing in the door.',
      channel: 'intimidationFlat',
    },
    {
      name: 'Snatch Teams',
      blurb: 'In, out and away before anybody has decided anything.',
      channel: 'unitSpeedPercent',
    },
    {
      name: 'Overwhelming Force',
      blurb: 'Three times what is needed, so that it is over in a minute.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Loading Drill',
      blurb: 'The truck is packed in four minutes, every time.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'The Example',
      blurb: 'One place, made an example of, and the next six pay without being asked.',
      channel: 'intimidationFlat',
    },
    {
      name: 'Breaching Order',
      blurb: 'Who goes in first, and what they do in the first two seconds.',
      channel: 'unitOffensePercent',
    },
    {
      name: 'Fence Network',
      blurb: 'Everything moves within a day. Nothing sits in the yard.',
      channel: 'lootCapacityPercent',
    },
    {
      name: 'The Name',
      blurb: 'Nobody counts what you brought. They count who is leading it.',
      channel: 'intimidationFlat',
    },
  ]),

  ...buildTrack('scout', [
    {
      name: 'Point Work',
      blurb: 'One person, four hundred metres ahead, and quiet.',
      channel: 'unitStealthPercent',
    },
    {
      name: 'Pace Counting',
      blurb: 'Distance without a map, in the dark.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Observation Posts',
      blurb: 'Somewhere you can watch a road all day without being seen.',
      channel: 'intelYieldPercent',
    },
    {
      name: 'Track Reading',
      blurb: 'Who went through, how many, and how long ago.',
      channel: 'intelYieldPercent',
    },
    {
      name: 'Light Order',
      blurb: 'Nothing carried that is not needed. Nothing that rattles.',
      channel: 'unitSpeedPercent',
    },
    {
      name: 'Hide Discipline',
      blurb: 'A day in a hole without moving.',
      channel: 'unitStealthPercent',
    },
    {
      name: 'Runner Relays',
      blurb: 'The report gets back in an hour instead of in a day.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Route Reconnaissance',
      blurb: 'The way in is walked before anybody has to use it.',
      channel: 'travelSpeedPercent',
    },
    {
      name: 'Counter-Tracking',
      blurb: 'Going back over your own trail and taking it apart.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Eyes On',
      blurb: 'There is nothing in this district you do not already know about.',
      channel: 'intelYieldPercent',
    },
  ]),

  ...buildTrack('consigliere', [
    {
      name: 'The Quiet Word',
      blurb: 'Before it is a problem, rather than after.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Reading the Room',
      blurb: 'Who is uncomfortable, and about what.',
      channel: 'intelResistancePercent',
    },
    { name: 'Favours Owed', blurb: 'A ledger nobody writes down.', channel: 'recruitPoolPercent' },
    {
      name: 'Terms in Advance',
      blurb: 'Agreed before anybody is in a position to want more.',
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Deniability',
      blurb: 'Arranged so that it was never said.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Backchannels',
      blurb: 'A way to talk to somebody you are not talking to.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Sitting Down',
      blurb: 'Both sides, one table, and somebody neutral pouring.',
      channel: 'unitMoraleFlat',
    },
    {
      name: 'The Long View',
      blurb: "This year's enemy is next year's supplier.",
      channel: 'wageDiscountPercent',
    },
    {
      name: 'Insulation',
      blurb: 'Nothing that happens downstairs reaches this floor.',
      channel: 'intelResistancePercent',
    },
    {
      name: 'Nothing in Writing',
      blurb: 'There is no document anywhere with your name on it.',
      channel: 'intelResistancePercent',
    },
  ]),

  ...buildTrack('professor', [
    {
      name: 'Reading Lists',
      blurb: 'What to read, in what order, and what to skip.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Lecture Series',
      blurb: 'Two hours a week, and everybody is better at their job.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Marginalia',
      blurb: 'The notes in the margin are worth more than the book they are in.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Working Papers',
      blurb: 'Circulated before they are finished, which is the point of them.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'Seminar',
      blurb: 'Six people arguing about one page.',
      channel: 'trainingSpeedPercent',
    },
    {
      name: 'Citation Index',
      blurb: 'Who read what, and what it changed.',
      channel: 'intelYieldPercent',
    },
    {
      name: 'Applied Sections',
      blurb: 'The theory goes down to the workshop the same week.',
      channel: 'buildSpeedPercent',
    },
    {
      name: 'Retrospectives',
      blurb: 'Every project, afterwards, honestly.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'The Reading Year',
      blurb: 'One long project nobody is allowed to hurry.',
      channel: 'researchSpeedPercent',
    },
    {
      name: 'First Principles',
      blurb: 'Beginning from nothing and arriving somewhere nobody expected.',
      channel: 'researchSpeedPercent',
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
 * What the finished rungs are worth, as effect channels.
 *
 * Sparse, and folded by the caller into the same struct everything else lands in, so a rung needs
 * no wiring of its own: whatever already reads `buildSpeedPercent` gets research's contribution to
 * it for free.
 */
export function researchEffects(known: readonly string[]): Partial<Record<EffectChannel, number>> {
  const total: Partial<Record<EffectChannel, number>> = {};
  for (const id of known) {
    const spec = findResearchItem(id);
    if (!spec) continue;
    const { channel } = spec.payout;
    total[channel] = (total[channel] ?? 0) + spec.magnitude;
  }
  return total;
}

/**
 * What one rung does, in the words a player reads.
 *
 * Here rather than at the route because it was written twice once already and the two copies
 * disagreed: the route folded the channel through {@link CHANNEL_LABELS} and the e2e fixture
 * printed the raw key, so every screenshot of the Lab said `+8% PRODUCTIONPERCENT` while the
 * running game said `+8% what the district makes`.
 */
export function describeResearchPayout(spec: ResearchItemSpec): string {
  const unit = CHANNEL_LABELS[spec.payout.channel].unit === 'flat' ? '' : '%';
  const effect = `+${spec.magnitude}${unit} ${CHANNEL_LABELS[spec.payout.channel].label.toLowerCase()}`;
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
