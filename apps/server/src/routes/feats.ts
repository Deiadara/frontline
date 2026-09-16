import {
  ClaimFeatRequestSchema,
  addItems,
  addToStash,
  addResources,
  canClaimFeat,
  mergeFeatRewards,
  findFeat,
  gainInfamy,
  unitSlotsUsed,
  type Army,
  type Base,
  type ClaimAllResponse,
  type ClaimFeatResponse,
  type FeatClaimRefusal,
  type FeatReward,
  type FeatsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { projectFeats, progressFor } from '../feats/project.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { settleBase } from '../district/settle.js';
import { mergeArmies } from '../battle/forces.js';
import { awardPlayerXp } from '../progression/award.js';
import { tallyInfamyEarned, tallyPagesIn, tallyResourcesEarned } from '../feats/tally.js';
import { tellPagesFound } from '../social/pages.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * Feats: reading the board, and collecting one (maintainer request, 2026-09-13).
 *
 * ## One refusal code, four reasons
 *
 * A claim can be turned down four ways and all of them are 409s carrying a `FeatClaimRefusal`,
 * because in none of them is the request wrong: the feat exists and the caller is who they say
 * they are, the game is simply not in a state where it can be paid. Which door is shut is the half
 * a screen can do something with, so it is in the unit.
 *
 * ## Why the whole thing is one transaction
 *
 * Collecting a feat writes a claim row and then pays out across as many as five different stores:
 * the stockpile, the inventory, the roster, the ledger, the boost stash, and the progression row.
 * A crash halfway through, or two tabs pressing the button together, is the one failure here that
 * costs a player something real. The claim row is written **first**, inside the transaction, and
 * the payout only happens if that insert was the one that won: `repos.feats.claim` reports whether
 * it wrote, so a second press finds the row already there, is told `already_claimed`, and pays
 * nothing. See `db/repos/feats.ts`.
 */

function refuse(reason: FeatClaimRefusal): never {
  throw new AppError('FEAT_REFUSED', reason);
}

/**
 * Whether the district has room for the units a reward pays (§A1).
 *
 * A feat is a reward and not an exemption. `queueTraining` refuses an order that would put a crew
 * over its ceiling and the Garage refuses a machine for the same reason; a feat paying a hundred
 * Juggernauts straight onto the roster was the one door left open, and the largest of them is 960
 * unit slots against a finished district's two thousand.
 *
 * `districtUnitSlots` is the same fold both other gates read, so all three agree about what is
 * already housed: the roster, the bench, the garrisons, the officers, the yard, and everything out
 * on a road. A reward that pays no units always fits, which is most of the catalogue.
 */
function fits(repos: Repositories, base: Base, units: Army | undefined): boolean {
  if (units === undefined) return true;
  const asking = unitSlotsUsed(units);
  return asking === 0 || asking <= districtUnitSlots(repos, base).spare;
}

export function registerFeatRoutes(app: FastifyInstance): void {
  /** The crew, settled, because half of what a feat asks about moves on a read. */
  function crew(userId: string, now: Date): Base {
    const base = app.repos.bases.findByOwnerId(userId);
    if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
    /*
     * Settled first, and this is not optional.
     *
     * Production, builds and training all land lazily on read. Without this, a crew that has been
     * away for a day would see a feats screen built from the stockpile they had when they logged
     * out, press nothing, and come back a moment later to find three of them finished. Worse, the
     * badge on the bottom bar reads from the same evaluation and would disagree with the screen.
     */
    return settleBase(app.repos, base, now).base;
  }

  app.get('/feats', { preHandler: app.authenticate }, (request): FeatsResponse => {
    const now = new Date();
    return projectFeats(app.repos, crew(request.currentUser.id, now), now);
  });

  app.post('/feats/claim', { preHandler: app.authenticate }, (request): ClaimFeatResponse => {
    const { featId } = parseBody(ClaimFeatRequestSchema, request.body);
    const now = new Date();
    // Settled before anything is decided, and the returned crew is deliberately not used: the
    // transaction below re-reads it, because the state that decides whether this is payable has to
    // be the state the payout is written against. What this call is for is the settle itself.
    crew(request.currentUser.id, now);

    const spec = findFeat(featId);
    if (!spec) refuse('unknown_feat');

    return app.db.transaction(() => {
      // Re-read inside the transaction. The settle above may have moved the numbers, and the state
      // that decides whether this is payable has to be the state the payout is written against.
      const fresh = app.repos.bases.findByOwnerId(request.currentUser.id);
      if (!fresh) throw new AppError('NO_BASE', 'You do not have a base yet');
      const standing = progressFor(app.repos, fresh).find((one) => one.id === featId);

      if (!canClaimFeat(standing)) {
        // The three states that are not `ready`, each named rather than collapsed into one word:
        // "finish the one before it" and "you already have that" are different things to be told.
        refuse(
          standing?.state === 'claimed'
            ? 'already_claimed'
            : standing?.state === 'locked'
              ? 'locked'
              : 'not_finished',
        );
      }

      // Room before the claim row, not after it. §A1 is a ceiling on what a district holds and a
      // feat is not exempt from it, so a reward that would not fit is refused *without* marking
      // the feat collected: it stays ready, and the player comes back when they have made room.
      if (!fits(app.repos, fresh, spec.reward.units)) refuse('no_unit_slots');

      // The claim before the payout. If this returns false another request banked it first, and
      // the only correct thing to do is pay nothing and say so.
      if (!app.repos.feats.claim(fresh.id, featId, now.toISOString())) {
        refuse('already_claimed');
      }

      payFeat(app.repos, fresh, spec.reward, now);
      const settled = app.repos.bases.findByOwnerId(request.currentUser.id) ?? fresh;
      return {
        featId,
        paid: spec.reward,
        feats: projectFeats(app.repos, settled, now),
      };
    })();
  });

  /**
   * Collect everything that is waiting, in one request.
   *
   * ## Why this exists, and why one request rather than a loop on the client
   *
   * A crew can have a great many feats waiting at once, and that is by design: a ladder unlocks on
   * achievement rather than on collection, so somebody who arrives at this screen at level forty
   * is handed the whole early game at once rather than being made to click through it a rung at a
   * time. A client pressing CLAIM once per rung would then hit the write limiter (120 a minute per
   * account) and be told 429 by the rate guard, which is a generic refusal that says nothing about
   * feats and leaves the rest uncollectable for a minute.
   *
   * So the backlog is one write. `mergeFeatRewards` was written for this and is why the rewards
   * are folded rather than paid one at a time: `payFeat` reads the crew once and writes each store
   * once, so calling it a hundred times against one stale copy would have each call overwrite the
   * last and pay only the final feat's caps.
   *
   * One pass is enough. Claiming never unlocks anything, because unlocking follows achievement, so
   * the set of waiting feats cannot grow while this runs.
   */
  app.post('/feats/claim-all', { preHandler: app.authenticate }, (request): ClaimAllResponse => {
    const now = new Date();
    crew(request.currentUser.id, now);

    return app.db.transaction(() => {
      const fresh = app.repos.bases.findByOwnerId(request.currentUser.id);
      if (!fresh) throw new AppError('NO_BASE', 'You do not have a base yet');

      const waiting = progressFor(app.repos, fresh).filter((one) => one.state === 'ready');
      /*
       * §A1 against the *backlog*, not against each feat on its own.
       *
       * This pays the whole batch in one write, so the ceiling has to be spent down across it:
       * two feats that each fit the spare room on their own do not both fit if the first one takes
       * it. Walked in board order, and a feat that does not fit is simply left ready rather than
       * stopping the run: the caps and the pages behind it are still collectable, and the units
       * are still there when the crew has made room.
       */
      let room = districtUnitSlots(app.repos, fresh).spare;
      const skipped: string[] = [];
      const payable = waiting.filter((one) => {
        const asking = unitSlotsUsed(findFeat(one.id)?.reward.units ?? {});
        if (asking > room) {
          skipped.push(one.id);
          return false;
        }
        room -= asking;
        return true;
      });
      // Each still writes its own claim row, so the ledger records what was collected rather than
      // that a batch happened, and a row another request banked first drops out here.
      const collected = payable
        .filter((one) => app.repos.feats.claim(fresh.id, one.id, now.toISOString()))
        .map((one) => findFeat(one.id))
        .filter((spec): spec is NonNullable<typeof spec> => spec !== undefined);

      const paid = mergeFeatRewards(collected.map((spec) => spec.reward));
      if (collected.length > 0) payFeat(app.repos, fresh, paid, now);

      const settled = app.repos.bases.findByOwnerId(request.currentUser.id) ?? fresh;
      return {
        featIds: collected.map((spec) => spec.id),
        skipped,
        paid,
        feats: projectFeats(app.repos, settled, now),
      };
    })();
  });
}

/**
 * Hands over one reward, across every store it touches.
 *
 * Called inside the claim transaction, never on its own. Each channel is written with the same
 * primitive the rest of the game uses for it, so a feat paying caps and a mission paying caps go
 * through one function and cannot disagree about what "add" means.
 *
 * The tallies at the end are not bookkeeping for its own sake: a feat that pays fifty thousand
 * caps is fifty thousand caps this crew has earned, and leaving it out would make the lifetime
 * ladders quietly wrong for anybody who collects the ones that pay in caps. Infamy and blueprint
 * pages count the same way, which means a large infamy feat can help finish an infamy feat, and
 * that is correct: it is infamy they now have and did not before.
 */
function payFeat(repos: Repositories, base: Base, reward: FeatReward, now: Date): void {
  const resources = reward.resources
    ? addResources(base.resources, reward.resources)
    : base.resources;
  const inventory = reward.items ? addItems(base.inventory, reward.items) : base.inventory;
  if (reward.resources || reward.items) {
    // One statement, because a reward can pay into both and a crash between two writes would bank
    // the caps and lose the pages.
    repos.bases.updateHoldings(base.id, resources, inventory);
  }

  if (reward.units) {
    // Straight onto the roster at home rather than into the training queue. A feat is a reward and
    // not an order: making somebody wait forty minutes for units they have already earned would
    // be a punishment dressed as a gift.
    repos.bases.updateArmy(base.id, mergeArmies(base.army, reward.units), base.trainingQueue);
  }

  if (reward.infamy) {
    repos.bases.updateEconomy(base.id, {
      ...base.economy,
      infamy: gainInfamy(base.economy.infamy, reward.infamy),
    });
  }

  if (reward.boosts) {
    // Into the same stash the back room fills, so a feat's boost and a bought one are the same
    // object on the fight screen and neither needs a second code path.
    let stash = repos.blackMarket.stashFor(base.id);
    for (const goodId of reward.boosts) stash = addToStash(stash, goodId);
    repos.blackMarket.writeStash(base.id, stash);
  }

  if (reward.xp) {
    /*
     * Through `awardPlayerXp`, which is the only writer of `Base.level` (INTERFACES R7).
     *
     * `questCompleted` is the source this uses, and it has been declared in `PLAYER_XP_AWARDS`
     * since the progression module was written with no producer behind it. Feats are the producer
     * it was waiting for. The amount is the feat's own, so the anchor is not read here: what a
     * feat pays is a balance decision made in the catalogue.
     */
    const current = repos.bases.findByOwnerId(base.ownerId) ?? base;
    awardPlayerXp(repos, current, 'questCompleted', 0, reward.xp);
  }

  if (reward.resources) tallyResourcesEarned(repos, base.id, reward.resources);
  if (reward.infamy) tallyInfamyEarned(repos, base.id, reward.infamy);
  if (reward.items) {
    /*
     * A feat is the seventh door a blueprint page comes through, and it was the one that counted
     * for nothing and rang nothing.
     *
     * The `pages` chain is itself paid in pages, so leaving this out meant collecting its first
     * rung handed over a page that did not move the crew a step towards its second. The bell is
     * the other half: the inventory is eighteen other things deep, and every one of the other six
     * doors tells the player a document moved a square closer.
     */
    tallyPagesIn(repos, base.id, reward.items);
    tellPagesFound(repos, {
      userId: base.ownerId,
      before: base.inventory,
      after: inventory,
      source: { kind: 'feat' },
      now,
    });
  }
}
