import {
  reputationOf,
  storageCapacity,
  type Building,
  type EconomyState,
  type Overseer,
  type Resources,
} from '@frontline/shared';
import { Link } from 'react-router-dom';
import { MeterChip, ReputationChip } from '../../components/Meters';
import { RESOURCE_ORDER, ResourceChip } from '../../components/Resources';
import { OverseerPortrait } from '../overseer/OverseerPortrait';

interface TopHudProps {
  overseer: Overseer;
  /** §A1 — the faction's name. The one label every other player sees, so it leads the bar. */
  faction: string;
  resources: Resources;
  economy: EconomyState;
  /** What is standing — the Apothecary in it is what sets the stockpile ceiling. */
  buildings: readonly Building[];
}

/**
 * The standing bar: who you are on the left, what you have in the middle, who is playing on the
 * right.
 *
 * Grepolis' arrangement, and it is the right one because it maps to three different questions a
 * player asks at three different moments. Cramming them into one undifferentiated row of chips —
 * which is what this was — means every glance has to re-find the thing it wanted. They are now
 * three groups with real space between them, and the stockpile is centred because it is the one a
 * player checks constantly.
 *
 * It is about 175% of its old height. That is not decoration: the resource figures are the most
 * frequently read numbers in the game and they were 14px on a translucent strip over a painting.
 * Height here buys legible numerals, icons big enough to identify without reading the number beside
 * them, and hit targets that clear the 44px guideline for the parts that are clickable.
 */
export function TopHud({ overseer, faction, resources, economy, buildings }: TopHudProps) {
  const reputation = reputationOf(economy, new Date());
  // One ceiling for every resource — the Apothecary holds this much *of each*, not in total.
  const capacity = storageCapacity(buildings);

  return (
    /*
     * One row where there is room for one, two tiers where there is not.
     *
     * Four groups on a single wrapping flex line: who you are, what you have, how you stand, and
     * whose face this is. All four fit on one line from about 1650px of frame — which is most
     * desks — and that is the arrangement the board asked for, because a wide browser has the space
     * and a second tier is height taken off the world for nothing.
     *
     * Below that they have to break, and *where* they break is the whole problem. Left to plain
     * `flex-wrap` the identity dropped alone to a second line and read as a rendering fault. So the
     * break is authored: a zero-height item with `basis-full` forces the wrap at a chosen point,
     * and `order` puts the identity above it. Narrow, that gives the Grepolis arrangement — a thin
     * identity strip over the numbers you actually watch. Wide, the breaker is `hidden` and the
     * order is the natural one. One DOM, no duplicated markup, and neither state is a wrap nobody
     * chose.
     */
    <header className="glass painted washed rivets edge-lit pointer-events-auto relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-brass-500/45 px-3 py-2 shadow-panel xl:px-4">
      {/* Who you are, and what the street calls you. First on both arrangements. */}
      <div className="order-1 flex min-w-0 items-center gap-2.5">
        {/* `truncate` on a `min-w-0` flex child rather than a fixed width: the name is bounded at
            40 characters by `FactionNameSchema`, and at 1024px a 40-character display-font name
            still has to give way to the reputation chip beside it rather than push it off. */}
        <p
          data-testid="faction-name"
          className="min-w-0 truncate font-display text-lg font-bold leading-tight tracking-[0.05em] text-ink-100 xl:text-xl"
          title={faction}
        >
          {faction}
        </p>
        <ReputationChip label={reputation} />
      </div>

      {/* The identity is a door, not a caption. It names the one person in the game the player
          *is*, and the sheet behind it is what every effect in the district is computed from — so
          clicking the face is the shortest route to the page that says what those numbers do.

          `order-2` narrow so it finishes the identity strip; `order-5` wide so it closes the row. */}
      <Link
        to="/game/overseer"
        data-testid="hud-overseer"
        // The name is in the label as well as in the markup, because below 1560px the markup is
        // hidden — and a door to "your own file" that does not say whose is a door with no name on
        // it, to a screen reader and to a pointer looking for a tooltip alike.
        title={`${overseer.name} — your own file`}
        aria-label={`${overseer.name}, Overseer — your own file`}
        className="group order-2 ml-auto flex shrink-0 items-center gap-2.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-brass-300/10 focus-visible:outline-none [@media(min-width:1280px)]:order-5 [@media(min-width:1280px)]:ml-0"
      >
        {/* The name and title are the first thing to go when the row is tight: the face is what
            makes this read as a door, and the sheet behind it opens with the name at the top of it.
            Hidden rather than truncated — a nameplate cut to "Var…" is worse than no nameplate. */}
        <span className="hidden text-right [@media(min-width:1560px)]:block">
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
      </Link>

      {/* The authored break. Zero height, full width, so the line ends here and nothing else has to
          guess where. Gone entirely once everything fits on one line. */}
      <span aria-hidden className="order-3 h-0 basis-full [@media(min-width:1280px)]:hidden" />

      {/* The stockpile — the row read most often. Never the group that wraps: a stockpile that
          reflows onto four lines takes a third of the screen away from the artwork. */}
      <div className="order-4 flex min-w-max items-center gap-1">
        {RESOURCE_ORDER.map((kind) => (
          <ResourceChip key={kind} kind={kind} value={resources[kind]} capacity={capacity} />
        ))}
      </div>

      {/* Standing. Grouped away from the stockpile: these move slowly and mean something else. */}
      <div className="order-4 ml-auto flex shrink-0 items-center gap-1.5">
        <MeterChip kind="morale" value={economy.morale} />
        <MeterChip kind="infamy" value={economy.infamy} />
      </div>
    </header>
  );
}
