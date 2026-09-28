import type { PartialResources } from '@frontline/shared';
import { create } from 'zustand';

/**
 * The one open "this would go to waste" question (maintainer ruling, 2026-09-28).
 *
 * The server refuses a credit that would overflow the stores with `WOULD_WASTE` and the figure,
 * and `lib/api.ts` asks the player here before sending the request again with their yes. A store
 * rather than a prop because the question comes out of the fetch layer, which no screen owns: the
 * Broker, the offers board and six cancel buttons all reach it the same way, and one dialog mounted
 * at the root (`WasteConfirmLayer`) answers for all of them.
 */
export interface WasteQuestion {
  /** What the request would throw away. */
  waste: PartialResources;
  answer: (yes: boolean) => void;
}

export const useWasteConfirm = create<{ question: WasteQuestion | null }>(() => ({
  question: null,
}));

/**
 * Puts the question to the player and resolves with their answer.
 *
 * A second question arriving while one is open declines the first: two dialogs stacked on each
 * other would leave the one underneath answering for a request the player cannot see.
 */
export function askToWaste(waste: PartialResources): Promise<boolean> {
  useWasteConfirm.getState().question?.answer(false);
  return new Promise((resolve) => {
    useWasteConfirm.setState({
      question: {
        waste,
        answer: (yes) => {
          useWasteConfirm.setState({ question: null });
          resolve(yes);
        },
      },
    });
  });
}
