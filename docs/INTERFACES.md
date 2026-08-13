# Integration contract — MOU-159 workstreams W1–W10

Ownership map and cross-workstream rulings for the [GDD](./GDD.md) rollout. The GDD says _what_ to
build; this file says _who owns which symbol_ so two workstreams never define the same thing.

- **Authority:** CTO (MOU-170). A ruling here overrides a workstream issue description.
- **Scope:** only symbols more than one workstream touches. If a symbol has one owner, it is not listed.
- **Conflict?** If your workstream needs to change something owned by another, raise it on MOU-170 —
  do not fork a second definition.

---

## 1. Ownership map

| Symbol / file                                                           | Owner           | Consumers                |
| ----------------------------------------------------------------------- | --------------- | ------------------------ |
| `packages/shared/src/attributes.ts`, `traits.ts`, `roles.ts`            | W1              | W3–W7                    |
| `apps/server/src/roles/requirements.ts` (hidden, server-only)           | W1              | W5, W7 (read-only)       |
| `packages/shared/src/resources.ts` — `ResourcesSchema`, `RESOURCE_KEYS` | W2              | everyone                 |
| Morale / infamy / reputation counters                                   | W2              | W3, W5, W10              |
| Weekly payroll engine (§H7)                                             | W2              | W5 (negotiation UI only) |
| `Base.level` — the **player** progression level (§I)                    | W6              | W4, W5, W8               |
| Player XP tally, level curve, level-up grant (§I1–I2)                   | W6              | W3, W4, W5, W8           |
| Mission definitions, travel/duration bands, resolution (§E)             | W3              | W4, W6                   |
| `Building.level` — per-structure level                                  | W8              | —                        |
| `Commander.level` — the **character** level (§H6)                       | W5              | W4                       |
| Resource icon **keys** (`icon-<resourceKey>`)                           | W2              | W9                       |
| Resource icon **prompt copy** (ART-PROMPTS §6.1)                        | W9              | —                        |
| `packages/shared/src/index.ts` (barrel)                                 | shared — see §3 | —                        |

---

## 2. Rulings

### R1 — "level" is two counters on two different subjects

The standing pin on MOU-164/MOU-165 is unchanged and correct: the **player's** progression level is
`Base.level` in `packages/shared/src/base.ts`, owned by **W6**, read by everyone. There is one base
per owner (`bases.ts` `findByOwnerId`), so base level _is_ player level. It drives the assignee pool
(§G8), the per-officer assignee cap (§G3) and recruit slots (§H8).

That pin also says "do not introduce a second progression counter". Read literally it forbids
something §H6 requires, so it is narrowed here:

- §H6/H6a gives **each held character** its own level, granting 5 attribute points per level (2
  player-assigned, 3 auto-allocated along affinities). That is **not** player progression and is
  **not** a second tally of it — it is a per-character counter, one per `Commander`.
- **W5 owns `Commander.level`** and the §H6 grant, matching the delivery map (H1–H8 → W5). W6 does
  not define it; W4 reads it.
- The "no second counter" rule still binds absolutely for _player_ progression: nothing anywhere may
  shadow, mirror, or recompute `Base.level`.
- Neither workstream may add a bare top-level `level` export to `@frontline/shared`. The package
  re-exports with `export *`, so prefix new symbols (`PLAYER_LEVEL_*`, `CHARACTER_LEVEL_*`).

### R2 — character XP has no source in the GDD

§I1 enumerates XP sources for the **player** only. §H6 says characters "evolve slowly" but never says
what drives it. Reading, pending a board correction (same status as §H6a):

> A character earns XP from the missions and internal processes **they are assigned to** (§E, §G6) —
> the only per-character activity the GDD defines.

W5 implements against this reading and keeps the source behind one function so a board correction is
a one-line change.

### R3 — resource keys vs. resource art

W2's §D9 migration replaces `credits/power/data/alloy` with `caps/food/oil/scrap/highQualityMetal`.
Two art surfaces are keyed off `keyof Resources` and break with it:

- `RESOURCE_ICON_SUBJECTS` in `packages/shared/src/art/prompts.ts` — typed
  `Record<keyof Resources, string>`, so a stale key set fails typecheck.
- `art/manifest.ts` derives asset keys `icon-<resourceKey>` and seeds from key order, so the rename
  changes generated asset identities.

Settled by MOU-181: `RESOURCE_ICON_SUBJECTS` is now `Readonly<Record<ResourceKey, string>>` with an
authored subject per live resource, and the manifest derives `icon-<kebab-cased key>` (so
`highQualityMetal` → `icon-high-quality-metal`) plus seeds `160001–160005` from `RESOURCE_KEYS`
order. No art existed under the old ids, so nothing was regenerated. W9 (art direction v2) may still
re-voice the five subjects; it owns any seed renumbering, coordinating with MOU-125
(`scripts/encode-art*`).

### R4 — the hidden role table stays hidden

`apps/server/src/roles/requirements.ts` (GDD §B8a) is server-side only. No star rating, no fit score,
no derived hint in any API response or client bundle. W1 lands the test that enforces it; **W5 and W7
must not defeat it** — hiring insight (§B9) surfaces discovered facts, never the raw profile.

W1's guard (`apps/server/src/roles/hidden-table.leak.test.ts`) scans `packages/shared/src`,
`apps/client/src` and `apps/client/e2e` only. A **server route** is outside that scan, so two rules
bind W5 and W7 directly:

- **Build recruits with `generateCharacter(seed)`, never `rollRecruit(seed)`.** Both live in
  `apps/server/src/characters/generate.ts`; `rollRecruit` returns `ShapedRoll`, which carries the
  `affinity` that shaped the roll — the purest fit hint there is. `generateCharacter` is the same
  roll with `affinity` dropped. `rollRecruit` is server-test-only and is already on the guard's
  forbidden-token list.
- **Extend the guard with a response-body assertion** when role data first goes on the wire, as the
  test's own header says. Serialise the actual recruit/insight response and assert no `affinity`,
  no weight ordering, no fit score. This is an acceptance criterion for W5 and W7, not a nicety —
  without it nothing mechanical stops a route from shipping the hint.

### R5 — one tally per meter

Reputation and infamy counters are defined once, in W2. W10 (The Government) **feeds** those counters;
it does not open a second anti-government tally. §D8a's `[TODO-LATER]` markers are W2's to place.

### R6 — migration numbers are allocated by the CTO, and `0003` is already doubled

W1 and W2 each wrote a migration numbered `0003` (`0003_attribute_model.sql`, `0003_economy.sql`).
The runner (`apps/server/src/db/index.ts`) keys `schema_migrations` on the **file name** and applies
in lexicographic order, so the duplicate prefix does not break it: both apply, `attribute_model`
first, `economy` second. That ordering is alphabetical accident, not intent.

- **Do not renumber either file.** The runner keys on the name, so a rename re-applies the migration
  against any database that already ran it — and `0003_attribute_model.sql` re-applied throws
  (`RENAME COLUMN skills_json` on a column that is already `attributes_json`), which fails boot.
- **The next migration is `0004`.** From here, a workstream asks on MOU-170 for its number before
  writing the file; the CTO allocates. Two agents picking the next integer from the same tree is how
  this happened.
- **No migration may depend on another `0003` running before it.** `0003_attribute_model.sql`
  `DELETE`s `bases`/`battles`/`overseers`; `0003_economy.sql` then backfills `bases` rows that no
  longer exist, so its `UPDATE` is a no-op in the combined run. That is harmless only because the
  seeder rebuilds. It means the **fresh-insert path**, not the backfill, is what actually has to
  produce a valid `economy_json` — the column's `DEFAULT '{}'` does not satisfy `EconomyStateSchema`.
  Verified at the W2 integration gate.

### R7 — missions award player XP: W6 owns the award, W3 owns the trigger

W3 (§E) and W6 (§I) are activated in parallel by MOU-204, and §I1 makes "missions" an XP source, so
the two meet at exactly one point: a mission completing.

- **W6 owns the whole XP side** — the tally, the curve, the level-up grant, and the single server
  function that awards XP and applies a level-up. W3 does not compute, store, or write XP, and does
  not decide how much a mission is worth.
- **W3 owns the trigger** — mission resolution, and the reward payout for resources.
- **Neither stubs the other.** W3 lands missions with no XP call at all; do not invent a hook, an
  injected callback, or a no-op default for a call site with one caller. W6 lands the XP engine, and
  **whoever lands second wires the one call** at W3's resolution site and cites R7 in the commit body.

### R8 — migration numbers for this wave

Allocated under R6 (the CTO allocates; do not pick your own):

- **W3 / MOU-162 → `0004_missions.sql`**
- **W6 / MOU-165 → `0005_progression.sql`**

Per R6 neither may depend on the other having run: `0004` must not read a column `0005` adds, and
`0005` must not read one `0004` adds. They apply in name order against a tree where both land
independently. Need a third file? Ask on MOU-170 — do not take `0006` yourself.

### R9 — W5 / MOU-164 → `0006_recruitment.sql`

Allocated under R6. `0004` and `0005` are both in (`7f8e525`, `c1b5068`), so `0006` is the next free
prefix and W5 is the only workstream holding it. One file; if the Bar needs a second, ask before
writing it.

- The daily roster is **derived, not stored** — it is a pure function of the UTC date (§H2), so it
  needs no table. Persist only what a player changes: held recruits, their alignment, their
  `Commander.level`, and the agreed wage.
- The wage belongs in W2's existing `PayrollState` (`packages/shared/src/economy/payroll.ts`,
  `bases.economy_json`) — W5 writes the numbers, W2's `runEconomyCycle` moves the money. Do not add
  a second wage column, and do not re-implement `proratedFirstWage`/`startOfPayWeek`.
- Per R6 `0006` must stand alone: it may read `bases` columns that existed at `0001_init.sql`, but
  nothing `0004` or `0005` added, and it must not renumber or edit an applied migration.

---

## 3. Shared-file discipline

`packages/shared/src/index.ts` and `base.ts` are edited by nearly every workstream, and all agents
share **one working tree**. Two live runs touching a barrel file clobber each other silently.

- Add your `export * from './yourfile.js'` line and nothing else. Do not reorder or reflow the barrel.
- Never stage a shared file you did not change in this issue. `git add <explicit paths>`, never `-A`.
- Re-check `git status` immediately before staging — the tree moves under you.
