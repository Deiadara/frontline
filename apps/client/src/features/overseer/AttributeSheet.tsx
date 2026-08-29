import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_LABELS,
  IMPORTANCE_LABELS,
  MAX_ATTRIBUTE,
  importanceOf,
  type AttributeGroup,
  type AttributeImportance,
  type AttributeName,
  type Attributes,
  type OfficerRole,
} from '@frontline/shared';
import { cn } from '../../lib/cn';
import { IMPORTANCE_EDGE } from '../../lib/importance';
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
function AttributeRow({
  name,
  value,
  bar,
  roomy,
  importance,
}: {
  name: AttributeName;
  value: number;
  bar: boolean;
  roomy: boolean;
  /** How much the chair this person sits in cares. `null` where there is no chair. */
  importance: AttributeImportance | null;
}) {
  const band = ratingBand(value);
  const share = Math.max(0, Math.min(1, value / MAX_ATTRIBUTE));
  return (
    // Without the bar this is the row the thumbnail always had, to the pixel: a 4px gap and a
    // figure that takes only the width its digits need. The bar version can afford 8px and a
    // fixed 24px column because it is only ever drawn where there is room for it; spending the
    // same here truncated `Communication` in a 122px column, which the layout gate reads as a cut
    // label and the board's bar forbids.
    <li
      data-testid={importance === null ? undefined : `attr-${name}`}
      data-importance={importance ?? undefined}
      title={importance === null ? undefined : IMPORTANCE_LABELS[importance]}
      className={cn(
        'flex items-center',
        bar ? 'gap-2' : 'gap-1',
        // Every other row on a wash of its own. Eleven rows of word-bar-number with nothing
        // between them is a block of texture, and the eye loses its place crossing it; a tint
        // that costs no height puts the line back under the finger.
        roomy && 'rounded-[2px] px-1.5 py-1 odd:bg-ink-100/[0.045]',
        // The edge is drawn even for `insignificant` (transparent), so every row in the column is
        // inset by the same two pixels and the marked ones do not appear to jut out.
        importance !== null && cn('pl-1.5', IMPORTANCE_EDGE[importance]),
      )}
    >
      {/* Named from the shared table, not title-cased here: two of the attributes are not what a
          naive capitalise produces, and a sheet spelled differently on two screens is the kind of
          thing nobody reports and everybody sees. */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-body leading-[1.15] text-ink-200',
          roomy ? 'text-[13.5px]' : 'text-[12px]',
        )}
      >
        {ATTRIBUTE_LABELS[name]}
      </span>
      {/* A fixed, short track rather than one that stretches to the column's width. Stretched, a
          15 out of 100 is a stub at the left end of a long empty rail and the *track* becomes the
          biggest mark on the row: the eye reads the gap, not the value. Short, and hard against
          the figure, so the bar and the number are one reading rather than two. */}
      {bar && (
        <span
          className={cn(
            'relative shrink-0 overflow-hidden rounded-full bg-black/35',
            roomy ? 'h-2 w-14' : 'h-1.5 w-12',
          )}
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
          'shrink-0 text-right font-display font-bold leading-[1.15] tabular-nums',
          roomy ? 'text-[14px]' : 'text-[12px]',
          bar && (roomy ? 'w-7' : 'w-6'),
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
  roomy = false,
  role = null,
}: {
  attributes: Attributes;
  /**
   * How many groups sit side by side.
   *
   * 4 only where the sheet has a full-width *page* panel to itself: the switch is a viewport media
   * query, so inside a modal it lays out four columns in whatever width the modal has, which cuts
   * `Communication`. 3 is the modal size: eleven rows a column, and the label, bar and figure stay
   * within a hand's width of each other. 2 is the default and safe anywhere.
   */
  columns?: 2 | 3 | 4;
  /**
   * Off where the sheet is a *thumbnail* rather than the thing being read.
   *
   * The bar costs about 50px of row, which is what a column needs to hold `Communication` whole
   * beside it. In a 488px character-select card four groups leave 122px each: enough for the word
   * and the figure, which is what that card showed before, and not enough for a bar as well. The
   * choice there is the bar or a cut label, and a cut label is the one the board's bar forbids.
   */
  bars?: boolean;
  /**
   * The sheet **is** the screen, rather than one panel on it.
   *
   * Bigger type, each group inside its own frame, and a tint on alternate rows. The Bar's seat
   * screen is what it exists for: a player reading one person's whole record to decide whether to
   * spend the night's single signature on them. At 12px with no frames the four groups ran
   * together into one field of thirty-four numbers, which is the shape you skim rather than read.
   * Every other placement keeps the compact sheet, where the attributes are reference beside
   * something else and the frames would be four boxes competing with the panel around them.
   */
  roomy?: boolean;
  /**
   * The chair this person is sitting in, when they are in one.
   *
   * Given, every row is edged by how much that chair cares about the skill; omitted, the sheet is
   * drawn plain. Omitted is right for the Overseer, who is in no seat, and for a recruit at the Bar
   * before anybody has decided what to hire them as: colouring a candidate's rows against a role
   * they have not been offered would be answering the question the Bar is asking.
   */
  role?: OfficerRole | null;
}) {
  return (
    <div
      className={cn(
        'grid',
        roomy && 'items-stretch',
        // The thumbnail keeps the geometry it shipped with, to the pixel: `gap-x-3` across four
        // columns is 24px more for the words than `gap-x-5`, and at ~120px a column that is the
        // difference between `Communication` and a cut label.
        bars ? 'gap-x-5 gap-y-3' : 'gap-x-3',
        columns === 4
          ? 'sm:grid-cols-2 [@media(min-width:1100px)]:grid-cols-4'
          : columns === 3
            ? 'sm:grid-cols-2 md:grid-cols-3'
            : 'sm:grid-cols-2',
      )}
      data-testid="attribute-sheet"
    >
      {ATTRIBUTE_GROUPS.map((group) => (
        <section
          key={group}
          className={cn(
            'min-w-0',
            // A frame each, all four the same height, so the row reads as four panels rather than
            // as one grid that happens to have gaps in it. `items-stretch` on the grid does the
            // equalising; without the frame there is nothing to see it on.
            roomy &&
              'edge-lit flex flex-col rounded-sm border border-surface-600/70 bg-black/20 p-2',
          )}
        >
          <h3
            className={cn(
              'truncate border-b border-surface-600/80 font-display font-bold uppercase tracking-[0.18em] text-brass-300',
              bars ? 'mb-1.5 pb-1' : 'mb-0.5 pb-0.5 text-[8px]',
              bars && (roomy ? 'text-[11px]' : 'text-[10px]'),
            )}
          >
            {GROUP_LABELS[group]}
          </h3>
          <ul className={cn('flex flex-col', bars && !roomy && 'gap-1')}>
            {ATTRIBUTES_BY_GROUP[group].map((name) => (
              <AttributeRow
                key={name}
                name={name}
                value={attributes[name]}
                bar={bars}
                roomy={roomy}
                importance={role === null ? null : importanceOf(role, name)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
