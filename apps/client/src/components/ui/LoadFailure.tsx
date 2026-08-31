import { Button } from './Button';

/**
 * A screen saying it could not load, with a way to try again.
 *
 * Exists because of a bug that hid for months. `GET /battles` was answering 500 for one account,
 * and the page drew every state that was not data as "Reading the board...": a server error looked
 * exactly like a slow network, and looked like it forever. Nobody could tell the difference, so
 * nobody reported it as broken.
 *
 * Every screen behind the nav had the same shape, and three of them were worse: they returned
 * `null` on a failed read, so a 500 rendered a blank sheet with no text on it at all.
 *
 * The rule this component exists to enforce: **a screen that cannot load must say so.** A spinner
 * that never resolves is the one failure a player cannot act on, cannot describe, and will not
 * report. Retry rather than a page reload, because the rest of the session is fine: one query
 * failed, and asking for it again is the whole remedy.
 */
export function LoadFailure({
  what,
  onRetry,
  detail,
}: {
  /** What would not load, as a noun the reader recognises: "the standings", "your mail". */
  what: string;
  onRetry: () => void;
  /** One line of reassurance where the failure has a consequence worth ruling out. */
  detail?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 p-6" data-testid="load-failure">
      <p className="font-body text-[14px] leading-relaxed text-oxblood-300">
        {what} would not load.
      </p>
      <p className="max-w-prose font-body text-[13px] leading-relaxed text-ink-300">
        {detail ?? 'Whatever went wrong is on our side, not yours. Nothing has been lost.'}
      </p>
      <Button size="sm" onClick={onRetry} data-testid="load-retry">
        Try again
      </Button>
    </div>
  );
}
