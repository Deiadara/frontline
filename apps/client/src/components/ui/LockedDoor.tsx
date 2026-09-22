import {
  BUILDING_CATALOG,
  OFFICER_ROLE_LABELS,
  areaName,
  areaRequirement,
  findResearchItem,
  noUnlocks,
  type GatedArea,
  type UnlockFacts,
  notorietyTier,
} from '@frontline/shared';
import { DrawnGlyph } from './DrawnMarks';
import type { IconName } from './Icon';

/**
 * The sign on a door that has not opened yet (§I3).
 *
 * The board's rule, and it is the right one: **a locked door says what unlocks it rather than
 * vanishing.** A screen that is simply absent teaches a player that the game is smaller than it is,
 * and then reappears one day with no explanation. A screen that is visible and shut teaches them
 * what they are working *towards*, which is the only reason to have gates at this depth at all.
 *
 * So this is a whole screen rather than a toast: the name of the place, what is behind it, the one
 * thing that opens it, and where the player currently stands against that thing, in the same
 * painted window the game explains everything else in.
 *
 * ## Why `where you stand` is per requirement
 *
 * It printed "you are level N" for every door, because every door was a level. Four of the nine
 * are not any more, and "you are level 7" on a screen that opens when you build the Scrapyard is
 * worse than saying nothing: it points at a number the player can raise all week without the door
 * ever moving. Each kind now reports its own position, and the ones that are yes-or-no say so
 * instead of inventing a distance.
 */
export function LockedDoor({ area, facts }: { area: GatedArea; facts?: UnlockFacts }) {
  const known = facts ?? noUnlocks();
  const requirement = areaRequirement(area);

  return (
    // The chrome floats over the top and bottom of this box, so the sign is inset by the measured
    // height of both: the same two custom properties `PageShell` reads. Without them the window is
    // centred on the *viewport* and its heading disappears behind the HUD, which is precisely the
    // failure a locked door must not have: the one thing it exists to say is its own name.
    //
    // `items-start`, not `items-center`: a scroll container that centres its child clips the top of
    // anything taller than the box, and there is no scrolling back up to it.
    <div
      className="flex h-full w-full items-start justify-center overflow-y-auto px-4"
      style={{
        paddingTop: 'calc(var(--hud-h, 96px) + 24px)',
        paddingBottom: 'calc(var(--nav-h, 104px) + 24px)',
      }}
    >
      {/*
       * A sheet of paper with a padlock drawn on it (maintainer, 2026-09-22).
       *
       * It was the game's painted info window: an eyebrow, a lilac plate with a struck glyph, a
       * paragraph about the place, and two ruled sections. That is the right frame for a fact
       * and the wrong one for a shut door: a player who has walked into a locked screen wants to
       * know what opens it and how far off they are, in the time it takes to glance, and every
       * extra line was a line between them and that. This is the inked frame and dark paper the
       * training floor and the feats board are drawn on, with a large red lock through the pen,
       * the condition in three words beside its own drawn mark, and one line on where they stand.
       *
       * Nothing drawn sits over a letter: the lock has the left column to itself, the marks sit
       * in a fixed column beside the words, and the frame's ink runs round the outside of all of
       * it. The blurb about what the place is went; the nav tile already names it, and the line
       * that opens it says more about what it is for than a paragraph did.
       */}
      <section
        className="ink-frame card-paper washed grain relative w-full max-w-lg p-5 shadow-panel sm:p-6"
        data-testid="locked-door"
      >
        <div className="flex items-start gap-5">
          <span
            aria-hidden
            className="block h-16 w-16 shrink-0 text-oxblood-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] sm:h-20 sm:w-20"
          >
            <DrawnGlyph name="lock" className="h-full w-full" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <p className="font-display text-[11px] uppercase tracking-[0.2em] text-oxblood-300">
                Not yet
              </p>
              <h1 className="mt-1 font-stamp text-[26px] font-semibold leading-[1.1] text-ink-100">
                {areaName(area)}
              </h1>
            </div>
            <span aria-hidden className="ink-rule block" />
            {/* The condition, in the drawn mark of the thing it asks for: the level chevrons, the
                infamy spade, the build tool, the crew, the flask. The mark is what makes the three
                words read at a glance; `figureFor` is the same line the old window stamped in its
                corner, so nothing a screen or a test looked for has moved. */}
            <p className="flex items-center gap-3">
              <span aria-hidden className="block h-7 w-7 shrink-0 text-brass-300">
                <DrawnGlyph name={markFor(requirement)} className="h-full w-full" />
              </span>
              <span className="font-stamp text-[19px] leading-none text-brass-100">
                {figureFor(requirement)}
              </span>
            </p>
            <p
              className="font-body text-[14px] leading-relaxed text-ink-200"
              data-testid="locked-door-standing"
            >
              {standing(requirement, known)}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The drawn mark of what a door asks for, from the icon set so it matches the rest of the game. */
function markFor(requirement: ReturnType<typeof areaRequirement>): IconName {
  switch (requirement.kind) {
    case 'level':
      return 'level';
    case 'building':
      return 'build';
    case 'officer':
      return 'crew';
    case 'notoriety':
      return 'infamy';
    case 'research':
      return 'research';
  }
}

/**
 * The condition, in one line that names the thing (2026-09-22).
 *
 * The sign lost its paragraph and its "What opens it" section for brevity, so this line has to
 * carry what those did: not "opens with the hire" but *which* chair, not "once it is built" but
 * *which* structure. The level and rank doors were already specific.
 */
function figureFor(requirement: ReturnType<typeof areaRequirement>): string {
  switch (requirement.kind) {
    case 'level':
      return `Opens at level ${requirement.level}`;
    case 'building':
      return `Opens once ${BUILDING_CATALOG[requirement.building].name} is built`;
    case 'officer':
      return `Opens with a ${OFFICER_ROLE_LABELS[requirement.role]} seated`;
    case 'notoriety':
      // The rank's name, not its index (maintainer, 2026-09-22): "rank 3" is a number off a
      // ladder nobody has the shape of, and the chip on the standing bar says the name.
      return `Opens at ${notorietyTier(requirement.rank)}`;
    case 'research':
      return `Opens with ${findResearchItem(requirement.technology)?.name ?? 'the programme'}`;
  }
}

/**
 * Where the player currently is against this door's condition.
 *
 * The two ladder conditions can name a distance, so they do: "four more and this is yours" is the
 * sentence that makes a gate feel like a target rather than a wall. The three yes-or-no ones
 * cannot, and saying so plainly beats manufacturing a number.
 *
 * Every branch also handles the already-satisfied case, because this screen does get rendered with
 * the condition met: a stale `/me` between a finished build and the next poll puts a player in
 * front of a door that has just opened, and "reload" is a better answer than a sign insisting they
 * have not done the thing they have just done.
 */
function standing(requirement: ReturnType<typeof areaRequirement>, facts: UnlockFacts): string {
  switch (requirement.kind) {
    case 'level': {
      if (facts.level >= requirement.level) return 'The door should be open. Reload the page.';
      const togo = requirement.level - facts.level;
      return `You are level ${facts.level}. ${togo} more and this is yours. Levels come off missions, fights, finished builds, finished research and anybody you sign at the Bar.`;
    }
    case 'building':
      return facts.buildings.includes(requirement.building)
        ? 'It is standing. Reload the page.'
        : 'You have not put one up yet. It goes on an empty plot in your district.';
    case 'officer':
      return facts.officers.includes(requirement.role)
        ? 'They are in the chair. Reload the page.'
        : 'Nobody is in that chair. Officers are signed at the Bar and seated from the Crew screen.';
    case 'notoriety':
      return facts.notoriety >= requirement.rank
        ? 'You have the rank. Reload the page.'
        : `You are at rank ${facts.notoriety}. Rank is bought with infamy, and once bought it is never lost.`;
    case 'research':
      return facts.technologies.includes(requirement.technology)
        ? 'It is finished. Reload the page.'
        : 'The Lab has not finished it. It is the first thing on the track, so nothing is needed before it.';
  }
}
