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
 * has them, so sending two hundred descriptions on every poll would be sending the client
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
 * All five are 409s carrying one of these rather than a sentence, because none of them is a
 * malformed request: the caller is who they say they are and the feat exists, the game is just not
 * in a state where it can be collected. Which door is shut is the useful half.
 *
 * `no_unit_slots` is the only one a player can clear by playing rather than by waiting. A feat
 * that pays units cannot be collected into a district with nowhere to put them (§A1), for the
 * same reason the Gauntlet will not take the order: the crew would be over its ceiling and the
 * roster would be a number the screen cannot explain. The feat stays **ready**, so being told to
 * make room costs nothing but the trip.
 */
export const FEAT_CLAIM_REFUSALS = [
  'unknown_feat',
  'not_finished',
  'locked',
  'already_claimed',
  'no_unit_slots',
] as const;
export const FeatClaimRefusalSchema = z.enum(FEAT_CLAIM_REFUSALS);
export type FeatClaimRefusal = z.infer<typeof FeatClaimRefusalSchema>;

export const FEAT_CLAIM_REFUSAL_TEXT: Readonly<Record<FeatClaimRefusal, string>> = {
  unknown_feat: 'There is no such feat.',
  not_finished: 'That one is not finished yet.',
  locked: 'Finish the one before it first.',
  already_claimed: 'You have already collected that one.',
  no_unit_slots:
    'Your district has nowhere to put the units that one pays. Make room and come back for it.',
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
  /**
   * Feats that were waiting and were **not** collected, because the district has nowhere to put
   * the units they pay (§A1).
   *
   * Sent because without it the button is a dead control: the backlog does not empty, the count on
   * its face does not move, and pressing it again pays nothing and says nothing. The screen needs
   * to be able to say *why* one is still red, and only the server knows what the beds are doing.
   *
   * Defaulted, so a client reading a response from a build that predates the cap sees an empty
   * list rather than a parse error.
   */
  skipped: z.array(z.string().min(1)).default([]),
  /** The whole backlog's reward, folded. See `mergeFeatRewards`. */
  paid: FeatRewardSchema.or(z.object({})),
  feats: FeatsResponseSchema,
});
export type ClaimAllResponse = z.infer<typeof ClaimAllResponseSchema>;
