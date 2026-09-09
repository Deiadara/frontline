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

A location can be worked to `MAX_LOCATION_LEVEL` (10). Each level pays more (`LEVEL_SCALE`, linear
at +0.5 of the level-1 value per level) and each upgrade costs more than the last
(`UPGRADE_COST_SCALE`, a doubling for the first three steps and a flat 1.4x after that). Each level
above the first also adds `POPULATION_PER_LOCATION_LEVEL` (3) beds on top of the flat
`POPULATION_PER_LOCATION` (20) every held location pays, and takes 2% off the price and 3% off the
clock of any unit that location unlocks (`homeTrainingBonus`).

**A capture keeps the level** and only cancels work in progress: `battle/resolve.ts`, not this
route. The district gate is a separate rule and still resets (`resetGateOnDistrictLost`).

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

`levelUp` is drained rather than derived. `awardPlayerXp` is the only writer of `Base.level` and it
banks every crossing into a durable marker (migration 0083, `bases.pending_level_up_json`, kept off
`Base` and off the wire); `takeLevelUp` reads that marker and clears it. So a level a settle banked
with no response to carry it, the world clock bringing a crew home at 03:00, a build finishing on a
poll of `/crew`, is announced by the next response that carries a `levelUp` rather than lost.
`GET /api/me`, `GET /api/missions`, `POST /api/missions`, `POST /api/missions/:id/recall` and
`POST /api/base/build` (success and refusal alike) are the responses that drain it.

### The Bar (§H, §H7a)

Five endpoints under `/api/bar`. Schemas are in `packages/shared/src/api.ts` and
`packages/shared/src/bar/auction.ts`.

The roster is never stored: §H2a makes it a pure function of the game day (Athens) and of the
city's average level, so every request recomputes it and two accounts asking on the same day are
served the same people. What is stored is what the players did to it: `bar_bids`, `bar_auction_results`
and the `bar_hires` signing log.

- `GET /api/bar` → `BarResponseSchema`. Settles last night's tables first (see below), then returns
  the room, the officers on the books, the payroll ledger, one `BarAuction` per recruit in roster
  order, how many tables this crew is at (`auctionsUsed` / `auctionsAllowed`), and `results`:
  yesterday's outcome for every table this crew sat at, as `won`, `lost`, `passed` (their final was
  highest and they could not take the person) or `unsold`.
- `POST /api/bar/bid`: `{recruitId, amount}`. A public bid, in the open phase. Must beat the leader
  by the increment, or match the reserve on an untouched table.
- `POST /api/bar/seal`: `{recruitId, amount}`. The one secret final value, in the last thirty
  minutes. A crew with no open bid may still lock one, and it counts against the table cap.
- `POST /api/bar/release`: `{officerId}`. Frees their slice of the payroll book and charges
  `DISMISSAL_WEEKS` of it in caps on the spot. `404 NOT_FOUND` for a stranger, `409
INSUFFICIENT_CAPS` when the crew cannot cover it.
- `POST /api/bar/payroll`: `{}`. Buys one step of standing payroll at a server-quoted price.

Both bid routes answer `200` with `BidResponseSchema` `{auction, auctionsUsed, auctionsAllowed}`:
the table as it now stands, so the screen never has to guess what its own bid did. A recruit id
that is not on today's roster is `404 NOT_FOUND`; every other refusal is a `409`, in this order:

| Reason                                                                | Code                  |
| --------------------------------------------------------------------- | --------------------- |
| Wrong phase (`bid` sealed or closed, `seal` before the sealed window) | `BID_REFUSED`         |
| §H3: they will not work for this crew                                 | `RECRUIT_UNAVAILABLE` |
| Already on this crew's books                                          | `RECRUIT_UNAVAILABLE` |
| §H8: no free chair                                                    | `NO_RECRUIT_SLOTS`    |
| Already at `maxOpenAuctionsFor(level)` tables                         | `TOO_MANY_AUCTIONS`   |
| Raising your own leading bid                                          | `BID_REFUSED`         |
| A sealed value already locked                                         | `BID_REFUSED`         |
| Under the minimum (the message carries it)                            | `BID_REFUSED`         |
| The payroll book will not hold the fee                                | `NO_PAYROLL`          |

Admin mode waives the four gates that are about how far along a crew is: `not_interested`,
`no_slots`, `no_payroll` and the §H3 doors. It does not waive the phases, the increment or the
table cap, which are rules about the auction rather than about the crew.

### Closing the day's tables

`settleBarAuctions(repos, now)` is the whole of the close, and it is lazy in the same way every
other clock in this server is. It looks for tables with bids and **no result row** on any day
before today, and settles each one in its own transaction:

1. Rank the finals with `rankBids`: a bidder's final is the higher of their open bid and their
   sealed value, and a tie is broken by a hash of the auction and the crew rather than by row
   order, so the answer does not depend on who ran the close or how often.
2. Walk the ranking and sign the first crew that can take them: not already on their books, a free
   chair, the §H3 doors open, and a fee the payroll book can hold. They go on the **bench**, the
   fee is committed, and `officerHired` XP is awarded.
   The **price** and the **fee** are two numbers on purpose: everything shared (the result row, both
   notifications, `results.price`) carries the price the table closed at, while the winner's payroll
   commitment and their officer's `weeklyWage` carry that price talked down by their own negotiators
   (`committedWage`, §H7's `wageDiscountPercent`). The payroll gate reads the discounted figure at
   the bid as well as at the close, so a crew is never refused a bid its book could have held.
3. Write the result row, which is also what stops the table being settled twice. A table nobody
   could take is recorded with a null winner and a null price.
4. Tell the table: `officer_hired` to the winner, `bar_outbid` to everybody else who bid.

Two doors reach it and both are fine, because it is a function of stored rows: `settleWorld` (so
the world clock closes tables at midnight whether or not anybody is looking) and `GET /api/bar`
(so the first player through the door after midnight sees the result on that read).

### The market and the Runner's lots (market extension)

Schemas are in `packages/shared/src/api.ts` and `packages/shared/src/market/auction.ts`.

The Runner's hours and what he carries are never stored: `vendorSessionsFor` and `vendorStockFor`
are pure functions of the game day (Athens), so two crews asking on the same day are served the same
barrow. What is stored is what the players did to it: `vendor_bids`, `vendor_lot_results`, and the
`vendor_sales` counter that says how many of a line the whole city has taken.

Buying off the barrow is gone. Every line is a **lot** on each **visit** (one of the day's two
sessions): while he is in, crews bid on it in the open, and when he packs up the highest bidder takes
**one** unit and pays their bid. A line with stock left is auctioned again on his next visit, so the
stock count is now how many more visits a line can go on.

- `GET /api/market` -> `MarketResponseSchema`. Sweeps expired listings, closes any visit that is
  over, then draws the board. `vendor.session` is which of today's sessions is running (null while he
  is away), each line carries `auction` (null when nothing is left on the line), and `vendor.results`
  is how the lots this crew bid on ended, from the last visit it bid at, looking back seven days.
- `POST /api/market/bid`: `{lineId, amount}`. Settles first, then takes the bid. `200` with the
  refreshed board; every refusal is `409 MARKET_REFUSED`, in this order: he is not in the district,
  the line is not on today's barrow, the city has cleared the line out, the crew is already the
  highest bid, the bid is under `nextLotBid` (the message carries both figures), the crew cannot
  cover it.

The reserve is the line's price with **no** crew discount on it: two crews bidding against each
other have to be bidding against the same floor. §A4's `marketDiscountPercent` comes off what the
winner is charged at the close instead, so the result row and both notifications carry the number the
lot closed at and the discount is invisible to everybody who was outbid. Nothing is escrowed at the
bid, so caps are checked at the table and again at the close.

### Closing a visit

`settleVendorAuctions(repos, now)` is the whole of the close, lazy like every other clock here. It
looks for lots with bids and **no result row** whose `visitClosesAt(day, session)` has passed, and
settles each in its own transaction:

1. Rank the bids with `rankLotBids` against the line's price, ties broken by a hash of the lot and
   the crew rather than by row order, so the answer does not depend on who ran the close.
2. Walk the ranking and hand the unit to the first crew whose caps cover `discountedCaps(bid, their
marketDiscountPercent)`. The sale is booked against `vendor_sales`, which is what takes the line
   one visit closer to gone.
3. Write the result row, which is also what stops a lot being settled twice and handing a second unit
   off a one-of-a-kind line. A lot nobody could pay for is recorded with a null winner and price.
4. Tell the barrow: `market_won` to the winner, `market_outbid` to everybody else who bid.

Two doors reach it and both are fine, because it is a function of stored rows: `settleWorld` and
`GET /api/market`. `latestLotResultsFor` reads the outcomes back, and tells `passed` (the crew was
top of the ranking and could not cover its own bid) from `lost` and `unsold` by re-running the
ranking.

### `POST /api/base/faction` (auth)

Body: `RenameFactionRequestSchema` `{name}`: trimmed and bounded by `FactionNameSchema`.
`200` → `RenameFactionResponseSchema` `{base}`.

### Lazy settlement

Every read path that touches a base calls `settleBase`, which runs **the district first, training
second and the Lab third**: a batch landing does not feed anything else in the settle, and nothing
above the Lab reads a technology. There used to be a weekly upkeep pass between the first two,
taking supplies out of the store for every officer on the books. No recurring charge is left in the
game, so nothing settles on a calendar.

Research was the exception until 2026-09-07: `settleResearch` ran on `GET /research` and
`POST /research/tech` and nowhere else, so a rung that finished while the player was on any other
screen was not finished. Every door it opens (a declaration slot, a mission slot, a chair at the
Bar, every percentage in the standing fold) stayed shut, and its receipt did not ring until the
player opened the page it points at. `settleResearchFor` folds it into `settleBase` behind its own
due check, so a read that finished nothing still costs one comparison.

Officer drilling (`settleTrainingFor`) is still the one settle that runs only on its own screen. It
writes two tables, the base's training book and the Overseer's attributes, and its own contract
requires both inside one transaction at the call site, which `settleBase` does not provide. Moving
it is a separate change and `training_done` has no emitter until it happens.

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

Eight endpoints, all under `/api/battles`, all answering with the whole board so a client never has
to reconstruct it. Schemas are in `packages/shared/src/api.battle.ts`.

Every handler settles in the same order the city routes use, with one more step on the end: the
crew's district and payroll, then any fortification whose clock ran out, then **any fight whose mark
has passed**. There is no scheduler: `settleBattles` runs on the read, and a fight nobody has looked
at for three days resolves to the same result whenever it is next opened.

- `GET /api/battles` → `BattlesResponseSchema`. Coming fights the caller is in or can see, finished
  ones they are allowed to read, the half-hour marks open right now, their infamy and what it buys,
  their own structures, and the gate state of every district they can see into.
- `POST /api/battles/declare`: `{target, scheduledFor}`. Three target kinds, `location`, `gate` and
  `district`, and which of them is legal is `declarationRefusal` and nothing else. Refused
  (`409 BATTLE_REFUSED`) for a mark off the half hour, inside eight hours or past twenty-four; for a
  location in a shut district (attack the gate); for a gate on a district that is neither held
  outright nor lived on; for a raid behind a gate that is still standing, or on a plot nobody lives
  on; for unscouted ground, ground already called, a fourth simultaneous call, or your own.

#### Raiding a home (§A4, board 2026-09-09)

**A home is shut.** A residential district has no locations, so `districtHolder` answers null for
one; the resident is what shuts it (`districtIsShut`), and the gate that is fought is the resident's
own Gate structure, whose level already reaches the fight through `standingEffectsFor` and
`withGate`. Winning at the gate breaks it for `GATE_BREACH_HOURS` (24), which `gateIsBroken` is the
only reader of.

Inside that day the whole district is one target. A won `district` raid does three things, all in
`breakIn`:

- **Loot.** `plunder` walks the priority order taking up to `MAX_RAID_SHARE` (a quarter) of each
  line, bounded by `lootCapacityOf(committed force, lootCapacityPercent)`, **with caps excluded**:
  caps are first in the order and weigh one apiece, so a raid that could take them filled its hold
  with the victim's wallet and left the materials standing.
- **Disruption.** `refreshDisruption(disruptionFrom(now))` on the resident: production down
  `RAID_DISRUPTION_PERCENT` (25) for `RAID_DISRUPTION_HOURS` (6), and for the same hours every
  _positive percentage_ the crew holds is worth a quarter less. That second half is `disrupted`,
  applied at the end of both `standingEffectsFor` and `crewEffectsFor`, so it reaches every consumer
  of a crew's standing. Negative percentages and flat channels are left alone, and so is
  `productionPercent` (`DISRUPTION_EXEMPT_CHANNELS`): the settle walk already cuts the disruption
  off the _hours_ that channel multiplies, so cutting it here as well would charge one raid twice.
  The two halves do not overlap: production loses its quarter in the walk, everything else loses
  its quarter in the fold.
- **Structures.** `STRUCTURES_WRECKED_PER_RAID` (3) of the resident's standing structures, tallest
  first and ties broken by id, take `damageBuilding(strikeDamage(lossShare))`.

Migration `0087` rewrote every stored `building` target into the `district` target of the same
district, resolved history included, so the repo carries no legacy branch.

- `POST /api/battles/deploy`: `{battleId, changes, perimeterChanges}`, both **deltas**. Positive
  sends, negative withdraws. Units leave the roster when sent and return when pulled, less whatever
  the enemy's ring takes on the way out. Refused past the cutoff, for units the crew does not have,
  and for units whose tier demands more infamy than the crew has earned.
- `POST /api/battles/vehicles`: `{battleId, vehicles}`, **absolute** rather than a delta and the
  whole set in one request. Committed machines leave the Garage exactly as deployed units leave the
  roster and come back the moment the set is narrowed. A column already walking is re-timed from its
  own departure, so loading the yard onto a fight after sending the people still counts. See the
  Garage section below for what a machine is worth on the road.
- `POST /api/battles/lead`: `{battleId, officerId}`, or `officerId: null` to stand somebody down.
  One officer, one fight, and one duty at a time (`crew/duty.ts`): somebody already leading a fight,
  walking home from a scouting run or out on a job is refused with where they are.
- `POST /api/battles/trap`: `{locationId, trapId}`. One armed trap per location, gated on the Lab.
- `POST /api/battles/boost`: `{battleId, boostId}`. One boost per side, and only the crew whose
  fight it is may name it, so an ally cannot burn the slot the principal was going to use.
- `POST /api/battles/notoriety`: no body. Buys the next rung of notoriety with infamy;
  `409 NOT_ENOUGH_INFAMY` when the name is not worth it yet, and `409 PLACE_UNAVAILABLE` at the top
  of the ladder.

### The Garage, and the one arithmetic every road uses (§C3)

- `GET /api/garage` → `GarageResponseSchema`. Every machine in the catalogue, always, with what it
  costs this crew (the Rail Yard's parts discount is already in the quote), how many are parked,
  how many are **out** on a fight or a run, and the one thing standing in the way of building it.
- `POST /api/garage/build`: `{vehicleId}`. Paid for and in the yard on the same request. Gated on a
  Garage level, the machine's blueprint document, the price, and `MAX_PER_VEHICLE` counted against
  the yard **plus** what is out.

A machine does not carry a percentage off a clock. It carries a `speed`, 0 to 100, on the same
scale a unit's sheet carries, and everybody riding it travels at exactly that number. What a column
travels at is `columnSpeed`: the **slowest group** in it, where a group is a unit type still on foot
at its own effective speed or a machine carrying somebody at the machine's. Seats go to the slowest
walkers first, the fastest machines are filled first, nobody boards a machine slower than their own
legs, and a sheet carrying `no_ride` (the Colossus) never takes a seat at all.

`roadMinutes(base, speed, reductionPercent)` (`packages/shared/src/time/speed.ts`) is the only place
that turns those two numbers into minutes, and every road in the game goes through it: the march to
a fight, a mission's travel leg, a scouting run at the officer's own speed, and the city view's
estimates at speed 0. The **speed divides** (`base / (1 + speed/100)`) and the crew's
**travel reduction multiplies what is left**, capped at `MAX_TRAVEL_SPEED_BONUS`. The effective
speed a road reads is the sheet after the workshop's fitted upgrades and the crew's
`unitSpeedPercent` channel, which is the same figure `battle/effects.ts` hands the engine.

A mission's pay is deliberately not on that clock. `pricedMinutes` is frozen at speed 0 and the
ground's reduction only, which is what the card quoted before a crew was picked, so a faster road is
what the Garage bought and never a discount on the take.

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
| 409  | `USERNAME_TAKEN`, `OVERSEER_ALREADY_CHOSEN`, `NO_BASE`, `BID_REFUSED`            |
| 500  | Unhandled errors → `INTERNAL` (set a Fastify error handler that hides internals) |

## Testing expectations

Vitest is configured. Use `buildApp` + `app.inject()` against `openDatabase(':memory:')` +
`runMigrations` (see `src/app.test.ts` for the pattern). Cover at minimum: register/login round
trip, auth rejection, overseer creation (double-create conflict), city projection contains no
private fields, battle persists a row and pays rewards on a forced attacker win (inject a
`RandomBattleEngine` with a fixed `random` fn).

### The console's mock fight

`POST /admin/mock-battle` (admin builds only, 404 otherwise) has somebody else in the city call a fight on the reviewer's ground through `declareBattle`, handing a landless crew one unheld location first. `GET /me` carries `unread.fightsOnYou`, the pending fights called on the crew's ground, for the bottom bar's red mark.
