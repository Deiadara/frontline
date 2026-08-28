import { Icon } from './Icon';
import { cn } from '../../lib/cn';

/**
 * One step through a list you are reading one item of: the person before, the next area.
 *
 * A token somebody inked a ring around, not a chevron floating in a strip. It started as the Bar's
 * pair either side of a recruit's record and the mission board kept its own square metal version,
 * which meant two controls doing exactly the same job looked like two different affordances and,
 * worse, behaved like them: the Bar stopped at the ends of the roster and the board wrapped round
 * to the beginning. Wrapping is the version that loses a player, because there is no moment where
 * the control says you have seen everything, and a list of four looks infinite.
 *
 * So: **dead at the ends rather than wrapping**, and it has to *look* dead. An arrow that silently
 * does nothing is indistinguishable from one that is broken, so the ring, the fill and the glyph
 * all drop together and the cursor says no.
 */
export function StepArrow({
  direction,
  disabled,
  label,
  size = 'large',
  testId,
  onStep,
}: {
  direction: 'back' | 'on';
  disabled: boolean;
  /** What this step is, for anyone who cannot see it. The caller names its own list. */
  label: string;
  /**
   * How much room the token takes.
   *
   * `large` is the pair standing either side of a card that is the whole screen. `small` is the
   * pair in a header line, where a 56px token would set the height of the row it is in.
   */
  size?: 'small' | 'large';
  testId?: string;
  onStep: () => void;
}) {
  const large = size === 'large';
  return (
    <button
      type="button"
      onClick={onStep}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={cn(
        'group relative flex shrink-0 items-center justify-center self-center rounded-full transition-all duration-150',
        large ? 'h-12 w-12 sm:h-14 sm:w-14' : 'h-10 w-10',
        disabled
          ? 'cursor-not-allowed opacity-25'
          : cn(
              'text-brass-100',
              direction === 'back' ? 'hover:-translate-x-0.5' : 'hover:translate-x-0.5',
            ),
      )}
    >
      {/* Lamp-light under the token, so it sits on the counter rather than on the page. */}
      <span
        aria-hidden
        className="absolute inset-1 rounded-full bg-surface-950/75 shadow-panel transition-colors duration-150 group-enabled:group-hover:bg-brass-300/15"
      />
      <span aria-hidden className="ink-disc absolute inset-0" />
      <Icon
        name="chevron-down"
        aria-hidden
        className={cn(
          'relative',
          large ? 'h-6 w-6' : 'h-5 w-5',
          direction === 'back' ? 'rotate-90' : '-rotate-90',
          disabled && 'text-ink-300',
        )}
      />
    </button>
  );
}
