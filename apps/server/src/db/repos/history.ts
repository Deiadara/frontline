import type { AppDatabase } from '../index.js';

/**
 * The append-only record of everything that has happened.
 *
 * The rest of the database stores *state*: what a district looks like now. This stores the
 * transitions, which is the only thing that can answer "how did it get like this" after a bad
 * restore, a balance argument or a bug report. Nothing reads it to make a decision — the moment a
 * rule depends on history, history stops being safe to prune and starts being state with a worse
 * schema.
 *
 * Writes are best-effort by design: `record` never throws. A ledger that can take the request that
 * was being logged down with it is worse than no ledger, and the one thing that must never fail
 * because of an audit trail is the move the player just made.
 */

export type EventKind =
  | 'account.registered'
  | 'account.login'
  | 'account.profile_changed'
  | 'account.password_changed'
  | 'blackmarket.taken'
  | 'admin.knobs'
  | 'backup.taken';

export interface GameEvent {
  actorId: string | null;
  baseId: string | null;
  kind: EventKind;
  payload: unknown;
  at: string;
}

export interface HistoryRepo {
  record(event: Omit<GameEvent, 'at'> & { at?: string }): void;
  /** Newest first. For the admin bench and for anybody reading a save after the fact. */
  recent(limit: number): GameEvent[];
}

export function createHistoryRepo(db: AppDatabase): HistoryRepo {
  const insertStmt = db.prepare(
    `INSERT INTO game_events (actor_id, base_id, kind, payload_json, at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const recentStmt = db.prepare('SELECT * FROM game_events ORDER BY id DESC LIMIT ?');

  return {
    record(event) {
      try {
        insertStmt.run(
          event.actorId,
          event.baseId,
          event.kind,
          JSON.stringify(event.payload ?? {}),
          event.at ?? new Date().toISOString(),
        );
      } catch {
        // See the module note: the trail is never allowed to be the reason a move fails.
      }
    },
    recent(limit) {
      const rows = recentStmt.all(limit) as {
        actor_id: string | null;
        base_id: string | null;
        kind: string;
        payload_json: string;
        at: string;
      }[];
      return rows.map((row) => ({
        actorId: row.actor_id,
        baseId: row.base_id,
        kind: row.kind as EventKind,
        payload: JSON.parse(row.payload_json) as unknown,
        at: row.at,
      }));
    },
  };
}
