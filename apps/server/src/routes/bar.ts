import {
  AssignPointRequestSchema,
  HireRecruitRequestSchema,
  playerLevelGrants,
  reputationOf,
  spendCharacterPoint,
  type AssignPointResponse,
  type Base,
  type BarResponse,
  type Commander,
  type HireRecruitResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { hireRecruit, type HireRefusal } from '../bar/hire.js';
import { settleOfficerAlignment } from '../bar/officers.js';
import { projectOfficer, projectRecruit } from '../bar/project.js';
import { barDay, barRoster, findBarRecruit } from '../bar/roster.js';
import { settleBaseEconomy } from '../economy/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';

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
  return settleOfficerAlignment(app.repos, settleBaseEconomy(app.repos, own, now), now);
}

/**
 * Every refusal is a 409: the request was well-formed and the character exists, the crew just is
 * not in a state where the hire can happen. The three §H3/§H4 refusals share a code because the
 * roster read already tells the client *which* gate is shut, in `assessment.blockers`.
 */
const REFUSAL_ERRORS: Record<HireRefusal, { code: ErrorCode; message: string }> = {
  already_hired: { code: 'RECRUIT_UNAVAILABLE', message: 'They already work for you' },
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

    return {
      day,
      serverNow: now.toISOString(),
      recruits: barRoster(day).map((recruit) => projectRecruit(base, recruit, now)),
      officers: base.commanders.map((officer) => projectOfficer(base, officer)),
      slotsUsed: base.commanders.length,
      slotsTotal: playerLevelGrants(base.level).recruitSlots,
      infamy: base.economy.infamy,
      reputation: reputationOf(base.economy, now),
      caps: base.resources.caps,
      filledRoles: base.commanders.map((officer) => officer.role),
    };
  });

  app.post('/bar/hire', { preHandler: app.authenticate }, (request): HireRecruitResponse => {
    const { recruitId, role, offerWage } = parseBody(HireRecruitRequestSchema, request.body);
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);

    const recruit = findBarRecruit(barDay(now), recruitId);
    if (!recruit) {
      // The roster turns over at midnight UTC (§H2), so a stale tab offering yesterday's people
      // lands here rather than hiring someone who is no longer in the room.
      throw new AppError('NOT_FOUND', 'They are not at the Bar today');
    }

    const result = hireRecruit(app.repos, { base, recruit, role, offerWage, now });
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
    return {
      accepted: true,
      wage: result.wage,
      officer: result.officer,
      firstPayment: result.firstPayment,
      resources: result.base.resources,
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
