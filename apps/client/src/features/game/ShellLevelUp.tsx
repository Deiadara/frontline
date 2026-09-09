import type { LevelUp } from '@frontline/shared';
import { useEffect, useRef, useState } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';

/**
 * The level-up the shell's own poll found.
 *
 * `/me` settles the base on every poll, so a build that finished while the player was on the Market
 * is banked there. It is also where a level the *world clock* banked is drained, so this can arrive
 * on a poll with nothing the player did behind it: nobody clicked, and the only thing that says the
 * level happened is this one response. Latched here, over whatever screen is open, until the player
 * says they saw it. The pages that settle through their own writes (the district, the missions, the
 * Bar) draw their own banner for those; this is for the level-ups nobody was looking at.
 */
export function ShellLevelUp({ levelUp: polled }: { levelUp: LevelUp | undefined }) {
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  /*
   * The highest level already announced, so a level is announced once and only once.
   *
   * The effect used to key on the object alone, on the stated grounds that `level` strictly
   * increases and two announcements can therefore never be the same object. That is true of the
   * *server's* sequence and not of what reaches this component: `levelUp` is absent between two
   * deliveries, so React Query's structural sharing cannot hold the identity, and anything that
   * delivers the same award twice (a retried poll, a second tab draining after this one had
   * already drawn it) hands over a fresh object with the same level in it and pops a banner the
   * player has already dismissed. Comparing the level itself is the invariant the old comment was
   * asserting; this is it enforced.
   */
  const announced = useRef(0);
  useEffect(() => {
    if (!polled || polled.level <= announced.current) return;
    announced.current = polled.level;
    setLevelUp(polled);
  }, [polled]);

  if (levelUp === null) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-50 flex justify-center px-4"
      style={{ top: 'calc(var(--hud-h, 0px) + 12px)' }}
      data-testid="shell-level-up"
    >
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col gap-2">
        <LevelUpBanner levelUp={levelUp} />
        <button
          type="button"
          onClick={() => setLevelUp(null)}
          className="self-end font-display text-[11px] uppercase tracking-[0.18em] text-ink-300 hover:text-ink-200"
        >
          Noted
        </button>
      </div>
    </div>
  );
}
