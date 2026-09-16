import { blueprintOfPage, findBlueprintPage, pagesGained, type Inventory } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notify } from './notify.js';

/**
 * The bell for a blueprint page arriving, from wherever it came from.
 *
 * §F puts pages behind six different doors: a mission's prize, the Runner's close, the fence's
 * shelf, the Lab's Reimagining trade, and each side of a settled offer. A player who was not
 * looking at the screen that door is on has no way of knowing a document moved a square closer,
 * and the page itself is a line in an inventory of eighteen other things.
 *
 * One helper for all six rather than a sentence written out at each: the copy is the same
 * sentence with the door swapped, and the thing that decides *which* pages arrived is a diff of
 * the inventory (`pagesGained`) rather than anything a caller has to remember to report.
 */

/** Which door the page came through. `offer` names the crew on the other side of the trade. */
export type PageSource =
  | { kind: 'mission' }
  | { kind: 'runner' }
  | { kind: 'blackmarket' }
  | { kind: 'lab' }
  | { kind: 'feat' }
  | { kind: 'offer'; from: string };

/** The end of the sentence: "Deck Timbers, a page of the Flatbed Blueprint, **off a mission**". */
function whereItCameFrom(source: PageSource): string {
  switch (source.kind) {
    case 'mission':
      return 'off a mission';
    case 'runner':
      return "off the Runner's barrow";
    case 'blackmarket':
      return 'from the back room';
    case 'lab':
      return 'out of the Lab';
    case 'feat':
      return 'for a feat';
    case 'offer':
      return `from ${source.from}'s offer`;
  }
}

export interface PagesFoundInput {
  userId: string;
  /** The inventory before the thing that happened, and after it. */
  before: Inventory;
  after: Inventory;
  source: PageSource;
  now: Date;
}

/**
 * Rings once per page id that went up, whatever it came in on.
 *
 * Two copies of the same page ring **once**, with a count on the title. A mission that turns up a
 * pair and a three-for-one Reimagining are both single decisions from the player's side, and two
 * identical rows in the list would read as the bell repeating itself rather than as two sheets.
 *
 * Returns how many bells were rung, which is what the tests assert on: whether a page arrived is
 * otherwise only observable by reading the notification table back.
 */
export function tellPagesFound(repos: Repositories, input: PagesFoundInput): number {
  const gained = pagesGained(input.before, input.after);
  let rung = 0;
  for (const [pageId, count] of Object.entries(gained)) {
    const page = findBlueprintPage(pageId);
    const blueprint = blueprintOfPage(pageId);
    // A page id that no document claims is a catalogue that has moved under a saved inventory. The
    // page still landed; there is just no sentence to write about it.
    if (!page || !blueprint || !count) continue;
    const many = count > 1 ? ` ×${count}` : '';
    const written = notify(repos, {
      userId: input.userId,
      kind: 'page_found',
      title: `${page.name}${many}, a page of the ${blueprint.name}, ${whereItCameFrom(input.source)}`,
      body: page.description,
      link: '/game/research/blueprints',
      subjectId: pageId,
      now: input.now,
    });
    if (written) rung += 1;
  }
  return rung;
}
