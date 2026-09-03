import {
  playerXpToNextLevel,
  storageCapacity,
  storageCapacityFor,
  type Base,
  type Building,
  type EconomyState,
  type Overseer,
  type ResourceKey,
  type Resources,
} from '@frontline/shared';
import { NavLink } from 'react-router-dom';
import { DistrictPlaque } from '../../components/DistrictPlaque';
import { CrewLevelChip, InfamyChip } from '../../components/Meters';
import { RESOURCE_ORDER, ResourceChip } from '../../components/Resources';
import { OverseerPortrait } from '../overseer/OverseerPortrait';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import type { LiveStatus } from '../../lib/live';
import { badgeCount, type UnreadCounts } from '@frontline/shared';

/**
 * A door in the standing bar.
 *
 * Sized and lit like the scenery switcher's doors so the two rows read as the same kind of control,
 * but label-less: the bar is a strip and there is no room under a 44px tile for a word.
 * The name lives in the tooltip and in the accessible label, and the glyph is the identity, which
 * is exactly how Grepolis' own top-bar buttons work.
 */
function HudDoor({
  to,
  icon,
  label,
  title,
  badge = 0,
}: {
  to: string;
  icon: IconName;
  label: string;
  title: string;
  /** Unread count. Zero draws nothing at all: an empty badge is a dot that means "no news". */
  badge?: number;
}) {
  return (
    /*
     * The name, drawn, and nothing else.
     *
     * These three used to carry a sentence in a `title` attribute: the operating system's tooltip,
     * in its own font, on its own grey, a second late. What a player wants off a row of icons is
     * which door it is, so the hover says "Battles" and the sentence stays where it is genuinely
     * useful, on `aria-label`, for anyone who cannot see the icon at all.
     */
    <NavLink
      to={to}
      data-tip={label}
      aria-label={`${label}: ${title}`}
      data-testid={`hud-${label.toLowerCase()}`}
      className="group flex shrink-0 items-center focus-visible:outline-none"
    >
      {({ isActive }) => (
        <span
          className={cn(
            // The same struck plate the scenery switcher's doors wear (`door-tile`): bevel,
            // interior glow, sheen and drop shadow. The two rows are the same kind of object and
            // now say so, which is what the board asked for.
            // 40px, matching the overseer's portrait at the other end of the group. The five doors
            // were 44 and made the right-hand cluster 23px wider than the stockpile, which put the
            // plaque visibly off-centre between them: it is centred in the *viewport* by the grid,
            // so any difference in the two groups' widths shows up as uneven air around the sign.
            'door-tile relative flex h-10 w-10 items-center justify-center rounded-lg border transition-all duration-150 ease-out',
            isActive
              ? 'door-tile-active z-10 -translate-y-0.5 scale-105 border-brass-300 text-brass-100'
              : 'border-surface-500/70 text-ink-200 ' +
                  'group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:border-iris-300/80 ' +
                  'group-hover:text-iris-100 group-hover:shadow-lifted group-active:translate-y-0 ' +
                  'group-active:scale-100',
          )}
        >
          <Icon
            name={icon}
            className="relative z-[2] h-6 w-6 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
          />
          {/*
           * The count, on the corner of the plate.
           *
           * Capped at `99+` (`badgeCount`), because three digits do not fit in a dot and a player
           * with 340 unread is not deciding on the exact figure. Oxblood rather than brass: this
           * is the one mark on the bar that is asking for something rather than reporting it.
           */}
          {badge > 0 && (
            <span
              data-testid={`hud-${label.toLowerCase()}-badge`}
              aria-hidden
              className={cn(
                'absolute -right-1 -top-1 z-[3] flex h-[18px] min-w-[18px] items-center justify-center',
                'rounded-full border border-oxblood-300/60 bg-oxblood-500 px-1',
                'font-display text-[10px] font-bold leading-none tabular-nums text-ink-100',
                'shadow-[0_1px_3px_rgba(0,0,0,0.6)]',
              )}
            >
              {badgeCount(badge)}
            </span>
          )}
        </span>
      )}
    </NavLink>
  );
}

interface TopHudProps {
  overseer: Overseer;
  /**
   * The two badges: how many messages and notifications are waiting.
   *
   * Comes off `/me`, which the shell already polls, rather than from two queries of its own. See
   * `UnreadCountsSchema`. Optional so a response from a server without the mailbox still renders.
   */
  unread?: UnreadCounts;
  /**
   * The crew, because the bar carries its name and the control that changes it.
   *
   * The whole base rather than a `allegiance` string: the plaque is a rename form, and a form needs
   * the id it is writing to. Passing the name alone put the rename control on the one screen that
   * had the base to hand, which is how it ended up buried in the district.
   */
  base: Base;
  resources: Resources;
  economy: EconomyState;
  /** What is standing: the Apothecary in it is what sets the stockpile ceiling. */
  buildings: readonly Building[];
  /** The live channel's state (`lib/live.ts`). Drawn only when it is not up. */
  live?: LiveStatus;
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
export function TopHud({
  overseer,
  base,
  resources,
  economy,
  buildings,
  unread,
  live,
}: TopHudProps) {
  /*
   * Three shelves, not one, and caps are on none of them.
   *
   * `storageCapacityFor` answers `Infinity` for the one resource with no ceiling. The chip takes
   * `'uncapped'` for that rather than the infinity: it still opens onto its window, because the
   * chip prints `125K` and the exact figure has to live somewhere, but there is no bar and no
   * "x of y" in it. An absent capacity means something else again: see `ResourceChipProps`.
   */
  const bulk = storageCapacity(buildings);
  const ceiling = (kind: ResourceKey): number | 'uncapped' => {
    const room = storageCapacityFor(buildings, kind, bulk);
    return Number.isFinite(room) ? room : 'uncapped';
  };

  return (
    /*
     * Three groups, and the middle one is dead centre.
     *
     * A grid rather than a flex row, and `1fr auto 1fr` rather than `justify-between`: the sign in
     * the middle has to sit on the frame's centre line whatever the two side groups measure, and a
     * flex row centres the *gap between them* instead, which drifts as soon as one side is wider.
     * The two outer columns are equal by construction, so the plaque is centred at every width
     * even before the groups happen to balance.
     *
     * The groups are: **what you have** on the left, **where you are** in the middle, **what you
     * have earned** on the right. The two doors sit at the head of the right group rather than
     * floating in the middle of the row, which is where the board put them: immediately left of
     * the level, so the three things a player checks between actions are one block.
     *
     * The symmetry has a floor, and the floor is **measured, not chosen**. A centred grid needs
     * `max(left, right) * 2 + plaque` to fit, because the two outer columns are equal by
     * construction. With the worst content the game can produce, a 28-character district name and
     * the longest rank, that is 776 * 2 + 312 plus gaps and padding: about 1920px. The floor was
     * 1500, so from 1500 to 1920 the grid promised each side more room than the frame had, the
     * stockpile ran over the identity plaque, and the plaque ran over the doors beside it. That is
     * the board's screenshot. Below the floor the grid gives way to a plain flex row: the three
     * groups still read left, middle, right, the sign is simply not on the centre line.
     *
     * Which means this number is downstream of the chip sizes. Shrink a chip and it can come down;
     * add anything to the bar and it has to go up. `visual.spec.ts` sweeps the whole range against
     * the worst content rather than trusting the arithmetic above.
     *
     * Below `1600px` the three groups cannot share a line at all, and an authored break drops the
     * sign and the standing onto their own tier. Zero-height, full-width, so the wrap happens at a
     * chosen point rather than wherever flexbox decides: left to itself the row broke in a
     * different place at every width, and at some of them the identity dropped alone and read as a
     * rendering fault.
     *
     * 1600 is measured, not chosen, and it is measured against the worst content the game can
     * produce: a 28-character district name, the largest figure in every stockpile, and the longest
     * rank. Lift the break and sweep, and the row is sound from 1600 up, cuts the name at 1550 and
     * overlaps the plaque at 1500. It used to be 1280, which was the width the groups needed
     * *before* the sixth stockpile and the rank plate existed; then 1720, before the chips were
     * measured for `compactFigure` instead of for a spelled-out seven-digit number. It comes down
     * whenever a chip does, and the way to find the new number is the sweep, not arithmetic.
     */
    <header className="glass painted washed rivets edge-lit pointer-events-auto relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b-2 border-brass-500/45 px-3 py-2 shadow-panel xl:px-4">
      {/* The stockpile: the row read most often, and now the left third of the bar on its own.
          Never the group that wraps: a stockpile that reflows onto four lines takes a third of
          the screen away from the artwork. */}
      <div className="order-1 flex min-w-max items-center gap-1">
        {RESOURCE_ORDER.map((kind) => (
          <ResourceChip key={kind} kind={kind} value={resources[kind]} capacity={ceiling(kind)} />
        ))}
      </div>

      {/* The authored break. Zero height, full width, so the line ends here and nothing else has
          to guess where. Gone entirely once all three groups fit on one line. */}
      <span aria-hidden className="order-2 h-0 basis-full [@media(min-width:1550px)]:hidden" />

      {/* Where you are. The one control in the bar that changes anything about the crew itself:
          see `DistrictPlaque`. */}
      <div className="order-3 flex min-w-0 flex-1 justify-center">
        <DistrictPlaque base={base} />
      </div>

      {/* What you have earned, and the two doors that open from anywhere.
          
          Battles and Actions are neither a resource nor a standing, which is why they are their
          own pair with a rule between them and the level: one is the fight you have called and the
          other is who is on the road, and both are wanted from wherever a player is standing
          rather than walked to. Settings used to be a third; it is pinned to the right of the
          scenery switcher now, closer to the hand. */}
      <div className="order-4 ml-auto flex shrink-0 items-center gap-1.5">
        <LiveMarker status={live} />
        <div className="flex shrink-0 items-center gap-1 border-r border-surface-600/70 pr-2.5">
          {/* The mailbox and the bell, left of the fighting. The board's placement, and it is the
              right one: these two are the game talking to *you*, and the two beside them are you
              talking to the city. */}
          <HudDoor
            to="/game/messages"
            icon="messages"
            label="Messages"
            title="Who has written to you"
            badge={unread?.messages ?? 0}
          />
          <HudDoor
            to="/game/notifications"
            icon="bell"
            label="Notifications"
            title="What happened while you were not looking"
            badge={unread?.notifications ?? 0}
          />
          <HudDoor
            to="/game/battles"
            icon="battles"
            label="Battles"
            title="Declared fights, and what came back"
          />
          <HudDoor
            to="/game/actions"
            icon="actions"
            label="Actions"
            title="Who is on the road, and how long they have left"
          />
          {/* The standings, next to Actions (board's placement). The last door in the group, and
              the only one that is about somebody other than you. */}
          <HudDoor
            to="/game/leaderboard"
            icon="standings"
            label="Standings"
            title="Who is ahead, of the players and of the factions"
          />
        </div>

        <CrewLevelChip
          level={base.level}
          xpIntoLevel={base.progression.xpIntoLevel}
          xpToNextLevel={playerXpToNextLevel(base.level)}
        />
        <InfamyChip infamy={economy.infamy} notoriety={economy.notoriety} />

        {/* The identity is a door, not a caption. It names the one person in the game the player
            *is*, and the sheet behind it is what every effect in the district is computed from, so
            clicking the face is the shortest route to the page that says what those numbers do. */}
        <NavLink
          to="/game/overseer"
          data-testid="hud-overseer"
          // The name is in the label as well as in the markup, because at most widths the markup
          // is hidden, and a door to "your own file" that does not say whose is a door with no
          // name on it, to a screen reader and to a pointer looking for a tooltip alike.
          data-tip={`${overseer.name}: your own file`}
          aria-label={`${overseer.name}, Overseer: your own file`}
          className="group flex shrink-0 items-center gap-2.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-brass-300/10 focus-visible:outline-none"
        >
          {/* The name and title are the first thing to go when the row is tight: the face is what
              makes this read as a door, and the sheet behind it opens with the name at the top of
              it. Hidden rather than truncated: a nameplate cut to "Var…" is worse than none.

              2100px, and the number is arithmetic rather than taste. The bar is a symmetric grid,
              so the *wider* of the two side columns is charged to both of them: the nameplate's
              151px is therefore 302px of bar, and it is only affordable once the viewport can pay
              for it beside the widest plaque the game will accept (28 capital Ws measure 367px).
              At 1800 with two doors it fit. The mailbox and the bell made four, and it stopped
              fitting at 1920 for *every* name, which is what hung this control 6px off the right
              edge of the screen. */}
          <span className="hidden text-right [@media(min-width:2100px)]:block">
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
      </div>
    </header>
  );
}

/**
 * Says when the game has stopped listening, and nothing at all when it has not.
 *
 * Drawn only in the failed state on purpose. A green "connected" light is chrome a player learns to
 * stop seeing within a day, and its whole job is to be noticed on the one day it goes out. What is
 * worth saying is the opposite: this board may be behind, because a strategy game that has quietly
 * lost its connection looks exactly like a strategy game where nothing is happening. The screens
 * are still polling underneath (`SHELL_POLL_MS`), so this is "slower than it should be" rather than
 * "broken", and it says so.
 */
function LiveMarker({ status }: { status: LiveStatus | undefined }) {
  if (status !== 'offline') return null;
  return (
    <span
      data-testid="live-offline"
      data-tip="Not receiving updates as they happen. The board is still refreshing, just slower."
      className="flex shrink-0 items-center gap-1.5 rounded-sm border border-oxblood-500/50 bg-oxblood-500/10 px-2 py-1 font-display text-[10px] uppercase tracking-[0.14em] text-oxblood-300"
    >
      <Icon name="clock" aria-hidden className="h-3 w-3" />
      Reconnecting
    </span>
  );
}
