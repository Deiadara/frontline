import { FEAT_CLAIM_REFUSAL_TEXT } from '@frontline/shared';

/**
 * Why a claim was turned down, in the player's language rather than as a code.
 *
 * The route answers every refusal as a 409 whose message is one of four words
 * (`FeatClaimRefusal`), so the screen looks the sentence up rather than writing four of its own.
 * Anything else that reaches here is already a sentence the server wrote, and is passed through:
 * the same shape `features/faction/refusal.ts` has, for the same reason.
 */
export function featRefusalText(message: string): string {
  return (FEAT_CLAIM_REFUSAL_TEXT as Record<string, string>)[message] ?? message;
}
