import { z } from 'zod';
import { FeatProgressSchema } from './feats/feats.js';
import { FeatRewardSchema } from './feats/rewards.js';
import { IsoDateTimeSchema } from './primitives.js';

/**
 * What the feats screen puts on the wire (maintainer request, 2026-09-13).
 *
 * ## The catalogue does not travel
 *
 * The response carries **progress only**, one small row per feat: an id, a state, two numbers. The
 * names, the blurbs, the eras and the rewards are in `@frontline/shared` and the client already
 * has them, so sending a hundred and sixty descriptions on every poll would be sending the client
 * its own source code. The screen joins the two by id.
 *
 * That also decides what happens when the two drift. A client one deploy behind gets progress rows
 * for feats it has never heard of, and drops them; a client one deploy ahead draws a feat with no
 * progress row as untouched, which is what it is. Neither is an error worth showing anybody.
 */
export const FeatsResponseSchema = z.object({
  progress: z.array(FeatProgressSchema),
  /** Finished and waiting to be collected. The number in the red square on the bottom bar. */
  ready: z.number().int().nonnegative(),
  /** How many have been collected, ever, for the line at the top of the screen. */
  claimed: z.number().int().nonnegative(),
  serverNow: IsoDateTimeSchema,
});
export type FeatsResponse = z.infer<typeof FeatsResponseSchema>;

export const ClaimFeatRequestSchema = z.object({ featId: z.string().min(1) });
export type ClaimFeatRequest = z.infer<typeof ClaimFeatRequestSchema>;

/**
 * Why a claim was refused.
 *
 * All four are 409s carrying one of these rather than a sentence, because none of them is a
 * malformed request: the caller is who they say they are and the feat exists, the game is just not
 * in a state where it can be collected. Which door is shut is the useful half.
 */
export const FEAT_CLAIM_REFUSALS = [
  'unknown_feat',
  'not_finished',
  'locked',
  'already_claimed',
] as const;
export const FeatClaimRefusalSchema = z.enum(FEAT_CLAIM_REFUSALS);
export type FeatClaimRefusal = z.infer<typeof FeatClaimRefusalSchema>;

export const FEAT_CLAIM_REFUSAL_TEXT: Readonly<Record<FeatClaimRefusal, string>> = {
  unknown_feat: 'There is no such feat.',
  not_finished: 'That one is not finished yet.',
  locked: 'Finish the one before it first.',
  already_claimed: 'You have already collected that one.',
};

/**
 * What collecting one paid, and the refreshed screen.
 *
 * The reward is echoed back rather than left for the client to look up, because the screen draws
 * a receipt of what just arrived and the answer has to be what the *server* paid. The two agree
 * today; they would stop agreeing the first time a reward was retuned while somebody had the page
 * open, and the version that is right is the one that came out of the till.
 */
export const ClaimFeatResponseSchema = z.object({
  featId: z.string().min(1),
  paid: FeatRewardSchema,
  feats: FeatsResponseSchema,
});
export type ClaimFeatResponse = z.infer<typeof ClaimFeatResponseSchema>;

/**
 * Everything that was waiting, collected in one go.
 *
 * `featIds` rather than a count, so the screen can stamp exactly the rungs that moved rather than
 * re-reading the board and guessing which ones changed. Empty when there was nothing to collect,
 * which is a success and not a refusal: pressing a button that had nothing to do is not an error
 * worth interrupting anybody about.
 */
export const ClaimAllResponseSchema = z.object({
  featIds: z.array(z.string().min(1)),
  /** The whole backlog's reward, folded. See `mergeFeatRewards`. */
  paid: FeatRewardSchema.or(z.object({})),
  feats: FeatsResponseSchema,
});
export type ClaimAllResponse = z.infer<typeof ClaimAllResponseSchema>;
