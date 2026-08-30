import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Are you sure, drawn.
 *
 * Destructive and one-way controls go through this rather than firing on click. Leaving a faction
 * as its leader disbands it for four other people, and joining one is a door that only opens the
 * other way by leaving; neither is a thing to do to somebody because their cursor was in the wrong
 * place.
 *
 * In the kit rather than on the faction screen, because the mailbox's invitation card needs the
 * same dialog and a feature importing a dialog out of another feature is how two of them end up
 * with different ideas of what "are you sure" looks like.
 */
export function Confirm({
  title,
  body,
  confirm,
  testId,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  testId: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} labelledBy={`${testId}-title`} size="default">
      <div className="flex flex-col gap-3 p-5" data-testid={testId}>
        <h2 id={`${testId}-title`} className="font-stamp text-xl text-ink-100">
          {title}
        </h2>
        <span aria-hidden className="ink-rule h-1 w-full" />
        <p className="font-body text-[13px] leading-relaxed text-ink-300">{body}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" data-testid={`${testId}-yes`} onClick={onConfirm}>
            {confirm}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Never mind
          </Button>
        </div>
      </div>
    </Modal>
  );
}
