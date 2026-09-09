import { PLAYER_LEVEL_MIN, playerXpToNextLevel } from '@frontline/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * One figure floating off a readout: `-1,200` when the crew spent it, `+400` when it landed.
 *
 * The board's ask is that spending and gaining are never silent. Every number on the HUD moves for
 * two different reasons, though, and only one of them is worth interrupting a player for: a build
 * that takes 1,200 caps is a decision they just made, and the three scrap the Scrapyard banked
 * between two polls is weather. A pop-up on the weather trains people to stop reading the pop-ups,
 * so the trickle is written off (see {@link shownDeltas}) and everything else shows.
 */
export interface DeltaMark {
  /** Unique for the life of the page, so two figures in one frame can never share a React key. */
  id: number;
  /** Signed and whole: negative is a spend, positive is a gain. */
  amount: number;
  /**
   * Which row of the stack this figure sits in, fixed when it appears.
   *
   * Several in a row stack rather than overwrite, and a stack laid out by list position jumps
   * every time the oldest one expires under the ones still animating. A lane is claimed when the
   * figure appears and freed when it goes, so a figure never moves once it is on screen.
   */
  lane: number;
}

/** How long a figure stays up. Matches the `delta-rise` keyframes in `index.css`. */
export const DELTA_MS = 2400;

/** What the client can see of the passive output behind a reading. */
export interface TrickleRates<K extends string> {
  /**
   * `economy.productionSettledAt`: the server clock the passive output was banked to.
   *
   * The server's, never `Date.now()`. The window between two readings is what the trickle is
   * measured over, and a browser clock that is a minute fast would write off a minute of real
   * gains as weather.
   */
  settledAt: string | null;
  /** Units per hour, as `districtProduction` computes them off the structures on the wire. */
  perHour: Readonly<Partial<Record<K, number | undefined>>>;
}

/**
 * How much of the built rate the crew's own perks can add on top.
 *
 * `accrueProduction` scales the structures' output by `CrewYield.productionPercent` and by a
 * per-resource yield, neither of which is on `/me`. Doubling covers every perk in the game with
 * room over: writing off twice the visible rate costs nothing, because the visible rate over a
 * five-second poll is a fraction of a unit.
 */
export const TRICKLE_MARGIN = 2;

/**
 * Ground the crew holds pays on top of what it built, and `/me` carries none of it.
 *
 * `city/locations.ts` is worth 94 caps, 80 supplies, 72 oil, 62 planks, 32 scrap and 8
 * high-quality metal an hour with *every* location in the city held, so one flat figure above the
 * largest of those covers the lot. Per hour, so it is nothing across a poll (0.14 caps over five
 * seconds) and only bites when the page has been asleep.
 */
export const UNSEEN_PER_HOUR = 100;

const MS_PER_HOUR = 3_600_000;

/**
 * The least a settle can bank on a resource, whatever its rate says.
 *
 * A stockpile is stored whole, so `accrueProduction` hands over whole units: a rate of two an hour
 * still banks a whole 1 the moment the accumulated fraction crosses, on whichever read happens to
 * be the one that crosses it. Measured over the gap between two settles that fraction is a
 * fraction, so an allowance sized purely by rate x time writes off nothing and the +1 is announced
 * as a payday. Every resource is therefore allowed one whole unit per reading before the rate is
 * even consulted.
 */
export const WHOLE_UNIT_ALLOWANCE = 1;

/**
 * The smallest rise worth a receipt on a stockpile that produces.
 *
 * The trickle allowance alone is not enough, and the board found the hole: launching a mission
 * invalidates `/me`, that read settles a few seconds of production, and a couple of seconds of a
 * low-rate resource rounds up to a whole oil and a whole wood. So a produced resource has a floor
 * under it as well as an allowance: a rise of one or two units is weather by definition, whatever
 * the clock says.
 *
 * What this costs is a +1 or +2 the crew really was paid, and the cost is measured rather than
 * assumed: of every reward line in the mission catalogue exactly two are that small (the scrap
 * run's 2 caps and the cable strip's 2 high-quality metal), and no job is that small in *every*
 * line, so a crew coming home always throws a figure. What can go silent is one line of a payout,
 * a rounding refund or a two-cap sale. That is the trade against throwing a figure for the
 * weather. Spends are not filtered at all: a fall of any size is something the crew paid.
 */
export const GAIN_FLOOR = 2;

export interface Reading<K extends string> {
  /**
   * Partial, so a satchel keyed by item id (where an item held none of is simply absent) reads
   * the same way a stockpile with every key present does.
   */
  values: Readonly<Partial<Record<K, number | undefined>>>;
  trickle?: TrickleRates<K> | undefined;
}

/**
 * The most a positive move can be and still be the passive trickle rather than a gain.
 *
 * Rate times the window, plus {@link WHOLE_UNIT_ALLOWANCE}: never less than one whole unit, because
 * a settle banks whole units and the read that crosses the fraction gets all of it.
 */
export function trickleAllowance<K extends string>(
  previous: Reading<K>,
  next: Reading<K>,
): Partial<Record<K, number>> {
  const rates = next.trickle;
  if (rates === undefined) return {};
  const hours =
    rates.settledAt !== null && previous.trickle?.settledAt
      ? (Date.parse(rates.settledAt) - Date.parse(previous.trickle.settledAt)) / MS_PER_HOUR
      : 0;
  const window = Number.isFinite(hours) && hours > 0 ? hours : 0;

  const allowance: Partial<Record<K, number>> = {};
  for (const key of Object.keys(next.values) as K[]) {
    const produced = ((rates.perHour[key] ?? 0) + UNSEEN_PER_HOUR) * TRICKLE_MARGIN * window;
    allowance[key] = Math.max(WHOLE_UNIT_ALLOWANCE, produced);
  }
  return allowance;
}

/**
 * What moved between two readings and is worth saying out loud.
 *
 * Every fall shows: nothing in the game quietly drains a stockpile, so a number going down is
 * always something the crew paid for or something that was taken from them. That is the board's
 * rule in one line: click a button that spends, get the figure.
 *
 * A rise has to clear `max(GAIN_FLOOR, allowance)` before it counts, and only on a reading that
 * carries {@link TrickleRates}. A counter with no passive source behind it (the infamy
 * wallet, the unit roster, the satchel) is announced whatever it moves by, because a single found
 * servo is +1 and there is nothing else it could have been.
 */
export function shownDeltas<K extends string>(
  previous: Reading<K>,
  next: Reading<K>,
): Partial<Record<K, number>> {
  const allowance = trickleAllowance(previous, next);
  const produces = next.trickle !== undefined;
  const moved: Partial<Record<K, number>> = {};
  for (const key of Object.keys(next.values) as K[]) {
    const delta = Math.round((next.values[key] ?? 0) - (previous.values[key] ?? 0));
    if (delta === 0) continue;
    const floor = produces ? Math.max(GAIN_FLOOR, allowance[key] ?? 0) : 0;
    if (delta > 0 && delta <= floor) continue;
    moved[key] = delta;
  }
  return moved;
}

/**
 * What the crew has learned since level 1, from the two figures the level chip is drawn from.
 *
 * `Base.level` and `xpIntoLevel` are stored deliberately as a level plus progress *into* it rather
 * than as a lifetime total (see `progression/curve.ts`), which means the chip cannot diff itself:
 * an award of 120 XP that crosses a threshold leaves `xpIntoLevel` *lower* than it was, and a chip
 * subtracting one reading from the next would announce a loss for the best thing that can happen
 * to a player.
 *
 * Summing the curve turns the pair back into one number that only ever rises, so the ordinary
 * diff in {@link useDeltaMarks} handles a level crossing, a double crossing and a plain award with
 * no special case: 600 to clear level 3 minus the 500 already in it, plus the 20 the new level
 * opened with, is the 120 that was awarded. Summed rather than solved in closed form so that
 * `playerXpToNextLevel` stays the only place the curve is written down.
 */
export function xpBehind(level: number, xpIntoLevel: number): number {
  const reached = Math.max(PLAYER_LEVEL_MIN, Math.trunc(level));
  let cleared = 0;
  for (let at = PLAYER_LEVEL_MIN; at < reached; at += 1) cleared += playerXpToNextLevel(at);
  return cleared + Math.max(0, Math.trunc(xpIntoLevel));
}

/** The lowest row nothing is standing in. */
function freeLane(live: readonly DeltaMark[]): number {
  const taken = new Set(live.map((mark) => mark.lane));
  let lane = 0;
  while (taken.has(lane)) lane += 1;
  return lane;
}

let nextId = 0;

/**
 * Diff consecutive readings of a set of numbers and hand back the figures to draw.
 *
 * One hook for the whole game: the HUD's six stockpiles, the infamy wallet and any screen counter
 * a mutation moves all read from this rather than growing a copy each.
 *
 * The first reading announces nothing. A page opening is not a payday, and a HUD that threw six
 * figures every time the shell mounted would be exactly the noise this is trying to avoid.
 *
 * `values` is compared by identity, which is what React Query's structural sharing gives for free:
 * a poll that changed nothing hands back the same object, so the common case costs one comparison.
 */
export function useDeltaMarks<K extends string>(
  values: Readonly<Partial<Record<K, number | undefined>>> | undefined,
  trickle?: TrickleRates<K>,
): Record<string, readonly DeltaMark[]> {
  const [marks, setMarks] = useState<Record<string, readonly DeltaMark[]>>({});
  const previous = useRef<Reading<K> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running) clearTimeout(timer);
      running.clear();
    };
  }, []);

  useEffect(() => {
    if (values === undefined) return;
    const before = previous.current;
    // Identity, not contents: a poll that changed nothing must not reset the production window,
    // or a stockpile that sat still for a minute would have its next rise measured over five
    // seconds and shown as a gain.
    if (before !== null && before.values === values) return;
    previous.current = { values, trickle };
    if (before === null) return;

    const moved = Object.entries(shownDeltas(before, { values, trickle })) as [K, number][];
    if (moved.length === 0) return;

    // The figures are minted here rather than inside the updater below, so their ids are fixed
    // whatever React does with the updater (it may call it more than once).
    const fresh = moved.map(([key, amount]) => ({ key, id: (nextId += 1), amount }));

    setMarks((live) => {
      const next = { ...live };
      for (const { key, id, amount } of fresh) {
        const standing = next[key] ?? [];
        next[key] = [...standing, { id, amount, lane: freeLane(standing) }];
      }
      return next;
    });

    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const gone = new Set(fresh.map((mark) => mark.id));
      setMarks((live) => {
        const next = { ...live };
        for (const { key } of fresh) {
          next[key] = (next[key] ?? []).filter((mark) => !gone.has(mark.id));
        }
        return next;
      });
    }, DELTA_MS);
    timers.current.add(timer);
  }, [values, trickle]);

  return marks;
}
