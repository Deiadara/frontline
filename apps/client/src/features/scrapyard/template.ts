/**
 * The one template every bench in the yard is cut to (maintainer request, 2026-09-15).
 *
 * The complaint was that the Traps bench had "one menu bigger than the others": a card sized itself
 * off its own content, so a trap with five resources in its bill and a requirement line under it
 * stood half a card taller than the trap beside it, and a bench of six read as a broken fence. The
 * four benches had also each grown their own card, so nothing lined up across a tab change either.
 *
 * Three pieces, used by every bench:
 *
 * - `BENCH_BOARD` is the sheet of yard steel a bench is bolted to.
 * - `BENCH_TRAY` is the grid of slots on it. `grid-auto-rows: 1fr` is the whole trick: the tray is
 *   left to size itself, so every `1fr` row resolves to the tallest card on the bench and every
 *   card stretches into its row. A bill that wraps lifts the tray by a line rather than lifting one
 *   card out of the row.
 * - `SLOT_WELL` is the recess a card sits in, so a card reads as seated in the board rather than
 *   floating on it. It is a dark ground with the light on the top edge and the shadow gathering
 *   inside, which is the opposite treatment to the plate behind it: two plates stacked read as a
 *   sheet laid on a sheet.
 *
 * Kept in their own module because `PartsBench` uses them too, and importing them back out of
 * `ScrapyardPage` (which imports `PartsBench`) would be a cycle.
 */

/**
 * One sheet per bench, cards recessed into it.
 *
 * Paper with a drawn frame rather than the yard steel it was (maintainer, 2026-09-17): the
 * modifications benches were asked to read like the feats board, and the board is a sheet somebody
 * inked a frame onto. The recess below still works on it, because a recess is a shadow and a shadow
 * lands on paper as readily as on tin.
 *
 * No padding of its own: `cn` here is plain `clsx` with no Tailwind merge behind it, so a board
 * that carried `p-4` could not be given `p-0` by a caller without the two classes racing in the
 * stylesheet. The bin puts its padding on the header and the tray instead.
 */
export const BENCH_BOARD = 'ink-frame card-paper washed grain rounded-sm shadow-panel';

/** The grid of slots on a board. Every card in it comes out the same height. */
export const BENCH_TRAY = 'grid items-stretch gap-3 [grid-auto-rows:1fr]';

/** The recess a card sits in. */
export const SLOT_WELL =
  'bg-surface-950/55 shadow-[inset_0_1px_0_rgb(222_216_240/0.07),inset_0_3px_14px_rgb(0_0_0/0.55)]';
