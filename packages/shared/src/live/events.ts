import { z } from 'zod';

/**
 * What the server pushes down the live channel.
 *
 * ## A nudge, not a payload
 *
 * Every event here says *that* something changed and never *what* it changed to. The client answers
 * one by refetching through the ordinary query it already has, so there is exactly one code path
 * that turns server state into screen state, and it is the one that is exercised on every load.
 *
 * The alternative, pushing the new state down the socket, is how live features usually rot: the
 * push path and the fetch path drift, and the bug that follows is a screen that is right after a
 * reload and wrong after an event. Sending a nudge costs one extra round trip on a connection that
 * is already open, and buys immunity from that whole class.
 *
 * ## Why the kinds are coarse
 *
 * A kind names a *screen family*, not a table. The client maps each to the query keys it
 * invalidates. Coarse kinds mean a new emitter on the server needs no client change: a new sort of
 * receipt is still `notification`, and the notifications screen is already listening.
 */
export const LIVE_EVENT_KINDS = [
  /** A receipt was written for you: the bell, the unread count, the notifications list. */
  'notification',
  /** A fight resolved, or one was declared against you. Battles, city, and the base under it. */
  'battle',
  /** Mail arrived, including a faction invite. */
  'message',
  /** Your faction changed under you: a member joined or left, a rank moved, it disbanded. */
  'faction',
  /** Your own holdings moved for a reason you did not cause on this tab. */
  'base',
  /*
   * The three below are **broadcast**: every open tab gets them, because what changed is the one
   * world everybody shares (maintainer request, 2026-09-11: two players looking at the same street
   * must see the same street). Still a nudge and never a payload, so a tab learns *that* the map
   * moved and refetches it through its own fogged, authenticated read.
   */
  /** Shared ground moved: a location changed hands or was dug in, a fight was called or settled, a gate went up or down, the standings moved. */
  'world',
  /** The market moved: a listing posted, taken or withdrawn, a bid on the Runner's barrow, a lot closed. */
  'market',
  /** The Bar moved: a bid on a seat, a table closed. */
  'bar',
] as const;

export type LiveEventKind = (typeof LIVE_EVENT_KINDS)[number];

export const LiveEventSchema = z.object({
  kind: z.enum(LIVE_EVENT_KINDS),
  /** Server time, ISO. The client never reads its own clock to decide when this happened. */
  at: z.string(),
});

export type LiveEvent = z.infer<typeof LiveEventSchema>;

/**
 * How long a client waits before deciding a silent channel is a dead one.
 *
 * The server sends a comment line every `LIVE_HEARTBEAT_MS`, so silence for meaningfully longer
 * than that is a proxy or a laptop lid rather than a quiet game. Set to three beats: two would trip
 * on one dropped packet, and a false reconnect costs a round trip and a refetch storm.
 */
export const LIVE_HEARTBEAT_MS = 20_000;
export const LIVE_SILENCE_TIMEOUT_MS = LIVE_HEARTBEAT_MS * 3;

/**
 * How long a connection has to stay up before it counts as a good one.
 *
 * The backoff needs an answer to "did that work?", and the obvious answers are both wrong. Response
 * headers are wrong because a proxy that accepts a request and closes it produces `res.ok`. The
 * first byte is wrong too, and that is the one that was in use: the server writes a `ready` frame
 * before anything else, on purpose, so *every* connection that opens at all delivers a byte,
 * including a server in a crash loop that dies a moment later. A client reconnecting into a crash
 * loop therefore reset its backoff every time and hammered the box about once a second, taking a
 * full cache invalidation with it on each pass.
 *
 * Time up is the honest measure, and one heartbeat is the natural length of it: a channel that
 * lived long enough to be sent a beat was a working channel, and one that died before its first
 * beat was not, whatever it managed to write on the way up.
 */
export const LIVE_STABLE_MS = LIVE_HEARTBEAT_MS;
