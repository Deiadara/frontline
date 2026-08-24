import {
  reputationOf,
  storageCapacity,
  type Base,
  type Building,
  type EconomyState,
  type Overseer,
  type Resources,
} from '@frontline/shared';
import { NavLink } from 'react-router-dom';
import { FactionPlaque } from '../../components/FactionPlaque';
import { InfamyChip, MeterChip, ReputationChip } from '../../components/Meters';
import { RESOURCE_ORDER, ResourceChip } from '../../components/Resources';
import { OverseerPortrait } from '../overseer/OverseerPortrait';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';

/**
 * A door in the standing bar.
 *
 * Sized and lit like the scenery switcher's doors so the two rows read as the same kind of control,
 * but square and label-less: the bar is a strip and there is no room under a 46px tile for a word.
 * The name lives in the tooltip and in the accessible label, and the glyph is the identity, which
 * is exactly how Grepolis' own top-bar buttons work.
 */
function HudDoor({
  to,
  icon,
  label,
  title,
}: {
  to: string;
  icon: IconName;
  label: string;
  title: string;
}) {
  return (
    <NavLink
      to={to}
      title={title}
      aria-label={`${label}: ${title}`}
      data-testid={`hud-${label.toLowerCase()}`}
      className="group flex shrink-0 items-center focus-visible:outline-none"
    >
      {({ isActive }) => (
        <span
          className={cn(
            'edge-lit flex h-11 w-11 items-center justify-center rounded-sm border transition-all duration-150 ease-out',
            isActive
              ? 'border-brass-300/80 bg-gradient-to-b from-brass-300/30 to-brass-500/15 text-brass-100 shadow-brass'
              : 'border-surface-600 bg-gradient-to-b from-surface-700 to-surface-800 text-ink-200 ' +
                  'group-hover:-translate-y-0.5 group-hover:border-iris-300/70 group-hover:text-iris-100 ' +
                  'group-hover:shadow-lifted group-active:translate-y-0',
          )}
        >
          <Icon name={icon} className="h-6 w-6" />
        </span>
      )}
    </NavLink>
  );
}

interface TopHudProps {
  overseer: Overseer;
  /**
   * The crew, because the bar carries its name and the control that changes it.
   *
   * The whole base rather than a `faction` string: the plaque is a rename form, and a form needs
   * the id it is writing to. Passing the name alone put the rename control on the one screen that
   * had the base to hand, which is how it ended up buried in the district.
   */
  base: Base;
  resources: Resources;
  economy: EconomyState;
  /** What is standing: the Apothecary in it is what sets the stockpile ceiling. */
  buildings: readonly Building[];
}

/**
 * The standing bar: who you are on the left, what you have in the middle, who is playing on the
 * right.
 *
 * Grepolis' arrangement, and it is the right one because it maps to three different questions a
 * player asks at three different moments. Cramming them into one undifferentiated row of chips,
 * which is what this was: means every glance has to re-find the thing it wanted. They are now
 * three groups with real space between them, and the stockpile is centred because it is the one a
 * player checks constantly.
 *
 * It is about 175% of its old height. That is not decoration: the resource figures are the most
 * frequently read numbers in the game and they were 14px on a translucent strip over a painting.
 * Height here buys legible numerals, icons big enough to identify without reading the number beside
 * them, and hit targets that clear the 44px guideline for the parts that are clickable.
 */
export function TopHud({ overseer, base, resources, economy, buildings }: TopHudProps) {
  const reputation = reputationOf(economy, new Date());
  // One ceiling for every resource: the Apothecary holds this much *of each*, not in total.
  const capacity = storageCapacity(buildings);

  return (
    /*
     * One row where there is room for one, two tiers where there is not.
     *
     * Four groups on a single wrapping flex line: who you are, what you have, how you stand, and
     * whose face this is. All four fit on one line from about 1650px of frame, which is most
     * desks, and that is the arrangement the board asked for, because a wide browser has the space
     * and a second tier is height taken off the world for nothing.
     *
     * Below that they have to break, and *where* they break is the whole problem. Left to plain
     * `flex-wrap` the identity dropped alone to a second line and read as a rendering fault. So the
     * break is authored: a zero-height item with `basis-full` forces the wrap at a chosen point,
     * and `order` puts the identity above it. Narrow, that gives the Grepolis arrangement: a thin
     * identity strip over the numbers you actually watch. Wide, the breaker is `hidden` and the
     * order is the natural one. One DOM, no duplicated markup, and neither state is a wrap nobody
     * chose.
     */
    <header className="glass painted washed rivets edge-lit pointer-events-auto relative flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b-2 border-brass-500/45 px-3 py-2 shadow-panel xl:px-4">
      {/* Who you are, and what the street calls you. First on both arrangements.

          The plaque is a *control*: it is where the faction is renamed, and it lives here rather
          than on the district page because the name belongs to the player rather than to one
          screen. The district used to carry it on a title bar of its own, which cost the painting
          forty pixels on every viewport and put the one rename control in the game behind a
          navigation step. */}
      <div className="order-1 flex min-w-0 items-center gap-2">
        <FactionPlaque base={base} />
        <ReputationChip label={reputation} />
      </div>

      {/* The identity is a door, not a caption. It names the one person in the game the player
          *is*, and the sheet behind it is what every effect in the district is computed from, so
          clicking the face is the shortest route to the page that says what those numbers do.

          `order-2` narrow so it finishes the identity strip; `order-5` wide so it closes the row. */}
      <NavLink
        to="/game/overseer"
        data-testid="hud-overseer"
        // The name is in the label as well as in the markup, because below 1560px the markup is
        // hidden, and a door to "your own file" that does not say whose is a door with no name on
        // it, to a screen reader and to a pointer looking for a tooltip alike.
        title={`${overseer.name}: your own file`}
        aria-label={`${overseer.name}, Overseer: your own file`}
        className="group order-2 ml-auto flex shrink-0 items-center gap-2.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-brass-300/10 focus-visible:outline-none [@media(min-width:1280px)]:order-5 [@media(min-width:1280px)]:ml-0"
      >
        {/* The name and title are the first thing to go when the row is tight: the face is what
            makes this read as a door, and the sheet behind it opens with the name at the top of it.
            Hidden rather than truncated: a nameplate cut to "Var…" is worse than no nameplate. */}
        <span className="hidden text-right [@media(min-width:1700px)]:block">
          <span className="block font-display text-sm font-semibold leading-tight tracking-[0.04em] text-ink-100">
            {overseer.name}
          </span>
          {/* "Overseer" is what this person *is*; the archetype is what they are good at, and it
              was being shown as though it were their title. */}
          <span className="block font-display text-[11px] uppercase leading-tight tracking-[0.18em] text-brass-300">
            Overseer
          </span>
        </span>
        <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-surface-600 shadow-lifted transition-colors group-hover:border-brass-300/70">
          <OverseerPortrait
            portraitId={overseer.portraitId}
            archetype={overseer.archetype}
            aspect="square"
            showTag={false}
          />
        </span>
      </NavLink>

      {/* The authored break. Zero height, full width, so the line ends here and nothing else has to
          guess where. Gone entirely once everything fits on one line. */}
      <span aria-hidden className="order-3 h-0 basis-full [@media(min-width:1280px)]:hidden" />

      {/* The stockpile: the row read most often. Never the group that wraps: a stockpile that
          reflows onto four lines takes a third of the screen away from the artwork.

          The two doors sit *inside* this group, after the resources, which is Grepolis' own
          arrangement and the board's instruction. They are where a player's eye already is, and
          they are the two screens most often wanted from anywhere: the fight you have called, and
          the knobs. Neither is a "place" in the scenery sense, which is why they came off the
          bottom row rather than being duplicated on it. */}
      <div className="order-4 flex min-w-max items-center gap-1">
        {RESOURCE_ORDER.map((kind) => (
          <ResourceChip key={kind} kind={kind} value={resources[kind]} capacity={capacity} />
        ))}
      </div>

      {/* The two doors, in the gap between what you have and how you stand.

          Their own group with a margin either side rather than tacked onto the end of the
          stockpile: they are neither a resource nor a standing, and sitting flush against the
          scrap counter made them read as a sixth and seventh material. Grepolis puts the same
          two in the same place, and for the same reason: a player looking for the fight they
          called or for the knobs looks at the top bar, not at the row of places. */}
      <div className="order-4 mx-auto flex shrink-0 items-center gap-1.5">
        <HudDoor
          to="/game/battles"
          icon="battles"
          label="Battles"
          title="Declared fights, and what came back"
        />
        <HudDoor
          to="/game/settings"
          icon="gear"
          label="Settings"
          title="Your name, mark, clock and passphrase"
        />
      </div>

      {/* Standing. Grouped away from the stockpile: these move slowly and mean something else. */}
      <div className="order-4 flex shrink-0 items-center gap-1.5">
        <MeterChip kind="morale" value={economy.morale} />
        <InfamyChip infamy={economy.infamy} notoriety={economy.notoriety} />
      </div>
    </header>
  );
}
