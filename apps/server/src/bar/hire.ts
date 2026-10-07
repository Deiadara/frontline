import { randomUUID } from 'node:crypto';
import { tallyOfficerHired } from '../feats/tally.js';
import {
  MAX_WAGE_DISCOUNT,
  askingWage,
  assessJoin,
  committedWage,
  buildingLevel,
  cancelDrill,
  chairPassiveOf,
  dismissalFee,
  officerPortraitId,
  payrollBonusPercent,
  payrollFits,
  payrollLedger,
  playerLevelGrants,
  sessionFor,
  type Base,
  type Commander,
  type CrewEffects,
  type JoinBlocker,
  type PayrollLedger,
} from '@frontline/shared';
import { adminCaps, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import { officerDuty } from '../crew/duty.js';
import type { Repositories } from '../db/repos/index.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { barDay, type BarCharacter } from './roster.js';

/**
 * Signing somebody out of the Bar (GDD §H3, §H7, §H8), and letting them go again.
 *
 * There is no hire *route* any more. The auction decides who signs (`bar/auction.ts`), and this is
 * the gate it walks a ranking through: the first crew that clears everything here takes the person.
 * So the file is smaller than it was by exactly the parts that were a conversation, a daily
 * allowance and a walk-out, all of which the auction replaced with a price.
 *
 * No caps change hands. An officer's fee is a **commitment against the payroll book**
 * (`economy/payroll.ts`), so signing writes the agreed figure into `payroll.commitments` and takes
 * nothing out of the stockpile; the only thing the book can refuse is a fee that does not fit in
 * what is left of it. The caps side of the contract is a single charge at the *other* end, when
 * somebody is let go: see `releaseOfficer`.
 */

export interface SignInput {
  base: Base;
  /** The account whose crew they join. The signing log is keyed by it. */
  userId: string;
  recruit: BarCharacter;
  /** §H7: the price the table closed at, which is the city's number and not this crew's. */
  price: number;
  now: Date;
  /**
   * The face they sign with: the one the Bar showed on their card, free in the whole city
   * (`crew/faces.ts`). Falls back to the hashed face when a caller has none to hand.
   */
  portraitId?: string;
  /**
   * Admin mode, handed down from whoever runs the close. The table waives the chair, the bed, the
   * payroll book and the recruit's doors in admin mode (`bar/auction.ts`), so the close has to
   * waive the same four, or an accepted admin bid is passed over at midnight with nobody signed
   * (maintainer, 2026-09-29). `already_hired` is a fact, not a gate, and is never waived.
   */
  admin?: boolean;
}

/** Why a crew cannot take the person they just won. */
export const HIRE_REFUSALS = [
  'already_hired',
  'no_slots',
  /** Every bed in the district is taken, and an officer sleeps in one (2026-09-29). */
  'no_unit_slots',
  'requirement',
  // The two doors the standout seats ask about (§H3, 2026-09-11). Named rather than folded into
  // `requirement`, because the close's reason is what the log and the bell carry.
  'infamy',
  'faction',
  'no_payroll',
] as const;
export type HireRefusal = (typeof HIRE_REFUSALS)[number];

export type SignResult =
  | { kind: 'refused'; reason: HireRefusal }
  | {
      kind: 'signed';
      base: Base;
      officer: Commander;
      /** What the book is actually charged: the price after this crew's negotiators (§H7). */
      wage: number;
      payroll: PayrollLedger;
    };

/**
 * What the crew's badge has earned, ever, or zero for a crew in no faction (§J8).
 *
 * Read through the repositories rather than off the base, because a faction is not part of a
 * district: it is a table of its own that a crew joins and leaves. Zero for somebody with no
 * membership, which is what makes the faction door in `assessJoin` shut for them.
 */
export function factionInfamyOf(repos: Repositories, base: Base): number {
  const membership = repos.factions.membershipOf(base.ownerId);
  if (!membership) return 0;
  return repos.factions.find(membership.factionId)?.infamyEarned ?? 0;
}

/**
 * §H3 judged against this crew: the one place the four doors are read for a base.
 *
 * `factionInfamy` is passed rather than looked up, because the two live callers already know it and
 * the third is a screen projecting eight recruits against one crew: reading the faction table once
 * per room beats once per person.
 */
export function assessAgainst(
  base: Base,
  recruit: BarCharacter,
  factionInfamy = 0,
): ReturnType<typeof assessJoin> {
  return assessJoin(recruit.requirement, {
    notoriety: base.economy.notoriety,
    infamy: base.economy.infamy,
    factionInfamy,
  });
}

/**
 * What this character asks for, which is what their auction opens at once `reservationWage` has
 * taken its cut (§H7).
 *
 * ## The asking price is the city's, not this crew's
 *
 * `discountPercent` is `wageDiscountPercent`, the channel four perks and six
 * Lab rungs feed, and every Bar path passes nothing here on purpose. An auction has **one**
 * floor, because two crews bidding against each other have to be bidding against the same number:
 * a per-crew reserve would mean a bid that is legal for one crew and under the floor for the other
 * at the same table, and a close that has to pick which of two reserves the ranking is measured
 * against.
 *
 * The channel has a sink all the same, one table further down: see {@link committedWage}. What the
 * crew's negotiators buy is not a cheaper table, it is a cheaper **contract**, which keeps the
 * bidding fair and still pays for hiring a Union Rep.
 */
export function wageAskedOf(recruit: BarCharacter, discountPercent = 0): number {
  // §H7: the tags are half of what somebody is worth, and the half nobody can train.
  return askingWage(recruit.attributes, discountPercent, recruit.perks);
}

/**
 * §H7a: the highest price a crew can bid and still hold the contract.
 *
 * The inverse of {@link committedWage} against what is left of the book: the largest whole number
 * whose talked-down figure still fits, which is what makes "the server refuses above this and only
 * above this" true on the wire.
 */
export function bidCeilingFor(available: number, discountPercent: number): number {
  const room = Math.max(0, Math.floor(available));
  if (room <= 0) return 0;
  // Capped exactly as `committedWage` caps it. The raw channel reaches 119 on a late crew, and read
  // uncapped it left no share to divide by, so the ceiling fell back to the bare book: half of
  // what the gate takes, since the contract is only ever talked down by half.
  const share = 1 - Math.min(MAX_WAGE_DISCOUNT, Math.max(0, discountPercent)) / 100;
  // Rounding means several raw prices land on the same charged figure, so the arithmetic answer
  // can sit a cap or two under the true edge as easily as over it. Walk to the edge from wherever
  // it lands, in both directions, so the ceiling is exactly the last bid the gate takes.
  let ceiling = Math.floor(room / share);
  while (ceiling > 0 && committedWage(ceiling, discountPercent) > room) ceiling -= 1;
  while (committedWage(ceiling + 1, discountPercent) <= room) ceiling += 1;
  return ceiling;
}

/**
 * The crew's payroll book as every gate in this file reads it.
 *
 * `stepDiscountPercent` is the perk channel for officers who make widening the book cheaper, and
 * it has to be threaded through rather than defaulted at the screen: `nextStepCost` on this ledger
 * is the price the Bar *prints*, and `POST /bar/payroll` charges the same function. A default here
 * with the discount applied only at the charge would put a different number on the screen from the
 * one that comes out of the stockpile, which is the worst kind of pricing bug because it looks
 * like a refund.
 */
export function ledgerFor(base: Base, effects: LedgerEffects = NO_LEDGER_EFFECTS): PayrollLedger {
  return payrollLedger(
    base.economy.payroll,
    buildingLevel(base.buildings, 'nexus'),
    // The district's cards and the ground's (`payrollPercent`, the Printworks held whole,
    // maintainer 2026-10-07), on the one sum the Nexus book is multiplied by.
    payrollBonusPercent(base.buildings) + effects.payrollPercent,
    effects.payrollStepDiscountPercent,
    // The Fixer's passive (maintainer, 2026-10-04).
    chairPassiveOf(effects, 'fixer', 'payroll'),
  );
}

/** What the ledger reads off a crew's standing: pass `standingEffectsFor`, or the ground pays nothing. */
export type LedgerEffects = Pick<
  CrewEffects,
  'payrollStepDiscountPercent' | 'chairPoints' | 'payrollPercent'
>;

const NO_LEDGER_EFFECTS: LedgerEffects = {
  payrollStepDiscountPercent: 0,
  chairPoints: {},
  payrollPercent: 0,
};

/**
 * Every §H3 door, in the order a player should be told about it, as the reason the close records.
 *
 * Derived from `JOIN_BLOCKERS` rather than written out, and that is the fix rather than a tidy-up.
 * It used to be two `if`s naming `notoriety` and `level`, so when the standout seats added the
 * wallet and the badge (2026-09-11) the close silently stopped reading them: `blockers` came back
 * `['infamy']`, neither `if` matched, and `refusalFor` returned null. The bid gate refused the
 * same crew at the table (`bar/auction.ts` reads `interested`), so an officer whose card says they
 * will not work for you at any price was handed over at midnight anyway. Reachable in ordinary
 * play, because infamy is a wallet that goes down: bid while you hold it, spend it, win them.
 *
 * A record over the blocker union, so a door added to `JOIN_BLOCKERS` fails to compile here until
 * it has a reason of its own.
 */
const REFUSAL_FOR_BLOCKER: Readonly<Record<JoinBlocker, HireRefusal>> = {
  notoriety: 'requirement',
  infamy: 'infamy',
  faction: 'faction',
};

/**
 * §H3 and §H8: everything that has to be true before this crew can put somebody on the books.
 *
 * Ordered by what a player most wants to be told. The same list gates a *bid*
 * (`bar/auction.ts`), which is the point: a crew that cannot take somebody should be told at the
 * table rather than at the close, when there is nothing left to do about it.
 */
function refusalFor(
  base: Base,
  recruit: BarCharacter,
  blockers: readonly JoinBlocker[],
  room: { slots: number; bedsFree: number },
  admin: boolean,
): HireRefusal | null {
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  // §H8: one slot with the Bar, another every two levels, read off W6's grant table rather than
  // restated here. `>=` rather than `===`: a crew already over the limit keeps everyone it holds
  // and signs nobody new until it is back under.
  if (base.commanders.length >= room.slots && !adminWaives('no_slots', admin)) return 'no_slots';
  if (room.bedsFree < 1 && !adminWaives('no_unit_slots', admin)) return 'no_unit_slots';
  // The doors are waived under the table's name for them, `not_interested`, so admin mode opens
  // exactly the doors at midnight that it opened when the bid went in.
  if (adminWaives('not_interested', admin)) return null;
  // `blockers` already arrives in the order `assessJoin` puts them in, which is the order a player
  // should read them, so the first one is the one to report.
  const shut = blockers[0];
  return shut === undefined ? null : REFUSAL_FOR_BLOCKER[shut];
}

/**
 * Puts a won recruit on the books at the price their table closed at, or says why not.
 *
 * Always onto the **bench**: a role is a decision the player makes on the Crew screen, and the
 * close happens while they are asleep. Two things happen together: the officer joins the books,
 * and the fee is committed against the payroll book. Nothing is charged.
 */
export function signRecruit(repos: Repositories, input: SignInput): SignResult {
  const { base, userId, recruit, now, admin = false } = input;
  const price = Math.max(0, Math.round(input.price));

  const { blockers } = assessAgainst(base, recruit, factionInfamyOf(repos, base));
  const room = {
    slots: recruitSlotsFor(base),
    bedsFree: districtUnitSlots(repos, base).spare,
  };
  const refusal = refusalFor(base, recruit, blockers, room, admin);
  if (refusal) return { kind: 'refused', reason: refusal };

  // Read once. The step discount is the same figure `GET /bar` and the payroll route apply, or the
  // step price on the response differs from the one that leaves the stockpile when the button is
  // pressed; the wage discount is what this crew's negotiators take off the contract.
  const effects = standingEffectsFor(repos, base);
  const wage = committedWage(price, effects.wageDiscountPercent);
  const ledger = ledgerFor(base, effects);
  if (!payrollFits(ledger, wage) && !adminWaives('no_payroll', admin)) {
    return { kind: 'refused', reason: 'no_payroll' };
  }

  const officer: Commander = {
    id: recruit.id,
    name: recruit.name,
    role: null,
    attributes: recruit.attributes,
    // §D4: nobody is hired hurt. The clock is only ever written by a fight the settler ran.
    injuredUntil: null,
    // §B7: the perks come with the person, exactly as the card at the Bar advertised them.
    perks: recruit.perks,
    // §H7: what the book is charged and what the crew card prints, which is the closing price
    // after this crew's own negotiators have been at it. The whole of the relationship now.
    weeklyWage: wage,
    portraitId: input.portraitId ?? officerPortraitId(recruit.id),
  };

  const signed: Base = {
    ...base,
    economy: {
      ...base.economy,
      payroll: {
        ...base.economy.payroll,
        commitments: { ...base.economy.payroll.commitments, [officer.id]: wage },
      },
    },
    commanders: [...base.commanders, officer],
  };

  repos.bases.updateEconomy(signed.id, signed.economy);
  repos.bases.updateCommanders(signed.id, signed.commanders);
  repos.bar.recordHire({
    id: randomUUID(),
    day: barDay(now),
    userId,
    recruitId: recruit.id,
    hiredAt: now.toISOString(),
  });
  // Feats: the signing, counted. `bar_hires` has recorded this since 0012 and nothing has
  // ever read it; a counter is one integer instead of a scan over a table that only grows.
  tallyOfficerHired(repos, base.id);

  return {
    kind: 'signed',
    base: signed,
    officer,
    wage,
    payroll: ledgerFor(signed, effects),
  };
}

/**
 * Letting somebody go (§H7).
 *
 * Their slice of the book is freed the moment it happens, and it costs `DISMISSAL_WEEKS` of that
 * slice in caps, paid there and then. That asymmetry is the whole design: committing costs
 * nothing, so a player will sign somebody; walking it back costs ten weeks, so they will think
 * about it first. Without it the book would be a scratch pad a crew could rewrite every time a
 * better sheet walked into the Bar.
 */
export type ReleaseResult =
  | { kind: 'refused'; reason: 'not_on_the_books' | 'cannot_afford' }
  | { kind: 'refused'; reason: 'on_duty'; held: 'run' | 'fight' }
  | { kind: 'released'; base: Base; officer: Commander; fee: number; payroll: PayrollLedger };

export function releaseOfficer(
  repos: Repositories,
  base: Base,
  officerId: string,
  admin = false,
  // The route's instant, the one it settled the base to (bug pass, 2026-10-06): this read the
  // wall clock twice, so duty and the drill cancel were judged a moment after the settle.
  now: Date = new Date(),
): ReleaseResult {
  const officer = base.commanders.find((held) => held.id === officerId);
  if (!officer) return { kind: 'refused', reason: 'not_on_the_books' };
  /*
   * Not while they are out leading something (2026-09-28). Every run has a leader, and letting
   * one go mid-run left the run with nobody at its head and a fight settling without the officer
   * the crew sent. Laid up is fine: the bed is not a job.
   */
  const duty = officerDuty(repos, base, officer, now);
  if (duty !== null && (duty.held === 'run' || duty.held === 'fight')) {
    return { kind: 'refused', reason: 'on_duty', held: duty.held };
  }

  const committed = base.economy.payroll.commitments[officerId] ?? 0;
  const fee = dismissalFee(committed);
  if (fee > base.resources.caps && !adminWaives('cannot_afford', admin)) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }

  const commitments = { ...base.economy.payroll.commitments };
  delete commitments[officerId];

  /*
   * Somebody let go mid-drill takes their hour with them (MOU, 2026-09-21).
   *
   * A session is keyed by `subjectId`, and nothing outside `base.commanders` ever removes one:
   * this path dropped the officer and left the drill standing on the board. Before the floor had
   * a bench limit that was invisible, because a stranded session only blocked the person who no
   * longer existed. Now `trainingBlocker` counts `sessions.length` against `TRAINING_QUEUE_SLOTS`,
   * so one of these holds a place in the queue nobody can see: with the queue full every drill on
   * every sheet answers "The queue is full" while the screen, which counts the floor off the
   * subjects it can see, prints "The floor is empty". There is no way out from
   * the client either, because the only source of session ids on that screen is the subject list
   * the officer has just left.
   *
   * `cancelDrill` rather than a bare filter: it is the one function that knows what taking a
   * drill off the board involves, which is the day's session handed back and the no-repeat memory
   * put back to what it read before the hour started. Nothing was learned, so nothing is charged.
   */
  const held = sessionFor(base.training, officerId);
  const training =
    held === undefined ? base.training : cancelDrill(base.training, held.id, now.toISOString());

  const released: Base = {
    ...base,
    resources: { ...base.resources, caps: base.resources.caps - adminCaps(fee, admin) },
    economy: { ...base.economy, payroll: { ...base.economy.payroll, commitments } },
    commanders: base.commanders.filter((officer) => officer.id !== officerId),
    training,
  };

  repos.bases.updateResources(released.id, released.resources);
  repos.bases.updateEconomy(released.id, released.economy);
  repos.bases.updateCommanders(released.id, released.commanders);
  // After the commanders write: `updateTraining` takes the roster too, and handing it the list
  // the officer is still on would put them straight back on the books.
  if (held !== undefined) {
    repos.bases.updateTraining(released.id, released.training, released.commanders);
  }

  return {
    kind: 'released',
    base: released,
    officer,
    fee,
    payroll: ledgerFor(released, standingEffectsFor(repos, released)),
  };
}

/**
 * How many officers the books hold: the level's slots, one per chair at most (maintainer,
 * 2026-09-30). The level is the only source since research stopped paying slots (maintainer,
 * 2026-10-01).
 */
export function recruitSlotsFor(base: Base): number {
  return playerLevelGrants(base.level).recruitSlots;
}
