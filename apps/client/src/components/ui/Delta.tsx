import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { DeltaMark } from '../../lib/deltas';
import { claimRow, releaseRow, type Press } from '../../lib/lastPress';

/** Clear of the chip, and clear of the frame's edge. */
const GAP = 10;
const EDGE = 44;
/** One figure's row. Tall enough that two stacked figures do not touch at this face size. */
const LANE = 30;

interface Placement {
  top: number;
  left: number;
}

/**
 * The figures that float off a readout when the number on it moves.
 *
 * Portalled to `document.body` and positioned in viewport coordinates, the way `HoverCard` is and
 * for the same reasons: the standing bar is a `flex-wrap` row that would grow to contain anything
 * drawn inside it, so a figure hanging under a chip would push the whole top of the screen down,
 * and the same component has to work on a unit count inside a scrolling column, where an in-flow
 * figure would be cut by the scroller rather than float over it.
 *
 * ## Where a figure lands
 *
 * A receipt belongs at the till (maintainer request, 2026-09-11): a figure that answers a button press
 * is drawn under that button, whatever it is, a spend or a gain, and every readout charged by the
 * one press stacks in one column under it, a row each. A figure nobody pressed a button for, a
 * mission home or a fight settled, hangs below its readout at the top of the screen.
 *
 * Each figure carries its own press (`DeltaMark.press`, stamped when it was minted), so two
 * presses a second apart on two cards draw two columns under two buttons. The first version held
 * one press per readout for as long as any of its figures lived, and both columns landed under
 * whichever button was pressed first.
 */
export function DeltaFloat({
  marks,
  icon,
  unit,
  'data-testid': testId,
}: {
  marks: readonly DeltaMark[];
  /** The readout's own mark, so a figure that has floated away from its chip still says which. */
  icon?: ReactNode;
  /**
   * What the figure counts, when the number alone does not say it.
   *
   * The stockpiles do not need one: the icon on the plate is the resource. The level chip does,
   * because `+120` beside a level reads as a hundred and twenty levels.
   */
  unit?: string;
  'data-testid'?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const owner = useId();
  // One placement per column: the readout's own, keyed `readout`, and one per press id.
  const [at, setAt] = useState<Record<string, Placement>>({});
  const showing = marks.length > 0;

  // Memoised on the marks: `place` and the layout effect hang off it, and a fresh Map on every
  // render would have them re-run, set state, and render again without end.
  const groups = useMemo(() => groupByPress(marks), [marks]);
  // The rows this readout holds under each press, so a row is given back when its column goes.
  const held = useRef(new Set<number>());

  const place = useCallback(() => {
    const style = anchor.current ? getComputedStyle(anchor.current) : null;
    const band = (name: string): number => parseFloat(style?.getPropertyValue(name) ?? '') || 0;
    const floor = window.innerHeight - band('--nav-h') - GAP;
    const ceiling = band('--hud-h') + GAP;
    const next: Record<string, Placement> = {};

    for (const [key, group] of groups) {
      if (group.press !== undefined) {
        const row = claimRow(group.press.id, owner);
        held.current.add(group.press.id);
        /*
         * Under the button, in this readout's row of the stack; above it when the stack would run
         * into the switcher at the foot of the frame. The chrome's bands are read off the CSS
         * variables the shell publishes, not guessed: a receipt drawn under a button that sits
         * just above the nav landed *behind* the nav, which is where the first version put it.
         */
        const rows = row + group.marks.length;
        const stack = rows * LANE + GAP;
        const below = group.press.rect.bottom + GAP + row * LANE;
        const above = group.press.rect.top - stack;
        next[key] = {
          top: group.press.rect.bottom + stack <= floor || above < ceiling ? below : above,
          left: Math.min(
            Math.max(EDGE, group.press.rect.left + group.press.rect.width / 2),
            window.innerWidth - EDGE,
          ),
        };
        continue;
      }
      const box = anchor.current?.getBoundingClientRect();
      if (!box) continue;
      next[key] = {
        top: box.bottom + GAP,
        // Centred on the chip and kept inside the frame. The figures are translated back by half
        // their own width, so this is the centre line rather than the left edge.
        left: Math.min(Math.max(EDGE, box.left + box.width / 2), window.innerWidth - EDGE),
      };
    }
    setAt(next);
  }, [groups, owner]);

  useLayoutEffect(() => {
    // Rows under a press whose figures have all gone are handed back.
    const live = new Set([...groups.values()].flatMap((g) => (g.press ? [g.press.id] : [])));
    for (const pressId of [...held.current]) {
      if (!live.has(pressId)) {
        releaseRow(pressId, owner);
        held.current.delete(pressId);
      }
    }
    if (!showing) {
      setAt({});
      return;
    }
    place();
  }, [showing, groups, place, owner]);

  useEffect(() => {
    if (!showing) return;
    // The readout can be in a panel that scrolls under the figure. Capture phase, because the
    // scroller that matters is usually an inner column rather than the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [showing, place]);

  return (
    <>
      {/* Out of the flow and the size of the readout it sits in, so dropping this into a chip
          changes no layout and the portal has the chip's own box to hang from. The readout must be
          `relative` for that; every caller here is. */}
      <span ref={anchor} aria-hidden className="pointer-events-none absolute inset-0" />
      {showing &&
        [...groups].map(([key, group]) => {
          const placement = at[key];
          if (placement === undefined) return null;
          return createPortal(
            <div
              key={key}
              data-testid={testId}
              data-anchored={group.press ? 'press' : 'readout'}
              aria-hidden
              className="pointer-events-none z-[210] w-0"
              style={{ position: 'fixed', top: placement.top, left: placement.left }}
            >
              {group.marks.map((mark, index) => (
                <DeltaFigure
                  key={mark.id}
                  mark={mark}
                  icon={icon}
                  unit={unit}
                  // Under a button this readout already has its own row in the press's stack, so
                  // its figures sit from that row down; on the chip they keep the lanes they were
                  // given when they appeared.
                  lane={group.press ? index : mark.lane}
                />
              ))}
            </div>,
            document.body,
          );
        })}
    </>
  );
}

interface Group {
  press: Press | undefined;
  marks: DeltaMark[];
}

/** One column per press, plus one for everything that answered no press. Stable order. */
function groupByPress(marks: readonly DeltaMark[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const mark of marks) {
    const key = mark.press ? `press-${mark.press.id}` : 'readout';
    const group = groups.get(key) ?? { press: mark.press, marks: [] };
    group.marks.push(mark);
    groups.set(key, group);
  }
  return groups;
}

/** `-1,200` in oxblood, `+400` in verdigris, in the chrome's display face with tabular figures. */
function DeltaFigure({
  mark,
  icon,
  unit,
  lane,
}: {
  mark: DeltaMark;
  icon?: ReactNode;
  unit?: string | undefined;
  lane: number;
}) {
  const spend = mark.amount < 0;
  return (
    <span
      // A waived bill (admin mode quoted it and did not take it) is drawn as the spend it would
      // have been: the figure and the currency, nothing else, so it reads the same as the real
      // thing. The test id keeps the distinction for the suite.
      data-testid={`delta-${mark.waived ? 'waived' : spend ? 'spend' : 'gain'}`}
      data-amount={mark.amount}
      className={
        // On its own plate, at 18px. The figure floats over whatever the screen happens to be
        // painting at that moment, and a small red number over a dim doorway is a number nobody
        // reads: the plate is what makes it the same figure over the city map and over a portrait.
        // The board's word was obvious, so it is the largest figure on the HUD while it lives.
        'delta-figure absolute left-0 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap ' +
        'rounded-sm border bg-surface-950/95 px-2 py-1 shadow-lifted ' +
        'font-display text-[18px] font-bold leading-none tabular-nums ' +
        (spend
          ? 'border-oxblood-500/70 text-oxblood-300'
          : 'border-verdigris-500/70 text-verdigris-300')
      }
      style={{ top: lane * LANE }}
    >
      {icon !== undefined && (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center">{icon}</span>
      )}
      {/* The sign is written rather than implied: "1,200" going past in red is a number, and
          "-1,200" is a receipt. `toLocaleString` for the same reason every other figure in the
          game has it: 1200 and 1,200 are not equally readable at a glance. */}
      {spend ? '-' : '+'}
      {Math.abs(mark.amount).toLocaleString()}
      {unit !== undefined && <span className="text-[13px] font-bold">{unit}</span>}
    </span>
  );
}
