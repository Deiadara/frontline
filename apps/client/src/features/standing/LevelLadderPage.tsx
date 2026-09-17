import {
  PLAYER_LEVEL_MIN,
  PLAYER_LEVEL_UNLOCKS,
  playerXpToNextLevel,
  type PlayerLevelUnlock,
} from '@frontline/shared';
import { useMe } from '../../lib/queries';
import { cn } from '../../lib/cn';
import { DrawnMeter } from '../../components/Meters';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoadSheet } from '../game/PageShell';
import { DoneMark, RungDisc } from './marks';
import { PaperBlock, StandingSheet } from './StandingSheet';

/**
 * Every district level, what it costs and what it opens (maintainer, 2026-09-17).
 *
 * The standing bar's level chip is a number and a bar, and until now that was the whole of what the
 * game ever said about levelling: a player could see that the meter moved and had no way at all to
 * find out what the next rung was worth or how much further the one after that was. So the chip is
 * a door and this is what is behind it.
 *
 * **Nothing here is a second copy of the curve.** The thresholds are `playerXpToNextLevel` and the
 * rewards are `PLAYER_LEVEL_UNLOCKS`, both read straight off `@frontline/shared`, so retuning the
 * curve or filing a new milestone moves this screen with it. A table typed out here would be the
 * exact failure the feats catalogue keeps recording: a written-down number that stops agreeing with
 * the game and says nothing when it does.
 */

/** Where the ladder stops: the last thing worth reaching, or wherever the player already is. */
export function ladderCeiling(level: number, unlocks: readonly PlayerLevelUnlock[]): number {
  const last = unlocks.reduce((top, unlock) => Math.max(top, unlock.level), PLAYER_LEVEL_MIN);
  // Four rungs past a player who has outrun the catalogue, so the screen is never a list that
  // ends above them. A ladder whose top rung is behind you is a ladder with no next step on it.
  return Math.max(last, Math.trunc(level) + 4);
}

function Rung({
  at,
  level,
  opens,
}: {
  /** The rung's own level. */
  at: number;
  /** Where the player is standing. */
  level: number;
  opens: readonly PlayerLevelUnlock[];
}) {
  const reached = at <= level;
  const here = at === level;
  /*
   * A drawn disc only where a rung means something.
   *
   * Every rung could carry one, and the first version did. Eighty hand-inked discs is eighty
   * `feTurbulence` filters on one screen, which is a real cost in a browser, and it is also the
   * wrong drawing: a mark on every step marks nothing. So the pen comes out for the rung the
   * player is standing on and the rungs that open something, and the rest are numbers.
   */
  const marked = here || opens.length > 0;

  return (
    <li
      className="flex items-start gap-3 py-1.5"
      data-testid={`level-rung-${at}`}
      // The rung the player is standing on, said in the markup rather than only in brass: a
      // colour is not a state anything can read but an eye.
      aria-current={here ? 'step' : undefined}
    >
      {marked ? (
        <RungDisc tone={here ? 'text-brass-300' : reached ? 'text-ink-500' : 'text-iris-300'}>
          {at}
        </RungDisc>
      ) : (
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center font-stamp text-[12px] leading-none',
            reached ? 'text-ink-500' : 'text-surface-500',
          )}
        >
          {at}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-display text-[12px] font-bold uppercase tracking-[0.12em]',
              here ? 'text-brass-100' : reached ? 'text-ink-300' : 'text-ink-200',
            )}
          >
            Level {at}
          </span>
          {reached && <DoneMark className="text-verdigris-300" />}
          {/* The leader, carrying the eye from the name across to the figure. A hairline rather
              than printed dots, which at this size read as dirt on the paper. */}
          <span aria-hidden className="ink-rule min-w-0 flex-1 translate-y-[-2px]" />
          <span className="shrink-0 font-stamp text-[14px] leading-none tabular-nums text-hextech-100">
            {playerXpToNextLevel(at).toLocaleString()}
          </span>
          <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.12em] text-ink-400">
            XP to leave
          </span>
        </span>
        {opens.map((unlock) => (
          <span key={unlock.id} className="flex flex-col">
            <span className="font-stamp text-[14px] leading-tight text-brass-100">
              {unlock.name}
            </span>
            <span className="font-body text-[12px] leading-snug text-ink-300">
              {unlock.description}
            </span>
          </span>
        ))}
      </span>
    </li>
  );
}

export function LevelLadderPage() {
  const me = useMe();
  const base = me.data?.base ?? null;

  if (base === null) {
    return (
      <ScreenLoadSheet
        what="The levels"
        loading="Counting the rungs…"
        isError={me.isError}
        onRetry={() => void me.refetch()}
      />
    );
  }

  const level = base.level;
  const into = base.progression.xpIntoLevel;
  const toNext = playerXpToNextLevel(level);
  const pct = toNext > 0 ? Math.max(0, Math.min(100, (into / toNext) * 100)) : 0;
  const top = ladderCeiling(level, PLAYER_LEVEL_UNLOCKS);
  const rungs = Array.from(
    { length: top - PLAYER_LEVEL_MIN + 1 },
    (_, at) => PLAYER_LEVEL_MIN + at,
  );

  return (
    <StandingSheet
      title="District levels"
      lede="What every level costs in XP, and what it opens when you get there."
    >
      {/* Where the player is standing, in the same arrangement the hover card uses: the level as
          the headline, the exact figures spelled out, and the meter under both. */}
      <PaperBlock
        className="flex flex-wrap items-center gap-x-6 gap-y-3"
        data-testid="level-standing"
      >
        <span className="flex items-center gap-3">
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center text-hextech-100 [&_svg]:h-9 [&_svg]:w-9">
            <Icon name="level" />
          </span>
          <span className="flex flex-col">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-400">
              Your district
            </span>
            <span className="font-stamp text-[22px] leading-none text-ink-100">Level {level}</span>
          </span>
        </span>
        <span className="flex min-w-[16rem] flex-1 flex-col gap-2">
          <span className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-hextech-100">
              {into.toLocaleString()}
            </span>
            <span className="font-display text-base tabular-nums text-ink-300">
              / {toNext.toLocaleString()} XP
            </span>
          </span>
          <DrawnMeter
            percent={pct}
            className="text-hextech-100"
            data-testid="level-standing-meter"
          />
        </span>
      </PaperBlock>

      <PaperBlock>
        <ol className="flex flex-col" data-testid="level-ladder">
          {rungs.map((at) => (
            <Rung
              key={at}
              at={at}
              level={level}
              opens={PLAYER_LEVEL_UNLOCKS.filter((unlock) => unlock.level === at)}
            />
          ))}
        </ol>
      </PaperBlock>
    </StandingSheet>
  );
}
