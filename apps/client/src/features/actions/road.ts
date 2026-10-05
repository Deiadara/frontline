import {
  unitSlotsUsed,
  type ActionsResponse,
  type Army,
  type BattleView,
  type BattlesResponse,
  type Mission,
  type MissionsResponse,
  type MovementView,
  type SpyRunView,
  type UnitMoveView,
  type SleeperCellView,
  type StationedForce,
} from '@frontline/shared';

/**
 * Everybody who is not where they started, gathered from the reads the game already makes.
 *
 * A column walking to a fight (`/actions`), a crew out on a job (`/missions`), a force standing at
 * a fight it has reached (`/battles`, the caller's own muster), and the rest of `/actions`: the spy
 * job, moves, cells and postings. The page used to list only the first, so a player whose whole
 * army was on a mission was told "nobody is out". Pure, so the sections and the header count can be
 * pinned without a screen.
 */
export interface Road {
  readonly columns: readonly MovementView[];
  readonly jobs: readonly Mission[];
  readonly fights: readonly BattleView[];
  /** The spy jobs out: the runners on a road are somebody too (2026-09-22). Two at most. */
  readonly spies: readonly SpyRunView[];
  /** Columns walking between the crew's own places (2026-09-22). */
  readonly moves: readonly UnitMoveView[];
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
    fights: (battles?.coming ?? []).filter((view) => {
      const mine = ownAt(view);
      return mine !== null && mine.size > 0 && view.battle.resolvedAt === null;
    }),
    spies: actions?.spyRuns ?? [],
    moves: actions?.moves ?? [],
    cells: actions?.sleepers ?? [],
    stationed: actions?.stationed ?? [],
  };
}

/**
 * What the reader has at a fight: their own row, not the whole side (bug pass, 2026-10-02). An ally's
 * reinforcement was drawn and counted as the reader's own units on the road. A payload from before
 * `own` existed reads as the side, as it always did.
 */
export function ownAt(view: BattleView): { army: Army; perimeter: Army; size: number } | null {
  return view.own === undefined ? view.muster : view.own;
}

/** Whether the road has anybody on it at all. */
export function roadIsEmpty(road: Road): boolean {
  return (
    road.columns.length === 0 &&
    road.jobs.length === 0 &&
    road.fights.length === 0 &&
    road.spies.length === 0 &&
    road.moves.length === 0 &&
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
  spies: number;
  moves: number;
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
    spies: road.spies.length,
    moves: road.moves.length,
    cells: road.cells.length,
    stationed: road.stationed.length,
    unitSlots:
      road.columns.reduce((total, column) => total + slots(column.army, column.perimeter), 0) +
      road.jobs.reduce((total, job) => total + slots(job.force), 0) +
      road.fights.reduce((total, fight) => {
        const mine = ownAt(fight);
        return total + (mine ? slots(mine.army, mine.perimeter) : 0);
      }, 0) +
      /*
       * §A1: planted and posted people draw their beds too, so the header has to count them.
       *
       * `unitsAbroad` on the server puts both in the district's draw, and a header that left
       * them out would disagree with the unit-slot chip on the roster by exactly the number of
       * people a player has standing somewhere.
       */
      road.moves.reduce((total, move) => total + slots(move.army), 0) +
      road.cells.reduce((total, cell) => total + slots(cell.army), 0) +
      road.stationed.reduce((total, post) => total + slots(post.army), 0),
  };
}

/** A force at a fight is waiting for the mark, or in it once the mark has passed and nobody has settled it. */
export function fightPhase(view: BattleView, now: Date): 'waiting' | 'fighting' {
  return Date.parse(view.battle.scheduledFor) <= now.getTime() ? 'fighting' : 'waiting';
}

/**
 * How many things the road tab is listing, for the badge on it.
 *
 * Rows rather than `roadCounts().unitSlots`: the badge sits beside the word "on the road", and a
 * player reads it as "how many entries am I about to look at". The slot figure is the header's
 * job on the page itself, where it has the room to say which currency it is in.
 */
export function roadRows(road: Road): number {
  const counts = roadCounts(road);
  // Every row the page draws: the spy runs and the moves were left out, so a crew whose only
  // business out was a move read "On the road 0" over a page listing it (bug pass, 2026-10-02).
  return (
    counts.columns +
    counts.jobs +
    counts.fights +
    counts.cells +
    counts.stationed +
    counts.spies +
    counts.moves
  );
}
