import { cn } from '../../lib/cn';
import { DrawnFace } from '../../components/ui/DrawnMarks';

/**
 * CLAIM: the one control on the feats screen, drawn rather than pressed out of metal.
 *
 * The kit already has two buttons and neither is right here. `Button` is a struck brass plate, the
 * machine affordance a Train or a Buy wants; `InkButton` is the drawn box, but it is a `Link` and
 * this commits a write. So this is the third: the ink box's own grammar (a rectangle gone round
 * one and a bit times, overshooting the corner it started at) on a real `<button>`, with the face
 * behind it filled so that it is unmistakably the thing to hit on a card of six.
 *
 * The drawing itself is {@link DrawnFace}, shared with the board's filter chips since they were
 * asked for in the same hand (maintainer, 2026-09-17). What stays here is the behaviour: the label
 * that changes under a press, the disabled state while a write is on the wire, and the sound.
 *
 * Pressing it is animated on the *face*, not on the frame: the whole button drops a pixel and the
 * fill dims, which reads as paper being pushed rather than as a border changing colour.
 */
export function ClaimButton({
  onClick,
  pending = false,
  label = 'CLAIM',
  ariaLabel = 'Claim this feat',
  className,
  'data-testid': testId,
}: {
  onClick: () => void;
  /** The claim is in flight. The button stays in place and stops taking a second press. */
  pending?: boolean;
  label?: string;
  /**
   * What a screen reader says, which is not always the four letters on the face.
   *
   * `CLAIM` alone is meaningless read aloud out of the row it sits in, so the default spells out
   * what is being claimed. It is a prop rather than a constant because this button is also the
   * collect-everything door at the head of the board, and two buttons on one screen announcing
   * themselves identically is the exact confusion the label exists to prevent.
   */
  ariaLabel?: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      // `confirm`, the sound every press that banks or spends makes. Read by the delegated
      // listener in `lib/sound.ts`, the same way `Button` declares its own.
      data-sound="confirm"
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn(
        'group/claim relative inline-flex shrink-0 items-center justify-center',
        'px-3.5 py-[8.7px] font-stamp text-[15px] leading-none tracking-[0.08em]',
        'text-brass-100 transition-all duration-150 ease-out',
        'hover:-translate-y-px hover:text-ink-100 active:translate-y-px',
        'disabled:cursor-progress disabled:opacity-60 disabled:hover:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300',
        className,
      )}
    >
      <DrawnFace face="fill-brass-500/25 transition-all duration-150 group-hover/claim:fill-brass-500/40 group-active/claim:fill-brass-500/15" />
      <span className="relative">{pending ? 'TAKING' : label}</span>
    </button>
  );
}
