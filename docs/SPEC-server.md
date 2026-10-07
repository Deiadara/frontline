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
  `UNKNOWN_PRESET`, `NO_BASE`, `INVALID_TARGET`, `WOULD_WASTE`, `INTERNAL`. A `WOULD_WASTE`
  refusal also carries `waste`, the amounts the request would have thrown away.
- **Auth**: a session on everything except `register`, `login`, `logout`, `/health`. The browser
  carries it in the `frontline_session` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api`,
  `Secure` in production), set by `register` and `login`; a scripted caller may send the same
  token as `Authorization: Bearer <jwt>`, which wins when both are present (`src/auth/session.ts`).
  JWT payload is `{ sub: userId, ver }` (`JwtPayload` in `src/types.ts`), signed with `JWT_SECRET`
  via `@fastify/jwt` and good for thirty days. `ver` is the account's `users.session_version`; a
  token whose version no longer matches, or with no expiry or version (signed before migration
  0121), is `401 UNAUTHORIZED`, as is a missing, invalid or expired one. Any authenticated answer
  to a token more than a day old carries a fresh one, as a new cookie to a cookie caller and in
  the `x-session-token` response header to a Bearer caller, so an active player stays signed in
  indefinitely. `POST /api/auth/logout-all` and `POST /api/settings/password` bump the version,
  ending every other session, and hand the caller its new token the same way.
- **CSRF**: every write (any method but `GET`, `HEAD`, `OPTIONS`) that rides the session cookie,
  except `register` and `login`, which never act on it, and `POST /api/auth/logout` from any
  caller not using Bearer, must carry `X-Requested-With: frontline` (`CSRF_HEADER` in
  `@frontline/shared`), or it is `403 FORBIDDEN` before the body is read (`src/auth/csrf.ts`).
  A Bearer write needs none: no other site can make a browser attach that header.
- **Limits**: bodies over 64 KB are refused before parsing, path parameters over 200 characters
  are refused, every id is at most `ID_MAX` (128) characters, and every client-named amount at
  most `REQUEST_AMOUNT_MAX`. Rate limits per account and per address are in
  `src/limits/rules.ts`; IPv6 callers are counted by their /64. Letters are capped at
  `MESSAGES_PER_DAY` in any rolling day (`409 MESSAGE_REFUSED`, `too_many_today`), faction
  invitations included, and at `LETTERS_TO_ONE_PLAYER_PER_DAY` from one sender to one reader
  (`too_many_to_them`). Both are counted off `letter_sends` (migration 0151), a day-long send log
  that deleting or trimming letters cannot touch. A mailbox and a sent folder each keep their newest `MAILBOX_LIMIT` (100),
  read or not: every send trims them (`social/send.ts`), and a recipient's copy that goes is folded
  into the sender's count first (`pruned_recipients`, `pruned_read`). The live
  channel refuses past 40 streams per address or 2,000 in total with `503 SERVER_BUSY`.
- **Passwords**: bcrypt-hashed via `bcryptjs` (cost 10). Rules come from the shared
  `PasswordSchema`: min 8 chars, max 72 UTF-8 bytes (`PASSWORD_MAX_BYTES`, what bcrypt reads).
  Signing in still takes up to 128 chars. Never return or log password material; convert rows to
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

`200 {status: 'ok', database: true, clockAgeMs, loopP99Ms}` while the database answers a read and
the world clock has ticked within 15 seconds; `503` with `status: 'degraded'` when either fails.
`clockAgeMs` is null before the clock's first tick and in processes that run no clock.

### `POST /api/auth/register` (public)

Body: `RegisterRequestSchema` `{username, password}`.

- No open city has a free home plot (`worldHasRoom`, `src/city/homes.ts`) → `409 WORLD_FULL`,
  before any account exists.
- Username unique (case-insensitive: the column is `COLLATE NOCASE`); conflict → `409 USERNAME_TAKEN`.
- A reserved name (`isReservedName`: the Combine and its leaders, staff words, the seeded bots;
  case, spaces, `_`, `-` and `.` ignored) is refused by the schema → `400 VALIDATION_ERROR`.
- Create user: `overseer_id = NULL`, bcrypt-hash the password.
- `201` → `AuthResponseSchema` `{token, user}`, and the session cookie.

### `POST /api/auth/login` (public)

Body: `LoginRequestSchema` `{username, password}`.

- Ten failed attempts against one username (case-insensitive) from one address (an IPv6 /64 is
  one address) in fifteen minutes shut that username to that address for the rest of the window:
  `429 RATE_LIMITED` with `Retry-After`, answered before the password is hashed
  (`LOGIN_FAILURE_LIMIT`, `src/limits/sign-in.ts`). Counted per account and per address
  (maintainer, 2026-10-06), so a stranger's guesses never lock the owner out from their own
  address. A correct password clears that address's count. This is on top of the per-address
  sign-in limit.
- Unknown username or bcrypt mismatch → `401 INVALID_CREDENTIALS` (same message for both, and
  the same time: an unknown name is compared against a decoy hash).
- `200` → `AuthResponseSchema` `{token, user}`, and the session cookie.

### `POST /api/auth/logout` (public)

Signs this browser out: `200 {ok: true}` with the session cookie overwritten by an expired one.
Other sessions carry on. Needs the CSRF header even without a cookie, unless the caller uses Bearer.

### `POST /api/auth/logout-all` (auth)

Ends every session the account has open. `200 {ok: true}`, with this caller's new session as a
cookie, or in `x-session-token` to a Bearer caller.

### `GET /api/me` (auth)

`200` → `MeResponseSchema` `{user, overseer, base}`: `overseer`/`base` are `null` until the
player has run `POST /api/overseer`. (One base per user in this milestone; pick the user's base
by `owner_id`.)

### `POST /api/overseer` (auth)

Body: `CreateOverseerRequestSchema` `{presetId, cityId?}`.

- User already has an overseer → `409 OVERSEER_ALREADY_CHOSEN`.
- `findOverseerPreset(presetId)` undefined → `400 UNKNOWN_PRESET`.
- `cityId` names a city with no map (`City.open === false`, or no ground in the atlas) →
  `400 CITY_UNBUILT`.
- `cityId` names a city whose four residential plots each already hold a crew →
  `409 CITY_FULL`. A seeded bot occupies its plot like a player (maintainer, 2026-09-28), so a dev
  world with the bots has four free plots rather than eight.
- In one transaction: create the overseer from the preset (fresh id, copy name/archetype/
  portraitId/bio/attributes/perks), set `users.overseer_id`, and create the starting base on a
  free plot in the chosen city, drawn at random (`pickHomePlot`), level 1, `STARTING_RESOURCES`,
  buildings = `[nexus L1, generator L1]` (fresh ids, empty `modifications`), an empty
  `buildQueue`, and the district name `"<username>'s Crew"` truncated to `DISTRICT_NAME_MAX`.
  The free list is read inside the same transaction that inserts, so two accounts racing for the
  last plot cannot both be seated on it.
- With no `cityId`: `STARTER_DISTRICT_ID` while it is free, otherwise a free plot in the first
  city with room, and `409 CITY_FULL` when the whole world is full.
- `201` → `CreateOverseerResponseSchema` `{user, overseer, base}`.

### `GET /api/overseer/choices` (auth)

`200` → `OverseerChoicesResponseSchema` `{choices, remaining, total, expiresAt, serverNow,
cities}`. `choices` is the four characters held for this account (§F6); `cities` is one
`CityHomeOffer` per city in `CITIES`, carrying `available`, `refusal` (`unbuilt` | `full` |
`null`), `plots` and `free`. A crew that already has an overseer is refused
`409 OVERSEER_ALREADY_CHOSEN` rather than handed a fresh hold.

### `GET /api/city` (auth)

`?city=` names the city to draw; left off, it answers the crew's own. `200` →
`CityResponseSchema` `{districts, cityId, homeDistrictId, capturedGates, serverNow}`. `districts`
is that city's map, one `DistrictSummary` each: the district, the road to it in minutes, who holds
it whole, how much of it is theirs, and the crew living on it where it is residential, projected
through `BaseSummarySchema` (id/ownerId/name/districtId/level only: never resources or buildings of
other players). `capturedGates` is the crew's own, in every city.

**The whole city is visible** (maintainer, 2026-09-29). Scouting is gone: every district in every
city reads the same for every crew, who holds each location included. What stays hidden is what is
standing on ground the crew does not hold: `GET /api/city/:id` never sends another party's garrison
or its size, and what a crew knows about one is its last spy report (`latestSpyReport`). A player's
district, and a district one party holds whole, still expose only the gate to a spy.

The door is **not** the rooms' door. The Bar, the market, the back room and the mission board run
on `cityAsked`, which wants ground already held in the city; the map cannot, because looking at a
city is how a player decides to take something in it. Any city with districts in the atlas is
readable. A city nobody has drawn ground for (`redline`, `deepcut`) is `404`.

### `POST /api/city/upgrade` (auth)

Body: `UpgradeLocationRequestSchema` `{locationId}`. Works a location you hold up one level
(GDD §A4). Charged up front, a clock on the control row, banked by `settleLocationUpgrades` on the
next read of the city.

A location can be worked to `MAX_LOCATION_LEVEL` (10). Each level pays more (`LEVEL_SCALE`, linear
at +0.5 of the level-1 value per level) and each upgrade costs more than the last
(`UPGRADE_COST_SCALE`, a doubling for the first three steps and a flat 1.4x after that).

Every order is the same mix of materials (`UPGRADE_MIX`): 50% planks, 5% high-quality metal, 15%
scrap, 20% oil and 10% caps, which is a ratio of 10 : 1 : 3 : 4 : 2 against the planks. A kind's
own catalogue entry sets one number, the planks its first upgrade asks for, and the rest of the
bill follows from it. That figure runs from 80 for a Pawn Shop to 460 for a Construction Site, so
the last level on the ladder costs between about 2,970 and about 17,050 planks (the 10% rise of
2026-10-05, `LOCATION_UPGRADE_PRICE_RISE`, included). Supplies are not
part of it: working ground up is building work, and a crew eats supplies rather than building
with them.

Each level
above the first also adds `UNIT_SLOTS_PER_LOCATION_LEVEL` (3) unit slots on top of the flat
`UNIT_SLOTS_PER_LOCATION` (20) every held location pays, and takes
`MUSTER_COST_PER_LOCATION_LEVEL` (1%) off the price and `MUSTER_SPEED_PER_LOCATION_LEVEL` (3%) off
the clock of any unit that location unlocks (`homeMusterBonus`).

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
| All `buildQueueCapacity` slots working (4, or 6 with `Batch Runs`) | `BUILD_QUEUE_FULL`       |
| Materials short                                                    | `INSUFFICIENT_RESOURCES` |

Materials are taken at order time. Price and duration are read off the district **as it stands**
and frozen onto the entry; only the _level_ comes from the queue's projection, so a player may
queue the Nexus and the structure it unlocks together.

**One sum per channel** (maintainer, 2026-10-01: "make them add"). A structure's own percentage
and the crew's are added, then bounded once, on five channels:

- **Price:** build-cost cards plus the crew's `buildCostPercent` and any perk naming the structure,
  through `buildCostCut` (in full to 20, tapering toward 46, since 2026-10-05), every line
  floored at 1, then the Engineer's passive on what is left. The catalogue sits 10% above its
  figures (`BUILDING_PRICE_RISE`, and `LOCATION_UPGRADE_PRICE_RISE` on location upgrades). The
  `building_credit` levels still move the level the bill is written at first.
- **Captured gate** (`POST /api/city/gate`, `capturedGateCost`; maintainer, 2026-10-05): the
  Gate's own curve through the same price line, then `CAPTURED_GATE_PRICE_RISE` (1.1). It used to
  take no discount at all. `gatePricingFor` reads the home district's build-cost cards, the crew's
  `buildCostPercent` plus its Gate-only `buildingCostPercent`, and the Engineer's passive. What
  was charged is stored on the row (`upgradePaid`, migration 0146 `captured_gates.upgrade_paid_json`)
  and `/city/gate/cancel` refunds from that, so an Engineer unseated between the order and the
  cancel cannot refund more than was paid.
- **Clock:** the Generator's 2.5 a level, build-time cards and the crew's `buildSpeedPercent`, as
  points off the clock, through `buildTimeCut` (in full to 35, toward 85). The Generator's
  two-hour burn is bought with oil and comes off after.
- **Research clock** (`research/tracks.ts` `minutesWith`): research cards, the crew's
  `researchSpeedPercent` and the Researcher's cut, through `researchTimeCut` (in full to 30,
  toward 92). The Lab's own level is not on the clock since 2026-10-02 (maintainer ruling P7-C).
- **Research price** (`researchItemPrice`): the track officer's cut, then the Lab's 1.5% a level
  (`labResearchCostCut`), the two multiplied. A programme tier opens every two Lab levels
  (`labLevelForStep`: the tenth rung of a track needs a Lab at 20), refused as `lab_too_low`.
- **Every list price fits the store its Nexus allows** (`fittedToTheStore`, P4-A): a bill line, and
  the Generator's burn, is the catalogue's figure below 80% of what the biggest Apothecary the
  required Nexus permits holds of it, and bends towards that store above it without reaching it.
- **Production** (`productionRates`): each producing structure's cards and any complete Plumbing
  set, plus the crew's production and the resource's yield, on one percentage. No bound.
- **Storage** (`storageCapacity`): storage cards plus the crew's storage, floored at the cards
  alone. No bound.

The muster clock and the supplies line keep their own ceilings.

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
`GET /api/me`, `GET /api/bar`, `GET /api/missions`, `POST /api/missions`,
`POST /api/missions/:id/recall` and `POST /api/base/build` (success and refusal alike) are the
responses that drain it. `GET /api/bar` is on that list because the Bar's own close runs on it and
signing somebody pays XP, so it is very often the only read that knows a level was crossed.

### The Bar (§H, §H7a)

Five endpoints under `/api/bar`. Schemas are in `packages/shared/src/api.ts` and
`packages/shared/src/bar/auction.ts`.

The roster is never stored: §H2a makes it a pure function of the game day (Athens) and of the
city's crews, so every request recomputes it and two accounts asking on the same day are served the
same people. What is stored is what the players did to it: `bar_bids`, `bar_auction_results` and the
`bar_hires` signing log, and the one input the day cannot supply, which crews the room was poured
for (`bar_rooms`, below).

- `GET /api/bar` → `BarResponseSchema`. Returns the room, the officers on the books, the payroll
  ledger, one `BarAuction` per recruit in roster order, how many tables this crew is at
  (`auctionsUsed` / `auctionsAllowed`), `results` (yesterday's outcome for every table this crew sat
  at, as `won`, `lost`, `passed` when their final was highest and they could not take the person, or
  `unsold`), and `levelUp` when the close or the district settle crossed a level.
- `POST /api/bar/bid`: `{recruitId, amount}`. A public bid, in the open phase. Must beat the leader
  by the increment, or match the reserve on an untouched table.
- `POST /api/bar/seal`: `{recruitId, amount}`. The one secret final value, in the last thirty
  minutes. A crew with no open bid may still lock one, and it counts against the table cap.
- Bids cannot be taken back (maintainer, 2026-10-04). Every bid a crew made today holds its wage
  against the payroll book until the close, won or lost: one table counts once, at the crew's
  highest bid there (`max(open, sealed)`, talked down by its negotiators). A new bid or seal must
  fit the book with every other table's hold on it, and `bidCeiling` is the same figure. The hold
  is read from today's `bar_bids` only, so what the crew did not win is free again the next day.
- `POST /api/bar/release`: `{officerId}`. Frees their slice of the payroll book and charges
  `DISMISSAL_WEEKS` of it in caps on the spot. `404 NOT_FOUND` for a stranger, `409
INSUFFICIENT_CAPS` when the crew cannot cover it.
- `POST /api/bar/payroll`: `{fromSteps?}`. Buys one expansion of standing payroll
  (`PAYROLL_STEP`, a flat 30 caps of capacity, added after the payroll cards rather than multiplied
  by them) at a server-quoted caps price. `fromSteps` names the count the screen showed; a stale one
  is `409 STALE_STATE`. There is always another expansion (maintainer, 2026-10-01): 300 caps for
  the first, then `PAYROLL_STEP_COST_RISE` (60) more for each one already bought, with no ceiling,
  so `n` cost `300n + 30n(n - 1)`. `payrollStepDiscountPercent` still comes off the price. A crew
  short of the caps is `409 INSUFFICIENT_RESOURCES`; admin mode waives the charge. Sold from one
  window that the Bar's and the Nexus's `Increase Payroll` both open.

**Every** route here settles last night's tables before it reads anything (see below), not only the
read. All five touch state the close moves: the chair it filled, the wage it committed, the tables a
bid is counted against. `POST /api/bar/bid` and `POST /api/bar/seal` used to skip it, so a crew that
won its last chair overnight could be offered a table the close would then refuse them at.

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

Admin mode waives the gates that are about how far along a crew is: `not_interested` (the §H3
doors), `no_slots`, `no_unit_slots` and `no_payroll`. It does not waive the phases, the increment
or the table cap, which are rules about the auction rather than about the crew. The close waives
the same gates in admin mode (maintainer, 2026-09-29), so an admin bid the table took is not
passed over at midnight.

#### Who the room is poured for (maintainer, 2026-09-28)

A city's room is built from a **room profile** (`RoomProfile`, `cityRoomProfile` in
`packages/shared/src/city/access.ts`): the weakest crew with a stake in the city, the strongest, and
the stake-weighted middle, each as a level and a notoriety rank. Crews are ranked by
`crewStanding` (level plus two per rank). Bots count, as they did before; they are dev-only.

| Seat              | Pitched at         | Sheet                                             | Door                                                                                                |
| ----------------- | ------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0, low            | the weakest crew   | that crew's calibre plus the seat's grade         | open                                                                                                |
| 1 to 4            | the middle         | the middle's calibre plus the seat's grade        | 1 and 2 open; the rest the grade's rank ladder, lifted one rung per rung the average is past rank 5 |
| 5, high           | the strongest crew | that crew's calibre plus `HIGH_SEAT_CALIBRE_LIFT` | that crew's rank or one under it, open while it is rank 0                                           |
| 6 and 7, standout | above the middle   | the middle's calibre plus `STANDOUT_CALIBRE_LIFT` | rank from `max(3, average)` to `max(8, average + 3)`; wallet and badge doors +20% per average rank  |

The calibre (`barCalibre`, standing to attribute points on every mean) keeps the old slope of one
point per three standing up to standing 30, then climbs in a straight line to `MAX_ROOM_CALIBRE` at
standing 110, a crew at level 90 that has bought ten rungs. The recruitment ceiling climbs with the
calibre of each roll past 10 (`recruitmentCeiling` in `characters/generate.ts`), so a young city
still never rolls past 40 and a finished one reaches 85. Measured best-leaning grades in a finished
city: the middle seats about B+, the standouts about A with the best at A+.

**The profile is frozen per city per day.** `barRoomOf(repos, cityId, day)` (`bar/room.ts`) reads
the day's `bar_rooms` row, or writes it from the live city the first time anybody reads, bids or
settles that room. The read route, both bid routes and the close all rebuild the room from it, so a
crew that levels at noon changes tomorrow's room, and the close signs the person that was on the
card. A table from a day that was never frozen settles against the city as it stands at the close.

### Closing the day's tables

`settleBarAuctions(repos, now, admin)` is the whole of the close, and it is lazy in the same way every
other clock in this server is. It looks for tables with bids and **no result row** on any day
before today, and settles each one in its own transaction:

1. Rank the finals with `rankBids`: a bidder's final is the higher of their open bid and their
   sealed value, and a tie is broken by a hash of the auction and the crew rather than by row
   order, so the answer does not depend on who ran the close or how often.
2. Walk the ranking and sign the first crew that can take them: not already on their books, a free
   chair, a free bed, the §H3 doors open, and a fee the payroll book can hold. Each crew is settled
   to the close's instant before it is judged, as the barrow's winner is, so a build or a research
   rung that landed before midnight counts. They go on the **bench**, the
   fee is committed, and `officerHired` XP is awarded.
   The **price** and the **fee** are two numbers on purpose: everything shared (the result row, both
   notifications, `results.price`) carries the price the table closed at, while the winner's payroll
   commitment and their officer's `weeklyWage` carry that price talked down by their own negotiators
   (`committedWage`, §H7's `wageDiscountPercent`). The payroll gate reads the discounted figure at
   the bid as well as at the close, so a crew is never refused a bid its book could have held.
3. Write the result row, which is also what stops the table being settled twice. A table nobody
   could take is recorded with a null winner and a null price.
4. Tell the table: `officer_hired` to the winner, `bar_outbid` to everybody else who bid.

Every door reaches it and that is fine, because it is a function of stored rows and of the
server's admin mode, which every door passes along: `settleWorld` (so
the world clock closes tables at midnight whether or not anybody is looking) and every `/api/bar`
route (so the first player through the door after midnight sees the result on that request,
whichever request it was).

### The Stackhouse (maintainer, 2026-10-05)

`GET /api/black-market/stackhouse` and `POST /api/black-market/stackhouse/bet`
(`routes/blackmarket.ts`, `blackmarket/stackhouse.ts`). The book lists every unresolved fight in
`scheduled_battles` that this crew or a faction member is in (the attacker, the defending base, or
a deployment row) and that is still more than `STACKHOUSE_CLOSES_MINUTES` (60) from its mark,
except a fight this crew called itself (`openFights` leaves those out; maintainer, 2026-10-05). A
crew that could call a fight on Combine or looter ground and bet on the defender was paid to lose
it. Fights a faction mate called stay on the book. A bet
(`PlaceStackhouseBetRequestSchema`: battle, side, stake 1 to `STACKHOUSE_MAX_STAKE`) is refused when
the rung `STACKHOUSE_RESEARCH_ID` is not done, a bet is already riding, the fight is not the crew's
or its faction's, the crew called it (`own_call`, on either side), betting has closed, or the caps
are short; the write route also asks for the
`market` and `black_market` doors. The stake leaves the caps at once, and the stake on record is
what was charged (maintainer, 2026-10-06): nothing in admin mode (`adminCaps`), so an admin bet pays
out on zero. Bets live in `stackhouse_bets` (migrations 0145, 0150), with a partial unique index
that holds one unsettled bet per crew.

`settleStackhouse` closes a bet whose fight has landed: `sieges.outcomeOf` reads the stored report's
`winner`; a match pays `stackhousePayout` (twice the stake), a miss pays nothing, and a fight that
was abandoned (an under-strength call-off is one, see "Declared battles"), is gone, or whose
report cannot be read hands the stake back. It runs on the world
tick right after the battles stage and on both routes before they answer, writes a
`stackhouse_settled` notification, and tallies `stackhouse_bets` and `stackhouse_wins` for the
two feat chains.

### The market and the Runner's lots (market extension)

The Broker (`POST /api/market/barter`) converts by value: what is handed over is priced at
`RESOURCE_CAP_VALUE`, the cut (`barterRateFor`) is taken, and what comes back is priced the same way
(`barterQuote`). He deals in every resource, caps included (maintainer, 2026-10-01; caps are worth
one), with no daily ration. A trade into caps pays at `brokerPayoutRate`: his rate, but never more
than the supply run charges this crew for the goods, so buying off the run and selling to him never
comes back ahead however deep the discount. The caps he pays out are not tallied as
`resources_earned` (a full warehouse sold in one press would otherwise be most of "A Quarter
Million"); what he hands over in materials still is. What it hands over goes into the stores up to
their ceiling, and a trade that would waste some is answered `409 WOULD_WASTE` until the request
carries `acceptWaste: true` (see "The stores are a hard ceiling" below).

The market discount (`market/discount.ts`) is the crew's `marketDiscountPercent` sources summed and
put through `60 x s / (s + 60)` (maintainer, 2026-10-01; it was the sum clamped at 45): 20 raw is 15
off, 45 is 26, 100 is 37.5, and it never reaches 60. `discountedCaps`, `supplyUnitPrice` and
`brokerRate` all take the raw sum and curve it themselves, so `GET /market` sends the raw sum in
`marketDiscountPercent` and the client passes it straight back into the same functions. The supply run, taking a listing, withdrawing one and paying in
a claim all work the same way. Posting one no longer asks, since what a listing brings back waits
as a claim for 24 hours and the poster is asked when they claim it.

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
  cover it with its caps plus what its own earlier bid on the lot is holding.

The reserve is the line's price with **no** crew discount on it: two crews bidding against each
other have to be bidding against the same floor. §A4's `marketDiscountPercent` comes off what the
winner is charged instead, so the result row and both notifications carry the number the lot closed
at and the discount is invisible to everybody who was outbid. A bid is held when it is placed
(maintainer, 2026-10-06): the discounted figure comes off the caps at once and is kept on the row
(`vendor_bids.held`, migration 0149; nothing in admin mode). Raising your own bid hands the old hold
back and takes the new one. At the close the winner's hold is the price and every other bidder's
comes back. The fence's shelf (`black_market_bids.held`) holds infamy the same way.

### Blueprints and the Reimagining bench (§D10, §G2)

Both writes live on the market routes, because a blueprint and its pages are items: they sit in
`inventory_json` beside everything else a crew holds, and both answer with the whole refreshed board
so the inventory updates from the response instead of racing a refetch.

- `POST /api/blueprints/unlock`: `{blueprintId}`. Spends one of every page and banks the document.
  `409 BLUEPRINT_REFUSED` with `unknown_blueprint`, `already_unlocked` or `missing_pages`.
- `POST /api/blueprints/reimagine`: `ReimagineRequestSchema` `{pages: [id, id, id]}`. The player
  names the three (maintainer, 2026-09-10); the Lab used to pick the most duplicated itself. The tuple is
  parsed against the page catalogue, so anything but exactly three real page ids is a
  `400 VALIDATION_ERROR` at the door. Then `reimaginingRefusal` re-checks against the _base record_:
  `not_available` (no Researcher seated, or the rung not banked), `wrong_page_count`, and
  `pages_not_held` when a named page is not held, or is named more times than it is held. Every one
  is a `409 REIMAGINING_REFUSED` carrying the machine name, and `REIMAGINING_REFUSAL_MESSAGES` in
  shared is the sentence each one prints. A crew that holds or has bound every page in the game is
  **not** refused (maintainer, 2026-09-23): the three pages go in and `REIMAGINING_COMPLETE_XP`
  (5000, source `pagesReimagined`, through `awardPlayerXp` so the usual bonuses apply) comes out, and
  the answer carries `gained: null` and the `xp` actually banked.

What comes back is never the caller's choice, but since the maintainer's 2026-09-18 call it does
depend on what went in. The trade is two seeded draws off a seed of the base id and the moment, so a
request retried because the connection dropped cannot be retried until the Lab offers something
better. The first draw picks a **rarity** off `reimaginingOdds`, which reads the three sheets in the
sockets: three Basic pages pay 80% Basic, 15% Intricate, 4.5% Advanced and 0.5% Masterpiece, three
Masterpiece pages pay that ladder backwards, and everything between is the two ends blended
geometrically on the mean input tier (`blueprints/reimagine-odds.ts` has the maths and the reason it
is not a straight line). The second draw picks a page uniformly out of the unseen pages of that
rarity. When the rolled rarity has nothing unseen left the payout falls to the nearest stocked
rarity, ties going down, because the trade is guaranteed and an empty tier can be neither a refusal
nor a reroll.

`unseenPages` is read off the inventory as it stands _before_ the spend. The three named pages are
held at that point, so none of them can be the page handed back, and a page of a document the crew
has already unlocked is out of the pool whatever its count says. The answer carries `spent` and
`gained` beside the board: the response is the only place a player ever learns which page they got.

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
`GET /api/market`. `latestLotResultsFor` reads the outcomes back, and tells `passed` (the close
walked past the crew on its way to the winner, or the crew was top of a lot nobody took) from
`lost` and `unsold` by re-running the ranking. The Bar's results panel reads the same rule
(`outcomeAgainst`).

### Notifications

The kinds live in `@frontline/shared`'s `social/notifications.ts` and every one of them is written
through `notify`. `page_found` says a blueprint page reached the inventory and has five doors, so its
sentence is written once: `tellPagesFound` (`social/pages.ts`) diffs the inventory before and after
and rings for a mission's page prize, the Runner's lot close, a page taken off the Black Market
shelf, the page the Lab hands back for a Reimagining, and a settled market offer: the taker's side
when it is taken, the seller's when they claim the pay (`payClaim`). The Runner's close rings it
alongside `market_won`: one is the lot, the other is the sheet.

### The live channel

`GET /api/events` is a server-sent event stream (`live/routes.ts`), one per open tab, heartbeat
every `LIVE_HEARTBEAT_MS`. Every event is a **nudge with no payload**: `{kind, at}`. The client
answers one by invalidating the queries that kind names (`lib/live.ts`), so there is one code path
from server state to screen state and it is the one every page load exercises.

Two scopes of kind, from `@frontline/shared`'s `live/events.ts`:

- **Per account**: `notification`, `battle`, `message`, `faction`, `base`. Published by `notify`
  alongside the receipt it writes, to the account the receipt is for.
- **Broadcast**: `world`, `market`, `bar`. Published to every connected account, because what
  moved is the one world everybody shares. Two sources: `live/broadcast.ts` maps the route prefix
  of every **successful** write that changes shared state (a fight called or moved, a location
  taken or worked up, a listing or a bid, a faction founded or left, a crew renamed) to a kind in an
  `onResponse` hook; `world/settle.ts` broadcasts what the clock itself moved (fights resolved,
  columns landed, gates raised, tables and lots closed), only when a count is above zero. A
  refused write announces nothing. Because a nudge carries no data, nothing private crosses: each
  tab refetches through its own authenticated reads.

On connect the client refetches every active query, so anything that happened while a tab was
disconnected is caught up without the server replaying events.

### `POST /api/base/district-name` (auth)

Body: `RenameDistrictRequestSchema` `{name}`: trimmed and bounded by `DistrictNameSchema`.
`200` → `RenameDistrictResponseSchema` `{base}`. A name another crew anywhere already uses, or one
the map reserves for a district, is `409 DISTRICT_NAME_TAKEN`.

### Factions (`routes/factions.ts`, `routes/faction-profile.ts`)

All auth. Every write answers `FactionMutationResponse` `{faction}`, the caller's screen as it now
stands, and refuses with `409 FACTION_REFUSED` whose message is a `FactionRefusal` code
(`FACTION_REFUSAL_TEXT` has the sentence).

- `GET /api/factions`: the caller's faction, rank and members, the invitations they hold and the
  ones their faction has pending, and the faction's fights and armies (`FactionResponse`).
- `POST /api/factions` `{name, badge, blurb}`: found one and lead it. Needs district level
  `FOUND_FACTION_PLAYER_LEVEL` and the Nexus at `FOUND_FACTION_NEXUS_LEVEL` (`canFoundFaction`),
  else `not_established`.
- `POST /api/factions/identity` `{name, badge}`: the leader only.
- `POST /api/factions/description` `{blurb}`: the leader or a chief.
- `POST /api/factions/invite` `{username}`: the leader or a chief. Delivered as a message, and
  counted against the sender's day of letters (`too_many_today`). One player may be sent
  `INVITES_TO_ONE_PLAYER_PER_DAY` (3) in any rolling day and `INVITES_TO_ONE_PLAYER_PER_WEEK` (5)
  in any rolling week, counted from the sender or from their faction (`invited_too_often_today`,
  `invited_too_often_this_week`; `social/limits.ts`, table `invitation_letters`).
- `POST /api/factions/answer` `{inviteId, accept}`: accepting needs the Faction door open.
- `POST /api/factions/leave`: `{successorId?}`. A leader leaving disbands the faction, unless they
  name a member to lead after them (`canNameSuccessor`): that member leads, and the leader leaves as
  a chief would. `409 FACTION_REFUSED` `not_allowed` for a successor named by anybody but a leader
  with members, `not_a_member` for one not at the table. Clean slate (`POST /api/admin/reset`)
  takes the same `{successorId?}` for the faction it walks out of.
- `POST /api/factions/disband`: the leader only.
- `POST /api/factions/member` `{userId, action}`: `kick`, `promote`, `demote` or `hand_over`.
  A member who is removed, leaves or is demoted below a rank that may invite loses every
  invitation they sent that is still open.
- `POST /api/factions/reinforce` `{battleId, army}`: send units to a faction-mate's fight, on the
  side the caller's faction is on (`battle/alignment.ts`).
- `GET /api/factions/:id/profile`: any faction's public page (`FactionProfileResponse`).

### Where there is work (maintainer, 2026-09-29)

`GET /api/missions` posts a board per area: `misc`, which is always there, plus every district
that passes `areaIsOpen` (`missions.areas.ts`): "in order to do missions in a district you still
need to hold at least one location in that district, or you can do the misc ones".

- **Contested.** The four residential districts are plots and hold no capturable locations, so
  they post nothing. `POST /api/missions` into one answers `409 MISSION_REFUSED`.
- **A foothold.** The crew holds at least one location in the district. Holding every location
  keeps the board open; another party holding it whole cannot happen alongside a foothold. A
  launch into a district the crew holds nothing in answers `409 MISSION_REFUSED` ("Nobody there
  hires a crew that holds nothing in it"), which also covers a stale card for ground just lost.

A new crew holds nothing, so its first board is `misc` alone; taking a place is what puts a
district's board on the screen. The Right Hand's standing orders read the same rule and stall with
the same advice when no board has work for them. `missions/board.test.ts` holds the rule.

Every board deals **one fight and two plain jobs** (`FIGHTS_PER_AREA`, maintainer 2026-09-23); the
coin that used to deal two fights on half the boards is gone.

**Grades** (maintainer, 2026-09-28, `missions.grade.ts`). Every card is dealt a grade on the
officers' twenty one marks, F- to S+, and the grade is a fact about the card, the same for anybody
who reads it: it sets the odds against the leader, what a fight fields (`GRADE_ENEMY_STRENGTH`),
how much longer than its authored time the job runs (`gradedDurationMinutes`, 8% a mark above the
job's lowest) and what it pays (`gradePay`, and on a fight `fightPayFactor`: +10% at F- climbing
geometrically to +200% at S and +250% at S+, maintainer 2026-09-30). Each template carries the
range it can be dealt at (`grades: [from, to]`); there are three hundred of them
(`packages/shared/src/mission-catalog/`), and every grade has at least eight of each kind.

The crew's level decides **only** which grades it is dealt (`gradeOdds`): a bell round the grade
whose pay level (`GRADE_PAY_LEVEL`, F- at 1 to A+ at 86) matches three quarters of the crew's level
(`GRADE_DEAL_PACE`, so a grade is dealt most a third above its pay level, `gradePeakLevel`), never more
than three marks either side. The S grades open flat at `MAYHEM_UNLOCK_LEVEL` (90) with at least
`MAYHEM_SHARE` (5%) of the deal. The old per-level pay premium, the per-level odds drop and the
per-level enemy growth are gone; a grade pays what the level premium used to pay at its pay level.
The pace is three quarters (2026-09-28, with the level curve and the rank ladder retuned so the
late game arrives about two and a half months in): `apps/server/scripts/progression-sim.ts` holds
the best leader within about a mark of the deal at it, now that the Bar seats officers pitched at
the city's level and a crew trades its weakest officer up. The level curve is
`PLAYER_XP_LEVEL_STEP * level ^ PLAYER_XP_LEVEL_POWER` (52 and 1.41, the power down from 1.6 on
2026-10-01 when the fight premium came down): level ten on day five, forty on day thirty, sixty on
day forty nine and ninety on day seventy six in the simulation, which leaves out XP from buildings,
research, drills, hires, declared fights and feats. The rank ladder costs 60 infamy for the first
rung and grows by 1.625 (`notorietyUpgradeCost`), so a crew that fights daily buys the fourth rung
around day ten, the seventh around day twenty nine and the tenth around day seventy four. Boards are a crew's own: `missionOffers(area,
key, level)` is deterministic for one crew on one key, and two crews at different levels see
different work. A fight's category is its letter: Skirmish (F, E), Battle (D, C), Siege (B, A),
Mayhem (S). The grade is frozen on the row (`Mission.grade`, migration 0123, which backfilled the
old `battle_tier` and dropped it).

### What each chair gives (maintainer, 2026-10-04)

There is no best-of sheet. `crewEffects` folds every perk in the room and records the seat points of
whoever is working each chair (`CrewEffects.chairPoints`); each consumer turns its chair's points
into the passive where the passive is spent (`chairPassiveOf`, `crew/passives.ts`). The lines a
player reads are `describeChairPassive` and `describeOverseerPassive`, one decimal, the research
payload's grain.

| Chair           | Passive                                             | Where it is spent                                    |
| --------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Researcher      | research up to 50% faster                           | `research/tracks.ts`, `researchClockFor`             |
| Fixer           | payroll +50% (the whole book)                       | `bar/hire.ts`, `ledgerFor`                           |
| Steward         | base unit slots +50% (beds and ground only)         | `districtUnitSlotCapacity`, `district/unit-slots.ts` |
| Field Commander | infamy +100%, fights against a crew                 | `battle/resolve.ts`, `bankOutcome`                   |
| Raid Boss       | own damage and vitality x5                          | `crew/leading.ts`, `officerSheetBonusFor`            |
| Salvager        | Scrapyard scrap and HQ metal half off               | `district/scrapyard.ts`, `yardCutFor`                |
| Cartographer    | road base half off, before speed (not the gate leg) | `roadMinutes`'s `baseCutPercent`                     |
| Trader          | market rates even at C+, +25% at S+                 | `brokerRate`, `supplyMarkup`                         |
| Veteran         | muster cost half off                                | `musterCost`'s `veteranPercent`                      |
| Engineer        | building and location cost half off                 | `buildingCost`, `upgradeCost`                        |
| Professor       | mission XP +50%                                     | `progression/award.ts`                               |

The Steward's base (maintainer, 2026-10-05) is the Quarters' beds plus the ground's flat unit
slots from held locations (`districtUnitSlotCapacity`'s `groundSlots`); flat slots from research
and perks add on top, unmultiplied. The Cartographer shortens roads only: the gate leg of a move
(`MOVE_GATE_MINUTES`) takes the column's pace and the crew's travel speed but no Cartographer.

The Overseer's grade (`ROLE_IMPORTANCE.overseer`) lifts every seated officer's irreplaceable and
essential skills, the first lift source on their sheet (`liftedOfficerSheet`). `GET
/api/overseer/me` ships `chairs` and `overseerGrade` where it shipped `crewSheet`; `GET /api/crew`
ships `overseer` and a `passive` per officer; a research track ships `passive` where it shipped
`costCutPercent`. Migration 0142 renames the five chairs, benches anybody in a removed one and drops
the forty rungs the catalogue no longer has.

The ground's group lift (the Chapel's mental and the Broadcast Station's social `officer_group`)
sits outside the officers' lift cap (`MAX_OFFICER_LIFT`, 10) beside the grade since 2026-10-05
(maintainer): `liftedOfficerSheet` passes it `uncapped`. A Chapel at 3 used to fill the cap on its
own, so its last seven levels and every teaching perk and rung behind it bought nothing. Paid at
half (`GROUND_OFFICER_LIFT_SHARE`, 0.5, floored, at least one): +2 at level 1, +6 at level 4 and
+14 at level 10.

**Settling in (2026-10-05).** `POST /api/crew/reassign` stamps `Commander.seatedAt` (in the
`commanders_json` blob, so no migration; absent reads as settled). For `CHAIR_SETTLE_HOURS` (6)
after it the chair gives nothing: `crewRoomFor` marks the member `settling` and `crewEffects`
leaves its seat out of `chairPoints`, `officerLiftRoom` takes no Right Hand who has not settled, and
`whispersChairPoints` reads null on both sides of a spy contest. Perks, leading and every gate
that asks for a chair's mark are untouched. `chairFrom` on a crew officer and on a chair line says
when the chair starts giving.

### Standing orders: the Right Hand's automations (§C2b)

The Right Hand's sheet buys three things, none of which existed before 2026-09-22: every other
officer is lifted on every attribute (`MAX_RIGHT_HAND_LIFT`, 5, on the standard fit curve, through
the same `LiftSource` machinery the teaching perks use, and never on themselves), the Overseer's
own sheet is lifted (`MAX_OVERSEER_LIFT`, 3, the only source that reaches the player's character),
and standing orders.

A standing order is a **slot** (`automations` table, one row per `(base_id, slot)`) holding a
`kind`, an order, a force and a cooldown. The server spends a slot through a runner looked up by
`kind` (`automations/runners.ts`, `AUTOMATION_RUNNERS`), so a second thing the Right Hand can be
told to do is a new runner and nothing else. `missions` is the one kind today.

- **It runs on the world tick.** `settleAutomations` is called from `settleWorld` immediately after
  crews coming home, and only when the caller is the world clock (`bringCrewsHome` is passed), so
  a page load settles the world and sends nobody. A party goes out, comes home and its slot rests,
  with nobody connected.
- **The ladder is the Right Hand's research track** (`AUTOMATION_RUNGS`): rung 3 one slot, an
  exact party and a named officer, non-fight jobs only; rung 5 name a size in unit slots and the
  party is filled most suitable unit first (`bestFitParty`, all of one unit before the next, as
  full as the pieces allow): for a fight, the units that win it, ranked by `FIGHT_RANK_SAMPLES`
  practice fights each against the job's grade on seeds the real fight never uses; otherwise the
  best carrier per slot. It is led by the best free officer, and a slot with nobody free stalls
  ("No officer is free to lead"): every run has a leader, and the Overseer is not a standing
  order's to send (a named officer is always that officer or a stall); rung 6 the gap drops from
  fifteen minutes to five;
  rung 7 a second slot; rung 8 chase one resource by best return per minute, meaning what comes
  **home**: the reward curve and the grade applied, trimmed to what the party carries; rung
  9 battle jobs; rung 10 the alternating order (a mission, then a fight).
  The ladder is re-read every tick, so a cancelled rung stops its slot.
- **Each slot keeps its own clock.** Both slots send the moment they are on. After that a slot
  rests from the moment its own party walks in (`restingSince` is stamped from the mission's
  `resolvedAt`, not from the tick that noticed) for the full gap, fifteen minutes or five after
  rung 6, and the other slot's clock is not consulted. **Admin mode does not flatten the gap**
  (maintainer, 2026-09-23): missions still run a minute on the bench, the rest is real. The
  Console's `automationsRested` knob clears every slot's rest for a test that cannot wait it out. Slots are settled one after another inside
  the tick's transaction, each re-reading the base and the active missions, so two slots cannot
  send the same officer or work the same area.
- **Never a fight on a location.** A battle here is a battle-kind job off the board. The kind list
  has no entry for attacking ground and the runner table nowhere to put one.
- **Which job:** two modes, by research (maintainer, 2026-10-02). Until Field Promotions, any job
  it can fill at random across every open board, and the screen says "at random". From that rung,
  the best: the best job overall by worth per minute (each resource at `RESOURCE_CAP_VALUE`), or
  the best rate in the resource it was told to chase. Either way only among jobs the slot can
  actually fill and lead, so it never picks one it cannot send while another is on offer. Stalls (nothing on offer, the named party or officer not free)
  are written to `stalled` and shown; they are not errors. A stalled slot is asked again after
  `STALL_RETRY_MS` (thirty seconds) rather than on every one-second tick, or at once when its
  order is edited.
- **The board lock is the strong rule:** while any slot is on, `POST /missions` is refused with
  "Your Right Hand has the board", and the screen says so first.
- **A slot obeys every door a player does** (bug pass, 2026-09-23). It was the fourth way onto a
  field and the only one that asked none of the questions the other three ask. It now checks the
  crews-out ceiling before it fires (`concurrentMissionSlots` plus `missionSlotsFlat`, stalling
  with "Every crew is out: N of M") and `unitsBeyondNotoriety` on the party it would send, for the
  named branch and the fitted one; `bestFitParty` is fitted out of what the crew may legally
  field, so a slot fills with the next best party rather than stalling. Its row, its roster write,
  its tally and its own bookkeeping go in **one transaction**, as the manual launch's do.

Routes: `GET /automations` (powers off the crew's research, the slots, the officers that could be
named), `POST /automations` (`SaveAutomationRequestSchema`, the whole slot, refused above the crew's
rungs and refused when it names both a party and a size), `GET /automations/board` (registered and
called by nothing: the missions screen reads its automation state off another payload).

## Spying (maintainer, 2026-09-22)

Nothing about somebody else's garrison is free. The city read serves `garrisonSize: null` and a
`defense` figure of the ground alone on every location the caller does not hold,
and the battle board's `enemySize` is null unless the caller has a spy report on that ground. The
old blur (their counter-intel against your intel, coarsened) is gone with `battle/intel.ts`; the
`intel` bonus is spy points now and `intel_resistance` counter-spy points.

A job is a party of runners with a target and a price, sent from the Master of Whispers' chair
(`spying/spying.ts`, shared arithmetic in `@frontline/shared`'s `spying/spying.ts`):

- `POST /api/city/spy`: `{target, tier}`. `target` is `{kind: 'location', locationId}` on open
  contested ground somebody else holds, or `{kind: 'gate', districtId}` on a player's district or
  a contested district one party holds whole. The five tiers cost 100, 500, 2000, 5000 and 12000
  caps (`SPY_TIER_SPECS`), taken at the send and never refunded. Loose Ears is open to every chair;
  the rest need a Whispers rung (`SpyTierSpec.opensWith`): Paid Whisper and Bought Eyes need Paid
  Informants (rung 2), Network Compromise needs Sleeper Lists (rung 7), Total Intelligence needs
  The Whole Wire (rung 10). One job out at a time, two with Two Sets of Eyes (rung 5,
  `CrewEffects.spyPartiesFlat`). The clock is the road twice plus the looking (`spyJobMinutes`: 40
  to 240 minutes off the Whispers' whole lifted sheet, the one the crew screen draws; the walk is
  paced off that sheet's speed too), the same at every tier. Refusals: `409 NO_FORCE`
  with nobody working the chair (empty, benched or hurt), `400 VALIDATION_ERROR` on your own ground, with no road, on a tier the
  track has not opened (`tier_locked`), with a party of this crew already out on the same place
  (`watching_here`, `sameSpyTarget`; maintainer, 2026-10-05: call it back or wait, checked before
  the party count), or with every party out (`already_out`);
  `400 INVALID_TARGET` on empty ground, on a location inside a shut district ("the gate is the
  only thing to read"), or on anything in a city that is not open (`city_closed`); `409 INSUFFICIENT_RESOURCES` without the caps. Answers with the district.
- `POST /api/city/spy/recall`: `{runId?}`. The named job, or the first one still open to a recall.
  Inside the first tenth of the whole job; the runners walk home as far as they had come, without
  a report, and the caps stay spent.
- The district read carries `spyRuns` (every job out, wherever it is), `spyParties` (how many may
  be out), `spyTiersOpen`, `spyQuote` (`{minutes}`, quoted on any district but home and an
  unclaimed plot) and `spyBlocker` (`no_whispers` | null). Each location carries `latestSpyReport`.
  `holderFaction` (`{name, badge}` | null) is the table of the crew holding every location, for the
  painting's "Held by" plaque; null for ground held in pieces, the Combine, the looters, and a crew
  at no table.
  `GET /api/actions` carries `spyRuns` for the Monitor; `GET /api/battles` carries every report the
  crew ever wrote as `spyReports`.

The contest (`spyScore` against `counterScore`): the spying side is the chair's fit points plus
`intelYieldPercent` (perks and held ground only: the chair's grade is the whole officer side, so no
other officer's ratings and no rung pay intel, maintainer 2026-10-01; a better chair is how a crew
spies better), raised by the tier's share (0, 80%, 170%, 210%, 440%; the middle three were 40%, 120% and 160%
until the cheap tiers were retuned to read an equal mid-game crew at about 40% and 90% once the
spy bonuses were gone, and Network Compromise was then widened to 2.1 so it is worth its caps;
Total Intelligence scores 1.5 times what it did at 260%, maintainer 2026-10-01). The spying side is frozen onto the run at the send
(`spy_runs.chair_points`, `intel_percent`, migration 0135): benching or swapping the Master of
Whispers mid-job changes nothing, and a run sent before the freeze is read at the settle.
The other side is the holder's own Master of Whispers' fit points, read exactly as their own jobs
read them, so two equal chairs cancel and the tier, bonuses and gate decide (maintainer,
2026-10-01), plus `intelResistancePercent` (perks only, by the same ruling: no rating and no rung)
plus the district's
counter-intelligence cards (`counter_intel_points`: Encrypted Core, 14) plus ten points per gate
level (the home Gate on a player's district, the captured gate on one held whole; none while that
gate is broken), and that sum is then moved by the holder's other officers
(`officersSpyDefencePercent`, maintainer 2026-10-01): the mean of Signals and Cryptography over
every officer seated and working but the Master of Whispers, on their lifted sheets, gives
`spyDefencePercent`, linear from -10% at 1 to nothing at 30, then `softCap` toward +25% (about +20%
at 70); a room with nobody but the Master of Whispers reads 0. No route carries the figure: spy
strength is not public. Nor does any route carry a spy total: `GET /api/overseer/me` leaves
`PRIVATE_CHANNELS` (`intelYieldPercent`, `intelResistancePercent`) out of its `effects`, and neither
a captured gate (`CapturedGateView`) nor a Gate's row on the battles board (`StructureDefence`)
carries its points against spies (maintainer, 2026-10-01). `routes/no-spy-figures.test.ts` sweeps
every read a player can make for either key and walks every shared response schema for them. Looter and Combine ground carry flat points off the district's
difficulty and the location's defence instead. The difference is a budget spent on bodies cheapest first, each body
costing `1 + stealth / 36` at the stealth its owner fields: the holder's garrison at the
holder's, each posting and Sleeper cell at its own crew's (maintainer, 2026-10-01). Accuracy is
exposed bodies over countable bodies; under 25% the report fails and lists nothing. Both printed
figures are rounded before the report is stored (maintainer, 2026-10-01), since exact they gave
back the whole count: accuracy to the nearest tenth and never 100% unless nothing was missed
(`roughAccuracy`), and the unseen estimate to 5, 10, the nearest ten, or past a hundred the
nearest fifty (`roughUnseen`). A report never names a unit
that is not there, never a Specter (`UnitSpec.unspyable`), and never a Sleeper without Sleeper
Lists.

What a report says is the Whispers track at writing time, frozen onto it (maintainer,
2026-09-28): before Written Reports (rung 1) `exposed` is sent empty and `exposedSlots` (the unit
slots of what was seen) is the whole report; the accuracy with Second Source (rung 4); the
"unseen" estimate with Counting the Empty Beds (rung 6), dropped again at The Whole Wire, which
prints `totalSlots`, the exact unit slots of every countable unit standing there, on every report
including a failed one. The battle board's `enemySize` is null on a slots-only report, and its
`enemyIntel` line says the slots in words; wherever a report carries The Whole Wire's figure, a
failed one included, the line says that too (bug pass, 2026-10-01).

Being seen: every job on a crew's ground is found out until Traffic Analysis (rung 3). After it the
chance to go unnoticed is the Whispers' mark index over 20, from 0 at `F-` to 1 at `S+`
(`spyUnnoticedChance`), rolled once off the run id (`spyFoundOut`) and frozen as `foundOut`.

The world clock writes the report (`settleSpying`, with the other receipts) on the ground as it
stands when the runners arrive, files it for ever, rings `spy_report` with a link to
`/game/battles?spy=<id>`, bumps `spy_jobs_returned` for every report written, `spy_reports` on a
report that stood and counted anybody, and `spy_jobs_unnoticed` on a job on a crew's ground that
was not found out. The holder is told once (`spied_on`) when a job is found out, with the player
and the crew; a job nobody saw is never heard of.

Turned Runners (rung 9, `spying/courier.ts`): a world-tick stage after spying files one report a
day per crew holding the rung, on the first tick of each Athens day. The place is drawn off the
crew and the day (`courierPick`) from every location and home gate a job could read that is held
by a crew outside the reader's faction; home districts, looter and Combine ground never count. It
reads every countable unit, cannot fail, has `tier: null` and `capsPaid: 0`, is never seen, and
its id is `courier:<baseId>:<day>`, so a restart files it once. He comes only while somebody is
working the Master of Whispers' chair (bug pass, 2026-10-01): a day with the chair empty, benched
or in bed all day brings nothing, and a chair back at work later that day still gets that day's. It rings `spy_report` and bumps
`courier_reports` (and `spy_reports` when it counted anybody).

Shared Knowledge (rung 8, `chair_teaches`): while a Master of Whispers is seated and working,
every other officer seated and working gets +5 stealth, +3 deception and +3 cryptography on the
lift (`liftedOfficerSheet`, named for the teacher on the receipt). The bench gets nothing.

Migration 0109 adds `spy_runs` and `spy_reports` and drops the six retired Whispers and
Consigliere rung ids from saves. Migration 0135 removes the Consigliere: seated ones go to the
bench, the track's ten rung ids and any active project on it are dropped. Migration 0131 moves `tech_loose_talk` to
`tech_written_reports`, then `tech_turned_runners` (old rung 8) to `tech_shared_knowledge`, then
`tech_compartmentation` (old rung 9) to `tech_turned_runners`, and rebuilds `spy_reports` with a
nullable `tier` and `exposed_slots`, `units_shown`, `total_slots` and `found_out`.

### The gate and the district, and moving between places (maintainer, 2026-09-22)

A crew's army stands in three kinds of place, and each defends only its own:

- **The district** (`Base.army`): home, where new units land. A raid inside a breach is met by
  this and nothing else.
- **The gate** (`Base.gateArmy`, migration 0110): the garrison at the door. A call on the gate is
  met by this and nothing else. When the gate falls, whoever is left standing falls back into the
  district; when it holds, they stay at the door and the ring goes back to the district. A spy on
  a player's gate reads this garrison. It starts empty on every save: nobody is at the door until
  somebody is walked there.
- **Locations**: the garrison on ground the crew holds, plus any faction ally's posting on it
  (`allied_garrisons`). A posting stands in the line when its crew is on the defender's side at the
  mark (see "Who fights for whom" below); a posting that held stays posted, one that fell goes home
  to its owner, and ground that changed hands has no postings left on it (a neutral's, parked
  there through the fight, walks home). A posting is reported as `garrisoned` on the roster and
  taken back out of `abroad`, so the census counts it once. Leaving, being removed from or
  disbanding a faction walks every posting on a former ally's ground home (`factions/unpost.ts`);
  that walk is not held by a fight's last hour, because a posting of nobody's side is parked
  anyway.

Winning attackers **stay and hold** what they took, always (maintainer, 2026-09-28: "The server
should automatically give the winners what they should hold, not ask them"). `holdAfterCapture` is
gone from `DeclareBattleRequest` (a request that still sends it has it stripped), every row is
written with it true, and the settle does not read it, so an old row with it false holds too. Walking onto ground nobody holds **claims** it on arrival with no fight,
the level as it stands, and counts as a capture for the feats.

**Nothing moves without walking** (maintainer, 2026-09-28: "Nothing sends units immediately, you
need to move them"). `POST /city/garrison`, which stood units on held ground or brought them home in
the same instant and across cities, is gone; the client's Garrison control opens the Move dialog
pointed at the place. Every trip home the game makes for a crew is a move on the same clock
(`walkHome` in `moves/moves.ts`): units pulled back out of a deployment, a column that reaches
ground that will no longer have it, a posting whose alliance ended, a crew standing in a fight on
nobody's side, and everybody on a fight that is called off. A battle column turned round in its
first tenth walks back what it walked; one still walking when its fight is run walks on to the
place and lands on whatever the fight left (the garrison of ground its crew now holds, a posting on
an ally's, its own gate or district, or nothing, and then home). A column landing after the mark
waits for the fight to be run first and is never folded into it.

**Survivors walk home too** (`homeFromTheFight` in `battle/resolve.ts`): every crew's share of a
fight's survivors, line and ring, with the machines that carried it, is a move home from the place
of the fight (the location, or the streets of the district fought over). That covers the declarer
and its allies after a win they are not staying to hold or after a loss (runners and porters
included), the defender's column abroad, the defender's allies, and a neighbour turned out by the
mark (a legacy case: see the neighbour note under the muster below). Four things stay where they are
because they are already there: winners who stay and hold what they took are its garrison; a
location's defenders who held it are its garrison, and a posting that held stays posted; a gate
garrison that held its own gate stays on it (a gate that fell sends its survivors back into the
district on the door's clock); and a crew raided at home is home. A column of machines with nobody
in it is not recallable. The regime's survivors go back onto the plots they came off in the same
instant, since those are in the district fought over and the Combine has no roster to walk to.
Reports, infamy and feats count the same survivors and losses as before; only where they are
afterwards changed, and a unit on the road home is in `abroad` on the roster.

`POST /api/actions/move`: `{from, to, army, vehicles}`, where a place is `{kind: 'district'}`,
`{kind: 'gate'}` or `{kind: 'location', locationId}`. A fourth kind, `{kind: 'street',
districtId}`, is the open streets of somebody else's district: only the game walks a column home
from it (after a gate fight or a raid abroad), and a request naming it as either end is refused. The source is anywhere the crew has people
standing; the destination is the district, the gate, ground the crew holds or ground a faction
ally holds (`UnitsResponse.moveDestinations`, with `standingAt` for what is on each). Vehicles
ride only from the district, and they come back **on their own**: the column drops its people and
the machines walk the same road home with nobody aboard, which is visible on the Monitor, is not
recallable, and keeps drawing its unit slots until they are parked.

The clock: district to gate or back is `MOVE_GATE_MINUTES` (10) at base, cut by the column's
speed and the crew's road bonuses; inside the crew's own district, the same leg; from outside to
the gate, the road between the districts; from outside to the district, the road and then the
door. `POST /api/actions/move/quote` answers `{minutes}` for the same body with nothing moved.
`POST /api/actions/move/recall`: `{moveId}`, inside the first tenth; the column walks back to
where it came from. Refusals: `400` for the same place, nobody named, a location somebody else
holds ("call a fight instead"), or a location in a city that is not open (`city_closed`: a shut city's
empty plots have control rows, and a claim there opened a city no screen draws); `409 NO_FORCE` for units or machines not
standing at the source, or scavengers bound for ground; `403` for a source the crew has nobody
on. Columns settle on the world clock beside the ones bound for a fight, and `GET /api/actions`
lists them as `moves`. The census counts the gate as its own place (`UnitsResponse.gateArmy`).

### Calling things off (maintainer, 2026-09-12)

One rule for everything that takes time, in `@frontline/shared`'s `time/cancel.ts`: a thing can be
called off inside the **first tenth** of its own clock, and a spend called off comes back at
**ninety percent** (whole units, rounded down; parts come back whole). A journey has no bill and
refunds time instead: a crew, a spy job or a column turned round in the first tenth of the way out
walks home the distance already covered, so the return takes as long as the going did. Every route
below refuses with `409` once the window has shut (`PLACE_UNAVAILABLE`, `RESEARCH_BUSY` or
`TRAINING_REFUSED`, matching its start route) and `404 NOT_FOUND` when there is nothing to call off.

- `POST /api/base/cancel`: `{orderId}`. Removes a build order (`paid` and `parts` are recorded on
  the entry at order time); the orders behind it close up. Answers like `/base/build`.
- `POST /api/research/cancel`: `{}`. Takes the active project off the bench (`paid` is recorded on
  it). Answers with the research screen.
- `POST /api/city/cancel-upgrade`: `{locationId}`. The start is derived from its end and the
  level's fixed duration, which the district read exposes as `upgradingSince`. Answers like
  `/city/upgrade`.
- `POST /api/city/gate/cancel`: `{districtId}`. The raise's `upgradingSince` (migration 0089) is
  the clock's start, and the refund is ninety percent of `upgradePaid` (migration 0146), falling
  back to the list price on a row written before it. Answers with the city.
- `POST /api/training/cancel`: `{sessionId}`. Drops the drill and hands the day's session back
  to the day it was queued on (`queuedAt`); the drills behind it close up.
  `POST /api/training` itself queues (maintainer, 2026-10-04): drills run one after another, each
  starting as the one ahead ends (`nextDrillStart`), and the queue holds two, the running one
  included (`TRAINING_QUEUE_SLOTS`, refusal "The queue is full"). One place per person, running
  ("Already in a session") or waiting ("Already in the queue"). The Professor's fourth rung, Second
  Chair, adds a third place (`training_queue`), and the response's `queueSlots` says how many.
  Each session lasts the person's own hour, frozen on it as `durationSeconds` when it starts
  (maintainer, 2026-10-01): `drillSeconds` of their lifted sheet, which takes
  `50% x (1 - e^(-w / 174))` off the hour with `w = 2 x Speed + Resolve + Organization`, so 1,981 s
  with all three at 100, 2,370 s at 50 and 3,075 s at 15. Admin mode stores five seconds as before. `GET /api/training`
  sends the same figure per subject as `sessionSeconds`; the response's own `sessionSeconds` is the
  plain hour. The settle, the countdown and the cancel window read `durationSeconds` only.
- The unit muster bench tapers its speed rather than stopping it (maintainer, 2026-10-01, bugs
  B3): `musterSpeedAfterTaper` is in full to 55 and closes on 80 (it was a hard 60). The cost cut
  still stops at 50, a price floor, on every line but supplies.
- The supplies line of a bill takes the cost cut and the supplies-only points on one taper toward
  70% off (`suppliesLineCut`, maintainer 2026-10-01): the knee is the cost cut, which pays in full,
  and the Greenhouse and the cards taper from their first point:
  `g + (70 - g) x (1 - e^(-s / (70 - g)))`. It used to add the two, up to 50 and 40, so a late crew paid a tenth of its supplies
  or less. The supplies-only sources were nerfed with it: the Greenhouse is half a point a level
  with no ceiling of its own (it was 2 a level stopped at 30), and the seven supplies cards are
  halved (Mess Rota 4, Sealed Growrooms 7, Dispensary Apprenticeships 7, Instructor Cadre 8, Kit
  Store 5, Grey Water Loop 3, Parts Carousel 3). All seven are BASIC now; the four that were
  ADVANCED or INTRICATE keep their old gates, reach and Scrapyard band through `requires`, `fits`
  and `yardLevel` (`scrapyardLevelForModification` reads the override before the grade's band): 9
  and 4 since the yard's levels were spread over twenty on 2026-10-02, the first level of the band
  they came from.
- The general muster cut was cut with it (maintainer, 2026-10-01: a strong mid-game crew built
  for cheap supplies at about 30%). The Armory pays 1 on `LEVEL_SCALE` (1 at level 1, 6 at 10; it
  was 12 to 66); the two Lab rungs pay 3 and 5 (Unit Costing, Standard Syllabus; they paid 8 and
  12); the four perks pay 1, 2, 2 and 6 (Range
  Master, Surplus Dealer, Bar Regular, Headhunter; 5, 8, 8 and 28); Run of the Belt pays 2 (10);
  a unit's own ground 1 a level (2). Jigs and Fixtures and the Chemistry share went with the chair
  rework (2026-10-04), and Batch Runs moved to the Engineer's track, where it pays build speed and
  no muster cut; the Veteran's passive takes up to half off every line of
  a muster bill on top, outside the floor price (`musterCost`'s `veteranPercent`, shipped as
  `musterVeteranReduction`). A typical mid-game crew (a Greenhouse 10, Mess Rota and an E
  Veteran) is about 20% off the supplies line, a strong one about 31%.
- `GET /api/units` ships `musterSpeedBonus`, `musterSuppliesReduction` and `homeSpeedBonus` as
  raw sums, which `musterSecondsFor` and `musterCost` taper. Each breakdown list ends on a
  `Tapering` line: the speed list adds up to the tapered speed, and the supplies list to
  `suppliesOnlyCut`, what the supplies-only points add over the cost cut, so the cost and supplies
  pages add up to the line. A unit whose own ground raises its cost cut carries
  `homeBonus.supplies`, the share of that its supplies-only points lose.
- `POST /api/units/cancel` and `POST /api/actions/recall` already existed; the unit refund moved
  from ninety-five to ninety percent. `POST /api/missions/recall` now refuses outside the first
  tenth of the outbound leg (it was open until the crew was home).

Every refund above goes into the stores like any other credit: a refund that would not fit is
answered `409 WOULD_WASTE` until the request carries `acceptWaste: true`.

### Five more channels on tapers (maintainer, 2026-10-05)

Vehicle parts, refits, the black market's infamy discount, travel speed and mission speed each
stopped dead at a `min` (60, 60, 50, 60 and 50), so a level 5 Rail Yard filled the vehicle cap
alone and every level, rung and perk past it bought nothing. Each now goes through
`softCap(points, knee, ceiling)` in `economy/soft-bounds.ts`: face value to the knee, then less for
every point, never reaching the ceiling. `MAX_MISSION_SPEED_BONUS`, `MAX_TRAVEL_SPEED_BONUS` and
`MAX_BLACK_MARKET_DISCOUNT` are gone. Sized so a realistic mid and late crew lands near the old
bound for its phase and a crew that stacks one channel runs ahead of it at falling returns:

| channel                      | function                 | knee / ceiling | old cap |
| ---------------------------- | ------------------------ | -------------- | ------- |
| vehicle parts                | `vehiclePartsCut`        | 30 / 70        | 60      |
| refits                       | `refitDiscountCut`       | 30 / 70        | 60      |
| black market infamy discount | `blackMarketDiscountCut` | 25 / 65        | 50      |
| travel speed                 | `travelSpeedCut`         | 30 / 75        | 60      |
| mission speed                | `missionSpeedCut`        | 25 / 60        | 50      |

Salvage went the same way: the Bone Market, the Rendering Shed, the two salvage rungs and the
perks add on `salvageRefundPercent`, and the sum reached 155% of what the dead cost.
`salvageRefundCut` (`battle/salvage.ts`) pays it in full to `SALVAGE_REFUND_KNEE` (50) and closes
on `SALVAGE_REFUND_CEILING` (100), so 155 points refund about 93.9% and a refund never returns
what was spent. Every location card on these channels says "(tapers, no hard stop)" (`TAPERS`).

### Reliquary's ground: authored payouts, the Mausoleums and the Death Cloaks (maintainer, 2026-10-06)

The third city is in `city/atlas.ts` behind `open: false` while it is written a district at a time
(`docs/DISTRICTS.md`, "Reliquary"). Four things in the code came with its first two districts:

- **Saltmarch is gone.** Reliquary took its row in `CITIES` and its place on the world screen,
  and its three-district sketch left the atlas with it; the shut-city tests that used it now use
  Reliquary. No migration: a save holding Saltmarch rows drops them (pre-launch rule).
- **A location can carry its own payouts.** `LocationSchema.bonuses` is an optional authored list
  that replaces its kind's; `baseBonusesOf(location)` is the one reader and `bonusesAt` takes the
  location (a bare kind still answers with the kind's own list, for tests). Every consumer of
  held ground reads through it: `territoryEffectsFor` (`city/control.ts`), the district view's
  card lines (`city/view.ts`), the unit bonus breakdown (`units/breakdown.ts`) and the test
  fixture `holdEveryBoard`. So the Wax Stalls are a Market that pays 40 caps, the Pilgrim Hostels
  a Fence Camp with beds and no caps, and the Cemetery a Graveyard worth 5% infamy and nothing
  else.
- **Two bonus shapes.** `officer_skill { attribute, flat }` puts flat points on one named skill
  of every officer, through `TerritoryEffects.officerSkillFlat` and `LiftRoom.bySkill`
  (`crew/standing.ts`), outside `MAX_OFFICER_LIFT` like the group lift; it is not the perk kind
  `officer_attribute`, which skips the officer carrying it. `unit_morale` takes an optional
  `tier`, folded into `TerritoryEffects.unitTierMoraleFlat` and read per unit in `effectiveStats`.
- **The Mausoleum** (`mausoleum`, appended to `LOCATION_KINDS`) pays `{ kind: 'faith' }`, which
  `applyHoldBonus` counts into `TerritoryEffects.mausoleums` rather than switching a flag, plus six
  beds. `effectiveStats` adds `FAITH_PER_MAUSOLEUM` (30) times that count to the damage and
  vitality of a unit whose sheet carries `faith: true`, before any percentage.
- **A muster cap tied to held ground.** `UnitSpec.capPerHold { locationKind, each }`: the Death
  Cloaks are fifty a Mausoleum. `heldCapRoom` (`units/muster.ts`) counts them everywhere the crew
  has people and on the bench, like `legendaryRoom`; `queueMuster` refuses past it with
  `at_the_cap` (409, `UNIT_LOCKED`, "That is as many as the ground you hold can raise"), and the
  roster sends the remaining room as `UnitOption.room` so the client's Max never offers a batch
  the route refuses. `death-cloaks.test.ts` holds the rule.

The Steelbelt's Bone Market moved to Gravefields the same day and the Steelbelt got a Soup Kitchen
(`steelbelt-canteen`) in its place; `salvage.ts` and the server tests that handed a crew "the Bone
Market" now use Bonded Row's Rendering Shed.

### The stores are a hard ceiling (maintainer, 2026-09-28)

"You're never past your storage, it will go to waste, the excess, but whenever you do something that
would push you to waste it has a warning first."

Every credit to a stockpile goes through `district/stores.ts` (`creditBase`, over the shared
`creditStores`): it lands up to each store's ceiling (`storeCeilings`, the crew's storage
bonus included; caps have none) and the rest is thrown away. A store already standing above its ceiling
keeps what it has and takes nothing more. That covers production, mission pay and salvage refunds,
raid loot and the Bone Market's caps, every market trade and escrow coming home, feat rewards,
cancel refunds and the Console's resource knob. `district/stores.test.ts` fails on a server source
that adds to a stockpile any other way.

The warning, for a credit the player fires: the request is refused with `409 WOULD_WASTE`, the
sentence from `wasteWarning`, and `waste` (the amounts) beside `error` in the envelope, and nothing
is written. The same request with `acceptWaste: true` goes through. It applies to
`/market/barter`, `/market/supply`, `/market/accept` (for the taker), `/market/withdraw`,
`/market/claim`, `/base/cancel`, `/units/cancel`, `/research/cancel`, `/city/cancel-upgrade` and
`/city/gate/cancel`. A feat claim keeps its own `FEAT_REFUSED` `would_waste`, because it can also
lose units.

A credit nobody is pressing for lands without a question: a crew coming home, a raid's haul. A
mission's report carries the part of its pay that did not fit as `Mission.wasted` (migration 0124),
shown per resource and as a loot total in the report's haul, and `resources_earned` counts only
what landed.

The trading board holds its unattended credits instead (maintainer, 2026-09-28): the poster's side
of a listing somebody takes, a listing's escrow when it expires untaken, a counter's escrow when
the listing it answered closes. Each becomes a row in `market_claims` (migration 0125), sent on
`GET /market` as `claims` and told with a `market_claim` notification. `POST /market/claim` pays one
into the stores behind the usual warning. After `CLAIM_WINDOW_HOURS` (24) the world tick's
`settleMarketBoard` pays it anyway, and what does not fit is lost; the same stage closes expired
listings, which used to wait for somebody to open the market. Posting a listing no longer warns
about what it asks for, since the claim is where the poster is asked. A reset drops the crew's
claims with its listings.

Taking a counter closes the listing it answers, which is always the taker's own: that listing's
escrow pays the counter first and what is left of it comes home with the goods, behind the same
warning. Every listing above that one in the chain closes with it (a reply to a counter, taken,
closes the first listing too), each one's escrow held as a `closed` claim for its poster. Only the
crew a counter is aimed at may take it or counter it back, and a counter to a counter is released
with the counter it answered.

### Lazy settlement

Every read path that touches a base calls `settleBase`, which runs **the district first, mustering
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

Officer drilling lands inside `settleBase` as well: the district walk cuts its window at every
drill that ends (`crewChangesDue`), banks it there (`bankTrainingFor`), and `announceDrills`
(`crew/training.ts`) sends one `training_done` for every hour that settle banked. The training
routes call `settleTrainingFor`, which banks and announces the same way.

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
crew's district and payroll, then any location upgrade whose clock ran out, then **any fight whose mark
has passed**. There is no scheduler: `settleBattles` runs on the read, and a fight nobody has looked
at for three days resolves to the same result whenever it is next opened.

- `GET /api/battles` → `BattlesResponseSchema`. Coming fights the caller is in or can see, finished
  ones they are allowed to read, the half-hour marks open right now, their infamy and what it buys,
  their own structures, and the gate state of every district they can see into. Each fight's
  `leaders` list is the officers free to take it, filtered through the same `officerDuty` the lead
  route refuses with, keeping whoever already leads that fight. It used to drop the injured alone,
  so it offered names `/battles/lead` then turned away.
- **Rules around a called fight (maintainer, 2026-09-27; `src/battle/lock.ts`).**
  - In the last hour before a fight, nothing leaves the place of it (maintainer, 2026-09-27 and
    2026-09-28; `placeLocked`): a move off a location with a fight called on it, off the gate
    before a call on the crew's own gate, or out of the district before a raid through its own
    breach (`/actions/move`, `409 PLACE_UNAVAILABLE`, `garrison_locked`); a withdrawal from the
    fight's own deployment (`/battles/deploy` with a negative delta, `409 BATTLE_REFUSED`); and,
    before a raid on home, anything else that takes units out of the district: a deployment to
    another fight, a Sleeper cell, a mission party (`409 MISSION_REFUSED`) and a standing order,
    which stalls. Turning the home army out onto the raid's own ring is not leaving it. Arrivals
    are accepted to the last second and fight.
  - No fight is called on an unoccupied plot (maintainer, 2026-10-04): the call is refused as
    `empty_ground`, and the plot is taken by walking onto it. A call made on one before that rule,
    or on ground that emptied after the call, still keeps it shut until it resolves: a move there
    is refused (`under_fire`), and a column already walking there turns home on arrival.
  - One fight per place: a second call on a target with a call still unresolved is refused
    (`already_declared`), whoever makes it and whatever mark it names.
  - **A losing caller waits a day** (maintainer, 2026-10-05; `lostHereRecently` in
    `battle/declare.ts`): a crew that called a fight and lost it (the defender won) is refused
    another call on the same target (`lost_here`) until `LOST_CALL_COOLDOWN_HOURS` (24) after that
    fight's mark. Only the caller that lost waits; anybody else may call the place at once, and a
    fight called off with no winner is not a loss.
  - **An attack needs twenty unit slots at the lock** (maintainer, 2026-10-05;
    `battle/understrength.ts`). When a pending fight enters its last hour (`insideLock`), the world
    tick's `under-strength calls` stage, run before the battles stage, counts the attacking side:
    the caller and every ally, deployment rows standing on it and columns still on the road, line
    and ring (`attackingSlots`). Under `MIN_ATTACK_UNIT_SLOTS` (20) the fight is called off
    (`callOff`): every column and row walks home whole, the fight closes with no winner so every
    Stackhouse bet on it is handed back, and the infamy paid to call it stays spent. The attacker
    and every crew deployed on it get a `battle_report` notification, "A fight was called off".
  - A fight through a breach (a raid, or a location in a shut district) must be called for before
    the gate comes back up (`breach_closes`, a mark at or after `brokenUntil` is refused). The
    declaration is the only thing that sets a mark, so the settle's call-off of a raid whose gate is
    up at the mark (everyone goes home, both sides get a `battle_report` notice) is a backstop a
    legal call never reaches.
  - **One pending fight per place** (maintainer, 2026-09-28: "two fights cannot be called in the
    same place at the same time"): a second call on a location, a gate or a raid on a district
    that already has an unresolved call is refused (`already_declared`), whoever makes it and
    whatever the mark, until the first resolves or is called off. It is not a rule about
    overlapping marks: two calls at different hours on one place are refused as well.
  - A broken gate gives nothing: no `gatePercent`, no intel resistance, no gate perks.
  - **A gate counts only at that gate** (maintainer, 2026-09-28): the home Gate (and the gate
    perks) in a fight at the crew's own home gate, a captured district's gate in a fight at that
    district's gate, and no gate in a location fight, a raid, or any fight elsewhere. A Colossus
    lowers only the gate its fight was at.
  - **A district's gate after a breach** (non-player ground): a contested district has a gate only
    while one party holds every location in it. Taking any location during the breach splits it,
    which resets the captured gate to level 1 (`resetGateOnDistrictLost`) and leaves the district
    open when the breach timer runs out: the gate is not recovered. With nothing taken, the gate is
    armed again the moment the timer runs out. A home (residential) district is shut by its
    resident, cannot change hands, and its Gate is always back up when the timer runs out.
- `POST /api/battles/declare`: `{target, scheduledFor}`. Three target kinds, `location`, `gate` and
  `district`, and which of them is legal is `declarationRefusal` and nothing else. Refused
  (`409 BATTLE_REFUSED`) for a mark off the half hour, inside eight hours or past twenty-four; for a
  location in a shut district (attack the gate); for a gate on a district that is neither held
  outright nor lived on; for a raid behind a gate that is still standing, or on a plot nobody lives
  on; for a place the map does not have, ground already called, ground this crew called and lost
  in the last day (`lost_here`), a fourth simultaneous call, or your own. A call on ground another player's crew holds costs `DECLARE_INFAMY_COST` (100 infamy), taken
  when the row is written and never handed back; Combine ground, looters and empty ground cost nothing
  (`declareInfamyCost`). A crew that cannot cover it is refused last, after every refusal it could
  answer by picking a different target or mark. Admin mode waives the price with the rest of them.

- `POST /api/battles/deploy/quote` answers `{minutes, arrivesAt, inTime, rail}`: the road, when a
  column sent now would land and whether that is at or before the mark (`rail` carries the same
  pair for the ride). The dialog says it plainly before the player confirms; a late column may
  still be sent.

#### Who fights for whom (maintainer, 2026-09-28)

_"Whatever units are in the location of the fight, if they are the attackers' or from a player
that is in the same faction as the attackers they attack, if they're the defenders' or the
defenders' [faction] they defend, and if they're a neutral's they don't affect anything and don't
show up in spying."_ Decided at the mark, on the factions as they stand then
(`battle/alignment.ts`, `musterAtTheMark`, run first thing in the fight's own transaction):

- The place is the location for a location fight, the gate for a gate fight and the district for a
  raid. At a location it holds the holder's garrison, every posting, every Sleeper cell waiting
  there and the deployment rows; at a gate the resident's gate garrison and, on a legacy database,
  any other crew living in the district's own gate garrison; in a raid the resident's home army and,
  on a legacy database, any other resident's home army; plus the rows.
- The two crews the call names are on their sides by identity; the regime's plots and muster are
  the defender's. Everybody else by faction; a crew whose faction is on both sides of an in-faction
  fight is on neither.
- A deployment row on the wrong side moves to the right one (its ring walks home from an attack,
  its officer, trap and boosts stay behind). A row of nobody's side is taken off the fight and walks
  home with its machines. A posting whose crew attacks joins that crew's attacking row. A cell whose
  crew is on a side wakes into that crew's row, which counts as `planted` for the declarer's own
  cell even when it went to ground after the call. A neighbour on a side turns out its gate
  garrison or home army into its own row, and its survivors go back to its roster. Neighbours exist
  only in a database from before 2026-09-28, when a player could be seated on a bot's plot; a plot
  now holds one crew, and this handling leaves with the bots (the TODO in `seed/index.ts`).
- A neutral's units are untouched: not counted, not killed, not in a spy report, and not on the
  battle page. A spy report counts only the holder's side as the reader would meet it (the holder's
  garrison, its faction's postings and, with the rung, its faction's cells), so a report on a
  faction-mate's ground no longer counts the reader's own posting as a defender.
- `BattleView.muster.standing` is everybody already at the place on the caller's side without a
  row: the garrison, the home army or gate garrison, postings, cells and (legacy) neighbours. The
  boost reach is priced on the same force.
- A cell goes only into a **split** district (maintainer, 2026-09-29). `POST /api/city/sleepers`
  refuses a location in a district one party holds end to end (`district_shut`, `409`): the gate
  is the one thing there to call on. It refuses a location in a city that is not open as well
  (`city_closed`, `409`). The rule holds after the send: a capture or a claim that closes a
  district sends every cell on or bound for its locations home the way a recall does
  (`sendCellsHomeFromShutDistrict`, run from `battle/resolve.ts` and `moves/moves.ts`).

#### The regime's army erodes, and grows back on Monday (maintainer, 2026-09-24)

A gate or district fight on Combine or looter ground is defended by every garrison standing in that
district (`assemble`), plus the muster `declare` turned out. Those survivors are now **written back
to the control rows they came off** (`spendGarrisons`), apportioned by the same largest-remainder
split an ally's survivors go home by. Before that the rows were never touched: the defence was
immortal and was counted as killed anyway, so every feat and every infamy payment for killing the
Combine could be collected again the next day against the same bodies. The muster is a row in the
split and its share is dropped, because it stood on no plot; a legendary is not in the split at all,
because `withoutTheLeader` keeps him out of any fight that is not on his own plot, and he is put
back on the row exactly as he was found.

**Sunday night at midnight, the instant before Monday begins**, every plot the Combine or the
looters still hold is put back to `startingGarrison`, which is the authored strength for that
district's difficulty and that location's `baseDefense`. Ground a crew holds is untouched: that
garrison is theirs. A legendary is a body in his plot's garrison, so he comes back under the same
condition and no other. Nothing ever hands a taken plot back to the regime (maintainer, 2026-09-29):
another crew can take it, a crew that lets it go leaves it empty, and a leader whose plot fell is
gone for good. He is stood back up only if he died in a fight the regime won.

The mark is Monday 00:00 in `GAME_TIMEZONE` (`lastWeekBoundary`), and the sweep is
`settleGarrisonRegrowth` on the world tick, before the fights. It is keyed on the week rather than
on the instant: `garrison_regrowth` (migration 0119) holds one row per mark, and the insert that
writes it is the claim. So a tick a fortnight later still pays the week it is in, once, and the
tick after it pays nothing.

#### Raiding a home (§A4, maintainer 2026-09-09)

**A home is shut.** A residential district has no locations, so `districtHolder` answers null for
one; the resident is what shuts it (`districtIsShut`), and the gate that is fought is the resident's
own Gate structure, whose level reaches a fight at that gate, and only there, through
`standingEffectsFor` and `withGate`. Winning at the gate breaks it for `GATE_BREACH_HOURS` (24), which `gateIsBroken` is the
only reader of.

Inside that day the whole district is one target (maintainer ruling, 2026-09-29, on who defends and
what a won raid costs):

- **Defence.** Every unit standing in the district defends, whether or not the resident deployed
  any (`assemble`: `defenderBase.army`, plus anything deployed). Units on the road or on a job have
  left the district army and are not in the line; the gate garrison (`gateArmy`) met the raiders at
  the door and lost when the gate went down, so it is not in it either.
- **Loot** (`breakIn`). `plunder` walks the priority order taking up to `MAX_RAID_SHARE` (a quarter) of each
  line, bounded by `lootCapacityOf(committed force, lootCapacityPercent)`, **with caps excluded**:
  caps are first in the order and weigh one apiece, so a raid that could take them filled its hold
  with the victim's wallet and left the materials standing.
- **Disruption**, and it is the only thing a won raid leaves broken.
  `stackDisruption(current, disruptionFrom(now, blow))` on the resident, where the blow is
  `defenderLossShare`: `forceSize(outcome.killed) / defenderStarted`, 1 when nobody defended. For
  `RAID_DISRUPTION_HOURS` (6) the district's **structures** make `raidDisruptionPercent(blow)` less.
  The settle walk hands it to `productionRates` as `raidCutPercent`, which scales the structures'
  own output before the held ground's is added, so the ground runs whole. Nothing else is cut: the
  crew's bonuses, the chair rungs, the Lab and the muster breakdown run at full strength.

  The curve is `RAID_CUT_ASYMPTOTE x blow / (blow + RAID_CUT_HALF_BLOW)` (60 and 1), the hyperbola
  the Collective rule uses: no clamp, every bit of blow costs something, each costs less. A light
  raid (a fifth of the line lost) is 10%, a medium one (half) 20%, a crushing one (all of it, or
  nobody home) 30%: 0.6, 1.2 and 1.8 hours of the structures' output over the six hours, and the
  district is whole when the window closes. A second raid **stacks through the curve**: its blow is
  added to the first one's blow times the share of the first window still to run, and the record
  restarts at the new raid (the fight has just settled the district, so the hours before it are
  banked at the old rate). Back to back, two crushing raids are 40% and three 45%, never 60. A
  record that has run out adds nothing, and a token raid never lowers the cut still owed: the
  curve's concavity gives `cut(r x blow) >= r x cut(blow)`.

  A raid used to wreck three of the victim's roofs on a 24 hour repair clock on top of this, so the
  same win was charged twice. That half is retired (migration `0101`), along with `damage` on a
  `Building`, its repair walk and everything that read them.

Migration `0087` rewrote every stored `building` target into the `district` target of the same
district, resolved history included, so the repo carries no legacy branch.

- `POST /api/battles/deploy`: `{battleId, changes, perimeterChanges}`, both **deltas**. Positive
  sends, negative withdraws. Units leave the roster when sent and walk home from the place of the
  fight when pulled (maintainer, 2026-09-28), less whatever the enemy's ring takes on the way out;
  a raid on the crew's own district is the one place that is already home. Refused in the fight's
  last hour for a withdrawal (`garrison_locked`), past the cutoff, for units the crew does not have,
  for units whose tier asks for a notoriety rank the crew has not bought (`unitsBeyondNotoriety`),
  and (`ring_is_the_defenders`) for any `perimeterChanges` from the attacker: only the defender may
  set a ring (maintainer, 2026-09-23).
- `POST /api/battles/vehicles`: `{battleId, vehicles}`, **absolute** rather than a delta and the
  whole set in one request. Committed machines leave the Garage exactly as deployed units leave the
  roster and come back the moment the set is narrowed. A column already walking is re-timed from its
  own departure, so loading the yard onto a fight after sending the people still counts. See the
  Garage section below for what a machine is worth on the road.
- `POST /api/battles/lead`: `{battleId, officerId}`, or `officerId: null` to stand somebody down.
  One officer, one fight, and one duty at a time (`crew/duty.ts`): somebody already leading a fight,
  laid up, or **out leading a run** is refused with `403` and the hold's own sentence, the same one
  the missions board dims them with and the launch refuses them with. The rule runs in both
  directions: a leader in a fight cannot lead a run, and a leader on a run cannot be named to a
  fight. A spy job holds nobody: the runners are the Master of Whispers' people, sent from the
  chair.
- `POST /api/battles/trap`: `{locationId, trapId}`. One armed trap per location. A trap is cut at the Scrapyard off its
  blueprint alone; no Lab rung gates it (maintainer, 2026-10-01).
- `POST /api/battles/boost`: `{battleId, boostId}`. Burns a name on one fight, and only the crew
  whose fight it is may do it, so an ally cannot spend the slot the principal was going to use.
  **A name is final** (maintainer, 2026-09-12): it cannot be swapped, cleared or refunded, taking the
  same name twice is `409 BOOST_REFUSED`, and a crew already at its cap is refused the same way.
  The cap is `BattleView.boostSlots`: one, plus `CrewEffects.battleBoostsFlat`, which the Field
  Commander's eighth research rung, Two Names, raises by one. `BattleView.boostIds` is what has been burned, in
  order. Two names stack by adding their percentages (`battle/resolve.ts`). A crate of contraband
  can be named on several coming fights and the first to land spends it; when that was the last of
  it in the bag, its id comes off every other fight it was named on and frees that slot
  (maintainer, 2026-09-29: the name-is-final rule is about a live crate). A crate applies the
  figures on its card in any city: only the fence's price moves with the city's level.
- `POST /api/battles/notoriety`: `{fromNotoriety?}`. Buys the next rung of notoriety with infamy;
  `409 NOT_ENOUGH_INFAMY` when the name is not worth it yet, and `409 PLACE_UNAVAILABLE` at the top
  of the ladder. `fromNotoriety` is the rung the screen was showing: when it is given and the row
  has moved on, `409 STALE_STATE` and nothing is bought, so a double click or a second tab cannot
  buy two irreversible ranks off one decision.

### Missions (§E), and who leads one (maintainer, 2026-09-10)

`GET /api/missions` settles first (see **Lazy settlement**) and then answers the whole screen:
the crew's runs, what just came home, the boards, the army at home, and two fields about leading.

**The opening ramp (maintainer, 2026-09-23).** A new crew's board is compressed into minutes and
opens out over the first six levels. `packages/shared/src/missions.ramp.ts` holds the bands and
`missions/pricing.ts`'s `rampFor` reads which one a crew is in, off its level and the lifetime
`missions_done` tally:

| when                   | door to door    | what it pays    |
| ---------------------- | --------------- | --------------- |
| the first three runs   | 1 to 3 min      | twice the clock |
| after that, to level 3 | 3 to 10 min     | half again      |
| levels 4 to 6          | 10 to 30 min    | the clock       |
| level 7 and up         | the board's own | the board's own |

**Every walk reads the crew's speed (maintainer, 2026-09-23).** A mission's travel legs now take
`travelSpeedPercent` off the clock and the `road_shortcut` holding's whole minutes off the end of
it, exactly as a march, a move between districts, a spy job and the city's travel estimate
already did. It lands on the **run's** clock and not on the priced one, beside the column's pace
and the leader's Short Way: `rewardScale` is monotonic in the minutes, so pricing a crew's own
speed into the card would pay a faster crew less for being faster.

The band is applied last, after the crew's own speed, in `pricedTimings`, so the card and the
launch quote the same clock; its premium is folded into `payPercent` beside the ground's and the
level's, so a run already out keeps it. The board's ordering survives: a job's own clock is mapped
into the band on a log scale, so the longest job in a band is still the longest. Above the last
band `earlyMissionRamp` answers null before it looks at the count, so the ramp is unreachable for a
crew that is past the opening whatever their history.

- **`leaders`** is the bench, from `apps/server/src/missions/leaders.ts`: the **Overseer first**,
  kind `overseer`, then every officer on the books in roster order, kind `officer`. Each carries the
  sheet the screen scores them with and one reason they cannot go: `held`, one of `run`, `fight`,
  `injury`, `bench` or `null`, with `heldUntil` set to the mark they are free at wherever the server
  knows one (the run's return, the end of the injury). A declared fight
  has no such mark until it settles, so `held: 'fight'` always carries `heldUntil: null`, and
  neither has the bench, which ends when the player seats them.
  - An officer's `held` is `officerDuty` (`apps/server/src/crew/duty.ts`), the same question the
    dispatch doors ask before they refuse, asked in one order: injured, at a fight, out on a
    run, on the bench. A dimmed row and a `409` therefore never disagree about why. The bench is
    last so an officer unseated mid-run still reads as out on the run, which is the hold the
    release door refuses on.
  - **The bench is unusable** (maintainer, 2026-09-28). An officer with no chair puts no rating,
    no perk and no lift on anybody into any fold (`officerIsWorking` in `@frontline/shared`, read
    by `officerLiftRoom` and `workingOfficers`), leads no run or fight, is left off the fight
    screen's picker and the Right Hand's choices, and is not fought in the leader quote. Every run
    keeps its leader, so `POST /api/crew/reassign` refuses to move an officer out on a run or named
    to lead a fight (`409`, "`<name>` is out leading a run. Seat changes wait until they are
    back"). Drills and release are unaffected.
  - **The Overseer is only ever held by a run they lead.** They are not on the books, so no
    declared fight can name them, and §D4's injuries belong to officers.
    Their half is the run join alone: the row's `overseerLed` flag, where an officer's is
    `officerId`.
  - Both this and the boards read the runs still out through `listActiveByBaseId`, never by
    filtering the `missions` history the response also carries: that page is the newest
    `MISSION_HISTORY_LIMIT` rows, so a long job with a couple of hundred short ones launched after
    it drops off the end of it while it is still out, and the bench would call its leader free
    while the launch refuses them.
    Every offer carries two fields the gauge needs and nothing more: `grade` (the one it was dealt at)
    and `leanings` (`leaningsFor`, one to three of eighteen; a fight carries `fight` alone,
    maintainer 2026-09-28). The odds a run would actually go out with
    are **not** on the card: the screen grades the chosen leader for the job (`leaderMark`, their
    attributes weighted by what the job leans on, on the role-mark scale) and runs `missionOdds`, the
    same function `launchMission` freezes the row with, so the needle and the row cannot disagree. A
    leader level with the job is 75%, three marks short about 30%, three over 95%, five or more over
    certain (`gradedChance`).
  - **A fight's leader is whoever wins it** (`missions/fight-leaders.ts`, maintainer 2026-09-28).
    `POST /api/missions/leaders/quote` (`{templateId, grade, force, vehicles?}`, a fight template
    only) fights the force under every leader on the bench over `LEADER_RANK_SAMPLES` practice
    fights on practice seeds, each with their chair's rungs on their sheet and on the line, and
    answers `{leaders: [{id, wins, fights, kept, score}]}` best first. The launch freezes the share
    the chosen leader won as the row's `successChance` (`fightChance`), which the report prints;
    the Right Hand's standing orders pick a fight's leader the same way once the party is filled.
  - **The Raid Boss's seat** (`RAID_BOSS_SEAT_TIMES`, `crew/leading.ts`): in every fight he leads,
    the damage and hit points the attribute table calculates for him are doubled, after any rung
    percentages. That is the whole of what the chair does as a chair; nothing has to be researched.
  - **Chair rungs** (`crew/leading.ts`). Rungs on the Raid Boss track pay him alone while he leads
    (`leader_self`: damage, hit points, armour past the officer cap; `leader_taunt`: more of the
    enemy's fire), and rungs on the Field Commander's pay every unit on his side (`leader_party`).
    A `mission` rung pays on a battle job only; a `fight` rung pays in any fight the engine
    settles, a battle job included. Nothing pays while another chair or the Overseer leads. Both
    settlers spend them through `leadingAs` and `officerSheetBonusFor`.

`POST /api/missions` takes `leaderId` (the Overseer's id or an officer's), and it is **required**:
every run has a leader (maintainer, 2026-09-28), and the Overseer is on the bench from the first
day. It also names the card exactly as it was read, `boardKey` and `grade` off the offer
(maintainer, 2026-09-29), and the server launches that card only if it is on the board the player
is reading or the one just before it (`missions/dealt.ts`, `namedCard`): the key of the moment or
the misc board's previous slot, dealt at the crew's level before the settle or at the level below
it, announced or not (maintainer, 2026-09-29: "always allow previous"). Anything else, a grade the card
was not dealt at or a board the screen no longer shows, is a `404`. A job in another city adds the
cross-city walk to each leg of its road, and the card is priced on it (`missionWalkMinutes`).

- an id nobody on the bench answers to → `404`;
- a leader who is out leading a run → `409`, "`<name>` is out leading a run". One job at a time,
  for the Overseer as much as for an officer;
- an officer who is injured, leading a declared fight or on the bench → `409` through
  `officerDuty`, in that hold's own words: "`<name>` is at a fight", "`<name>` is still laid up",
  "`<name>` is on the bench. Give them a chair first" (`LEADER_HOLD_MESSAGES`, in
  `@frontline/shared`). The Overseer
  answers to none of that: they are the player, not an employee;
- no `leaderId` at all → `400`, from the schema.

Otherwise the row is priced by `missionOdds({grade, leader, profile})` and frozen:
`officerId` for an officer, `overseerLed: true` for the Overseer. What
came before this is gone rather than kept beside it: `delegationTerms`, the ×0.67 odds and ×1.5
clock penalties, `requiresOfficer`'s hard-job gate, and `overseerMissionEdge`'s Speed-and-Stealth
nudge. The Overseer goes through `leaderFit` like anybody else.

The Right Hand's second and sixth rungs (`research/tracks.ts`) used to open unled runs. They keep
the ids crews researched them under (`tech_unled_runs`, `tech_unled_runs_free`) and their other
bonuses; neither opens anything unled any more.

A recall does not free the leader. `recalledAt` is recorded and the row stays `active` for the walk
home, so the person at the head of the crew is out until the settle brings them in, and a recalled
run never fights: the fight is skipped on it, the whole force comes back, and it settles as a
failure with `lost` empty and `reported` true.

#### A battle job fights

A `battle` template no longer rolls against its frozen chance. At the settle
(`missions/resolve.ts` through `missions/battle.ts`):

1. The enemy is built from the row's own seed: `enemyForce(grade, seed)` (`missions/enemy.ts`), a
   force of catalogue units whose `fieldStrength` lands within `ENEMY_STRENGTH_TOLERANCE` of
   `enemyStrength(grade)`. The grade's letter picks the roster (`ENEMY_ROSTERS`, F to S), from
   razors and scrapers at F to wardens, breakers, snipers and juggernauts at A and S; the grade
   sets how many. The grade is **dealt on the card** and **frozen on the row** (`grade`,
   migration 0123), so nothing on the road changes it. A won Mayhem always brings
   `MAYHEM_GUARANTEED_PARTS` components and a page home on top of the haul (the Siege's guarantee
   until 2026-09-28). A row from before grades carries null and settles as the job's lowest.
2. `TacticalSkirmishEngine` runs it with the crew as the attacker and the enemy as the defender, on
   a bare battlefield, **with no ring on either side**: whoever breaks and runs is not pursued and
   comes home. Whoever led the run is folded in as the side's officer, the way a declared battle
   folds one.
3. The outcome is `success` when the crew held the field. `lost` on the row is the units that did
   not come home, `force` less `lost` walks back into the army, and a machine whose riders all died
   is wrecked by the same `wrecked` rule the battle settler uses.
4. `reported` is false when nobody came home at all. Then the run banks nothing: no pay, no
   salvage, no page, no XP, no infamy, and the bell says "Nobody came back from `<job>`".

Migration 0088 adds `overseer_led`, `lost_json` and `reported` to `missions`. A row written before
it reads as an officer-led or unled run that killed nobody and was reported, which is what every one
of them was.

A mission does not lay a leader up: §D4's stretcher needs the day's margin and a stream the battle
settler owns. A leader is out for the length of the run and free the moment the crew is home.

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

**A seat is priced in unit slots, not in heads.** `VehicleSpec.capacity` is in the same currency
the district houses a unit in (`UnitSpec.unitSlots`), so a Cheese Wagon at thirty carries thirty
one-slot units, or ten three-slot Ironsides, or twenty Haulers and three Ironsides. A unit that
costs more slots than a machine has left does not board it, and a machine too small for the sheet
at the front of the queue is stepped over rather than ending the fill. `ridingUnitSlots` is the one
function that counts what is asking for a seat, and the deploy window's ceiling, the column's pace
and the wreck share on the settle all read it.

`roadMinutes(base, speed, reductionPercent)` (`packages/shared/src/time/speed.ts`) is the only place
that turns those two numbers into minutes, and every road in the game goes through it: the march to
a fight, a mission's travel leg, a spy job at the Master of Whispers' own speed, and the city view's
estimates at speed 0. The **speed divides** (`base / (1 + speed/100)`) and the crew's
**travel reduction multiplies what is left**, bent by `travelSpeedCut` (in full to 30, closing
on 75; it was a hard `MAX_TRAVEL_SPEED_BONUS` of 60 until 2026-10-05). The effective
speed a road reads is the sheet after the Scrapyard's fitted upgrades and the crew's
`unitSpeedPercent` channel, which is the same figure `battle/effects.ts` hands the engine.

A mission's pay is deliberately not on that clock. `pricedMinutes` is **the card's own figure**:
`pricedTimings(template, missionSpeedPercent)` in `apps/server/src/missions/pricing.ts`, and the one
function both `offerFor` (which draws the board) and `launchMission` (which freezes the row) call,
so the two cannot come apart. It carries the crew's own `missionSpeedPercent` and nothing else,
because that is the only input the card can know when it is read. Three things are therefore in the
clock the crew actually runs on and out of the one it is paid on:

- the **column's pace**, chosen after the card is read, so the Garage buys a shorter wait and never
  a smaller cheque;
- §D5's **`leadArrivalPercent`**, for the same reason: `rewardScale` is monotonic in the minutes, so
  pricing a led run off its own shorter clock paid a crew _less_ for bringing their fastest leader;
- **admin mode**, which skips the wait and not the economy: the card is not admin-aware and quotes
  the real clock, so the testing build pays the real price.

There used to be a fourth, §G6's officerless penalty, which made an unled run half again as long.
Leading a job moves its odds and not its clock now: see the missions section above.

`missionXp` is frozen off the same figure, and `resolveDueMissions` pays and awards against it
through `pricedTotalMinutes`. What an officer leading a run _does_ buy on the pay side is
`leadLootPercent`, which goes into the frozen `payPercent`.

The **report** is withheld rather than redacted. A defender always gets one, whatever happened to
their line or their officer: it is their ground. An attacker gets one if they won or if at least
one unit fled and made it home past the ring; the officer counts for nothing towards it
(maintainer, 2026-09-23). A redacted report leaks the shape of what was kept back, and a ring is
bought to buy a silence. The ledger pays a kill whole, a rout half (floored on the bulk) and every
death at the ring half (`economy/infamy.ts`); `units_routed` counts the rout for the feats. A
trap's dead are paid to whoever set it, an ally included: their infamy, `kills` and `trap_kills`
go to the setter, and the rest of the defending side's ledger to the principal.
The analysis the settler stores carries two more fields since 2026-09-28, because the report is
a sheet of final figures rather than a log now: `spoils`, what landed on the winner after the
stores' waste (the same figure the battle record keeps), and `target` (`location`, `gate` or
`district`), so the sheet can say captured, held, broken or raided without re-reading the map.

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
