import { DISTRICT_NAME_MAX, type Base } from '@frontline/shared';
import { useState } from 'react';
import { ApiRequestError } from '../lib/api';
import { useRenameDistrict } from '../lib/queries';
import { Button } from './ui/Button';
import { cn } from './../lib/cn';

/**
 * The sign in the middle of the standing bar: the crew's own name, and nothing else.
 *
 * It moved here from the far left, and the move is the point. The bar is three groups now: what
 * you have on the left, what you have earned on the right, and this between them, dead centre,
 * because the one label on the screen the player chose themselves should not be tucked into a
 * corner beside the caps counter.
 *
 * It carried the district's name as well for a while, on the reasoning that a sign says where you
 * are. It does not any more: the district is one place a crew holds, the plaque is the crew, and
 * two names on one plate made the smaller of them read as a subtitle of the larger.
 *
 * **The whole plaque is the rename control**, as it always was. No pencil and no `Rename` caption:
 * a sign with a verb printed on it is two things fighting for the same twelve characters. The
 * affordance is that it lifts and lights on hover, takes a pointer cursor, and says what it does
 * in its tooltip and its accessible name.
 *
 * The brackets are drawn rather than implied by a border. Four corner rules and a lit line under
 * the name are what make this read as a *plate bolted to a wall* against a painting behind it,
 * which is the job: it has to survive over lit windows and wet ground.
 */

/**
 * How big the name is allowed to be, given how long it is.
 *
 * `DISTRICT_NAME_MAX` is 28 and every fixture uses about 20, so a name at the ceiling set at the
 * short name's size pushes the standing bar onto a second line, which costs the world underneath
 * it fifty pixels. **Ellipsis is not an option**: a cut label is what the board's bar forbids
 * outright. See the note on `DISTRICT_NAME_MAX`.
 *
 * Three rungs rather than two. The ceiling itself stays at 28 and is not negotiable from here:
 * `BaseSchema.name` is this same schema, so lowering the maximum would stop an existing 23 to 28
 * character name from parsing at all and take those accounts down with it. The width has to come
 * out of the type instead.
 */
function plaqueType(length: number): string {
  if (length <= 16) return 'tracking-[0.06em] text-base [@media(min-width:1500px)]:text-lg';
  if (length <= 22) return 'tracking-[0.06em] text-sm [@media(min-width:1500px)]:text-base';
  // The last rung, for names in the top six characters of the range. The bar has to hold six
  // stockpiles, two meters, five doors and this at once, and a 28-character name set at the
  // 22-character size is what put the stockpile through the plaque in the board's screenshot.
  //
  // The tracking goes with the size. A plaque is letter-spaced because it is a sign, but at 28
  // characters that spacing is 28 gaps: about 47px of pure air, which is more than the whole
  // margin the bar has left at the width the break is measured against. A long name closes up.
  return 'text-xs tracking-normal [@media(min-width:1500px)]:text-sm';
}

export function DistrictPlaque({ base }: { base: Base }) {
  const rename = useRenameDistrict(base.id);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(base.name)}
        data-testid="district-plaque"
        data-tip={`${base.name} · rename`}
        aria-label={`${base.name}. Rename your district`}
        className={cn(
          'group glass painted edge-lit pointer-events-auto relative flex shrink-0 flex-col items-center',
          'justify-center rounded-md border-2 border-brass-500/60 px-4 py-1.5 shadow-panel',
          'transition-all duration-150 hover:-translate-y-px hover:border-brass-300 hover:shadow-brass',
          'active:translate-y-0',
        )}
      >
        {/* The four corner rules. Drawn, because a plate is a plate by its corners: a plain border
            reads as a box around text and this has to read as something bolted to a wall.
            
            `!absolute`, and it has to be. `.painted > *` sets `position: relative` on every direct
            child (it is what lifts content above the soft-light texture layer), and a child
            combinator outranks a plain class however the utilities are ordered. Without the
            important flag these four sat in the flex flow and stacked into an I-beam at the top of
            the sign. */}
        {(
          [
            'left-1 top-1 border-l-2 border-t-2',
            'right-1 top-1 border-r-2 border-t-2',
            'left-1 bottom-1 border-b-2 border-l-2',
            'right-1 bottom-1 border-b-2 border-r-2',
          ] as const
        ).map((corner) => (
          <span
            key={corner}
            aria-hidden
            className={cn(
              '!absolute h-2.5 w-2.5 border-brass-300/70 transition-colors group-hover:border-brass-100',
              corner,
            )}
          />
        ))}

        <span
          className={cn(
            'font-stamp font-bold leading-none text-brass-100 text-on-art',
            plaqueType(base.name.length),
          )}
        >
          {base.name}
        </span>

        {/* The lit rule under the name. Decoration, and the load-bearing kind: a name floating
            inside four brackets reads as a label in a box, and a rule under it reads as a sign.
            
            Taken out of the flow (`!absolute`, because `.painted > *` forces `relative` on a direct
            child) so the name is the only thing being centred. In the flow it and its margin sat
            below the letters, which pushed the name up and left visibly more air under it than
            over it. */}
        <span
          aria-hidden
          className="!absolute bottom-1.5 left-1/2 h-px w-1/2 -translate-x-1/2 bg-gradient-to-r from-transparent via-brass-300/70 to-transparent transition-colors group-hover:via-brass-100"
        />
      </button>
    );
  }

  return (
    <form
      className="pointer-events-auto relative flex shrink-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim();
        if (name.length < 2) return;
        rename.mutate({ name }, { onSuccess: () => setDraft(null) });
      }}
    >
      {/*
       * Why it was refused, and it has to be said somewhere.
       *
       * A crew name has to be unique in the city and may not be one of the plot numbers the map
       * draws, so this form has a failing path now. Without a message the button simply did
       * nothing and the field stayed open, which reads as a broken save rather than a taken name.
       *
       * Absolutely positioned so a refusal does not resize the HUD the plaque sits in: the whole
       * standing bar would jump the moment somebody picked a name that was gone.
       */}
      {rename.error !== null && (
        <p
          role="alert"
          data-testid="district-name-error"
          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-sm border border-oxblood-500/60 bg-surface-950/95 px-2 py-1 font-body text-[12px] leading-none text-oxblood-300"
        >
          {rename.error instanceof ApiRequestError ? rename.error.message : 'That did not save'}
        </p>
      )}
      <label className="sr-only" htmlFor="district-name">
        District name
      </label>
      <input
        id="district-name"
        value={draft}
        autoFocus
        maxLength={DISTRICT_NAME_MAX}
        onChange={(event) => {
          rename.reset();
          setDraft(event.target.value);
        }}
        className="min-w-0 border border-brass-500/60 bg-surface-950 px-3 py-1.5 font-display text-base tracking-[0.1em] text-ink-100 focus-visible:border-brass-300 focus-visible:outline-none"
      />
      <Button size="sm" type="submit" disabled={rename.isPending || draft.trim().length < 2}>
        {rename.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        type="button"
        onClick={() => {
          // The refusal belongs to the attempt, not to the plaque: leaving it in the
          // mutation reopened the form with "That name is taken" already under a field
          // holding the name the crew is currently using. `onChange` already resets it,
          // which is why the first keystroke used to clear it.
          rename.reset();
          setDraft(null);
        }}
      >
        Cancel
      </Button>
    </form>
  );
}
