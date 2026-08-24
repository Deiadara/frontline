import { cn } from '../../lib/cn';

/**
 * A line that is not information.
 *
 * Missions opens with "The first death is in the heart. Get out there and show you are still
 * alive." — and it was set at 12px in the same grey as a form's help text, indistinguishable from
 * the sentence next to it explaining travel times. A line of poetry rendered as a hint is not a
 * line of poetry; it is noise the eye has already learned to skip.
 *
 * So it is drawn as a quotation. Handwriting, at a size the stroke can be seen at, inside a real
 * opening mark set large and dropped behind the words. The em-dash attribution is optional and
 * usually absent — most of these are the city talking, not a person.
 *
 * Deliberately not a `<blockquote>` with a border on the left. That is the shape a documentation
 * site uses, and it would put this back in the same visual family as the help text it is trying to
 * stop looking like.
 */
export function Quote({
  children,
  attribution,
  className,
}: {
  children: string;
  /** Who said it, if anybody did. Set smaller, in the stamped face, under the line. */
  attribution?: string;
  className?: string;
}) {
  return (
    <figure className={cn('min-w-0', className)}>
      <blockquote>
        {/*
         * Both marks are set inline rather than dropped behind the words on a pseudo-element.
         * A large decorative mark positioned outside the flow is the prettier idea and the wrong
         * one here: these sit at the top of a scrolling sheet, directly under a pinned header, and
         * an absolutely-positioned glyph reaching up out of its box collides with the rule above it
         * and reads as a rendering fault. Inline, it cannot overlap anything, and it is still a
         * quotation mark three times the size of the words it opens.
         */}
        <p className="font-hand text-[26px] italic leading-[1.3] text-brass-100">
          <span
            aria-hidden
            className="mr-0.5 align-[-0.18em] text-[44px] not-italic leading-none text-brass-300/60"
          >
            “
          </span>
          {children}
          <span
            aria-hidden
            className="ml-0.5 align-[-0.3em] text-[44px] not-italic leading-none text-brass-300/60"
          >
            ”
          </span>
        </p>
      </blockquote>
      {attribution !== undefined && (
        <figcaption className="mt-1 font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
          — {attribution}
        </figcaption>
      )}
    </figure>
  );
}
