import type { LevelUp } from '@frontline/shared';
import { useEffect, useRef, useState } from 'react';
import { LevelUpToast } from './LevelUpToast';

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
    /*
     * Bottom right, above the bottom bar.
     *
     * Centred over the page, which is where it used to sit, it landed across whatever the player
     * was reading and had to be dismissed before the screen could be used. The first move was to
     * the top right, and a screenshot killed that one: every `PageShell` puts its primary action
     * in exactly that corner, so on the feats screen the card sat straight over `Collect all 4`.
     * Down here it clears both pieces of chrome, and it is where a transient notice belongs
     * anyway. `--nav-h` is measured by the bottom bar itself, so this rides on the real height
     * rather than a guess, and the fallback matches `PageShell`'s own.
     *
     * `LevelUpToast` owns the five second clock and the X; this only decides where it sits.
     */
    <div
      className="pointer-events-none absolute right-0 z-50 flex justify-end px-4"
      style={{ bottom: 'calc(var(--nav-h, 104px) + 12px)' }}
      data-testid="shell-level-up"
    >
      <div className="pointer-events-auto">
        <LevelUpToast levelUp={levelUp} onDismiss={() => setLevelUp(null)} />
      </div>
    </div>
  );
}
