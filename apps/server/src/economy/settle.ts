import { runEconomyCycle, type Base } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Settles every upkeep week the base has crossed since it was last read (GDD §D1).
 *
 * Food only. An officer's caps are a commitment against the payroll book (`economy/payroll.ts`)
 * rather than a weekly bill, so nothing here touches caps: the book is checked when somebody signs
 * and charged when somebody is let go, and never in between.
 *
 * Upkeep runs on the real-world clock, not on a server tick, so it is applied lazily on the read
 * paths instead of from a scheduler: a base that nobody looks at owes exactly the same amount
 * whenever it is next opened, and there is no background job to keep alive. Writes only happen on
 * a week that actually turned over.
 */
export function settleBaseEconomy(repos: Repositories, base: Base, now: Date): Base {
  const cycle = runEconomyCycle({
    resources: base.resources,
    payroll: base.economy.payroll,
    officerCount: base.commanders.length,
    now,
  });
  if (cycle.weeksSettled === 0) return base;

  const settled: Base = {
    ...base,
    resources: cycle.resources,
    economy: { ...base.economy, payroll: cycle.payroll },
  };
  repos.bases.updateResources(settled.id, settled.resources);
  repos.bases.updateEconomy(settled.id, settled.economy);
  return settled;
}
