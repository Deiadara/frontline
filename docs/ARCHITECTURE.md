# Frontline: Architecture

Cyberpunk multiplayer base-building strategy game (Grepolis / Ikariam / CoC / Total War / FM
lineage). This document covers the foundation; the REST contract lives in `SPEC-server.md`, the
UI contract in `SPEC-client.md`, and **what is actually built today is in `STATUS.md`**.

## Monorepo layout

```
frontline/
├── packages/
│   └── shared/          @frontline/shared: domain model (types + Zod), constants, battle engine
├── apps/
│   ├── server/          @frontline/server: Fastify REST API + sqlite persistence
│   └── client/          @frontline/client: React 18 + Vite + Tailwind frontend
└── docs/                this file + the two implementation specs
```

pnpm workspaces, TypeScript strict everywhere (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ESM only. `@frontline/shared` builds to `dist/` with declarations;
both apps consume it via `workspace:*`. **Build shared before running either app**
(`pnpm --filter @frontline/shared build`, or just `pnpm build` at the root: pnpm builds in
topological order).

## Single source of truth

All domain types, enums, constants (`OVERSEER_PRESETS`, `CITY_DISTRICTS`, `BUILDING_CATALOG`,
`STARTING_RESOURCES`, `STARTER_DISTRICT_ID`) and every API DTO live in `@frontline/shared`,
co-located with their Zod schemas (`type X = z.infer<typeof XSchema>`). The server validates
request bodies with these schemas; the client parses responses with them. Neither app declares its
own copy of a domain type. The only deliberate exception: the server-only `UserRecord`
(`apps/server/src/types.ts`) which adds `passwordHash`: that field must never appear in a shared
or client-facing type.

## Module map (shared)

| Module                  | Contents                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `primitives.ts`         | `IdSchema`, `IsoDateTimeSchema`, `UsernameSchema`                                    |
| `attributes.ts`         | `ATTRIBUTE_NAMES` (34, four groups), `Attributes` (0..100), `attributeTier`          |
| `traits.ts`             | `TRAIT_IDS`, `TRAIT_CATALOG`, `applyTraitBonuses`                                    |
| `roles.ts`              | `OFFICER_ROLES` (19) + labels; the requirement weights stay server-side (GDD §B8)    |
| `overseer.ts`           | `Overseer`, archetypes, `OVERSEER_PRESETS` (4), `findOverseerPreset`                 |
| `commander.ts`          | Staff roles (head_doctor/battle_analyst/accountant/head_spy), factory                |
| `resources.ts`          | `Resources` {caps,supplies,oil,scrap,highQualityMetal}, `STARTING_RESOURCES`         |
| `building/`             | The district: 13 kinds, costs, power, production, standing, queue, 65 modifications  |
| `base.ts`               | `Base` (district + queue + economy + roster), `BaseSummary` (public projection)      |
| `city/`                 | The map: 10 districts, 42 location kinds, labels, weather, control, levels           |
| `units/`                | 27 battle units, their sheets, multi-clause unlocks, training and the army cap       |
| `raid.ts`               | Loot capacity in kg, what a raid takes, and the disruption it leaves                 |
| `economy/`              | Meters (§D4/§D7), payroll (§H7), the §D8 reputation tally                            |
| `bar/`                  | §H dispositions, wage negotiation, alignment, character levels                       |
| `assignees/`            | §G pool, placement, the §G7 bonus table                                              |
| `research/`             | §B9/§F2 projects, discovered facts, effects                                          |
| `progression/`          | §I player levels, grants, the (empty) §I3 unlock catalogue                           |
| `user.ts`               | Client-facing `User` (no password material)                                          |
| `time/zone.ts`          | Europe/Athens is the game's clock; IANA zones, day boundaries, wall-clock formatting |
| `market/blackmarket.ts` | The back room: 5 shared slots, priced in infamy, one take a day, battle boosts       |
| `api.accounts.ts`       | Settings, the black market and the admin bench: the DTOs around the game             |
| `battle/types.ts`       | `BattleInput`, `BattleResult`, `BattleEngine` interface                              |
| `battle/skirmish.ts`    | `CoinFlipSkirmishEngine`: a deliberate stub behind a swappable interface             |
| `battle/schedule.ts`    | Half-hour marks, the 8-24h declaration window, the one-second deployment cutoff      |
| `battle/scheduled.ts`   | A declared fight: targets, gates, deployments, and what may legally be called        |
| `battle/perimeter.ts`   | The ring outside the fight, who does not get away, and whose report goes missing     |
| `battle/traps.ts`       | What is buried under an approach, and the bounded bite it takes                      |
| `battle/intel.ts`       | What the other side can count of a deployment, on the §F2 channels                   |
| `battle/analysis.ts`    | The after-action ledger, and who is allowed to read one                              |
| `economy/infamy.ts`     | §D7 as an uncapped point total: what a kill is worth, and what a name buys           |
| `building/damage.ts`    | What a breach does to a structure, and what watching one is worth                    |
| `api.ts`                | All request/response DTO schemas + `ApiErrorSchema`                                  |
| `api.battle.ts`         | The declared-battle contract, kept separate because it is a whole feature's worth    |

The `building/` module is split by concern rather than kept as one file: `kinds` (the catalogue),
`state` (what stands and its caps), `cost` (materials and clock), `power` (the grid), `production`
(output, storage, housing), `standing` (morale/defence/research/XP/hardship), `modifications`
(the 65-entry table) and `queue`. Everything in it is a pure function of a `Building[]`, which is
why the client can render the same numbers the server enforces without a DTO for each one.

## Decisions

- **Fastify**: fastest mainstream Node HTTP framework, first-class TS, `app.inject()` for
  handler tests without sockets, plugin model (cors/jwt already registered). We validate with Zod
  at handler boundaries instead of Fastify's JSON-schema layer so shared schemas stay the single
  source of truth.
- **Europe/Athens is the game's clock**: every schedule, refresh and day boundary is an Athens
  wall clock, because a shared world needs a shared day. Instants are stored and transmitted as
  UTC ISO-8601 and converted at display time; a player's own zone is an IANA _name_ on their
  account (never an offset, which does not know about summer time) and changes only what they are
  shown, never when the day turns over. See `packages/shared/src/time/zone.ts`.
- **Snapshots every ten minutes**: `VACUUM INTO` writes a whole consistent database file while the
  server keeps taking writes, and the newest 24 are kept. A file copy is not an option: in WAL mode
  the newest commits live in the `-wal` sidecar. Recovery path in `docs/RECOVERY.md`.
- **Admin mode is the default build**: `ADMIN=false` turns it off. Every clock becomes five seconds
  and nothing is charged, while every screen still quotes the real price and the real duration, and
  every gate still refuses. Off automatically under the test runner, because a suite in which
  nothing costs anything cannot see a pricing bug. See `apps/server/src/admin/mode.ts`.
- **better-sqlite3**: zero-ops single-file persistence, synchronous API keeps handler code
  simple (no connection pool, no async ceremony) and is more than fast enough at this scale.
  Migrations are plain ordered SQL files (`src/db/migrations/NNNN_*.sql`) applied by a tiny
  runner tracked in `schema_migrations`. Fallback if the native module ever breaks: Node 24's
  built-in `node:sqlite` (`DatabaseSync`) has a near-identical API.
- **Pixi.js (v8)**: kept for the asset pipeline only. It was chosen for a pan-and-zoom WebGL city
  map, and that map is gone: the city is a painted plate with DOM tags on it (`CityView`), so
  **nothing mounts a Pixi `Application` any more**. What still uses the library is `assets/loader.ts`
  (texture loading) and `render/procedural.ts` (the code-drawn fallback art). The whole UI is plain
  React + Tailwind.
- **Zod (v4)**: runtime validation + static types from one declaration; used on both sides of
  the wire.
- **JWT (stateless)**: no session table; token carries `{sub: userId}`. Fine for this scale;
  revocation is a non-goal for now.
- **zustand + react-query**: session/auth token is client-local state (zustand); everything
  from the server is cache-managed by react-query. No duplicated server state in stores.

## Battle engine

`SkirmishEngine` is an interface so the combat model is swappable, and server code depends only on
the interface (it injects `defaultSkirmishEngine`). That seam has already paid for itself once: the
coin flip the board asked for first was replaced wholesale without a route, a repository or a screen
changing.

The model is a **deterministic seeded round simulation**. A force is committed and the server runs
the fight in one shot; what changed with the battle rework is _when_ that happens. A fight is now
**declared for a half-hour mark between eight and twenty-four hours out**, both sides move units
towards it until one second before, and it resolves on the first read after its mark: lazily, like
everything else, with no scheduler. `apps/server/src/battle/` owns that half; the engine below it is
unchanged in shape and now reads three inputs it previously ignored: the workshop's fitted upgrades,
the crew's cohesion (which widens usable frontage), and a held district's stealth bonus. Eight modules under
`packages/shared/src/battle/`, each independently testable: see `docs/STATUS.md` for the table and
for which established game each mechanic was borrowed from.

Four properties are load-bearing, and each has a test that fails without it:

- **Deterministic.** One seeded stream (`battle/rng.ts`, mulberry32 over an FNV-1a hash), persisted
  on the battle row, so a fight replays exactly. The rout draws from a _second_ stream seeded with a
  `:rout` suffix, so re-tuning the round loop cannot silently change historical survivors.
- **Simultaneous.** Both sides fire from one snapshot. A sequential loop hands whichever side is
  first in the array a free volley: the most common way this kind of engine develops a quiet bias.
- **Calibrated.** `battle/attrition.ts` holds the Tribal Wars / Travian reference curve, and
  `engine.test.ts` measures the simulation against its shape. That is what stops six tunable
  constants drifting somewhere unbalanced one pass at a time.
- **Bounded.** Always terminates, always with somebody holding the ground: including the
  mutual-collapse case, which is settled on residual power rather than defaulting to the holder.

`CoinFlipSkirmishEngine` is still exported. It is not a model of anything; it is what a test uses
when it needs a decided outcome without an army behind it.

Both kinds of fight go through the same engine: taking a location (§A4) and raiding a home district
(`homeBattlefield`). The caller's job is to build a `Battlefield`: the route that forgets to is
caught by `routes.test.ts`, which asserts the log names the ground.

## Lazy settlement

There is **no scheduler and no tick anywhere in the system.** Payroll, missions, research, the
build queue and production all settle on the read path, from stored timestamps. A base nobody has
looked at for three days owes exactly the same amount whenever it is next opened, and there is no
background job to keep alive.

`settleBase` (`apps/server/src/district/settle.ts`) is the one entry point every route uses. It
runs the district first and training second. There used to be a weekly upkeep pass between the
two; nothing in the game is charged on a clock any more, so what is left is production and then
the batches it paid for.

Two rules the settle paths follow, both learned the hard way:

- **Walk the window, do not multiply it.** Production is accrued piecewise, cut at each completed
  build, so a structure that finished an hour ago is not paid for the whole absence.
- **Never round an accrual.** A settle below `PRODUCTION_MIN_STEP_MS` is skipped _without
  advancing the clock_, so a fast-polling client loses nothing. Rounding instead is the oldest bug
  in the genre.

## Tooling / gates

Root scripts fan out with `pnpm -r`: `build`, `typecheck`, `lint`, `test`;
`format` / `format:check` run Prettier over the whole repo. One flat ESLint config at the root
(typescript-eslint recommended-type-checked, no unused vars, no floating promises). Per-package
vitest. Client e2e via Playwright (`pnpm --filter @frontline/client test:e2e`). Before handing
work back run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
