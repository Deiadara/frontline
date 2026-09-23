import { z } from 'zod';

/**
 * The opening tutorial (maintainer, 2026-09-22).
 *
 * Six cards, shown once each, on the screens they are about. The game has eleven systems and a
 * new crew arrives on a city map with no explanation of any of them: what a district is, who is
 * holding it, why the whole map is grey, or what the Combine is. This is the smallest thing that
 * answers those in the order a player meets them.
 *
 * ## The rules the maintainer set
 *
 * - **Narrated by the game, not by a character.** The Combine card carries Directive Xero's
 *   portrait because that is the face of the thing being described, but he is not speaking and no
 *   card is in anybody's voice. So there are no quotation marks and no name on any card.
 * - **First visit to a screen**, not first action. A card explains a screen while the player is
 *   looking at it, which is also the only trigger that needs nothing from the server but a flag.
 * - **Every card offers Skip**, and skipping stops all of them for good. There is no close cross:
 *   a cross is an invitation to dismiss one card without deciding about the rest, and the
 *   maintainer asked for the decision to be on the card.
 * - **Only at the beginning.** Once a step is seen it never returns, and the set is fixed at six.
 *
 * ## Why the state is a set of seen ids
 *
 * A cursor ("you are on step 3") cannot answer "have they seen the battles card", which is the
 * only question the client ever asks, and it goes wrong the moment a player reaches a screen out
 * of order, which they will: the city, missions, battles and the base are four doors on one bar
 * and nothing makes anybody walk them left to right. A set answers the question directly and has
 * no order to get wrong. **Skip is not a second concept**: it writes every id into the set, so
 * "skipped" and "seen them all" are the same state and there is no pair of flags to disagree.
 */
export const TUTORIAL_STEPS = [
  'welcome',
  'combine',
  'city',
  'missions',
  'battles',
  'base',
] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];
export const TutorialStepSchema = z.enum(TUTORIAL_STEPS);

/**
 * Which screen raises each card.
 *
 * `city` is the game's index route, so the three cards that carry it are the opening: a player
 * who has just chosen an overseer lands there and reads welcome, then the Combine, then the map,
 * one press apart. The other three wait on their own screens and may never be seen at all, which
 * is correct: a card about calling a fight is noise until somebody opens the battles board.
 */
export const TUTORIAL_SCREENS = {
  welcome: 'city',
  combine: 'city',
  city: 'city',
  missions: 'missions',
  battles: 'battles',
  base: 'base',
} as const satisfies Record<TutorialStep, string>;

export type TutorialScreen = (typeof TUTORIAL_SCREENS)[TutorialStep];

/** What each card says. Kept here so the copy is in the package the tests can price it against. */
export interface TutorialCardSpec {
  readonly step: TutorialStep;
  readonly title: string;
  /** The one line under the title: what this screen is, in the player's words. */
  readonly lede: string;
  /** Two or three short paragraphs. Never a wall: a card nobody reads teaches nothing. */
  readonly body: readonly string[];
  /**
   * The unit whose portrait sits beside the text, if any.
   *
   * Only the Combine card has one, and it is Directive Xero because he is the top of the thing
   * the card is describing. A portrait on every card would make the set look like six people
   * talking to you, which is exactly the reading the maintainer ruled out.
   */
  readonly portraitUnitId?: string;
}

export const TUTORIAL_CARDS: readonly TutorialCardSpec[] = [
  {
    step: 'welcome',
    title: 'Ashfall',
    lede: 'You have a district, a handful of people and no reputation at all.',
    body: [
      'Everything in this city belongs to somebody. What you hold, you hold because you took it and nobody has taken it back yet.',
      'Three things pay: running missions for materials, building your district up so it produces more, and taking ground off whoever is standing on it.',
      'Start with your own district. It is the only thing here that is already yours.',
    ],
  },
  {
    step: 'combine',
    title: 'The Combine',
    lede: 'The company that owns the city, and the reason the map is mostly grey.',
    body: [
      'The Combine is not a gang. It is the administration: it runs the power, the water and the checkpoints, and it holds most of the districts on the map as property rather than as territory.',
      'It does not negotiate and it does not need to. Ground you take from it is ground it will come back for.',
      'At the top is Directive Xero, in the Combine Spire. Everything above you in this city answers to him, and the last district in the game is the one he stands in. You are not going to meet him for a long time.',
    ],
    portraitUnitId: 'directive_xero',
  },
  {
    step: 'city',
    title: 'The city',
    lede: 'Twelve districts. Four are lived in, eight are worth fighting over.',
    body: [
      'Each contested district holds locations: a pawn shop, a water works, a rail yard. Holding one pays you every hour for as long as you keep it, and holding every location in a district pays a bonus on top.',
      'Press a district to look inside it. What you cannot see yet is what you have not scouted.',
    ],
  },
  {
    step: 'missions',
    title: 'Missions',
    lede: 'The safest money in the game, and the slowest.',
    body: [
      'A mission sends people out for a set number of minutes and brings back materials. Nobody contests it and nothing is at stake except the time.',
      'Send an officer with them where you can. Who leads a run changes what comes back from it.',
    ],
  },
  {
    step: 'battles',
    title: 'Fights',
    lede: 'Ground changes hands here, and only here.',
    body: [
      'You call a fight on a target and pick a mark for it. Both sides know it is coming, which is the point: a raid nobody can answer is not a fight, it is a tax.',
      'Take a location and you take it as it stands, at the level its last holder worked it up to. Everything they poured in is yours.',
      'Losing costs you the units you sent. Send enough.',
    ],
  },
  {
    step: 'base',
    title: 'Your district',
    lede: 'Eleven structures, and every one of them is a decision about what you are short of.',
    body: [
      'Structures produce materials, house people and open the rest of the game. The Nexus is the one everything else answers to: most things cannot go above it.',
      'Orders queue and are worked one at a time. Materials come out of the stockpile when you place an order, not when it finishes.',
    ],
  },
];

/** The card for a step, or `undefined` for an id no catalogue entry claims. */
export function tutorialCard(step: TutorialStep): TutorialCardSpec | undefined {
  return TUTORIAL_CARDS.find((card) => card.step === step);
}

/**
 * The next card to show on `screen`, given what has already been seen.
 *
 * Catalogue order, so the three that share the city map come out welcome, Combine, city however
 * they are stored. `null` when there is nothing left, which is the state every player ends in.
 */
export function nextTutorialCard(
  screen: string,
  seen: readonly string[],
): TutorialCardSpec | undefined {
  return TUTORIAL_CARDS.find(
    (card) => TUTORIAL_SCREENS[card.step] === screen && !seen.includes(card.step),
  );
}

/** Whether anything is left to show at all: the one check a screen makes before it looks further. */
export function tutorialFinished(seen: readonly string[]): boolean {
  return TUTORIAL_STEPS.every((step) => seen.includes(step));
}
