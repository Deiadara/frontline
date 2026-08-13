import type { LevelUp } from '@frontline/shared';

/**
 * The level-up moment (GDD §I2), shown by whichever screen's own request paid for it.
 *
 * Rendered from the response's `levelUp` rather than from `base.level`, because the level alone
 * cannot say that *this* raid or *this* returning crew is what crossed the threshold — the server
 * sends the field only when a level was actually gained, so its presence is the whole trigger.
 *
 * The three figures are the §I2 grants at the new level, which is what the level is worth: more
 * assignees in the pool (§G8), more of them under one officer (§G3), more recruit slots (§H8).
 */
export function LevelUpBanner({ levelUp }: { levelUp: LevelUp }) {
  const { level, levelsGained, grants } = levelUp;

  return (
    <section aria-label="Level up" className="scanlines border border-warning/50 bg-warning/5 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-[10px] uppercase tracking-[0.3em] text-warning/80">
          Level Up
        </p>
        {levelsGained > 1 && (
          <p className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
            <span className="tabular-nums text-warning">+{levelsGained}</span> levels
          </p>
        )}
      </div>
      <p className="mt-0.5 font-display text-2xl font-black tracking-[0.2em] text-warning">
        LEVEL {level}
      </p>
      {/* Capped: the banner spans the page on the missions screen, and an uncapped row would fling
          the figure a thousand pixels from the label it belongs to. */}
      <dl className="mt-2.5 flex max-w-sm flex-col divide-y divide-warning/15 border-t border-warning/15">
        <GrantRow label="Assignee pool" value={grants.assigneePool} />
        <GrantRow label="Assignees / officer" value={grants.assigneeCapPerOfficer} />
        <GrantRow label="Recruit slots" value={grants.recruitSlots} />
      </dl>
    </section>
  );
}

function GrantRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
        {label}
      </dt>
      <dd className="font-display text-sm font-semibold tabular-nums text-steel-100">{value}</dd>
    </div>
  );
}
