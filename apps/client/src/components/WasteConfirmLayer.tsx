import { wasteWarning } from '@frontline/shared';
import { useWasteConfirm } from '../store/wasteConfirm';
import { Confirm } from './ui/Confirm';

/**
 * The warning before anything is thrown away (maintainer ruling, 2026-09-28): "whenever you do
 * something that would push you to waste it has a warning first".
 *
 * Mounted once at the root, like the tooltip layer, and drawn only while `askToWaste` has a
 * question open. The sentence is the server's own (`wasteWarning`), so the figure the dialog names
 * is the figure the till would discard.
 */
export function WasteConfirmLayer() {
  const question = useWasteConfirm((state) => state.question);
  if (question === null) return null;
  return (
    <Confirm
      title="Your stores are full"
      body={`${wasteWarning(question.waste)}. Go ahead?`}
      confirm="Go ahead"
      testId="waste-confirm"
      onConfirm={() => question.answer(true)}
      onCancel={() => question.answer(false)}
    />
  );
}
