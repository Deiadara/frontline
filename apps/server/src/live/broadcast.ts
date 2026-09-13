import type { LiveEventKind } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { liveHub } from './hub.js';

/**
 * Which shared-world nudge a successful write sends to every open tab (maintainer request, 2026-09-11).
 *
 * One table over the route prefixes rather than a `liveHub.broadcast` line in each of thirty
 * handlers, for the reason the fog is enforced in one function: a write that changes the shared
 * world and forgets to say so is a bug two players notice as two different maps, and a table a
 * new route falls into by its prefix cannot forget. What is *not* here is deliberate: scouting,
 * building, training, research and the crew's own file change nothing another player can see, and
 * the sender's own tabs already learn of those through the write's response and the `base` kind.
 *
 * Only a **successful** write broadcasts (see the hook below). A refusal changed nothing, so
 * announcing it would make every open tab refetch for no reason, which on a busy night is a
 * request storm a player with a mistyped bid can start.
 */
interface Broadcast {
  prefix: string;
  kind: LiveEventKind;
  /** `exact` matches the path alone; otherwise the prefix and everything under it. */
  match?: 'exact';
}

const PREFIXES: readonly Broadcast[] = [
  // The map: a location taken, dug in, worked up or garrisoned; a captured gate raised.
  { prefix: '/city/gate', kind: 'world' },
  { prefix: '/city/garrison', kind: 'world' },
  { prefix: '/city/fortify', kind: 'world' },
  { prefix: '/city/upgrade', kind: 'world' },
  { prefix: '/city/cancel-upgrade', kind: 'world' },
  { prefix: '/city/cancel-fortify', kind: 'world' },
  { prefix: '/city/gate/cancel', kind: 'world' },
  // The board: a fight called, a force moved or withdrawn, an ally's column sent, one recalled.
  // Not the trap, the leader, the boost or the rank: those are one crew's own books, and a tab
  // across the city learns nothing from them it is allowed to see.
  { prefix: '/battles/declare', kind: 'world' },
  { prefix: '/battles/deploy', kind: 'world' },
  { prefix: '/battles/withdraw', kind: 'world' },
  { prefix: '/actions/recall', kind: 'world' },
  { prefix: '/factions/reinforce', kind: 'world' },
  // A faction founded, joined, left or disbanded moves the standings and the badges on the map.
  // An invite, a rank or a blurb moves only the table's own screen, and that is told by name.
  { prefix: '/factions', kind: 'world', match: 'exact' },
  { prefix: '/factions/answer', kind: 'world' },
  { prefix: '/factions/leave', kind: 'world' },
  { prefix: '/factions/disband', kind: 'world' },
  { prefix: '/factions/member', kind: 'world' },
  // A new crew on the map, or one renamed: the name is on every row that names it.
  { prefix: '/overseer', kind: 'world', match: 'exact' },
  { prefix: '/base/district-name', kind: 'world' },
  { prefix: '/settings/profile', kind: 'world' },
  // The barrow and the shelves.
  { prefix: '/market', kind: 'market' },
  { prefix: '/black-market', kind: 'market' },
  // The room: a bid or a sealed one moves every seat's price for everybody in it.
  { prefix: '/bar/bid', kind: 'bar' },
  { prefix: '/bar/seal', kind: 'bar' },
];

/** The kind a write to `path` broadcasts, or null when the write is nobody else's business. */
export function broadcastKindFor(method: string, path: string): LiveEventKind | null {
  // The profile is the one shared-world write that is a PATCH; everything else that changes the
  // world is a POST, and a GET changes nothing.
  if (method !== 'POST' && method !== 'PATCH') return null;
  // Whatever prefix the API is mounted under, and any query string.
  const bare = path.replace(/\?.*$/, '').replace(/^.*?\/api(?=\/)/, '');
  const hit = PREFIXES.find(({ prefix, match }) =>
    match === 'exact' ? bare === prefix : bare === prefix || bare.startsWith(`${prefix}/`),
  );
  return hit ? hit.kind : null;
}

/**
 * The hook that does the broadcasting.
 *
 * `onResponse`, so the handler has returned: every write route commits its transaction
 * synchronously (better-sqlite3) inside the handler, so by the time the reply has gone the row is
 * on disk and a tab that refetches on the nudge reads the new world, never the old one.
 */
export function registerLiveBroadcast(app: FastifyInstance): void {
  app.addHook('onResponse', (request, reply, done) => {
    if (reply.statusCode < 400) {
      const kind = broadcastKindFor(request.method, request.url);
      if (kind !== null) liveHub.broadcast(kind, new Date());
    }
    done();
  });
}
