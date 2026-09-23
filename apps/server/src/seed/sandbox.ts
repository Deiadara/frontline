import {
  BUILDING_KINDS,
  levelCeilingFor,
  RESOURCE_KEYS,
  storageCapacity,
  storageCapacityFor,
  capLegendaries,
  PLAYER_UNITS,
  type Army,
  type Building,
  type ResourceKey,
  type Resources,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { sendMessage } from '../social/send.js';
import {
  MVP_ALLY,
  MVP_BOT,
  MVP_FACTION,
  MVP_RIVAL_FACTION,
  MVP_RIVAL_SECOND,
} from './constants.js';

/**
 * `UNLOCKED=true`: the whole game, standing, on the seeded dev account.
 *
 * A design pass cannot judge what it cannot see, and almost everything interesting here is behind
 * twenty levels of Nexus: the late structures, the units they authorise, a stockpile with enough
 * digits to break the HUD's layout. Playing to it takes days; without it a reviewer looks at the
 * first hour and calls that the game.
 *
 * So this is a **sandbox switch**, not a cheat. Off unless the environment says otherwise, it only
 * ever touches the seeded dev account, and it is applied on every boot rather than only at creation:
 * a flag you have to delete the database to try is a flag nobody tries.
 *
 * It deliberately fabricates nothing the rules could not produce: every value below is one the game
 * would eventually reach, so what a reviewer looks at is the real end-game rather than a mock of it.
 * Research is pointedly left alone for that reason: a programme is *worked through* on the Lab's one
 * bench, and granting the rungs outright would be inventing a state the mechanic does not have.
 */

/** Level 20 is the ceiling the game actually has, so "end-game" means exactly this. */
export const UNLOCKED_LEVEL = 20;

/**
 * Every structure standing at its ceiling, so no plot is empty and none is mid-curve.
 *
 * Each structure's own ceiling, not the global one. The Garage and the Infirmary stop at 10, and
 * seeding them at 20 would put a level in the database that no build queue could ever produce,
 * which is the one thing this seed's own doc comment promises not to do: the plot dialog would
 * read "MAXED AT LEVEL 10" over a structure standing at 20.
 */
export function maxedBuildings(): Building[] {
  return BUILDING_KINDS.map((kind) => ({
    id: `unlocked-${kind}`,
    kind,
    level: levelCeilingFor(kind),
    modifications: [],
  }));
}

/**
 * How full the stockpile is left, as a share of what a level-20 Apothecary holds.
 *
 * Just under the ceiling on purpose. The first version of this handed out a flat 900,000 of
 * everything, which is roughly twenty times what the rules allow a district to store, so every
 * capacity bar in the HUD pinned to full and went red, and the end-game a reviewer was shown was
 * one permanently screaming that it was overflowing. Near-full is the interesting state and a real
 * one: the bars read as nearly-there, the warning copy is one raid away, and nothing on screen is a
 * number the game could not have produced.
 */
export const UNLOCKED_FULLNESS = 0.86;

/**
 * A real end-game stockpile: near the ceiling the maxed Apothecary actually sets, per shelf.
 *
 * Per shelf, and derived off `RESOURCE_KEYS`, because the three of them are different sizes now: a
 * flat figure would pin the metal bar to full and leave the bulk ones a third along, which is the
 * same "number the game could not have produced" the note above is about. Caps have no ceiling, so
 * they get the bulk figure: a plausible end-game wallet rather than an arithmetic accident.
 */
export function unlockedResources(buildings: readonly Building[]): Resources {
  const bulk = storageCapacity(buildings);
  const near = (key: ResourceKey): number => {
    const room = storageCapacityFor(buildings, key, bulk);
    return Math.round((Number.isFinite(room) ? room : bulk) * UNLOCKED_FULLNESS);
  };
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, near(key)])) as Resources;
}

/**
 * A dozen of every unit, so every roster card renders and the slot count reads like a real army.
 *
 * ...except the legendaries, which are one each (maintainer, 2026-09-19: "you can have up to 1 of
 * each legendary unit, no more, and remove any excess that the console gives you"). This was the
 * one door in the game that broke the rule: `trainUnits` has refused a second unique since they
 * existed, and this handed out twelve of all seven.
 */
export function fullArmy(): Army {
  // ...and never the Combine's sheets, which no console may grant (`UnitSpec.faction`).
  return capLegendaries(Object.fromEntries(PLAYER_UNITS.map((unit) => [unit.id, 12])));
}

export interface SandboxSummary {
  applied: boolean;
  baseId?: string;
}

/**
 * Raises the seeded dev account to the end-game state, in place.
 *
 * Idempotent: it writes the same values every boot, so restarting with the flag on is a no-op after
 * the first time, and turning the flag *off* leaves the account where the switch left it rather
 * than rolling progress back, because an unlock that un-unlocks is a data-loss bug wearing a
 * feature's clothes.
 */
export function applyUnlockedSandbox(repos: Repositories, username: string): SandboxSummary {
  const user = repos.users.findByUsername(username);
  if (!user) return { applied: false };
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) return { applied: false };

  const buildings = maxedBuildings();
  repos.bases.updateProgression(base.id, UNLOCKED_LEVEL, { xpIntoLevel: 0 });
  repos.bases.updateResources(base.id, unlockedResources(buildings));
  repos.bases.updateDistrict(base.id, buildings, []);
  repos.bases.updateArmy(base.id, fullArmy(), []);
  seedMailbox(repos, user.id, new Date());
  return { applied: true, baseId: base.id };
}

/**
 * A few letters in the sandbox account's inbox (maintainer, 2026-09-24).
 *
 * Every other screen in this save has something on it: the district is built out, the roster is
 * full, the board has work. The mailbox was the one that opened on "Nothing in the box", so the
 * screen could not be looked at without writing to yourself from a second account first.
 *
 * Sent through `sendMessage`, the same function the route uses, so each one lands as a real row
 * with a real bell entry behind it rather than as a fixture the game would not have produced. The
 * senders are the seeded neighbours, and one is left unread so the badge on the bottom bar has a
 * number in it.
 */
function seedMailbox(repos: Repositories, userId: string, now: Date): void {
  // Idempotent: the sandbox runs on every boot, and three more letters every restart would be a
  // mailbox nobody could read by the end of the week.
  if (repos.social.inbox(userId, 1).length > 0) return;

  const letters: readonly {
    from: { username: string };
    faction: string | null;
    subject: string;
    body: string;
    minutesAgo: number;
    read: boolean;
  }[] = [
    {
      from: MVP_ALLY,
      faction: MVP_FACTION.name,
      subject: 'The Tideline Market, oh-three-thirty',
      body: 'Bringing eight Ironsides and the snipers. If anybody has bodies spare, the market is wide open on the north side.',
      minutesAgo: 40,
      read: false,
    },
    {
      from: MVP_BOT,
      faction: MVP_RIVAL_FACTION.name,
      subject: 'You are on the wrong street',
      body: 'Consider this the only warning you get. The Steelbelt is ours and it stays ours.',
      minutesAgo: 6 * 60,
      read: true,
    },
    {
      from: MVP_RIVAL_SECOND,
      faction: null,
      subject: 'A word about the south quay',
      body: 'I have no quarrel with you and no interest in one. Keep off the quay and we can both keep working.',
      minutesAgo: 26 * 60,
      read: true,
    },
  ];

  for (const letter of letters) {
    const sender = repos.users.findByUsername(letter.from.username);
    if (!sender) continue;
    const sentAt = new Date(now.getTime() - letter.minutesAgo * 60_000);
    sendMessage(repos, {
      sender: { id: sender.id, username: sender.username },
      senderFaction: letter.faction,
      recipients: [userId],
      audience: 'player',
      addressedTo: repos.users.findById(userId)?.username ?? 'you',
      subject: letter.subject,
      body: letter.body,
      sentAt,
      notification: {
        kind: 'message_received',
        title: `${sender.username} wrote to you`,
        body: letter.subject,
        link: '/game/messages',
      },
      keepSentCopy: false,
    });
    if (!letter.read) continue;
    // Opened already, so the badge counts one letter rather than three: a mailbox where
    // everything is unread says less about the screen than one with a single mark on it.
    for (const message of repos.social.inbox(userId, 20)) {
      if (message.subject === letter.subject && message.readAt === null) {
        repos.social.markMessageRead(message.id, userId, sentAt.toISOString());
      }
    }
  }
}
