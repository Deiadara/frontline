import { z } from 'zod';
import { MORAL_COMPASSES, type Ambition, type MoralCompass } from './disposition.js';
import { reservationWage } from './wage.js';

/**
 * Haggling with somebody who has an opinion about you (GDD §H7).
 *
 * `negotiateWage` answers one question, *would they take this?*, and it answers it the same way
 * every time, for everybody. That is a price check, not a negotiation. What was missing is the part
 * that makes hiring a person feel like hiring a person: they say something, you move, they move,
 * and at some point they stop moving and start looking at the door.
 *
 * The model is Football Manager's, because Football Manager solved this a long time ago and the
 * shape of it is worth borrowing exactly:
 *
 * - **A reservation value.** A number they will not go below, fixed before the conversation starts.
 *   Here it is {@link reservationWage}, unchanged and deliberately so: the Bar already shows it, the
 *   server already enforces it, and a negotiation whose floor disagreed with the hire gate would be
 *   theatre with a bug in it.
 * - **A standing demand that moves.** They open at their asking price and concede a share of the
 *   gap each time you improve on your last offer, never past the floor. Standing still gets you
 *   almost nothing back, which is what makes the *sequence* of offers matter rather than only the
 *   last one.
 * - **A personality.** Two people with identical sheets do not haggle alike. Ambition sets how hard
 *   they hold out; the moral compass sets how long they will stay in the chair.
 * - **Patience that runs out.** Every exchange costs some. Lowballing costs more. Repeating
 *   yourself costs more still.
 * - **A walk-away.** When it is gone they are gone, and not for five minutes, for the day. That is
 *   the whole reason to negotiate carefully rather than binary-searching the floor, and it is why
 *   this state is persisted rather than kept in a component.
 *
 * Everything here is pure and deterministic: the same conversation replays to the same words. The
 * server owns the state, the client renders it, and neither of them has a second opinion about what
 * a character just said.
 */

/** How they haggle, derived from §H4 rather than rolled: a character negotiates like themselves. */
export interface NegotiationTemper {
  /** Exchanges they will sit through before they are done. */
  patience: number;
  /** The share of the gap they give up when an offer improves. Higher is easier to move. */
  concession: number;
}

/**
 * What each ambition is worth in patience.
 *
 * Somebody here for the money will sit and grind; somebody here because they want to belong to
 * something is embarrassed to be haggling at all and gives ground to end it.
 */
const AMBITION_TEMPER: Readonly<Record<Ambition, NegotiationTemper>> = {
  wealth: { patience: 6, concession: 0.2 },
  power: { patience: 4, concession: 0.28 },
  revenge: { patience: 3, concession: 0.4 },
  justice: { patience: 4, concession: 0.45 },
  knowledge: { patience: 5, concession: 0.35 },
  belonging: { patience: 5, concession: 0.5 },
  notoriety: { patience: 3, concession: 0.3 },
};

/** And what the moral compass does to it. A pragmatist negotiates; a ruthless one does not. */
const COMPASS_TEMPER: Readonly<Record<MoralCompass, { patience: number; concession: number }>> = {
  idealist: { patience: 1, concession: 0.05 },
  pragmatist: { patience: 2, concession: 0.1 },
  opportunist: { patience: 1, concession: -0.05 },
  ruthless: { patience: -1, concession: -0.1 },
};

export const MIN_PATIENCE = 2;
export const MAX_PATIENCE = 8;

export function negotiationTemper(
  ambition: Ambition,
  moralCompass: MoralCompass,
): NegotiationTemper {
  const base = AMBITION_TEMPER[ambition];
  const shift = COMPASS_TEMPER[moralCompass];
  return {
    patience: Math.min(MAX_PATIENCE, Math.max(MIN_PATIENCE, base.patience + shift.patience)),
    concession: Math.min(0.7, Math.max(0.1, base.concession + shift.concession)),
  };
}

/** An offer below this share of their floor is not a negotiating position, it is an insult. */
export const INSULT_FRACTION = 0.65;
/** Patience an insulting offer costs, on top of the one every exchange costs. */
export const INSULT_PATIENCE_COST = 2;
/** And what repeating an offer they have already turned down costs. */
export const STONEWALL_PATIENCE_COST = 1;
/** How much of the gap a non-improving offer still buys. Enough to notice, not enough to work. */
export const STALE_CONCESSION_SHARE = 0.25;

export const NEGOTIATION_MOODS = [
  'opening',
  'considering',
  'close',
  'insulted',
  'stonewalled',
  'agreed',
  'overpaid',
  'walked',
] as const;
export const NegotiationMoodSchema = z.enum(NEGOTIATION_MOODS);
export type NegotiationMood = z.infer<typeof NegotiationMoodSchema>;

/**
 * A conversation in progress. Persisted per crew, per character, per day.
 *
 * `standing` is the only number the player is shown moving, and it is the honest one: what they
 * are asking for *now*. The floor is never on the wire in so many words, because the whole game of
 * a negotiation is working out where it is, and the Bar already gives an honest player enough to
 * derive it.
 */
export const NegotiationSchema = z.object({
  /** Exchanges that have happened. */
  rounds: z.number().int().nonnegative(),
  /** Exchanges they have left in them. Zero means they have gone. */
  patience: z.number().int().nonnegative(),
  /** What they are asking for, right now, in caps a week. */
  standing: z.number().int().positive(),
  /** The last thing the player put on the table, or `null` before they have said anything. */
  lastOffer: z.number().int().nonnegative().nullable(),
  /** How the last exchange went: what the window draws its face and its line off. */
  mood: NegotiationMoodSchema,
  /** Set once they have signed or gone. Nothing more can be said either way. */
  closed: z.boolean(),
});
export type Negotiation = z.infer<typeof NegotiationSchema>;

/** The opening position: what they asked for, and everything they have in them. */
export function openNegotiation(
  asking: number,
  ambition: Ambition,
  moralCompass: MoralCompass,
): Negotiation {
  return {
    rounds: 0,
    patience: negotiationTemper(ambition, moralCompass).patience,
    standing: Math.max(1, Math.round(asking)),
    lastOffer: null,
    mood: 'opening',
    closed: false,
  };
}

export interface NegotiationTurn {
  negotiation: Negotiation;
  /** True the moment they take an offer. The wage is `negotiation.lastOffer`. */
  accepted: boolean;
  /** True the moment patience runs out. Nothing else will be agreed today. */
  walkedAway: boolean;
}

export interface NegotiationInput {
  negotiation: Negotiation;
  /** What the player just put on the table. */
  offer: number;
  /** Their opening price against *this* crew: the floor is derived from it. */
  asking: number;
  ambition: Ambition;
  moralCompass: MoralCompass;
}

/**
 * One exchange: the player's offer, and what it does to the person across the table.
 *
 * The order of the checks is the order the fiction happens in. They hear the number, they decide
 * whether it is acceptable, and only if it is not do they work out how much of an insult it was and
 * whether they can be bothered to answer it. A character who has already agreed or already left
 * is returned untouched rather than throwing: a double-click must not be a crash.
 */
export function negotiate({
  negotiation,
  offer,
  asking,
  ambition,
  moralCompass,
}: NegotiationInput): NegotiationTurn {
  if (negotiation.closed) {
    return { negotiation, accepted: false, walkedAway: negotiation.patience === 0 };
  }

  const floor = reservationWage(asking);
  const bid = Math.max(0, Math.round(offer));
  const rounds = negotiation.rounds + 1;

  // Taken as made. Above their standing demand as well as their floor is a different feeling: the
  // window says so, and it is the one branch where the player has definitely paid too much.
  if (bid >= floor) {
    return {
      negotiation: {
        rounds,
        patience: negotiation.patience,
        standing: bid,
        lastOffer: bid,
        mood: bid > negotiation.standing ? 'overpaid' : 'agreed',
        closed: true,
      },
      accepted: true,
      walkedAway: false,
    };
  }

  const insulting = bid < floor * INSULT_FRACTION;
  const improved = negotiation.lastOffer === null || bid > negotiation.lastOffer;
  const cost =
    1 + (insulting ? INSULT_PATIENCE_COST : 0) + (improved ? 0 : STONEWALL_PATIENCE_COST);
  const patience = Math.max(0, negotiation.patience - cost);

  // Gone. Their standing demand is left where it was rather than snapped back to the asking price:
  // the number they walked out on is the interesting one, and inflating it on the way out would
  // read as the game punishing a player twice for the same offer.
  if (patience === 0) {
    return {
      negotiation: {
        rounds,
        patience: 0,
        standing: negotiation.standing,
        lastOffer: bid,
        mood: 'walked',
        closed: true,
      },
      accepted: false,
      walkedAway: true,
    };
  }

  // They come down. Improving on your last offer buys the full concession; repeating yourself buys
  // a quarter of it, which is enough that a stubborn player is not simply stuck and little enough
  // that stubbornness is a bad plan.
  const { concession } = negotiationTemper(ambition, moralCompass);
  const share = improved ? concession : concession * STALE_CONCESSION_SHARE;
  const standing = Math.max(
    floor,
    Math.round(negotiation.standing - (negotiation.standing - bid) * share),
  );

  return {
    negotiation: {
      rounds,
      patience,
      standing,
      lastOffer: bid,
      mood: insulting
        ? 'insulted'
        : !improved
          ? 'stonewalled'
          : standing <= floor
            ? 'close'
            : 'considering',
      closed: false,
    },
    accepted: false,
    walkedAway: false,
  };
}

/**
 * What they actually say.
 *
 * Four voices, because the moral compass is the half of §H4 that shows in how somebody talks about
 * money: an idealist is uncomfortable, an opportunist is enjoying himself. Picked deterministically
 * off the round number so a conversation replays word for word and a test can pin a line.
 *
 * Written as speech and not as UI copy. "Not enough" is a validation message; "I have got people
 * asking after me, and they are not opening there" is a person.
 */
const LINES: Readonly<Record<MoralCompass, Readonly<Record<NegotiationMood, readonly string[]>>>> =
  {
    idealist: {
      opening: [
        'I would rather talk about the work, but the work does not feed anybody. Say a number.',
        'I am not going to pretend this part does not matter. What are you offering?',
      ],
      considering: [
        'That is not nothing. It is not enough either, and I think you know that.',
        'I have turned down more than that from people I liked less. Try again.',
      ],
      close: [
        'We are nearly there, and I would like to stop doing this. One more step.',
        'Close enough that I am embarrassed to still be arguing. Nearly.',
      ],
      insulted: [
        'You are not negotiating. You are seeing what I will put up with.',
        'I came here because of what people say you stand for. That number says something else.',
      ],
      stonewalled: [
        'You have said that already. I heard it the first time.',
        'The number has not changed and neither have I.',
      ],
      agreed: [
        'Then we are agreed. I will not ask you for more.',
        'Good. Now tell me what the work is.',
      ],
      overpaid: [
        'That is more than I asked for. I will not pretend I did not notice.',
        'You did not have to do that. I will remember that you did.',
      ],
      walked: [
        'No. I would rather be poor somewhere honest.',
        'I am going to go before one of us says something we cannot take back.',
      ],
    },
    pragmatist: {
      opening: [
        'Let us get the money out of the way. What is the number?',
        'I have a figure in mind. Say yours and we will see how far apart we are.',
      ],
      considering: [
        'That is a start. It is not a finish.',
        'I can see where you are going. You have not got there yet.',
      ],
      close: [
        'We are inside spitting distance. Do not make me haggle over one week.',
        'That is nearly the number. Nearly.',
      ],
      insulted: [
        'You have wasted one of us’s time and it was not mine.',
        'I will assume you misheard the figure rather than that you meant that.',
      ],
      stonewalled: [
        'Same number. Same answer.',
        'If you have nothing new to say, we are just sitting here.',
      ],
      agreed: ['Done. Where do you want me.', 'Agreed. I will not bring it up again.'],
      overpaid: [
        'That is over the odds and I am not going to argue you down.',
        'Generous. I will take it before you think about it.',
      ],
      walked: [
        'We are too far apart and neither of us is moving. I am out.',
        'This is not going to close. Good luck.',
      ],
    },
    opportunist: {
      opening: [
        'Everybody in here has a price. Mine is a bit higher than you were hoping.',
        'Go on then. Impress me.',
      ],
      considering: [
        'I have got people asking after me, and they are not opening there.',
        'You can do better. I have watched you do better.',
      ],
      close: ['One more move and I stop looking at the door.', 'Nearly. And I do mean nearly.'],
      insulted: [
        'That is not an offer, that is a test. I do not sit tests.',
        'I have been underpaid before. I have never been underpaid that creatively.',
      ],
      stonewalled: ['Still that? All right. Still no.', 'Repeating it does not make it bigger.'],
      agreed: ['Now you are talking. I am yours.', 'Signed. You will get your money’s worth.'],
      overpaid: [
        'You are paying over. I am not going to be the one to mention it. Oh.',
        'That is more than I would have taken and you will never know how much more.',
      ],
      walked: [
        'There is a better table in here and I am going to go sit at it.',
        'I am done. Somebody else will pay it.',
      ],
    },
    ruthless: {
      opening: ['Number.', 'Say it once and say it properly.'],
      considering: ['No.', 'Not for that.'],
      close: [
        'Nearly. Do not make me say it twice.',
        'One more and I will stop being polite about it.',
      ],
      insulted: [
        'Say that again and see what happens.',
        'I have hurt people for less than that and got paid for it.',
      ],
      stonewalled: ['You already said that.', 'I do not repeat myself either.'],
      agreed: ['Fine.', 'Done. Point me at somebody.'],
      overpaid: ['You did not have to. Noted.', 'More than I asked. Keep doing that.'],
      walked: ['We are finished.', 'No. And do not send anybody after me about it.'],
    },
  };

/**
 * The line for this turn.
 *
 * Deterministic on the round, so the same conversation says the same thing twice and a test can pin
 * it. Falls back to the pragmatist's bank for a compass the table somehow does not answer to,
 * because a missing line on a settle path is a blank speech bubble and a blank speech bubble is
 * worse than a slightly wrong voice.
 */
export function negotiationLine(
  moralCompass: MoralCompass,
  mood: NegotiationMood,
  round: number,
): string {
  const voice = LINES[moralCompass] ?? LINES.pragmatist;
  const bank = voice[mood];
  const line = bank[Math.abs(Math.trunc(round)) % bank.length];
  return line ?? '…';
}

/** Guards the voice table against a compass being added and going silent. */
for (const compass of MORAL_COMPASSES) {
  for (const mood of NEGOTIATION_MOODS) {
    if ((LINES[compass][mood]?.length ?? 0) === 0) {
      throw new Error(`no ${mood} line for a ${compass}`);
    }
  }
}
