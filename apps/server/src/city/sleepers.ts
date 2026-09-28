import { randomUUID } from 'node:crypto';
import {
  cellCanHold,
  findLocation,
  findUnit,
  isHeldBy,
  type Army,
  type Base,
  type SleeperCell,
  type SleeperRefusal,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { mergeArmies, removeForce } from '../battle/forces.js';
import { travelMsTo } from '../battle/movement.js';
import { standingEffectsFor } from '../crew/standing.js';
import { visibleDistricts } from './view.js';
import { settleEach } from '../world/guard.js';
import { placeLocked } from '../battle/lock.js';

/**
 * Planting and pulling out Sleeper cells (§A4, maintainer 2026-09-18).
 *
 * See `sleepers.ts` in shared for what a cell is and why it is the only force in the game that
 * can be somewhere before its crew has announced they want it. This module is the two doors and
 * the clock: sending, recalling, and the pass that lands both walks.
 *
 * **They walk, in both directions.** That is the maintainer's ruling and it is the whole value of
 * the mechanic rather than a tax on it: a column sent to a declared fight pays its travel inside
 * the window everybody can see, and a cell pays the same travel days earlier, where nobody is
 * looking. Instant planting would make a Sleeper no faster than any other unit sent at the mark.
 */

export type SleeperResult =
  { kind: 'refused'; reason: SleeperRefusal } | { kind: 'ok'; base: Base; cell: SleeperCell };

export interface PlantInput {
  base: Base;
  locationId: string;
  /** Unit ids to counts. Every one of them has to be a sheet that goes to ground. */
  army: Army;
  now: Date;
}

/**
 * Send a cell to ground on a location this crew does not hold.
 *
 * The units leave the roster immediately, exactly as a deployment takes them: a crew that has
 * promised the same twenty Sleepers to two places would be discovering which one they turned up
 * at, and the answer would be a bug rather than a decision.
 */
export function plantSleepers(repos: Repositories, input: PlantInput): SleeperResult {
  const location = findLocation(input.locationId);
  if (!location) return { kind: 'refused', reason: 'unscouted' };

  const sending = Object.fromEntries(
    Object.entries(input.army).filter(([, count]) => count > 0),
  ) as Army;
  if (Object.keys(sending).length === 0) return { kind: 'refused', reason: 'nobody_sent' };

  // Only the sheets that do this, and the rule is the unit's own flag rather than an id typed
  // here, so a second infiltrating sheet needs no edit at this door.
  for (const unitId of Object.keys(sending)) {
    if (!cellCanHold(findUnit(unitId))) return { kind: 'refused', reason: 'not_sleepers' };
  }
  for (const [unitId, count] of Object.entries(sending)) {
    if ((input.base.army[unitId] ?? 0) < count) {
      return { kind: 'refused', reason: 'not_enough_units' };
    }
  }
  // They leave from home, and nothing leaves home in the last hour before a raid on it
  // (`battle/lock.ts`, maintainer 2026-09-28).
  if (placeLocked(repos, input.base, { kind: 'district' }, input.now)) {
    return { kind: 'refused', reason: 'garrison_locked' };
  }

  /*
   * The fog, read off the map rather than off the raw intel table.
   *
   * `visibleDistricts` is what the city screen draws and what `battle/declare.ts` gates a
   * declaration on: the scouted set, plus the ground this crew holds, plus whatever a Satellite
   * Uplink reaches. This door read `repos.city.scouted` instead, which is only the first of those
   * three, so a crew could call a fight on a district it had seen from the Uplink and could not
   * put a cell on it first. That is backwards: the whole value of a cell is being in place before
   * the declaration, so the preparatory door must not be tighter than the door it prepares for.
   */
  const visible = visibleDistricts(
    repos,
    input.base,
    repos.city.controls(),
    standingEffectsFor(repos, input.base, input.now),
  );
  if (!visible.has(location.districtId)) {
    return { kind: 'refused', reason: 'unscouted' };
  }
  const control = repos.city.control(location.id);
  if (control && isHeldBy(control, input.base.id)) {
    return { kind: 'refused', reason: 'already_yours' };
  }

  /*
   * The walk, priced the way a column to a fight is priced.
   *
   * `travelMsTo` reads the crew's speed channels and the force walking, so a cell of Sleepers
   * moves at a Sleeper's pace. No vehicles: a machine parked on somebody else's ground for a week
   * is not going unnoticed, which is the one thing a cell has to be.
   */
  const travel = travelMsTo(repos, input.base, location.districtId, {
    vehicles: {},
    force: sending,
  });
  // No road, no cell. The road is world-wide now, so this is only reachable for a location whose
  // district the map does not have at all, and planting a sleeper that arrived instantly would be
  // the same teleport bug the column had.
  if (travel === null) return { kind: 'refused', reason: 'no_road' };

  const cell: SleeperCell = {
    id: randomUUID(),
    baseId: input.base.id,
    locationId: location.id,
    army: sending,
    phase: 'outbound',
    departedAt: input.now.toISOString(),
    arrivesAt: new Date(input.now.getTime() + travel).toISOString(),
    travelMs: travel,
  };
  repos.sleepers.insert(cell);

  const base: Base = { ...input.base, army: removeForce(input.base.army, sending) };
  repos.bases.updateArmy(base.id, base.army, base.trainingQueue);
  return { kind: 'ok', base, cell };
}

/**
 * Turn a cell round. The walk home is as long as the walk out was.
 *
 * Works from any phase but `returning`: a cell still on the road is turned round where it stands,
 * and one already waiting gets up and leaves. Either way the units are off the board until they
 * are home, which is what stops a recall being a free teleport out of a fight about to start.
 */
export function recallSleepers(
  repos: Repositories,
  base: Base,
  cellId: string,
  now: Date,
): { kind: 'ok'; cell: SleeperCell } | { kind: 'refused'; reason: 'unknown' | 'locked' } {
  const cell = repos.sleepers.findById(cellId);
  if (!cell || cell.baseId !== base.id || cell.phase === 'returning') {
    return { kind: 'refused', reason: 'unknown' };
  }
  /*
   * A cell on the ground is at the place, and the last hour holds it there like everybody else
   * (bug pass, 2026-09-28): whoever is there fights. One still on the road is not there yet.
   */
  if (
    cell.phase === 'waiting' &&
    placeLocked(repos, base, { kind: 'location', locationId: cell.locationId }, now)
  ) {
    return { kind: 'refused', reason: 'locked' };
  }

  /*
   * Home is the walk they have already done, not a fresh quote.
   *
   * An outbound cell turned round at the halfway mark is home in half the time it had left, and
   * a waiting cell owes the whole walk. Measured off `travelMs`, which is the walk frozen at the
   * send, and **not** off the two marks: once a cell lands, `arrivesAt` is rewritten to the
   * moment it went to ground, so the difference between the marks measures how late the settle
   * ran rather than how far anybody went. A cell that landed while the server was asleep for six
   * hours read as a six hour walk and owed one on the way back.
   */
  const walked =
    cell.phase === 'waiting'
      ? cell.travelMs
      : Math.min(cell.travelMs, Math.max(0, now.getTime() - Date.parse(cell.departedAt)));
  repos.sleepers.markReturning(
    cell.id,
    now.toISOString(),
    new Date(now.getTime() + Math.max(0, walked)).toISOString(),
  );
  const returning = repos.sleepers.findById(cell.id);
  return returning ? { kind: 'ok', cell: returning } : { kind: 'refused', reason: 'unknown' };
}

/**
 * Land every walk whose mark has passed: cells going to ground, and cells coming home.
 *
 * Called by the world clock beside `settleMovements`. Returns how many rows moved, so the settle
 * can tell an open tab that something happened.
 */
export function settleSleepers(repos: Repositories, now: Date): number {
  // One transaction per cell: the army going home and the cell going are one fact, and a throw
  // between them used to send the same army home again on the next tick (`world/guard.ts`).
  return settleEach(
    repos,
    'sleeper cells',
    repos.sleepers.due(now.toISOString()),
    (cell) => cell.id,
    (cell) => {
      if (cell.phase === 'returning') {
        const base = repos.bases.findById(cell.baseId);
        if (base) {
          repos.bases.updateArmy(base.id, mergeArmies(base.army, cell.army), base.trainingQueue);
        }
        repos.sleepers.remove(cell.id);
        return;
      }

      /*
       * Gone to ground, merged with whatever this crew already has waiting there.
       *
       * One row per crew per location is what every reader downstream assumes: `assemble` asks
       * `waitingAt` for a single cell, and the Monitor lists one line per place. Merging here
       * rather than at the send is deliberate, because until they arrive they are two columns on
       * two different marks and only one of them is standing anywhere.
       */
      const standing = repos.sleepers.waitingAt(cell.baseId, cell.locationId);
      if (standing) {
        repos.sleepers.setArmy(standing.id, mergeArmies(standing.army, cell.army));
        repos.sleepers.remove(cell.id);
      } else {
        repos.sleepers.markWaiting(cell.id, now.toISOString());
      }
    },
  );
}
