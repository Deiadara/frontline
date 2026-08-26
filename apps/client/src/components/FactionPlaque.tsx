import { FACTION_NAME_MAX, type Base } from '@frontline/shared';
import { useState } from 'react';
import { useRenameFaction } from '../lib/queries';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';

/**
 * The faction's name (§A1), and the one control that changes it.
 *
 * An inline edit rather than a settings page: it is one field, it is the first thing a new player
 * wants to change, and sending them somewhere else to change it is how it never gets changed.
 */
/**
 * How big the sign is allowed to be, given how long the name on it is.
 *
 * The cap was 40 and every fixture used 21, so the standing bar was fitted to a plaque half the
 * width of a legal one: at the ceiling the sign pushed the meters and the avatar onto a second
 * line and 76px of header became 140px, which is 64px off the top of every screen under it.
 * `FACTION_NAME_MAX` is 28 now, which is what the row can carry, and the note there has the
 * measurements.
 *
 * The bands remain because 28 is the ceiling rather than the common case: a name in the mid
 * twenties still wants a step down from the size a short one is set at, and a long name set
 * smaller and whole is what a sign painter does with the same board and more letters to fit on
 * it. **Ellipsis is not an option**: a cut label is what the board's bar forbids outright and what
 * the layout gate reports as text sliced by a clipping edge (see the roster rail in
 * `TrainingPage`).
 */
function plaqueType(length: number): string {
  if (length <= 21) {
    return 'text-base tracking-[0.06em] [@media(min-width:1400px)]:text-lg [@media(min-width:1400px)]:tracking-[0.08em]';
  }
  return 'text-sm tracking-[0.05em] [@media(min-width:1400px)]:text-base';
}

export function FactionPlaque({ base }: { base: Base }) {
  const rename = useRenameFaction(base.id);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      // A plaque over the gate, not a heading on a page. It has to stay readable against lit
      // windows and wet ground, so it gets its own dark ground and a border of sodium light rather
      // than a text-shadow doing all the work. The rename control is an affordance on it: always
      // reachable by keyboard, but out of the picture until the plaque is pointed at.
      // **The whole plaque is the button.**
      //
      // The rename control used to be a pencil that appeared on hover, which fails the first rule of
      // an affordance: a control you cannot see is a control that does not exist. Nothing told a
      // player the name was theirs to change, and the one gesture that would have revealed it:
      // hovering a heading: is not a gesture anyone performs on a heading.
      //
      // Now the plaque looks pressable at rest (a raised edge, a pencil always visible, a pointer
      // cursor) and says what it does on hover and to assistive tech. Fitts's law does the rest: the
      // target went from a 16px glyph to the entire sign.
      <button
        type="button"
        onClick={() => setDraft(base.name)}
        data-tip={`${base.name} · rename`}
        aria-label={`${base.name}. Rename your faction`}
        className="group glass painted edge-lit pointer-events-auto flex items-center rounded-md border border-brass-500/50 px-2.5 py-1.5 shadow-panel transition-all duration-150 hover:-translate-y-px hover:border-brass-300/80 hover:shadow-brass active:translate-y-0"
      >
        {/* The one plaque on the screen, and at 18px a struck-ribbon letterform reads as a sign
            bolted to a wall, which is what this is. The dense 10-12px labels everywhere else are
            set in Roboto Condensed for legibility: see `fontStacks`.

            No pencil and no `Rename` caption beside it any more. The board's note: a sign with a
            verb printed on it is two things fighting for the same twelve characters, and the name
            is the thing worth reading. The affordance survives without them, because the plaque
            still lifts and lights on hover, still takes a pointer cursor, and still says what it
            does in its title and its accessible name. */}
        {/* A step down below 1400px. The plaque moved into the standing bar and it is the widest
            single thing on it, so at the width where the bar is already fighting for room the sign
            gets smaller rather than the row getting taller.

            And a ceiling on the width, which is the other half of the same rule. A name may be 40
            characters (`FACTION_NAME_MAX`), and the type steps down past 21 so a name at the
            ceiling still fits the standing bar whole. See `plaqueType`. */}
        <h1
          className={cn(
            'font-stamp font-bold leading-none text-ink-100 text-on-art',
            plaqueType(base.name.length),
          )}
        >
          {base.name}
        </h1>
      </button>
    );
  }

  return (
    <form
      className="pointer-events-auto mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim();
        if (name.length < 2) return;
        rename.mutate({ name }, { onSuccess: () => setDraft(null) });
      }}
    >
      <label className="sr-only" htmlFor="faction-name">
        Faction name
      </label>
      <input
        id="faction-name"
        value={draft}
        autoFocus
        maxLength={FACTION_NAME_MAX}
        onChange={(event) => setDraft(event.target.value)}
        className="min-w-0 flex-1 border border-brass-500/60 bg-surface-950 px-3 py-1.5 font-display text-lg tracking-[0.1em] text-ink-100 focus-visible:border-brass-300 focus-visible:outline-none"
      />
      <Button size="sm" type="submit" disabled={rename.isPending || draft.trim().length < 2}>
        {rename.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(null)}>
        Cancel
      </Button>
    </form>
  );
}
