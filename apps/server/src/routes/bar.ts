import {
  AssignPointRequestSchema,
  HireRecruitRequestSchema,
  NegotiateRequestSchema,
  barHiresPerDay,
  negotiate,
  negotiationLine,
  openNegotiation,
  playerLevelGrants,
  reputationOf,
  spendCharacterPoint,
  type AssignPointResponse,
  type Base,
  type BarResponse,
  type Commander,
  type HireRecruitResponse,
  type NegotiateResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { assessAgainst, hireRecruit, wageAskedOf, type HireRefusal } from '../bar/hire.js';
import { settleOfficerAlignment } from '../bar/officers.js';
import { projectOfficer, projectRecruit } from '../bar/project.js';
import { barSeatsFor, barDay, barRoster, findBarRecruit, seatOf } from '../bar/roster.js';
import { crewEffectsFor } from '../crew/standing.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { awardPlayerXp, levelUpFrom } from '../progression/award.js';

/**
 * The Bar (GDD §H).
 *
 * The roster is never read from the database: §H2a makes it a pure function of the UTC date, so
 * every request recomputes it and two accounts asking on the same day are served the same eight
 * people. What *is* stored is only what a player changed — who they hired, how those officers feel
 * (§H5), what level they are (§H6) and what they agreed to pay (§H7, in W2's payroll book).
 */

/** A player recruits into their one base or into nowhere. */
function requireOwnBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}

/**
 * Settle everything the Bar reads off before reading it: wages and upkeep first (§H7/§D1), then
 * the §H5 drift, because an officer paid off the books this instant is still on them.
 */
function settledBase(app: FastifyInstance, ownerId: string, now: Date): Base {
  const own = requireOwnBase(app, ownerId);
  return settleOfficerAlignment(app.repos, settleBase(app.repos, own, now).base, now);
}

/**
 * Every refusal is a 409: the request was well-formed and the character exists, the crew just is
 * not in a state where the hire can happen. The three §H3/§H4 refusals share a code because the
 * roster read already tells the client *which* gate is shut, in `assessment.blockers`.
 */
const REFUSAL_ERRORS: Record<HireRefusal, { code: ErrorCode; message: string }> = {
  already_hired: { code: 'RECRUIT_UNAVAILABLE', message: 'They already work for you' },
  daily_limit: {
    code: 'DAILY_HIRE_LIMIT',
    message: 'You have already signed somebody today. The room restocks tomorrow',
  },
  no_housing: {
    code: 'NO_HOUSING',
    message: 'Nowhere to put them. Raise the Quarters first',
  },
  no_slots: { code: 'NO_RECRUIT_SLOTS', message: 'You have no room for another recruit' },
  role_taken: { code: 'ROLE_TAKEN', message: 'Someone already holds that position' },
  requirement: {
    code: 'RECRUIT_UNAVAILABLE',
    message: 'They will not work for a crew this far off the street',
  },
  reputation: {
    code: 'RECRUIT_UNAVAILABLE',
    message: 'They want nothing to do with a crew like yours',
  },
  cannot_afford: { code: 'INSUFFICIENT_CAPS', message: 'You cannot cover their first payment' },
};

export function registerBarRoutes(app: FastifyInstance): void {
  app.get('/bar', { preHandler: app.authenticate }, (request): BarResponse => {
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);
    const day = barDay(now);
    // §H2 — the room as it stands for everyone, including whoever has walked in to replace the
    // people already hired out of it today.
    // §F2 — Charisma and Diplomacy widen the room. Word gets around about who is hiring.
    const seats = barSeatsFor(crewEffectsFor(app.repos, base).recruitPoolPercent);
    const generations = app.repos.bar.generations(day, seats);

    return {
      day,
      serverNow: now.toISOString(),
      recruits: barRoster(day, generations, seats).map((recruit) =>
        projectRecruit(base, recruit, now),
      ),
      officers: base.commanders.map((officer) => projectOfficer(base, officer)),
      slotsUsed: base.commanders.length,
      slotsTotal: playerLevelGrants(base.level).recruitSlots,
      infamy: base.economy.infamy,
      reputation: reputationOf(base.economy, now),
      caps: base.resources.caps,
      filledRoles: base.commanders.map((officer) => officer.role),
      hiresLeftToday: Math.max(
        0,
        barHiresPerDay(base.level) - app.repos.bar.hiresBy(request.currentUser.id, day),
      ),
      // §H7 — conversations already under way. Sent whole rather than as a count, because the
      // window has to be able to re-open on the exact exchange the player left it on.
      negotiations: app.repos.bar.negotiations(request.currentUser.id, day),
    };
  });

  /**
   * §H7 — one exchange of a wage negotiation.
   *
   * Server-owned on purpose. Patience, a walk-away and a demand that only moves when the player
   * moves are all rules a client could simply decline to enforce, and the whole point of the
   * conversation is that a bad offer costs something you cannot reload away.
   *
   * Agreeing a number does **not** hire anybody. The player still sends it to `/bar/hire`, which is
   * where §H8 housing, the §H2b daily limit and the first payment are checked — a negotiation is a
   * handshake, not a contract.
   */
  app.post('/bar/negotiate', { preHandler: app.authenticate }, (request): NegotiateResponse => {
    const { recruitId, offerWage } = parseBody(NegotiateRequestSchema, request.body);
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);
    const day = barDay(now);

    const seats = barSeatsFor(crewEffectsFor(app.repos, base).recruitPoolPercent);
    const recruit = findBarRecruit(day, recruitId, app.repos.bar.generations(day, seats), seats);
    if (!recruit) throw new AppError('NOT_FOUND', 'They are not at the Bar today');

    const { stance, blockers } = assessAgainst(base, recruit, now);
    // §H3/§H4 come first: somebody who will not work for this crew at any price is not somebody to
    // haggle with, and letting the conversation open would teach the player nothing true.
    if (blockers.length > 0) {
      throw new AppError('RECRUIT_UNAVAILABLE', 'They will not talk terms with a crew like yours');
    }

    const asking = wageAskedOf(recruit, stance);
    const current =
      app.repos.bar.negotiation(request.currentUser.id, day, recruitId) ??
      openNegotiation(asking, recruit.ambition, recruit.moralCompass);
    if (current.closed) {
      throw new AppError('NEGOTIATION_CLOSED', 'That conversation is over');
    }

    const turn = negotiate({
      negotiation: current,
      offer: offerWage,
      asking,
      ambition: recruit.ambition,
      moralCompass: recruit.moralCompass,
    });
    app.repos.bar.saveNegotiation(
      request.currentUser.id,
      day,
      recruitId,
      turn.negotiation,
      now.toISOString(),
    );

    return {
      negotiation: turn.negotiation,
      line: negotiationLine(recruit.moralCompass, turn.negotiation.mood, turn.negotiation.rounds),
      accepted: turn.accepted,
      walkedAway: turn.walkedAway,
    };
  });

  app.post('/bar/hire', { preHandler: app.authenticate }, (request): HireRecruitResponse => {
    const { recruitId, role, offerWage } = parseBody(HireRecruitRequestSchema, request.body);
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);

    const day = barDay(now);
    const seats = barSeatsFor(crewEffectsFor(app.repos, base).recruitPoolPercent);
    const generations = app.repos.bar.generations(day, seats);
    const recruit = findBarRecruit(day, recruitId, generations, seats);
    const seat = seatOf(day, recruitId);
    if (!recruit || seat === null) {
      // Two ways to land here and one honest answer for both: the roster turned over at midnight
      // UTC (§H2), or somebody else signed this person and their seat has already moved on
      // (§H2b). A stale tab must not be able to hire the replacement by accident, which is why
      // the generation is part of the id it sends back.
      throw new AppError('NOT_FOUND', 'They are not at the Bar today');
    }

    const result = app.db.transaction(() =>
      hireRecruit(app.repos, {
        base,
        userId: request.currentUser.id,
        seat,
        recruit,
        role,
        offerWage,
        now,
        admin: app.config.admin,
      }),
    )();
    if (result.kind === 'refused') {
      const { code, message } = REFUSAL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    if (result.kind === 'countered') {
      return {
        accepted: false,
        wage: result.wage,
        officer: null,
        firstPayment: 0,
        resources: null,
      };
    }
    // §I1 — signing somebody is one of the two or three things a player does in a session that
    // takes a real decision, so it pays. Outside the hire transaction deliberately: the XP ledger
    // is W6's and a level-up must not be able to roll a signed contract back.
    const { award } = awardPlayerXp(app.repos, result.base, 'officerHired');
    return {
      accepted: true,
      wage: result.wage,
      officer: result.officer,
      firstPayment: result.firstPayment,
      resources: result.base.resources,
      levelUp: levelUpFrom([award]),
    };
  });

  /** §H6/§H6a — the 2 points per level the player assigns by hand. */
  app.post(
    '/bar/assign-point',
    { preHandler: app.authenticate },
    (request): AssignPointResponse => {
      const { officerId, attribute } = parseBody(AssignPointRequestSchema, request.body);
      const now = new Date();
      const base = settledBase(app, request.currentUser.id, now);

      const officer = base.commanders.find((held) => held.id === officerId);
      if (!officer) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');

      const spent = spendCharacterPoint(officer, attribute);
      if (!spent) throw new AppError('NO_POINTS', 'They have no points waiting to be assigned');

      const updated: Commander = { ...officer, ...spent };
      app.repos.bases.updateCommanders(
        base.id,
        base.commanders.map((held) => (held.id === officerId ? updated : held)),
      );
      return { officer: updated };
    },
  );
}
