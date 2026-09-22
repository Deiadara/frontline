/**
 * Where the player last pressed something, so a receipt can land beside the button that spent
 * (maintainer request, 2026-09-11).
 *
 * The spend figures used to float off the stockpile chips at the top of the screen, which is
 * where the number lives but not where the player is looking: they pressed Work It Up at the
 * bottom of a window and the "-704" appeared a screen away, under a chip, and was missed. A
 * receipt belongs at the till.
 *
 * One capture-phase listener on the document, the way `lib/sound.ts` hears every press, records
 * the box of the control under the pointer and when. `DeltaFloat` asks for it when a spend
 * appears: a press inside {@link PRESS_WINDOW_MS} is the press that caused the spend, since a
 * write round-trips in well under a second and nothing else in the game drains a stockpile on a
 * click. A gain never asks: what came home from a mission has no button to land beside.
 *
 * Only real controls count. A link changes the page rather than the balance, and a text field
 * being clicked into is not a decision.
 */

/** How long after a press a spend is still that press's doing. */
export const PRESS_WINDOW_MS = 2_500;

const PRESSABLE = 'button, [role="button"], input[type="checkbox"], input[type="radio"]';

export interface Press {
  /** A fresh id per press, so figures from one press stack in one column. */
  id: number;
  at: number;
  /** The control's box at the moment of the press, in viewport coordinates. */
  rect: { top: number; bottom: number; left: number; width: number };
}

let last: Press | null = null;
let nextId = 0;

function record(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const control = target.closest(PRESSABLE);
  if (control === null) return;
  const box = control.getBoundingClientRect();
  // A control with no box is one the pointer could not have found: a hidden input.
  if (box.width === 0 && box.height === 0) return;
  const rect = { top: box.top, bottom: box.bottom, left: box.left, width: box.width };
  const now = Date.now();
  /*
   * The same control pressed again inside the window is the same column (maintainer,
   * 2026-09-22: "if I click two times on train a unit the minus symbols appear more than two
   * times and glitch out").
   *
   * Every press minted a fresh id, and a readout stacks its figures per press id, so two quick
   * presses of Train were two stacks with the same anchor: the second pair of receipts was
   * drawn over the first at the same pixel, and four figures fighting for two rows is what the
   * glitch was. Measured: `-36@612,481` and `-36@612,482`, twice each. Keeping the id makes the
   * second press's figures the next rows of the first press's column, which is what a receipt
   * for two purchases looks like.
   */
  if (last !== null && now - last.at <= PRESS_WINDOW_MS && sameBox(last.rect, rect)) {
    last = { ...last, at: now, rect };
    return;
  }
  last = { id: (nextId += 1), at: now, rect };
}

/** The same control, allowing a pixel for a button that shifted under a hover lift. */
function sameBox(a: Press['rect'], b: Press['rect']): boolean {
  return (
    Math.abs(a.top - b.top) <= 2 &&
    Math.abs(a.bottom - b.bottom) <= 2 &&
    Math.abs(a.left - b.left) <= 2 &&
    Math.abs(a.width - b.width) <= 2
  );
}

let installed = false;

/** Start listening. Idempotent, so every caller may say so and only the first one does anything. */
export function installLastPress(doc: Document = document): void {
  if (installed) return;
  installed = true;
  doc.addEventListener('click', (event) => record(event.target), { capture: true });
}

/** The press that just happened, if one did, else null. */
export function recentPress(now: number = Date.now()): Press | null {
  if (last === null || now - last.at > PRESS_WINDOW_MS) return null;
  return last;
}

/** Tests only: forget the last press, so one spec's click cannot anchor the next one's figure. */
export function forgetPresses(): void {
  last = null;
}

/*
 * Figures from one press stack in one column.
 *
 * Three stockpiles charged by one press are three `DeltaFloat`s, one per chip, and each knows only
 * its own marks. Left to themselves all three would sit in lane zero under the button, on top of
 * one another. So a press hands out rows: the first readout to ask gets the top row, the next the
 * one under it, and a row is given back when that readout's figures have gone.
 */
const rows = new Map<number, { owner: string; count: number }[]>();

/**
 * The first row this readout's figures start on under a press, given how many it holds.
 *
 * One row per *figure*, not per readout (maintainer, 2026-09-22). It was one row per owner, so a
 * readout holding two figures drew its second straight through the next readout's first: two
 * quick presses of Train put the caps column's `-36` on row 0 and 1 and the supplies column's
 * `-7` on row 1 and 2, and row 1 had both. Each owner reserves as many rows as it has figures,
 * and the next owner starts after them.
 */
export function claimRow(pressId: number, owner: string, count = 1): number {
  const held = rows.get(pressId) ?? [];
  const at = held.findIndex((one) => one.owner === owner);
  const next =
    at === -1
      ? [...held, { owner, count }]
      : held.map((one, index) => (index === at ? { owner, count } : one));
  rows.set(pressId, next);
  const before = at === -1 ? held : held.slice(0, at);
  return before.reduce((total, one) => total + one.count, 0);
}

export function releaseRow(pressId: number, owner: string): void {
  const held = rows.get(pressId);
  if (held === undefined) return;
  const left = held.filter((one) => one.owner !== owner);
  if (left.length === 0) rows.delete(pressId);
  else rows.set(pressId, left);
}
