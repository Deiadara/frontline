import { TUTORIAL_STEPS, type TutorialCardSpec } from '@frontline/shared';
import { Modal } from '../../components/ui/Modal';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { UnitPortrait } from '../units/UnitPortrait';

/**
 * One card of the opening tutorial (maintainer, 2026-09-22).
 *
 * The game's own voice, not a character's: the Combine card carries Directive Xero's portrait
 * because he is the face of what it describes, and nothing on it is in quotation marks. That was
 * the maintainer's call and it is the reason there is no speaker name, no "he says", and the same
 * treatment on all six cards whether or not one has a picture.
 *
 * **No close cross.** `Modal` is handed `dismissible={false}` on purpose. A cross lets a player
 * dismiss this card without deciding anything about the next five, and the maintainer asked for
 * the decision to be on the card: `Skip tutorial` stops all of them, `Got it` takes the next one.
 * Pressing the backdrop does nothing for the same reason.
 */
export function TutorialCard({
  card,
  remaining,
  onNext,
  onSkip,
  pending,
}: {
  card: TutorialCardSpec;
  /** How many cards, this one included, are still unseen. Drives the counter and the last label. */
  remaining: number;
  onNext: () => void;
  onSkip: () => void;
  pending: boolean;
}) {
  const last = remaining <= 1;
  return (
    <Modal
      onClose={onSkip}
      labelledBy="tutorial-card-title"
      size="wide"
      dismissible={false}
      className="border-brass-300/40"
      data-testid="tutorial-card"
    >
      <div className="flex min-h-0 flex-col" data-testid={`tutorial-card-${card.step}`}>
        <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-surface-600/60 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="tutorial-card-title"
              className="break-words font-stamp text-[clamp(20px,2.4vw,28px)] leading-tight text-ink-100"
            >
              {card.title}
            </h2>
            <span aria-hidden className="mt-1.5 block h-1.5 w-[min(18rem,50vw)] text-brass-300/70">
              <DrawnRule />
            </span>
          </div>
          {/*
           * Where you are in the set, which is the one thing a player wants to know before they
           * decide whether to read it: "1 of 6" is a promise that this ends.
           */}
          <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.18em] text-ink-400">
            {TUTORIAL_STEPS.length - remaining + 1} of {TUTORIAL_STEPS.length}
          </span>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5 sm:flex-row sm:gap-5">
          {card.portraitUnitId !== undefined && (
            /* Fixed column, so the text beside it has a predictable measure whether or not the
               art has been delivered: the portrait falls back to a silhouette, not to nothing. */
            <div className="w-full shrink-0 sm:w-[11rem]">
              <UnitPortrait
                unitId={card.portraitUnitId}
                tier="legendary"
                className="rivets edge-lit w-full border-2 border-brass-500/40"
              />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-2.5">
            <p className="font-display text-[13px] uppercase tracking-[0.12em] text-brass-300">
              {card.lede}
            </p>
            {card.body.map((paragraph) => (
              <p key={paragraph} className="font-body text-[14px] leading-relaxed text-ink-200">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        {/*
         * Skip on the left and go on the right, the way the overseer screen's pair reads: the way
         * out is red, the way on is green. Both are always enabled except while the write is in
         * flight, because a card that cannot be dismissed is a card that has trapped somebody.
         */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-surface-600/60 px-5 py-3">
          <DrawnButton
            size="sm"
            tone="danger"
            onClick={onSkip}
            disabled={pending}
            data-testid="tutorial-skip"
          >
            Skip tutorial
          </DrawnButton>
          <DrawnButton
            size="md"
            tone="go"
            onClick={onNext}
            disabled={pending}
            data-testid="tutorial-next"
          >
            {last ? 'Got it' : 'Next'}
          </DrawnButton>
        </footer>
      </div>
    </Modal>
  );
}
