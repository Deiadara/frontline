import {
  GAME_TIMEZONE,
  SPY_COURIER_RESEARCH_ID,
  dayInZone,
  mulberry32,
  seedFrom,
  type Base,
  type SpyTarget,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { tallyCourierReport, tallySpyReport } from '../feats/tally.js';
import { settleEach } from '../world/guard.js';
import { composeSpyReport, fileReportNotice, groundBehind, readGround } from './spying.js';

/**
 * Turned Runners (maintainer, 2026-09-28): "Every day you get one full report of a player's
 * location at random."
 *
 * Once per Athens day, for every crew that has finished the rung, the courier brings in one
 * report on one place, picked at random from the ground held by crews outside the reader's
 * faction. It reads everything a spy could ever count there and cannot fail. The maintainer's note
 * draws the line: a player's home gate "counts as a location", their home district does not, and
 * looter and Combine ground never does.
 *
 * Filed on the first tick of the day on which the crew holds the rung, which for a crew that
 * already held it is the tick after midnight. The report's id is the crew and the day, so a
 * restart, a retried tick or two ticks racing each other file it once.
 */

/** The report a crew's courier brings in on one day. Its id is the once-a-day guard. */
export function courierReportId(baseId: string, day: string): string {
  return `courier:${baseId}:${day}`;
}

/**
 * Every place the courier could bring a report on, for this crew, in a fixed order.
 *
 * What a job could read (`groundBehind`) and nothing else, so the courier never reports on
 * ground a spy could not have looked at: a location inside a district held whole is behind its
 * gate. Held by a crew that is neither the reader nor in the reader's faction; for a home gate,
 * the crew living behind it.
 */
export function courierTargets(repos: Repositories, reader: Base): SpyTarget[] {
  const factions = repos.factions.factionOfEveryone();
  const ownerOf = new Map(repos.bases.listSummaries().map((crew) => [crew.id, crew]));
  const readerFaction = factions.get(reader.ownerId);
  const rival = (baseId: string): boolean => {
    const crew = ownerOf.get(baseId);
    if (!crew || crew.id === reader.id) return false;
    return readerFaction === undefined || factions.get(crew.ownerId) !== readerFaction;
  };

  const locations: SpyTarget[] = [...repos.city.controls().values()]
    .filter((control) => control.holder.kind === 'crew' && rival(control.holder.baseId))
    .map((control) => ({ kind: 'location', locationId: control.locationId }));
  const gates: SpyTarget[] = [...ownerOf.values()]
    .filter((crew) => rival(crew.id))
    .map((crew) => ({ kind: 'gate', districtId: crew.districtId }));

  const readable = [...locations, ...gates].filter(
    (target) => groundBehind(repos, reader, target).kind === 'ground',
  );
  const key = (target: SpyTarget) => JSON.stringify(target);
  return [...new Map(readable.map((target) => [key(target), target])).values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
}

/** One of the places, drawn off the crew and the day: the same answer however often it is asked. */
export function courierPick(
  baseId: string,
  day: string,
  targets: readonly SpyTarget[],
): SpyTarget | null {
  if (targets.length === 0) return null;
  const at = Math.floor(mulberry32(seedFrom(`courier:${baseId}:${day}`))() * targets.length);
  return targets[at] ?? null;
}

/**
 * File today's report for every crew holding the rung that has not had one. Returns how many.
 *
 * A crew with nowhere to report on (every rival in its faction, or no rival holding anything a
 * spy could read) gets nothing that day rather than a report on empty ground: the courier stops
 * here on his way somewhere, and there was nowhere to go.
 */
export function settleCouriers(repos: Repositories, now: Date): number {
  const day = dayInZone(now, GAME_TIMEZONE);
  const due = repos.spying
    .basesHolding(SPY_COURIER_RESEARCH_ID)
    .filter((baseId) => !repos.spying.hasReport(courierReportId(baseId, day)));
  let filed = 0;
  settleEach(
    repos,
    'couriers',
    due,
    (baseId) => baseId,
    (baseId) => {
      const reader = repos.bases.findById(baseId);
      if (!reader) return;
      const target = courierPick(baseId, day, courierTargets(repos, reader));
      if (!target) return;
      const report = composeSpyReport(
        repos,
        reader,
        { id: courierReportId(baseId, day), target, tier: null, capsPaid: 0, foundOut: false },
        readGround(reader, groundBehind(repos, reader, target), Number.POSITIVE_INFINITY),
        now,
      );
      repos.spying.insertReport(report);
      tallyCourierReport(repos, baseId);
      if (report.exposedSlots > 0) tallySpyReport(repos, baseId);
      fileReportNotice(repos, baseId, report, now);
      filed += 1;
    },
  );
  return filed;
}
