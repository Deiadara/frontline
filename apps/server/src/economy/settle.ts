import { runEconomyCycle, type Base } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Settles every pay-week boundary the base has crossed since it was last read (GDD §H7 wages,
 * §D1 food upkeep).
 *
 * Payroll runs on the real-world clock, not on a server tick, so it is applied lazily on the
 * read paths instead of from a scheduler: a base that nobody looks at owes exactly the same
 * amount whenever it is next opened, and there is no background job to keep alive. Writes only
 * happen on a week that actually turned over.
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
