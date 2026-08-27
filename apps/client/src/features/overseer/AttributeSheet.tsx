import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_LABELS,
  MAX_ATTRIBUTE,
  type AttributeGroup,
  type AttributeName,
  type Attributes,
} from '@frontline/shared';
import { cn } from '../../lib/cn';
import { RATING_FILL, RATING_TEXT, ratingBand } from '../../lib/rating';

const GROUP_LABELS: Record<AttributeGroup, string> = {
  physical: 'Physical',
  mental: 'Mental',
  social: 'Social',
  technical: 'Technical',
};

/**
 * One attribute: the word, a bar, and the figure.
 *
 * The bar is the whole change. A column of `Strength 27 / Stamina 15 / Dexterity 15` is a table of
 * numbers a player has to read one at a time and hold in their head to compare, and four of those
 * side by side is the flattest thing in the game. A length is comparable at a glance: which of
 * these is this character actually good at is answered by the shape of the column before any
 * number is read.
 *
 * The figure stays, because "good at this" and "27" are different questions and the sheet is asked
 * both. Scaled against `MAX_ATTRIBUTE` rather than against the sheet's own best, so two characters
 * put side by side are drawn on the same axis: normalising per sheet would make a weak character's
 * best attribute look like an elite one.
 */
function AttributeRow({ name, value, bar }: { name: AttributeName; value: number; bar: boolean }) {
  const band = ratingBand(value);
  const share = Math.max(0, Math.min(1, value / MAX_ATTRIBUTE));
  return (
    // Without the bar this is the row the thumbnail always had, to the pixel: a 4px gap and a
    // figure that takes only the width its digits need. The bar version can afford 8px and a
    // fixed 24px column because it is only ever drawn where there is room for it; spending the
    // same here truncated `Communication` in a 122px column, which the layout gate reads as a cut
    // label and the board's bar forbids.
    <li className={cn('flex items-center', bar ? 'gap-2' : 'gap-1')}>
      {/* Named from the shared table, not title-cased here: two of the attributes are not what a
          naive capitalise produces, and a sheet spelled differently on two screens is the kind of
          thing nobody reports and everybody sees. */}
      <span className="min-w-0 flex-1 truncate font-body text-[12px] leading-[1.15] text-ink-200">
        {ATTRIBUTE_LABELS[name]}
      </span>
      {/* A fixed, short track rather than one that stretches to the column's width. Stretched, a
          15 out of 100 is a stub at the left end of a long empty rail and the *track* becomes the
          biggest mark on the row: the eye reads the gap, not the value. Short, and hard against
          the figure, so the bar and the number are one reading rather than two. */}
      {bar && (
        <span
          className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-black/35"
          aria-hidden
        >
          <span
            className={cn('block h-full rounded-full opacity-90', RATING_FILL[band])}
            style={{ width: `${share * 100}%` }}
          />
        </span>
      )}
      <span
        className={cn(
          'shrink-0 text-right font-display text-[12px] font-bold leading-[1.15] tabular-nums',
          bar && 'w-6',
          RATING_TEXT[band],
        )}
      >
        {value}
      </span>
    </li>
  );
}

/**
 * The full sheet, Football-Manager style: every attribute the character has, in its group
 * (GDD §B4a). Every human carries every attribute (§B6), so nothing here is filtered by role,
 * and nothing here hints at which role the character would suit (§B8).
 *
 * Four groups across where there is room, two where there is not. Four was already the shape; what
 * made it unreadable was the *row*, which put the label at one end of the column and its own
 * number at the other with nothing in between, so a wide column read as two unrelated lists, one
 * of words and one of figures. With the bar holding the two together the group is about 180px
 * wide and four of them fit without stretching anything.
 *
 * **The caller says how many**, because the constraint is the width of the box this is dropped
 * into rather than the width of the window. A media query got this wrong in the obvious way: the
 * Bar's recruit cards are two to a row on a wide screen, so at 1440 they took the four-column
 * branch inside a 590px card and truncated every label to `Stren…`, which is a cut label and the
 * one thing the board's bar forbids outright.
 */
export function AttributeSheet({
  attributes,
  columns = 2,
  bars = true,
}: {
  attributes: Attributes;
  /** 4 only where the sheet has a full-width panel to itself. Anything narrower wants 2. */
  columns?: 2 | 4;
  /**
   * Off where the sheet is a *thumbnail* rather than the thing being read.
   *
   * The bar costs about 50px of row, which is what a column needs to hold `Communication` whole
   * beside it. In a 488px character-select card four groups leave 122px each: enough for the word
   * and the figure, which is what that card showed before, and not enough for a bar as well. The
   * choice there is the bar or a cut label, and a cut label is the one the board's bar forbids.
   */
  bars?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid',
        // The thumbnail keeps the geometry it shipped with, to the pixel: `gap-x-3` across four
        // columns is 24px more for the words than `gap-x-5`, and at ~120px a column that is the
        // difference between `Communication` and a cut label.
        bars ? 'gap-x-5 gap-y-3' : 'gap-x-3',
        columns === 4 ? 'sm:grid-cols-2 [@media(min-width:1100px)]:grid-cols-4' : 'sm:grid-cols-2',
      )}
      data-testid="attribute-sheet"
    >
      {ATTRIBUTE_GROUPS.map((group) => (
        <section key={group} className="min-w-0">
          <h3
            className={cn(
              'truncate border-b border-surface-600/80 font-display font-bold uppercase tracking-[0.18em] text-brass-300',
              bars ? 'mb-1.5 pb-1 text-[10px]' : 'mb-0.5 pb-0.5 text-[8px]',
            )}
          >
            {GROUP_LABELS[group]}
          </h3>
          <ul className={cn('flex flex-col', bars && 'gap-1')}>
            {ATTRIBUTES_BY_GROUP[group].map((name) => (
              <AttributeRow key={name} name={name} value={attributes[name]} bar={bars} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
