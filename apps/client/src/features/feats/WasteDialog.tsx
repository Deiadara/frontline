import type { FeatSpec, FeatWaste } from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { RewardTally } from './RewardTally';

/**
 * Are you sure, with a figure on it (maintainer ruling, 2026-09-23).
 *
 * A feat reward is paid **up to the ceiling** and the difference is discarded, so a rung whose pay
 * will not fit asks before it goes through. This is the only door to that: the route refuses a
 * claim that would waste something unless it carries `acceptWaste`, so nothing can be burned
 * without this window having been answered.
 *
 * `Confirm` in the kit is the shape this follows, and it was nearly the component used. What it
 * cannot do is the middle of the window: its body is one string, and the thing a player has to
 * weigh here is a row of amounts against another row of amounts. Those are drawn with the board's
 * own tokens, so what is lost is recognisably the same objects as what the rung promised.
 *
 * The figure comes off the server's quote on the feats read and is never computed here. The
 * ceilings are the district's structures and the crew's Logistics folded together, and a screen
 * that guessed would be naming a number the till does not agree with.
 */
export function WasteDialog({
  spec,
  waste,
  pending,
  onConfirm,
  onCancel,
}: {
  spec: FeatSpec;
  waste: FeatWaste;
  /** The confirmed claim is on the wire. The window stays put and stops taking a second press. */
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} labelledBy="feat-waste-title" size="default">
      <div className="flex flex-col gap-3 p-5" data-testid="feat-waste">
        <h2 id="feat-waste-title" className="font-stamp text-xl text-ink-100">
          Some of that will not fit
        </h2>
        <span aria-hidden className="ink-rule h-1 w-full" />
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          <span className="text-ink-100">{spec.name}</span> pays more than the district can take.
          Collect it now and it is paid up to the ceiling; the rest is gone for good.
        </p>

        <div className="flex flex-col gap-1.5 rounded-sm border border-oxblood-300/50 bg-oxblood-500/10 px-3 py-2">
          <span className="font-stamp text-[13px] leading-none tracking-[0.06em] text-oxblood-100">
            Thrown away
          </span>
          <RewardTally reward={waste} lost data-testid="feat-waste-lost" />
        </div>

        <p className="font-body text-[12px] leading-relaxed text-ink-400">
          Leave it and it stays on the board. Build the room for it and it pays in full.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            data-testid="feat-waste-yes"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Taking it' : 'Collect it anyway'}
          </Button>
          <Button variant="ghost" data-testid="feat-waste-no" onClick={onCancel}>
            Never mind
          </Button>
        </div>
      </div>
    </Modal>
  );
}
