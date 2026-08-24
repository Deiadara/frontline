# Recovering the database

The server keeps a rolling set of point-in-time snapshots. Restoring one takes three commands and
replays nothing.

## What is on disk

| Path                                            | What it is                                         |
| ----------------------------------------------- | -------------------------------------------------- |
| `$DATABASE_PATH` (default `./frontline.sqlite`) | The live database.                                 |
| `frontline.sqlite-wal`, `-shm`                  | Its write-ahead log and shared-memory index.       |
| `$BACKUP_DIR` (default `./backups`)             | Snapshots, named `frontline-<ISO instant>.sqlite`. |

A snapshot is a **whole database**, taken with `VACUUM INTO` inside a single read transaction. It
has no `-wal` sidecar of its own, it is defragmented, and it carries its own `schema_migrations`
table — so a restore never needs a migration re-run and never needs anything replayed on top.

Snapshots are taken every **10 minutes** (`BACKUP_INTERVAL_MS`) and the newest **24** are kept
(`BACKUP_KEEP`), which is a rolling window of four hours. The admin bench (`/game/admin`) lists what
is currently on disk with its timestamp and size, so the choice can be made without an ssh session.

## Restoring

```bash
# 1. Stop the server. Nothing below is safe against a live writer.
#    (Ctrl-C the dev process, or stop the service.)

# 2. Move the damaged database aside — all three files. The -wal is part of the
#    database's persistent state, and leaving it next to a restored main file is
#    the classic way to corrupt the thing you just restored.
mkdir -p ./corrupt
mv frontline.sqlite      ./corrupt/ 2>/dev/null || true
mv frontline.sqlite-wal  ./corrupt/ 2>/dev/null || true
mv frontline.sqlite-shm  ./corrupt/ 2>/dev/null || true

# 3. Copy the chosen snapshot into place. Copy, do not move: the snapshot stays
#    in the backup directory in case the restore itself needs redoing.
cp backups/frontline-2026-08-16T09-50-00-000Z.sqlite frontline.sqlite

# 4. Start the server.
pnpm --filter @frontline/server dev
```

The server runs migrations on boot. A snapshot from an older build is brought up to the current
schema on that first boot, so an old snapshot is still a valid restore target.

## Checking a snapshot before you trust it

```bash
sqlite3 backups/frontline-2026-08-16T09-50-00-000Z.sqlite 'PRAGMA integrity_check;'
sqlite3 backups/frontline-2026-08-16T09-50-00-000Z.sqlite \
  'SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM bases; SELECT MAX(name) FROM schema_migrations;'
```

`integrity_check` answering `ok` and a plausible row count is the whole check. If a snapshot is
damaged, take the next one down the list — they are independent files, not a chain.

## What was lost

At most the ten minutes between the chosen snapshot and the incident. To find out exactly what,
read `game_events` in the **damaged** database if it still opens: it is an append-only record of
every account change, black-market purchase and admin knob, with the actor and the instant. Nothing
in the game reads that table to make a decision, so it is safe to read out of a broken save.

```bash
sqlite3 ./corrupt/frontline.sqlite \
  "SELECT at, kind, base_id FROM game_events WHERE at > '2026-08-16T09:50:00.000Z' ORDER BY id;"
```

## Configuration

| Variable        | Default              | Effect                                           |
| --------------- | -------------------- | ------------------------------------------------ |
| `DATABASE_PATH` | `./frontline.sqlite` | Where the live database lives.                   |
| `BACKUP_DIR`    | `./backups`          | Where snapshots are written.                     |
| `BACKUPS`       | on                   | `BACKUPS=false` turns the schedule off entirely. |

## Why it is done this way

Researched rather than assumed, and the sources are in the module doc on
`apps/server/src/db/backup.ts`. The short version:

- **Server-authoritative, single source of truth.** Browser storage is borrowed, not owned — it has
  quotas, eviction policies and no persistence guarantee, and several mobile in-app browsers treat
  it as a cache. Nothing about a player's progress lives in the browser; the client holds a JWT and
  a react-query cache and that is all.
- **A relational database, taken whole.** SQLite in WAL mode is the right size for this game and
  scales to a Postgres migration without changing a line of application code, because everything
  goes through the repository layer.
- **`VACUUM INTO`, never a file copy.** In WAL mode the newest committed data is in the `-wal`
  sidecar. Copying `frontline.sqlite` on its own is the standard way to take a backup that silently
  loses the last few minutes, or captures a torn page mid-checkpoint. `VACUUM INTO` runs inside one
  read transaction against a live database and writes one consistent, defragmented file.
- **A schedule plus retention, not one snapshot.** Frequent cheap snapshots with a rolling window is
  the pattern every production SQLite guide converges on. Continuous replication (Litestream and
  friends) is the next step up if the board ever wants a recovery point measured in seconds rather
  than minutes; nothing here would have to change to adopt it.
