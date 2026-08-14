# Frontline — Architecture

Cyberpunk multiplayer base-building strategy game (Grepolis / Ikariam / CoC / Total War / FM
lineage). This document covers the foundation; the REST contract lives in `SPEC-server.md`, the
UI contract in `SPEC-client.md`. Build strictly against those specs.

## Monorepo layout

```
frontline/
├── packages/
│   └── shared/          @frontline/shared — domain model (types + Zod), constants, battle engine
├── apps/
│   ├── server/          @frontline/server — Fastify REST API + sqlite persistence
│   └── client/          @frontline/client — React 18 + Vite + Tailwind + Pixi frontend
└── docs/                this file + the two implementation specs
```

pnpm workspaces, TypeScript strict everywhere (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), ESM only. `@frontline/shared` builds to `dist/` with declarations;
both apps consume it via `workspace:*`. **Build shared before running either app**
(`pnpm --filter @frontline/shared build`, or just `pnpm build` at the root — pnpm builds in
topological order).

## Single source of truth

All domain types, enums, constants (`OVERSEER_PRESETS`, `CITY_DISTRICTS`, `BUILDING_CATALOG`,
`STARTING_RESOURCES`, `STARTER_DISTRICT_ID`) and every API DTO live in `@frontline/shared`,
co-located with their Zod schemas (`type X = z.infer<typeof XSchema>`). The server validates
request bodies with these schemas; the client parses responses with them. Neither app declares its
own copy of a domain type. The only deliberate exception: the server-only `UserRecord`
(`apps/server/src/types.ts`) which adds `passwordHash` — that field must never appear in a shared
or client-facing type.

## Module map (shared)

| Module             | Contents                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `primitives.ts`    | `IdSchema`, `IsoDateTimeSchema`, `UsernameSchema`                                         |
| `attributes.ts`    | `ATTRIBUTE_NAMES` (34, four groups), `Attributes` (0..100), `attributeTier`               |
| `traits.ts`        | `TRAIT_IDS`, `TRAIT_CATALOG`, `applyTraitBonuses`                                         |
| `roles.ts`         | `OFFICER_ROLES` (19) + labels; the requirement weights stay server-side (GDD §B8)         |
| `overseer.ts`      | `Overseer`, archetypes, `OVERSEER_PRESETS` (4), `findOverseerPreset`                      |
| `commander.ts`     | Staff roles (head_doctor/battle_analyst/accountant/head_spy), factory                     |
| `resources.ts`     | `Resources` {credits,power,data,alloy}, `STARTING_RESOURCES`, `addResources`              |
| `building.ts`      | `Building`, 6 kinds, `BUILDING_CATALOG` (base cost/output)                                |
| `base.ts`          | `Base`, `BaseSummary` (public projection)                                                 |
| `city.ts`          | `District`, `CITY_DISTRICTS` (11 nodes, normalized 0..1 positions), `STARTER_DISTRICT_ID` |
| `user.ts`          | Client-facing `User` (no password material)                                               |
| `battle/types.ts`  | `BattleInput`, `BattleResult`, `BattleEngine` interface                                   |
| `battle/engine.ts` | `RandomBattleEngine` stub + `defaultBattleEngine`                                         |
| `api.ts`           | All request/response DTO schemas + `ApiErrorSchema`                                       |

## Decisions

- **Fastify** — fastest mainstream Node HTTP framework, first-class TS, `app.inject()` for
  handler tests without sockets, plugin model (cors/jwt already registered). We validate with Zod
  at handler boundaries instead of Fastify's JSON-schema layer so shared schemas stay the single
  source of truth.
- **better-sqlite3** — zero-ops single-file persistence, synchronous API keeps handler code
  simple (no connection pool, no async ceremony) and is more than fast enough at this scale.
  Migrations are plain ordered SQL files (`src/db/migrations/NNNN_*.sql`) applied by a tiny
  runner tracked in `schema_migrations`. Fallback if the native module ever breaks: Node 24's
  built-in `node:sqlite` (`DatabaseSync`) has a near-identical API.
- **Pixi.js (v8)** — the city map is a pannable canvas with dozens of animated interactive nodes;
  a WebGL scene graph beats DOM/SVG for that, and Pixi has the mildest API surface of the
  candidates. Everything that is not the map is plain React + Tailwind.
- **Zod (v4)** — runtime validation + static types from one declaration; used on both sides of
  the wire.
- **JWT (stateless)** — no session table; token carries `{sub: userId}`. Fine for this scale;
  revocation is a non-goal for now.
- **zustand + react-query** — session/auth token is client-local state (zustand); everything
  from the server is cache-managed by react-query. No duplicated server state in stores.

## Battle engine

`BattleEngine` is an interface so the combat model is swappable. Server code depends only on the
interface (it injects `defaultBattleEngine`).

`AttritionBattleEngine` is the live model. One draw decides the raid:

```
assault    = 0.5·tactics + 0.3·leadership + 0.2·hacking   (the Overseer's effective sheet, 0..100)
resistance = 8 · district.difficulty                       (difficulty 1..10 on the same scale)
chance     = clamp(0.5 + (assault − resistance)·0.01, 0.05, 0.95)
attacker wins ⟺ seededRoll(seed) < chance
```

The clamp is deliberate: no raid is ever a certainty or a foregone loss. The roll is seeded
(`battle/rng.ts`, mulberry32 over an FNV-1a hash of the seed string) and the seed is persisted on
the battle row, so a fight replays exactly. `AttritionBattleEngine`'s constructor takes the roll
function, which is the seam tests use to pin an outcome.

Still deferred, and marked `TODO-LATER` on the engine: defender base buildings (walls/barracks) and
commander bonuses — districts are not bases and carry no structures, so there is nothing to read
until a base itself can be raided.

## Tooling / gates

Root scripts fan out with `pnpm -r`: `build`, `typecheck`, `lint`, `test`;
`format` / `format:check` run Prettier over the whole repo. One flat ESLint config at the root
(typescript-eslint recommended-type-checked, no unused vars, no floating promises). Per-package
vitest. Client e2e via Playwright (`pnpm --filter @frontline/client test:e2e`). Before handing
work back run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
