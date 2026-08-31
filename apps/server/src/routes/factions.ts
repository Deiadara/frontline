import { randomUUID } from 'node:crypto';
import {
  AnswerInviteRequestSchema,
  CreateFactionRequestSchema,
  EditFactionDescriptionRequestSchema,
  EditFactionIdentityRequestSchema,
  FactionMemberActionRequestSchema,
  InviteToFactionRequestSchema,
  ReinforceRequestSchema,
  canAdminister,
  canEditDescription,
  canEditIdentity,
  canInvite,
  canKick,
  canSetRank,
  leavingDisbands,
  buildingLevel,
  CENTRAL_BUILDING,
  FOUND_FACTION_NEXUS_LEVEL,
  FOUND_FACTION_PLAYER_LEVEL,
  sameFactionName,
  type FactionMutationResponse,
  type FactionRefusal,
  type FactionResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { hasRoom, projectFaction } from '../factions/project.js';
import { notify, notifyFaction } from '../social/notify.js';
import { sendMessage } from '../social/send.js';
import { adjustDeployment } from '../battle/deploy.js';
import { REFUSAL_MESSAGES } from '../battle/routes.js';
import { settleBase } from '../district/settle.js';

/**
 * Factions (board request): the team a player belongs to.
 *
 * Every write answers with the whole refreshed screen, the way every other mutating route in this
 * server does, so the client never re-derives a roster from a partial response.
 *
 * ## One refusal code, many reasons
 *
 * All of these are 409s carrying a `FactionRefusal`, because none of them is a malformed request:
 * the caller is who they say they are and the thing they named exists, the game is just not in a
 * state where it can happen. The reason is in the body so one screen can say *which* door is shut,
 * which is the whole of what §H3 taught this codebase about refusals.
 */

function refuse(reason: FactionRefusal): never {
  throw new AppError('FACTION_REFUSED', reason);
}

export function registerFactionRoutes(app: FastifyInstance): void {
  const screen = (userId: string, now = new Date()): FactionResponse =>
    projectFaction(app.repos, userId, now);
  const answer = (userId: string): FactionMutationResponse => ({ faction: screen(userId) });

  /** The membership this request is acting under, or a refusal. */
  function membership(userId: string) {
    const held = app.repos.factions.membershipOf(userId);
    if (!held) refuse('not_a_member');
    return held;
  }

  app.get('/factions', { preHandler: app.authenticate }, (request): FactionResponse => {
    return screen(request.currentUser.id);
  });

  app.post('/factions', { preHandler: app.authenticate }, (request): FactionMutationResponse => {
    const { name, badge, blurb } = parseBody(CreateFactionRequestSchema, request.body);
    const userId = request.currentUser.id;

    return app.db.transaction(() => {
      if (app.repos.factions.membershipOf(userId)) refuse('already_in_a_faction');
      /*
       * §B1: a faction needs a crew that has been somewhere and a Nexus big enough to run it from.
       *
       * Both, not either, and refused with one message that names both numbers: the client shows
       * the same sentence on the found-a-faction form, so a player never reaches this by surprise.
       */
      const founder = app.repos.bases.findByOwnerId(userId);
      if (
        !founder ||
        founder.level < FOUND_FACTION_PLAYER_LEVEL ||
        buildingLevel(founder.buildings, CENTRAL_BUILDING) < FOUND_FACTION_NEXUS_LEVEL
      ) {
        refuse('not_established');
      }
      // Checked through the domain's own comparison rather than the UNIQUE index, so "Iron  Wolves"
      // and "Iron Wolves" collide here the way they will on screen. The index is the cruder backstop.
      const taken = app.repos.factions.all();
      if (taken.some((faction) => sameFactionName(faction.name, name))) refuse('name_taken');

      const now = new Date().toISOString();
      const id = randomUUID();
      app.repos.factions.insert({ id, name, badge, blurb, foundedAt: now });
      // The founder leads it. A faction with no leader is a faction nobody can ever admit anyone to.
      app.repos.factions.addMember({ userId, factionId: id, rank: 'leader', joinedAt: now });
      // Every invitation they were holding is void: they have a table now.
      app.repos.factions.clearInvitesFor(userId);
      return answer(userId);
    })();
  });

  /*
   * The name and the badge: the leader's alone (`canEditIdentity`).
   *
   * These two are what everybody outside the faction recognises it by, which is why they are not a
   * chief's to change. The badge needs no uniqueness check the way the name does: two factions
   * choosing the same crest out of ninety thousand is a coincidence players are allowed to have,
   * and policing it would mean telling somebody their drawing is taken.
   */
  app.post(
    '/factions/identity',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const { name, badge } = parseBody(EditFactionIdentityRequestSchema, request.body);
      const userId = request.currentUser.id;

      return app.db.transaction(() => {
        const held = membership(userId);
        if (!canEditIdentity(held.rank)) refuse('not_allowed');

        const others = app.repos.factions.all().filter((faction) => faction.id !== held.factionId);
        if (others.some((faction) => sameFactionName(faction.name, name))) refuse('name_taken');

        app.repos.factions.setIdentity(held.factionId, name, badge);
        return answer(userId);
      })();
    },
  );

  /** The description, which a chief keeps current too: it is the recruiting pitch. */
  app.post(
    '/factions/description',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const { blurb } = parseBody(EditFactionDescriptionRequestSchema, request.body);
      const userId = request.currentUser.id;

      return app.db.transaction(() => {
        const held = membership(userId);
        if (!canEditDescription(held.rank)) refuse('not_allowed');
        app.repos.factions.setDescription(held.factionId, blurb);
        return answer(userId);
      })();
    },
  );

  app.post(
    '/factions/invite',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const { username } = parseBody(InviteToFactionRequestSchema, request.body);
      const userId = request.currentUser.id;

      return app.db.transaction(() => {
        const held = membership(userId);
        if (!canInvite(held.rank)) refuse('not_allowed');
        if (!hasRoom(app.repos, held.factionId)) refuse('faction_full');

        const invitee = app.repos.users.findByUsername(username);
        if (!invitee) refuse('no_such_player');
        if (invitee.id === userId) refuse('already_a_member');
        if (app.repos.factions.membershipOf(invitee.id)) refuse('already_in_a_faction');
        const open = app.repos.factions.invitesFrom(held.factionId);
        if (open.some((invite) => invite.invitedUserId === invitee.id)) refuse('already_invited');

        const faction = app.repos.factions.find(held.factionId);
        if (!faction) refuse('not_a_member');
        const now = new Date();
        const inviteId = randomUUID();
        app.repos.factions.invite({
          id: inviteId,
          factionId: held.factionId,
          invitedUserId: invitee.id,
          invitedByUserId: userId,
          sentAt: now.toISOString(),
        });

        /*
         * The invitation is delivered as a message, because that is where a player looks.
         *
         * It carries the invitation id, so the button in the mailbox spends the same row the
         * faction screen would: there is one way into a faction and this is a second door onto it,
         * not a second mechanism. The bell entry is `faction_invite` rather than
         * `message_received`, so somebody who has muted ordinary mail still hears about this.
         */
        sendMessage(app.repos, {
          sender: { id: userId, username: request.currentUser.username },
          senderFaction: faction.name,
          recipients: [invitee.id],
          audience: 'player',
          addressedTo: invitee.username,
          subject: `An invitation to ${faction.name}`,
          body:
            `${request.currentUser.username} has asked you to join ${faction.name}.\n\n` +
            `${faction.blurb || 'They have not written down what they are for.'}\n\n` +
            'Accepting puts your district at their table: your army shows up on their roster, ' +
            'their fights show up on yours, and either of you can send help to the other.',
          sentAt: now,
          invite: { inviteId, factionId: faction.id },
          notification: {
            kind: 'faction_invite',
            title: `${faction.name} has asked you to join`,
            body: `${request.currentUser.username} sent the invitation.`,
            link: '/game/messages',
          },
          keepSentCopy: false,
        });
        return answer(userId);
      })();
    },
  );

  app.post(
    '/factions/answer',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const { inviteId, accept } = parseBody(AnswerInviteRequestSchema, request.body);
      const userId = request.currentUser.id;

      return app.db.transaction(() => {
        const invite = app.repos.factions.findInvite(inviteId);
        // Scoped to the invited player: an invitation id is not a capability anybody else can spend.
        if (!invite || invite.invitedUserId !== userId) refuse('no_such_invite');

        if (!accept) {
          app.repos.factions.deleteInvite(inviteId);
          return answer(userId);
        }

        if (app.repos.factions.membershipOf(userId)) refuse('already_in_a_faction');
        // Re-checked at the moment of joining, not at the moment of inviting: five people can each
        // hold an invitation to the last seat, and only one of them can take it.
        if (!hasRoom(app.repos, invite.factionId)) refuse('faction_full');
        // A seat is a district at the table. Everything the faction screen shows about a member is
        // read off their district, so somebody without one is a member nobody can see who still
        // counts against the cap and still receives every faction message.
        if (!app.repos.bases.findByOwnerId(userId)) refuse('not_a_member');

        /*
         * The first real player at an all-fixture table takes the head of it.
         *
         * The seeded ally leads the faction they founded so that the table exists before anybody
         * joins, and nothing drives them: they will never promote anyone, hand over, or invite a
         * friend. A player who joined as an ordinary member would therefore be permanently unable
         * to run the faction they are in, which is a dead end rather than a rank.
         *
         * Stated as a general rule about factions with nobody playing in them rather than as a
         * check for one seeded name, so it also covers a faction whose last human left.
         */
        const seatedMembers = app.repos.factions.members(invite.factionId);
        const nobodyPlaying = seatedMembers.every(
          (row) => app.repos.bases.findByOwnerId(row.userId)?.isBot === true,
        );
        const now = new Date();
        if (nobodyPlaying) {
          for (const row of seatedMembers) {
            if (row.rank === 'leader') app.repos.factions.setRank(row.userId, 'chief');
          }
        }
        app.repos.factions.addMember({
          userId,
          factionId: invite.factionId,
          rank: nobodyPlaying ? 'leader' : 'member',
          joinedAt: now.toISOString(),
        });
        app.repos.factions.clearInvitesFor(userId);
        notifyFaction(app.repos, invite.factionId, {
          kind: 'faction_joined',
          title: `${request.currentUser.username} has joined`,
          body: '',
          link: '/game/faction',
          now,
          exceptUserId: userId,
        });
        return answer(userId);
      })();
    },
  );

  app.post(
    '/factions/leave',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const userId = request.currentUser.id;
      return app.db.transaction(() => {
        const held = membership(userId);
        const members = app.repos.factions.members(held.factionId);
        const now = new Date();

        /*
         * A leader walking out takes the faction with them (board's rule, `leavingDisbands`).
         *
         * Not a refusal, which is what this used to be: a leader who wanted out was told to hand it
         * over first and had no way to simply be finished with it. Now leaving is always allowed
         * and the leader is told what it will cost before they do it, which is the client's job
         * (`LeaveDialog`) and the reason the same rule is a shared function rather than a branch
         * living here. Handing over first still works, and is the way to leave without ending it:
         * after the handover this caller is a chief and takes the ordinary path below.
         */
        if (leavingDisbands(held.rank, members.length)) {
          notifyFaction(app.repos, held.factionId, {
            kind: 'faction_left',
            title: `${request.currentUser.username} disbanded the faction`,
            body: 'The faction they led is gone.',
            link: '/game/faction',
            now,
            exceptUserId: userId,
          });
          app.repos.factions.disband(held.factionId);
          return answer(userId);
        }

        app.repos.factions.removeMember(userId);
        notifyFaction(app.repos, held.factionId, {
          kind: 'faction_left',
          title: `${request.currentUser.username} has left the faction`,
          body: '',
          link: '/game/faction',
          now,
        });
        return answer(userId);
      })();
    },
  );

  /**
   * Disbanding on purpose, rather than by walking out of an empty room.
   *
   * The leader can already end a faction by leaving it, so this route exists for the case where
   * that reads wrong: a leader with four people at the table who wants the faction *closed* rather
   * than handed on. Same outcome, said out loud, and it is the one destructive control on the
   * screen that is not reachable by accident.
   */
  app.post(
    '/factions/disband',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const userId = request.currentUser.id;
      return app.db.transaction(() => {
        const held = membership(userId);
        if (!canAdminister(held.rank)) refuse('not_allowed');

        notifyFaction(app.repos, held.factionId, {
          kind: 'faction_left',
          title: `${request.currentUser.username} disbanded the faction`,
          body: 'The faction they led is gone.',
          link: '/game/faction',
          now: new Date(),
          exceptUserId: userId,
        });
        app.repos.factions.disband(held.factionId);
        return answer(userId);
      })();
    },
  );

  app.post(
    '/factions/member',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const { userId: targetId, action } = parseBody(
        FactionMemberActionRequestSchema,
        request.body,
      );
      const userId = request.currentUser.id;

      return app.db.transaction(() => {
        const held = membership(userId);
        const target = app.repos.factions.membershipOf(targetId);
        if (!target || target.factionId !== held.factionId) refuse('not_a_member');
        if (targetId === userId) refuse('not_allowed');

        const now = new Date();
        switch (action) {
          case 'kick': {
            // One question, two ranks, answered in the domain: a chief may remove a member and
            // nobody else, and nobody removes the leader. See `canKick`.
            if (!canKick(held.rank, target.rank)) refuse('not_allowed');
            app.repos.factions.removeMember(targetId);
            notify(app.repos, {
              userId: targetId,
              kind: 'faction_left',
              title: 'You have been removed from the faction',
              body: '',
              link: '/game/faction',
              now,
            });
            notifyFaction(app.repos, held.factionId, {
              kind: 'faction_left',
              title: `${app.repos.users.findById(targetId)?.username ?? 'Somebody'} was removed`,
              body: '',
              link: '/game/faction',
              now,
            });
            return answer(userId);
          }
          case 'promote':
          case 'demote': {
            if (!canSetRank(held.rank)) refuse('not_allowed');
            // Chiefs do not make chiefs: the leader is the only rank that moves anybody.
            if (target.rank === 'leader') refuse('not_allowed');
            app.repos.factions.setRank(targetId, action === 'promote' ? 'chief' : 'member');
            notify(app.repos, {
              userId: targetId,
              kind: 'faction_joined',
              title:
                action === 'promote'
                  ? 'You are a chief of the faction now'
                  : 'You are an ordinary member of the faction now',
              body: '',
              link: '/game/faction',
              now,
            });
            return answer(userId);
          }
          case 'hand_over': {
            if (!canAdminister(held.rank)) refuse('not_allowed');
            // Both writes or neither: a faction with two leaders and a faction with none are both
            // states nothing else in this file knows how to read.
            app.repos.factions.setRank(targetId, 'leader');
            app.repos.factions.setRank(userId, 'chief');
            notify(app.repos, {
              userId: targetId,
              kind: 'faction_joined',
              title: 'You lead the faction now',
              body: `${request.currentUser.username} handed it over.`,
              link: '/game/faction',
              now,
            });
            return answer(userId);
          }
        }
      })();
    },
  );

  /**
   * §A4: sending units to an ally's fight.
   *
   * Deliberately the *same* code path a crew uses to deploy into their own battle
   * (`adjustDeployment`), which is what makes this feature real rather than cosmetic: the units
   * leave this crew's roster, walk for the same travel time, land in this crew's own row on that
   * side, fight in the same engine and come home to this crew through the same split. A second
   * bespoke path would have been a second set of rules about supply, travel and losses.
   */
  app.post(
    '/factions/reinforce',
    { preHandler: app.authenticate },
    (request): FactionMutationResponse => {
      const { battleId, army } = parseBody(ReinforceRequestSchema, request.body);
      const userId = request.currentUser.id;

      return app.db.transaction(() => {
        const held = membership(userId);
        const base = app.repos.bases.findByOwnerId(userId);
        if (!base) refuse('not_a_member');

        const battle = app.repos.sieges.find(battleId);
        if (!battle || battle.resolvedAt !== null) refuse('no_such_invite');

        // The fight has to belong to somebody at this table. Without this check a battle id would be
        // a way to put units into any fight in the city, which is a different game.
        const allies = new Set(
          app.repos.factions
            .members(held.factionId)
            .flatMap((row) => app.repos.bases.findByOwnerId(row.userId)?.id ?? []),
        );
        const attackerRows = app.repos.sieges.side(battle.id, 'attacker');
        const defenderRows = app.repos.sieges.side(battle.id, 'defender');
        const allyOnAttack =
          allies.has(battle.attackerBaseId) ||
          attackerRows.some((row) => row.baseId !== null && allies.has(row.baseId));
        const allyOnDefence = defenderRows.some(
          (row) => row.baseId !== null && allies.has(row.baseId),
        );
        if (!allyOnAttack && !allyOnDefence) refuse('not_a_member');

        const now = new Date();
        const settled = settleBase(app.repos, base, now).base;
        const result = adjustDeployment(app.repos, {
          base: settled,
          battle,
          side: allyOnAttack ? 'attacker' : 'defender',
          // Positive only: this route sends help. Pulling your own units back out of an ally's fight
          // is the ordinary deployment screen's job, against the same row.
          changes: army,
          perimeterChanges: {},
          now,
        });
        if (result.kind === 'refused') {
          throw new AppError('BATTLE_REFUSED', REFUSAL_MESSAGES[result.reason]);
        }

        // The ally hears about it, because a column arriving is a fact about *their* fight.
        const ownerOfBattle = app.repos.bases.findById(battle.attackerBaseId)?.ownerId;
        if (ownerOfBattle && ownerOfBattle !== userId) {
          notify(app.repos, {
            userId: ownerOfBattle,
            kind: 'reinforcement_arrived',
            title: `${request.currentUser.username} is sending help`,
            body: 'Units are on the road to a fight of yours.',
            link: '/game/battles',
            now,
          });
        }
        return answer(userId);
      })();
    },
  );
}
