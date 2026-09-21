import {
  unitSlotsUsed,
  type ActionsResponse,
  type BattleView,
  type BattlesResponse,
  type Mission,
  type MissionsResponse,
  type MovementView,
  type ScoutingRunView,
  type SleeperCellView,
  type StationedForce,
} from '@frontline/shared';

/**
 * Everybody who is not where they started, gathered from the reads the game already makes.
 *
 * Four kinds of away: a column walking to a fight (`/actions`), a crew out on a job (`/missions`),
 * a force standing at a fight it has reached (`/battles`, the caller's own muster), and the one
 * scout a crew may have out (`/actions` again). The page used to list only the first, so a player
 * whose whole army was on a mission was told "nobody is out". Pure, so the sections and the header
 * count can be pinned without a screen.
 */
export interface Road {
  readonly columns: readonly MovementView[];
  readonly jobs: readonly Mission[];
  readonly fights: readonly BattleView[];
  readonly scout: ScoutingRunView | null;
  /** §A4: cells planted on somebody else's ground, in any of their three phases. */
  readonly cells: readonly SleeperCellView[];
  /** ...and the people posted on ground this crew holds, who are not going anywhere. */
  readonly stationed: readonly StationedForce[];
}

export function onTheRoad(
  actions: ActionsResponse | undefined,
  missions: MissionsResponse | undefined,
  battles: BattlesResponse | undefined,
): Road {
  return {
    columns: actions?.movements ?? [],
    // Active runs only: a crew at the gate is home, and the board is where its report is read.
    jobs: (missions?.missions ?? []).filter((mission) => mission.status === 'active'),
    // A fight the caller has units at. A declaration with nobody deployed yet is on the board,
    // not on the road, and a bystander's fight is nobody's.
    fights: (battles?.coming ?? []).filter(
      (view) => view.muster !== null && view.muster.size > 0 && view.battle.resolvedAt === null,
    ),
    scout: actions?.scoutingRun ?? null,
    cells: actions?.sleepers ?? [],
    stationed: actions?.stationed ?? [],
  };
}

/** Whether the road has anybody on it at all. */
export function roadIsEmpty(road: Road): boolean {
  return (
    road.columns.length === 0 &&
    road.jobs.length === 0 &&
    road.fights.length === 0 &&
    road.scout === null &&
    // A crew with people planted or posted is not a crew with nobody out, and saying so put the
    // "Nobody is out" card over the top of the only screen that lists either of them.
    road.cells.length === 0 &&
    road.stationed.length === 0
  );
}

/**
 * The header's figures: how many of each, and the unit slots out, columns and jobs and fights added.
 *
 * **Unit slots, not heads.** The header prints the word, and a `size` off the wire is a head count:
 * a crew with a Colossus on the road was told it had one slot out when the district was holding
 * twelve of them open for it. Both payloads carry the force itself beside the size, so the figure
 * is summed here through the same `unitSlotsUsed` the beds and the vehicles use.
 */
export function roadCounts(road: Road): {
  columns: number;
  jobs: number;
  fights: number;
  scouts: number;
  cells: number;
  stationed: number;
  unitSlots: number;
} {
  const slots = (...armies: Readonly<Record<string, number>>[]) =>
    armies.reduce((total, army) => total + unitSlotsUsed(army), 0);
  return {
    columns: road.columns.length,
    jobs: road.jobs.length,
    fights: road.fights.length,
    scouts: road.scout === null ? 0 : 1,
    cells: road.cells.length,
    stationed: road.stationed.length,
    unitSlots:
      road.columns.reduce((total, column) => total + slots(column.army, column.perimeter), 0) +
      road.jobs.reduce((total, job) => total + slots(job.force), 0) +
      road.fights.reduce(
        (total, fight) =>
          total + (fight.muster ? slots(fight.muster.army, fight.muster.perimeter) : 0),
        0,
      ) +
      /*
       * §A1: planted and posted people draw their beds too, so the header has to count them.
       *
       * `unitsAbroad` on the server puts both in the district's draw, and a header that left
       * them out would disagree with the unit-slot chip on the roster by exactly the number of
       * people a player has standing somewhere.
       */
      road.cells.reduce((total, cell) => total + slots(cell.army), 0) +
      road.stationed.reduce((total, post) => total + slots(post.army), 0),
  };
}

/** A force at a fight is waiting for the mark, or in it once the mark has passed and nobody has settled it. */
export function fightPhase(view: BattleView, now: Date): 'waiting' | 'fighting' {
  return Date.parse(view.battle.scheduledFor) <= now.getTime() ? 'fighting' : 'waiting';
}
