import { randomUUID } from 'node:crypto';
import {
  STACKHOUSE_MAX_STAKE,
  STACKHOUSE_RESEARCH_ID,
  findDistrict,
  stackhouseClosesAt,
  stackhouseOpen,
  stackhousePayout,
  type Base,
  type BattleSide,
  type ScheduledBattle,
  type StackhouseFight,
  type StackhouseOutcome,
  type StackhouseRefusal,
  type StackhouseResponse,
} from '@frontline/shared';
import { adminCaps, adminWaives } from '../admin/mode.js';
import { defendingBaseOf, residentOf, targetName } from '../battle/ground.js';
import type { Repositories } from '../db/repos/index.js';
import type { StackhouseBetRow } from '../db/repos/stackhouse.js';
import { tallyStackhouseBet, tallyStackhouseWin } from '../feats/tally.js';
import { notifyBase } from '../social/notify.js';
import { settleEach } from '../world/guard.js';

/**
 * The Stackhouse (maintainer, 2026-10-05): a private book on declared fights.
 *
 * A crew can bet on a fight it or anybody at its faction's table is in, on either side, from the
 * call until an hour before the mark. One bet rides at a time and it cannot be taken back. A win
 * pays twice the stake; a fight that never runs hands the stake back. Settled on the world tick
 * after the fights land, and lazily on every read of the book, so a receipt never waits on a tick.
 */

/** This crew and everybody at its faction's table: whose fights the book takes bets on. */
function ourBaseIds(repos: Repositories, base: Base): Set<string> {
  const ids = new Set([base.id]);
  const membership = repos.factions.membershipOf(base.ownerId);
  if (!membership) return ids;
  for (const member of repos.factions.members(membership.factionId)) {
    const memberBase = repos.bases.findByOwnerId(member.userId);
    if (memberBase) ids.add(memberBase.id);
  }
  return ids;
}

/** Which sides of a fight are ours: declared by us, called on us, or reinforced by us. */
function ourSides(repos: Repositories, battle: ScheduledBattle, ours: Set<string>): BattleSide[] {
  const sides = new Set<BattleSide>();
  if (ours.has(battle.attackerBaseId)) sides.add('attacker');
  const defender = defendingBaseOf(repos, battle);
  if (defender && ours.has(defender.id)) sides.add('defender');
  for (const row of repos.sieges.deployments(battle.id)) {
    if (row.baseId !== null && ours.has(row.baseId)) sides.add(row.side);
  }
  return [...sides];
}

const HOLDER_NAMES = { government: 'The Combine', looters: 'Looters', unoccupied: 'Nobody' };

function sideNames(repos: Repositories, battle: ScheduledBattle): Record<BattleSide, string> {
  const defender = defendingBaseOf(repos, battle);
  return {
    attacker: repos.bases.findById(battle.attackerBaseId)?.name ?? 'a crew nobody knows',
    defender:
      defender?.name ??
      (battle.defender.kind === 'crew' ? 'Another crew' : HOLDER_NAMES[battle.defender.kind]),
  };
}

function fightView(
  repos: Repositories,
  battle: ScheduledBattle,
  ours: Set<string>,
): StackhouseFight {
  const sides = ourSides(repos, battle, ours);
  const names = sideNames(repos, battle);
  return {
    battleId: battle.id,
    place: targetName(battle.target, residentOf(repos, battle.target.districtId)),
    districtName: findDistrict(battle.target.districtId)?.name ?? 'somewhere',
    attacker: { name: names.attacker, yours: sides.includes('attacker') },
    defender: { name: names.defender, yours: sides.includes('defender') },
    startsAt: battle.scheduledFor,
    closesAt: stackhouseClosesAt(battle.scheduledFor).toISOString(),
  };
}

/** The fights still taking this crew's bets, soonest first. */
function openFights(repos: Repositories, base: Base, now: Date): StackhouseFight[] {
  const ours = ourBaseIds(repos, base);
  return (
    repos.sieges
      .pending()
      .filter((battle) => stackhouseOpen(battle.scheduledFor, now))
      // Never a fight this crew called itself (maintainer, 2026-10-05).
      .filter((battle) => battle.attackerBaseId !== base.id)
      .filter((battle) => ourSides(repos, battle, ours).length > 0)
      .map((battle) => fightView(repos, battle, ours))
  );
}

export function stackhouseUnlocked(base: Base): boolean {
  return base.research.technologies.includes(STACKHOUSE_RESEARCH_ID);
}

/** The whole book as this crew sees it. */
export function projectStackhouse(repos: Repositories, base: Base, now: Date): StackhouseResponse {
  const riding = repos.stackhouse.riding(base.id);
  const last = repos.stackhouse.lastSettled(base.id);
  const unlocked = stackhouseUnlocked(base);
  return {
    serverNow: now.toISOString(),
    unlocked,
    fights: unlocked && !riding ? openFights(repos, base, now) : [],
    activeBet: riding
      ? {
          battleId: riding.battleId,
          side: riding.side,
          stake: riding.stake,
          placedAt: riding.placedAt,
          place: riding.place,
          backing: riding.backing,
          startsAt: riding.startsAt,
        }
      : null,
    lastResult:
      last && last.settledAt !== null && last.outcome !== null
        ? {
            place: last.place,
            backing: last.backing,
            stake: last.stake,
            outcome: last.outcome,
            payout: last.payout,
            settledAt: last.settledAt,
          }
        : null,
    maxStake: STACKHOUSE_MAX_STAKE,
  };
}

export interface PlaceStackhouseBet {
  base: Base;
  battleId: string;
  side: BattleSide;
  stake: number;
  now: Date;
  admin: boolean;
}

/** Puts one bet on the book and takes the stake, or says why not. */
export function placeStackhouseBet(
  repos: Repositories,
  bet: PlaceStackhouseBet,
): { kind: 'placed' } | { kind: 'refused'; reason: StackhouseRefusal } {
  const { base, battleId, side, stake, now, admin } = bet;
  const refused = (reason: StackhouseRefusal) => ({ kind: 'refused' as const, reason });
  if (!stackhouseUnlocked(base)) return refused('locked');
  if (repos.stackhouse.riding(base.id)) return refused('bet_riding');
  const battle = repos.sieges.find(battleId);
  const ours = ourBaseIds(repos, base);
  if (!battle || ourSides(repos, battle, ours).length === 0) return refused('not_your_fight');
  if (battle.attackerBaseId === base.id) return refused('own_call');
  // Landed or called off between the read and the click: closed, not somebody else's (bug pass,
  // 2026-10-05).
  if (battle.resolvedAt !== null) return refused('closed');
  if (!stackhouseOpen(battle.scheduledFor, now)) return refused('closed');
  if (stake > base.resources.caps && !adminWaives('cannot_afford', admin)) {
    return refused('cannot_afford');
  }

  const view = fightView(repos, battle, ours);
  /*
   * The stake on record is what left the stockpile (maintainer, 2026-10-06). Admin mode charges
   * nothing, and a bet recorded at the typed figure paid real caps back on a refund and twice them
   * on a win, so the console minted caps through the book.
   */
  const charged = adminCaps(stake, admin);
  repos.bases.updateResources(base.id, {
    ...base.resources,
    caps: base.resources.caps - charged,
  });
  repos.stackhouse.place({
    id: randomUUID(),
    baseId: base.id,
    battleId,
    side,
    stake: charged,
    place: view.place,
    backing: view[side].name,
    startsAt: battle.scheduledFor,
    placedAt: now.toISOString(),
  });
  tallyStackhouseBet(repos, base.id);
  return { kind: 'placed' };
}

/** How a riding bet ends now, or null while its fight is still coming. */
function outcomeOf(
  repos: Repositories,
  bet: StackhouseBetRow,
): { outcome: StackhouseOutcome; payout: number; at: string | null } | null {
  const fight = repos.sieges.outcomeOf(bet.battleId);
  if (fight && fight.resolvedAt === null) return null;
  // Gone, abandoned, or a report this build cannot read: nothing was decided, so the stake comes back.
  if (!fight || fight.winner === null) {
    return { outcome: 'refunded', payout: bet.stake, at: fight?.resolvedAt ?? null };
  }
  return fight.winner === bet.side
    ? { outcome: 'won', payout: stackhousePayout(bet.stake), at: fight.resolvedAt }
    : { outcome: 'lost', payout: 0, at: fight.resolvedAt };
}

const RECEIPTS: Record<StackhouseOutcome, (bet: StackhouseBetRow, payout: number) => string> = {
  won: (bet, payout) =>
    `${bet.backing} took it at ${bet.place}. Your ${bet.stake.toLocaleString('en')} came back as ${payout.toLocaleString('en')} caps.`,
  lost: (bet) =>
    `${bet.backing} lost at ${bet.place}. The house keeps your ${bet.stake.toLocaleString('en')} caps.`,
  refunded: (bet) =>
    `The fight at ${bet.place} never ran. Your ${bet.stake.toLocaleString('en')} caps are back.`,
};

/**
 * Closes every bet whose fight is over. Answers how many closed.
 *
 * One bet at a time through `settleEach` (bug pass, 2026-10-06): a bare loop let one unreadable
 * bet throw the whole stage on every tick, and since the Stackhouse's own reads settle first, answer
 * 500 on the screen for every crew in the game.
 */
export function settleStackhouse(repos: Repositories, now: Date): number {
  let closed = 0;
  settleEach(
    repos,
    'stackhouse bets',
    repos.stackhouse.unsettled(),
    (bet) => bet.id,
    (bet) => {
      const result = outcomeOf(repos, bet);
      if (result === null) return;
      const at = result.at ?? now.toISOString();
      if (!repos.stackhouse.settle(bet.id, result.outcome, result.payout, at)) return;
      closed += 1;
      const base = repos.bases.findById(bet.baseId);
      if (!base) return;
      if (result.payout > 0) {
        repos.bases.updateResources(base.id, {
          ...base.resources,
          caps: base.resources.caps + result.payout,
        });
      }
      if (result.outcome === 'won') tallyStackhouseWin(repos, base.id);
      notifyBase(repos, base.id, {
        kind: 'stackhouse_settled',
        title:
          result.outcome === 'won'
            ? 'Your bet came in'
            : result.outcome === 'lost'
              ? 'Your bet is gone'
              : 'Your stake is back',
        body: RECEIPTS[result.outcome](bet, result.payout),
        link: '/game/market/black',
        subjectId: bet.battleId,
        at: new Date(at),
      });
    },
  );
  return closed;
}
