import type { LevelUp } from '@frontline/shared';
import { useEffect, useState } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';

/**
 * The level-up the shell's own poll found.
 *
 * `/me` settles the base on every poll, so a build that finished while the player was on the Market
 * is banked there, and that response is the only one that ever knows it crossed a level: the next
 * poll carries nothing. Latched here, over whatever screen is open, until the player says they saw
 * it. The pages that settle through their own writes (the district, the missions, the Bar) draw
 * their own banner for those; this is for the level-ups nobody was looking at.
 */
export function ShellLevelUp({ levelUp: polled }: { levelUp: LevelUp | undefined }) {
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  // Keyed on the value: `level` strictly increases, so two announcements are never the same
  // object and this fires once per level crossed.
  useEffect(() => {
    if (polled) setLevelUp(polled);
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
