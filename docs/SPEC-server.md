# SPEC: Server (`apps/server`)

The REST contract the server dev implements. The scaffold already boots (`/health`, CORS, JWT
plugin, sqlite + migrations). Implement everything below in `apps/server/src`: register routes
from `buildApp()` in `app.ts`. Do not redefine domain types: import every schema/type/constant
from `@frontline/shared`.

## Conventions

- All endpoints are JSON under `/api` (except `GET /health`).
- **Validation**: parse every request body with the shared Zod schema (`safeParse`); on failure
  respond `400` with code `VALIDATION_ERROR` and a human-readable message.
- **Error envelope** (every non-2xx response): `{ "error": { "code": string, "message": string } }`
  (`ApiErrorSchema`). Codes are `SCREAMING_SNAKE`: `VALIDATION_ERROR`, `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `USERNAME_TAKEN`, `INVALID_CREDENTIALS`, `OVERSEER_ALREADY_CHOSEN`,
  `UNKNOWN_PRESET`, `NO_BASE`, `INVALID_TARGET`, `INTERNAL`.
- **Auth**: `Authorization: Bearer <jwt>` on everything except `register`, `login`, `/health`.
  JWT payload is `{ sub: userId }` (`JwtPayload` in `src/types.ts`), signed with `JWT_SECRET`
  via the already-registered `@fastify/jwt`. Missing/invalid token → `401 UNAUTHORIZED`.
  Recommended: an `authenticate` decorator/preHandler that verifies the token and loads the user
  row (`401` if the user no longer exists).
- **Passwords**: bcrypt-hashed via `bcryptjs` (cost 10). Rules come from the shared
  `PasswordSchema`: min 8 / max 128 chars. Never return or log password material; convert rows to
  the shared `User` shape before responding (see `UserRecord` in `src/types.ts`).
  Note for the product owner's "single shared password" idea: we satisfy it with normal
  per-user passwords: every account registers with its own password; nothing else is needed.
- **Ids**: `crypto.randomUUID()`. **Timestamps**: ISO-8601 UTC strings (`new Date().toISOString()`).
- **Persistence**: better-sqlite3 (synchronous: no `await` on db calls). Tables exist from
  `0001_init.sql`: `users`, `overseers`, `bases`, `battles` (+ `schema_migrations`). JSON payload
  columns (`attributes_json`, `perks_json`, `resources_json`, `buildings_json`, `log_json`,
  `rewards_json`) are
  serialized with `JSON.stringify` and parsed through the shared Zod schemas when read.
  (Fallback note: if better-sqlite3's native build ever fails on a machine, swap
  `src/db/index.ts` to Node 24's built-in `node:sqlite` `DatabaseSync`: same synchronous shape.
  Not needed on the current machine; the prebuilt binary installs fine.)

## Endpoints

### `GET /health` (public): implemented

`200 {"status":"ok"}`.

### `POST /api/auth/register` (public)

Body: `RegisterRequestSchema` `{username, password}`.

- Username unique (case-insensitive: the column is `COLLATE NOCASE`); conflict → `409 USERNAME_TAKEN`.
- Create user: `overseer_id = NULL`, bcrypt-hash the password.
- `201` → `AuthResponseSchema` `{token, user}`.

### `POST /api/auth/login` (public)

Body: `LoginRequestSchema` `{username, password}`.

- Unknown username or bcrypt mismatch → `401 INVALID_CREDENTIALS` (same message for both).
- `200` → `AuthResponseSchema` `{token, user}`.

### `GET /api/me` (auth)

`200` → `MeResponseSchema` `{user, overseer, base}`: `overseer`/`base` are `null` until the
player has run `POST /api/overseer`. (One base per user in this milestone; pick the user's base
by `owner_id`.)

### `POST /api/overseer` (auth)

Body: `CreateOverseerRequestSchema` `{presetId}`.

- User already has an overseer → `409 OVERSEER_ALREADY_CHOSEN`.
- `findOverseerPreset(presetId)` undefined → `400 UNKNOWN_PRESET`.
- In one transaction: create the overseer from the preset (fresh id, copy name/archetype/
  portraitId/bio/attributes/perks), set `users.overseer_id`, and create the starting base:
  district `STARTER_DISTRICT_ID`, level 1, `STARTING_RESOURCES`, buildings =
  `[nexus L1, generator L1]` (fresh ids, empty `modifications`), an empty `buildQueue`, and the
  faction name `"<username>'s Crew"` truncated to `FACTION_NAME_MAX`.
- `201` → `CreateOverseerResponseSchema` `{user, overseer, base}`.

### `GET /api/city` (auth)

`200` → `CityResponseSchema` `{districts: CITY_DISTRICTS, bases}` where `bases` is ALL bases
projected through `BaseSummarySchema` (id/ownerId/name/districtId/level only: never resources
or buildings of other players).

### `POST /api/city/upgrade` (auth)

Body: `UpgradeLocationRequestSchema` `{locationId}`. Works a location you hold up one level
(GDD §A4). Charged up front, a clock on the control row, banked by `settleFortifications` on the
next read of the city: the same lazy contract fortifying uses, and the same settler.

A location is captured at level 1 and can be worked to `MAX_LOCATION_LEVEL` (4). Each level pays
more (`LEVEL_SCALE`) and each upgrade costs more than the last (`UPGRADE_COST_SCALE`). **A capture
resets it to 1** and cancels any work in progress: `battle/resolve.ts`, not this route.

Refusals, all `409`:

| Reason                          | Code                     |
| ------------------------------- | ------------------------ |
| Not held by the caller          | `PLACE_UNAVAILABLE`      |
| Already at `MAX_LOCATION_LEVEL` | `PLACE_UNAVAILABLE`      |
| Work already under way there    | `PLACE_UNAVAILABLE`      |
| Stockpile does not cover it     | `INSUFFICIENT_RESOURCES` |

`200` → `CityMutationResponseSchema` `{district, base}`.

### `GET /api/base/:id` (auth)

- No such base → `404 NOT_FOUND`.
- Base not owned by the caller → `403 FORBIDDEN` (owner-only in this milestone).
- `200` → `BaseDetailResponseSchema` `{base}`.

### `POST /api/base/build` (auth)

Body: `BuildStructureRequestSchema` `{kind}`. Puts one structure's **next level** into the build
queue (GDD §A1). It does not raise anything. `settleBase` runs first, so an order that finished
while the tab was open lands before the queue is measured against its limit.

Refusals, all `409`, in the order they are checked:

| Reason                                                             | Code                     |
| ------------------------------------------------------------------ | ------------------------ |
| An unlock clause is unmet: Nexus, another structure, or crew level | `STRUCTURE_LOCKED`       |
| Already at `BUILDING_MAX_LEVEL`                                    | `STRUCTURE_AT_MAX_LEVEL` |
| Held down by the Nexus's own level                                 | `NEXUS_CAP`              |
| All `MAX_BUILD_QUEUE` slots working                                | `BUILD_QUEUE_FULL`       |
| Materials short                                                    | `INSUFFICIENT_RESOURCES` |

Materials are taken at order time. Price and duration are read off the district **as it stands**
and frozen onto the entry; only the _level_ comes from the queue's projection, so a player may
queue the Nexus and the structure it unlocks together.

Unlocking is a **clause list** per structure (§A1, §I3), and all of them must hold: `building`
clauses name another structure at a level (the Nexus rung is the most important instance, not a
separate rule) and `player_level` clauses name the crew's own level. Several structures carry one
clause, several carry two and the heavy ones carry three: a `STRUCTURE_LOCKED` refusal names every
unmet clause at once rather than the first, so a player is not sent off to do a thing that will not
unlock it.

`200` → `BuildStructureResponseSchema` `{base, levelUp?}`.

### `POST /api/base/faction` (auth)

Body: `RenameFactionRequestSchema` `{name}`: trimmed and bounded by `FactionNameSchema`.
`200` → `RenameFactionResponseSchema` `{base}`.

### Lazy settlement

Every read path that touches a base calls `settleBase`, which runs **the district first and
training second**: a batch landing does not feed anything else in the settle. There used to be a
weekly upkeep pass between the two, taking supplies out of the store for every officer on the
books. No recurring charge is left in the game, so nothing settles on a calendar.

The district settle walks the window rather than multiplying it. It is cut at each completed
build so a structure that finished an hour ago is not paid for the three days the district went
unread. It skips windows shorter than `PRODUCTION_MIN_STEP_MS` **without advancing the clock**, so
nothing is lost to a fast-polling client.

### `POST /api/battle` (auth)

Body: `BattleRequestSchema` `{targetDistrictId}`.

- Caller has no base yet → `409 NO_BASE`.
- District unknown, or `kind` not in `('raid', 'npc_stronghold')` → `400 INVALID_TARGET`.
- Run the engine: `defaultBattleEngine.simulate({attackerBaseId, targetDistrictId})`: depend on
  the `BattleEngine` interface, not the concrete class (it will be swapped, see
  docs/ARCHITECTURE.md).
- Persist a `battles` row (fresh id, winner, log, rewards, created_at).
- On attacker win apply rewards to the base with `addResources` and persist; same transaction as
  the battle insert.
- `200` → `BattleResponseSchema` `{result, resources}` (`resources` = attacker base stockpile
  after payout).

### Declared battles (§A4, battle rework)

Six endpoints, all under `/api/battles`, all answering with the whole board so a client never has
to reconstruct it. Schemas are in `packages/shared/src/api.battle.ts`.

Every handler settles in the same order the city routes use, with one more step on the end: the
crew's district and payroll, then any fortification whose clock ran out, then **any fight whose mark
has passed**. There is no scheduler: `settleBattles` runs on the read, and a fight nobody has looked
at for three days resolves to the same result whenever it is next opened.

- `GET /api/battles` → `BattlesResponseSchema`. Coming fights the caller is in or can see, finished
  ones they are allowed to read, the half-hour marks open right now, their infamy and what it buys,
  their own structures, and the gate state of every district they can see into.
- `POST /api/battles/declare`: `{target, scheduledFor}`. Refused (`409 BATTLE_REFUSED`) for a mark
  off the half hour, inside eight hours or past twenty-four; for a location in a district one party
  holds outright (attack the gate); for a gate where no one party holds all of it; for a structure
  behind a gate that is still standing; for unscouted ground, ground already called, a fourth
  simultaneous call, or your own.
- `POST /api/battles/deploy`: `{battleId, changes, perimeterChanges}`, both **deltas**. Positive
  sends, negative withdraws. Units leave the roster when sent and return when pulled, less whatever
  the enemy's ring takes on the way out. Refused past the cutoff, for units the crew does not have,
  and for units whose tier demands more infamy than the crew has earned.
- `POST /api/battles/trap`: `{locationId, trapId}`. One armed trap per location, gated on the Lab.
- `POST /api/battles/garrison`: `{buildingId, delta}`. Up to three watches per structure.
- `POST /api/battles/sacrifice`: `{sacrificeId}`. Spends infamy outright; `409 NOT_ENOUGH_INFAMY`
  when the name is not worth it. One at a time.

The **report** is withheld rather than redacted: the winner always gets one, the loser only if at
least one unit fled and made it home. A redacted report leaks the shape of what was kept back, and a
perimeter is bought to buy a silence.

## Status code summary

| Code | Used for                                                                         |
| ---- | -------------------------------------------------------------------------------- |
| 200  | Successful reads, login, battle                                                  |
| 201  | register, overseer+base creation                                                 |
| 400  | Zod validation failure, `UNKNOWN_PRESET`, `INVALID_TARGET`                       |
| 401  | Missing/invalid/expired token, `INVALID_CREDENTIALS`                             |
| 403  | Accessing someone else's base detail                                             |
| 404  | Unknown base id (and unknown routes)                                             |
| 409  | `USERNAME_TAKEN`, `OVERSEER_ALREADY_CHOSEN`, `NO_BASE`                           |
| 500  | Unhandled errors → `INTERNAL` (set a Fastify error handler that hides internals) |

## Testing expectations

Vitest is configured. Use `buildApp` + `app.inject()` against `openDatabase(':memory:')` +
`runMigrations` (see `src/app.test.ts` for the pattern). Cover at minimum: register/login round
trip, auth rejection, overseer creation (double-create conflict), city projection contains no
private fields, battle persists a row and pays rewards on a forced attacker win (inject a
`RandomBattleEngine` with a fixed `random` fn).
