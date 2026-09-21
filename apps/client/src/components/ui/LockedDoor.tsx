import {
  areaDescription,
  areaName,
  areaRequirement,
  describeAreaRequirement,
  noUnlocks,
  type GatedArea,
  type UnlockFacts,
} from '@frontline/shared';
import { Icon } from './Icon';
import { InfoWindow, WindowSection } from './InfoWindow';

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
      <div className="w-full max-w-md">
        <InfoWindow
          eyebrow="Not yet"
          title={areaName(area)}
          tone="oxblood"
          icon={<Icon name="lock" className="h-full w-full text-surface-950" />}
          figure={
            <span className="font-stamp text-[18px] leading-none text-oxblood-100">
              {figureFor(requirement)}
            </span>
          }
        >
          <p className="font-body text-[14px] leading-relaxed text-ink-200">
            {areaDescription(area)}
          </p>
          <WindowSection label="What opens it">
            <p className="font-body text-[13px] leading-snug text-ink-100">
              {describeAreaRequirement(area)}
            </p>
          </WindowSection>
          <WindowSection label="Where you stand">
            <p
              className="font-body text-[13px] leading-snug text-ink-100"
              data-testid="locked-door-standing"
            >
              {standing(requirement, known)}
            </p>
          </WindowSection>
        </InfoWindow>
      </div>
    </div>
  );
}

/** The stamped line in the window's corner: the condition in three or four words. */
function figureFor(requirement: ReturnType<typeof areaRequirement>): string {
  switch (requirement.kind) {
    case 'level':
      return `Opens at level ${requirement.level}`;
    case 'building':
      return 'Opens once it is built';
    case 'officer':
      return 'Opens with the hire';
    case 'notoriety':
      return `Opens at rank ${requirement.rank}`;
    case 'research':
      return 'Opens with the programme';
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
