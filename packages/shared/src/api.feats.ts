import { z } from 'zod';
import { FeatProgressSchema } from './feats/feats.js';
import { FeatRewardSchema } from './feats/rewards.js';
import { FeatWasteSchema } from './feats/waste.js';
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
  /**
   * What collecting a **ready** rung right now would throw away, by feat id (maintainer ruling,
   * 2026-09-23). Only the rungs that would lose something appear; an empty map is the usual case.
   *
   * ## Why the quote rides on this read rather than on a preview endpoint
   *
   * The alternative was `POST /feats/claim/preview`, and it loses twice. It is a second round trip
   * on a button press, and it is a write-shaped request that writes nothing, so the account's write
   * limiter (120 a minute) would count every player who reads a warning and declines it. This read
   * is already refetched on almost every nudge the live channel sends, so a quote carried on it is
   * as fresh as the progress rows beside it and costs nothing extra.
   *
   * The quote is a snapshot, not a promise. Production settles between a read and a press, so the
   * claim route recomputes the split against the state it writes against and answers with what it
   * actually discarded. This is what the dialog is drawn from; that is what the receipt says.
   *
   * Computed server-side and never on the client: the ceilings come off the district's buildings
   * and the crew's Logistics, and a client that guessed would be quoting a figure the till does
   * not agree with.
   */
  waste: z.record(z.string(), FeatWasteSchema).default({}),
  /** Finished and waiting to be collected. The number in the red square on the bottom bar. */
  ready: z.number().int().nonnegative(),
  /** How many have been collected, ever, for the line at the top of the screen. */
  claimed: z.number().int().nonnegative(),
  serverNow: IsoDateTimeSchema,
});
export type FeatsResponse = z.infer<typeof FeatsResponseSchema>;

export const ClaimFeatRequestSchema = z.object({
  featId: z.string().min(1),
  /**
   * The player has seen what would be wasted and said go ahead.
   *
   * Absent or false, a claim that would overflow a store or the beds is refused with
   * `would_waste` and nothing is paid or marked collected. The confirmation has to reach the
   * server because the discard happens here: a route that clamped silently would burn a reward
   * for anybody on a client that had never heard of the dialog.
   */
  acceptWaste: z.boolean().optional(),
});
export type ClaimFeatRequest = z.infer<typeof ClaimFeatRequestSchema>;

/**
 * Why a claim was refused.
 *
 * All five are 409s carrying one of these rather than a sentence, because none of them is a
 * malformed request: the caller is who they say they are and the feat exists, the game is just not
 * in a state where it can be collected. Which door is shut is the useful half.
 *
 * `would_waste` is the only one a player can clear by pressing again. It says the reward does not
 * fit: a store is too full for what it pays, or the district has no beds for the units (§A1). The
 * feat stays **ready** and nothing is spent, and the screen's answer is the warning dialog, which
 * repeats the claim with `acceptWaste` once the player has agreed to lose the difference.
 *
 * It replaced `no_unit_slots` on 2026-09-23. That code was the same situation with no way out of
 * it: units that did not fit were refused outright and the player could only go and build
 * Quarters. Beds are now one of the two ceilings a claim can be paid up to.
 */
export const FEAT_CLAIM_REFUSALS = [
  'unknown_feat',
  'not_finished',
  'locked',
  'already_claimed',
  'would_waste',
] as const;
export const FeatClaimRefusalSchema = z.enum(FEAT_CLAIM_REFUSALS);
export type FeatClaimRefusal = z.infer<typeof FeatClaimRefusalSchema>;

export const FEAT_CLAIM_REFUSAL_TEXT: Readonly<Record<FeatClaimRefusal, string>> = {
  unknown_feat: 'There is no such feat.',
  not_finished: 'That one is not finished yet.',
  locked: 'Finish the one before it first.',
  already_claimed: 'You have already collected that one.',
  would_waste:
    'Some of what that one pays has nowhere to go. Press CLAIM again to see what would be lost.',
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
  /**
   * What landed. Allowed to be empty, because a confirmed claim against stores that are full to
   * the top pays nothing at all and is still a claim: the rung is collected and the difference is
   * gone, which is what the player agreed to.
   */
  paid: FeatRewardSchema.or(z.object({})),
  /** What was discarded on the way, when the player confirmed a claim that did not fit. */
  wasted: FeatWasteSchema.optional(),
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
   * Feats that were waiting and were **not** collected, because the whole of what they pay would
   * not fit: the stores are too full for the resources, or the district has no beds for the units
   * (§A1).
   *
   * A bulk button must not throw anything away on a player's behalf. A single claim can waste a
   * reward, but only behind a dialog naming the figure and only once the player has said yes; one
   * press that collects forty rungs has no way to ask that question forty times, so a rung that
   * cannot be paid in full is left ready for the player to take deliberately.
   *
   * Sent because without it the button is a dead control: the backlog does not empty, the count on
   * its face does not move, and pressing it again pays nothing and says nothing. The screen needs
   * to be able to say *why* one is still red, and only the server knows what the beds and the
   * shelves are doing.
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
