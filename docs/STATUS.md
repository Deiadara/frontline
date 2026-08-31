# Frontline: Status

What is built, what is stubbed, and what is not started. `GDD.md` says what the game _should_ be;
this says where it actually is. Keep it current: a stale status doc is worse than none, because
the next person plans against it.

Last verified: **2026-08-27**, gates green (`format:check`, `lint`, `typecheck`,
2387 unit tests, 202 e2e).

---

## Legend

| Mark | Meaning                                                                      |
| ---- | ---------------------------------------------------------------------------- |
| ✅   | Built and covered by tests                                                   |
| 🟡   | Built, but deliberately thin: the shape is right, the depth is not           |
| 🔵   | Stubbed on purpose: a real seam exists, the model behind it is a placeholder |
| ⬜   | Not started                                                                  |

---

## Shipped

### The district (GDD §A1, §D3)

✅ Eleven structures: Nexus, Quarters, Greenhouse, Generator, Scrapyard, Apothecary,
Gate, Lab, Gauntlet, Infirmary, Garage. Max level 20. Every one owns exactly one
implemented mechanic (the `role` field on `BuildingSpec` is the contract that keeps it that way).

✅ Nexus gating: it caps every other structure at its own level, unlocks the rest as it grows
(ladder from level 1 to 12), and discounts everyone else's materials and clock.

✅ **Build queue**, six slots, worked sequentially. Materials taken at order time; price and
duration frozen onto the entry. Settled lazily on read: no scheduler.

✅ **Power grid.** The Generator burns oil for supply; every other structure draws. Power is never
banked and is not a resource. Surplus raises where morale settles; a shortfall browns the district
out: production scales down, nothing stops. Fuel burn scales with _load carried_, not nameplate.

✅ **Production**, accrued lazily and piecewise (the window is cut at each completed build, so a
structure that finished an hour ago is not paid for the three days nobody looked). Greenhouse →
supplies, Scrapyard → scrap/oil/HQ metal, Garage → oil/HQ metal. Caps are not farmed: they come off
missions and raids.

✅ **Storage** (Apothecary) clamps production only: raid loot and pay are never clawed back.
✅ **Housing** (Quarters) caps the army, enforced on both hiring and placement.

✅ **Modifications**: 65 of them, five per structure, slots opening at levels 5/10/20. Researched
rather than bought; needs a Lead Engineer. Fourteen effect kinds, every one wired to a real
mechanic.

✅ **Faction naming**, shown in the HUD and on the district page.

### Economy and standing

✅ Payroll (§H7) as a standing capacity. Nothing in the game is charged on a clock: no weekly draw of caps, supplies or anything else.
✅ Morale (§D4) as a **target the district drifts toward**: frequency-independent, so it cannot be
farmed by refreshing. The Quarters and power raise it; the Infirmary softens the hit from a missed
payday.
✅ Infamy (§D7) and the §D8 reputation tally, with exponential decay.

### Other people

✅ **Factions**: a team of up to 5 players, invitation-only, three ranks (leader / officer /
member). The roster shows every member's district, level, standing and army, read live off their
district rather than copied onto the membership row.
✅ **Fighting together**: a battle side is a list of contributors, not one crew. An ally's fights
appear on the faction screen and units can be sent to them through the same deployment path a crew
uses for its own battles, so travel, supply and losses follow the same rules. Survivors are split
back per contributor by largest remainder, so nobody loses a body to rounding.
✅ **Messages**: player-to-player and player-to-faction, fanned out per recipient at send time so
read state is per person. Inbox, sent folder with a read count, reply with quoting, delete.
✅ **Notifications**: 15 kinds in 4 groups, each carrying a link to what it is about. Unread badge
in the standing bar, read-on-open, mark-all-read, and a per-kind mute list applied at **write**
time. Battle reports and attacks on your district cannot be muted.
✅ **A neighbour who fights beside you**: `Sable_Ninth` holds Ashen Terraces, leads the seeded
faction and has a fight on the board. Not driven by anything: a fixture the faction screen is built
and tested against, seeded through the same base insert as the rival.

### Characters

✅ 34 attributes in four groups, 0..100 (§B1-B6). 108 perks (§B7): crew-wide bonuses, nought to
three an officer, summed across the roster. They replaced traits, which moved the carrier's own
attributes and so told a player nothing the sheet did not already say.
✅ 19 officer roles; the requirement table is server-side only, with a leak test over the real
response body (§B8a).
✅ The Bar (§H): shared daily roster, §H3 gates, §H7 wage negotiation. The haggle reads patience and
concession off the recruit's own Composure and Negotiation, both printed on the card.
❌ §H4 dispositions, §H5 alignment drift and §H6 character levels are **cut** (see GDD §H4-H6
superseded). An officer is their sheet, their perks and their wage; nothing about them changes
behind the player's back.
✅ **Shared shop** (§H2b): hiring removes that recruit for _every_ player and a replacement takes
the seat; one hire per player per UTC day. The seat's generation is in the recruit id, so a stale
tab cannot sign the replacement by accident.
✅ Assignees (§G): pool, placement, per-officer caps, the §G7 bonus table (24 rows), Professor
reskilling.

### The city (GDD §A4)

✅ **Ten districts**, hard-authored: three residential (crews live there) and seven contested.
Nicknames on some and not others. Relative geography: travel time scales with real distance and
is shortened by a Rail Yard, a Skate Ground or a district's unified bonus.

✅ **31 capturable places** across 20 kinds, each with an authored name, a hold bonus wired to a
real mechanic, and a fortify difficulty. Holding every place in a district pays a **unified bonus**
that is deliberately a different _kind_ of thing from anything inside it: enforced by a test.

✅ **Territory control** as world state: a place is held by exactly one party (unoccupied / the
Combine / looters / a crew) and every player sees the same answer. Garrisons live on the place, not
on the crew, because they are what changes hands when it does.

✅ **Fog of war.** A district's places are hidden until the crew has scouted it, and the fog is
enforced server-side on the way out: unscouted ground returns no places at all, and `held` is
`null` rather than `0 / 4`. A Satellite Uplink sees the nearest districts without walking in.

✅ **Fortification**, five levels with scaling cost and time, settled lazily. Easy/medium/hard
ground pays 5/4/3% defence per level: the board's inversion, so hard ground is already defensible
and what you can add to it is marginal.

✅ **Raiding a home district.** It can never be captured. A successful raid takes a share of the
stockpile bounded by what the force can physically carry in **kilograms**, and leaves the district's
structures running at reduced effectiveness for six hours.

### Battle units (GDD §A5)

✅ **27 units across five tiers** with the full sheet: speed, vitality, morale, armour, damage type,
resistances, lethality, range, offense, evasion, stealth, loot capacity, intimidation, and named
modifiers from a shared table of combat contexts.

✅ **Multi-clause unlocks.** Every unit's requirements are a list that must _all_ hold: a structure
at a level, a specific modification fitted, or a place of a given kind held. Most of the roster
needs two or more, and every legendary needs three: a roster reads as a campaign. Razors are the
one unit with no requirement at all, so a crew on day one has a move.

✅ **Training**: cost and time, a five-slot queue settled lazily, a standing-army cap set by the
Gauntlet, and legendary units capped at one.

### The battle engine (GDD §A5) (`packages/shared/src/battle/`)

The coin flip is gone. What replaced it is a **deterministic, seeded, round-by-round simulation**
resolved in one shot: a player commits a force, the server runs the fight, and the report is what
comes back. That split is the one most auto-resolvers land on: a formula can tell you that you
lost, a simulation can tell you _that your Snipers never got a shot off_.

Eight modules, each independently testable:

| Module           | What it decides                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| `battlefield.ts` | Which `CombatContext`s the ground has, and what digging in is worth.             |
| `effects.ts`     | The sheet → the numbers it fights with. Bonuses add, reductions multiply.        |
| `matchup.ts`     | Damage type vs resistance, armour, reach/closing, and threat-weighted targeting. |
| `morale.ts`      | The steady → shaken → wavering → broken ladder, intimidation and the cascade.    |
| `attrition.ts`   | The industry reference curve the engine is calibrated against.                   |
| `engine.ts`      | The round loop.                                                                  |
| `rout.ts`        | Who gets away, driven by the sheet rather than a flat coin flip.                 |
| `report.ts`      | What the player is told, and what is only implied.                               |
| `forecast.ts`    | The pre-battle read, by running the same engine sixty times.                     |
| `luck.ts`        | The day's luck, −5.0…+5.0 in tenths, drawn after both forces are committed.      |

**Where the mechanics came from.** Deliberately borrowed rather than invented, from systems that
have been balanced by other people's players for years:

- **Tribal Wars / Travian**: one-shot resolution and the `(loser/winner)^K` attrition curve, with
  Travian's size-scaled exponent. `attrition.ts` reproduces it and `engine.test.ts` calibrates
  against it.
- **Heroes of Might & Magic III**: bonuses add, reductions multiply. Getting that backwards is the
  most common way this class of engine produces an unkillable stack.
- **0 A.D.**: exponential armour (`0.9575^armour`), so armour never reaches zero damage and the
  tenth point is worth less than the first.
- **Battle for Wesnoth**: resistance as a signed percentage per damage type, with negatives as real
  vulnerabilities, kept separate from the dodge axis.
- **Age of Empires II**: semi-hidden armour classes and bonus damage, which is where
  threat-weighted targeting comes from.
- **Total War**: the morale ladder, rout cascade, and fear/terror as morale weapons.
- **Lanchester's laws**: ranged fire concentrates (square law), melee does not (linear). That is
  literally the `CONCENTRATION_EDGE` term, weighted by a side's ranged share.
- **Mount & Blade II autoresolve**: sublinear power ratios and morale scaling the damage.

**The interactions, and the test that pins each.** Every one is mutation-verified: the rule was
deleted and the test was confirmed to fail:

- Range beats slow, and is worth nothing against something that closes fast (`reach`).
- Fast units run down shooters: weighted by how much the target relied on range (`closing`).
- Intimidation works on low morale: the same shock hurts more the lower a stack already is.
- Special units are almost immune to some damage and vulnerable to others (85% ceiling, no immunity).
- Armour-piercing units walk toward the armour, with no rule anywhere saying they should.
- The ground fires a unit's sheet, and fortification decides who _holds_ a place.
- Narrow ground caps how many can fight at once, so numbers stop scaling.
- An **opening strike**: `ambush` used to be a second `urban_bonus` under a different name, and is
  now a partial free exchange scaled by the stealth gap: the only combat use `stealth` has.
- **The day's luck**, ±5% in tenths, drawn _after_ both forces are committed so it cannot be planned
  around. It adds its face value in points to critical-strike chance and to the flee roll, and
  touches nothing else: points rather than a multiplier, so it is worth half again to a Razor at 8%
  lethality and a sixteenth to a Specter at 80%.

**One deliberate departure.** The engine is strictly kinder to the winner than Tribal Wars is:
measured at 0.2-0.5× the reference curve, because this game routs and Tribal Wars annihilates. A
fight that ends when somebody runs is always cheaper than one that ends when somebody dies, and the
survivors go home. The shape is what matters and it is what the tests hold: winning a near-even
fight costs over 30% of the force, winning a 4:1 costs under 12%.

**The pre-battle read.** `ForcePicker` runs `forecast()`, the _same_ engine, sixty times, against
what the player knows, and reports it in bands rather than percentages. A simulator built as a
second model drifts from the real one the first time either is tuned, so `forecast.test.ts` pins one
forecast run against `simulate` on the same seed. It cannot see through fog: an enemy garrison's
composition is hidden, so the estimate stands an ordinary defender in for every body and says so.

**Dead wiring found and fixed.** Three effects were computed by `building/standing.ts` and read by
nothing at all: `districtDefense`, `raidLootBonus` and `characterXpBonus`. The first is the worst:
the Gate's entire job is raid protection, its own doc comment claimed the battle engine added it,
and the engine had never heard of it. Found by listing exported functions with no consumer outside
their own file, which is now the cheapest audit in this repo.

**More dead wiring, and the worst of it.** `outcome.winnerLosses` was computed by the engine and
read by nobody, so **winning a fight cost neither side anything**: a successful attack returned the
whole force including its dead, a garrison that turned an assault back lost nobody, and a raided
crew lost resources but not one body. The attrition six modules exist to calculate never reached an
army row.

**Every NPC place was undefended.** `startingControl` seeded `garrison: {}`, so the whole city map
could be taken by one Razor for free: found by trying to write a test that needed somebody to fight
and discovering there was never anybody there. Places are now garrisoned off the district's
difficulty and the place's `baseDefense` (Steelbelt holds 3-8, the Combine Spire 17), the Combine
fields regulars where looters field rabble, and a new crew is issued eight Razors rather than four
because four cannot take the easiest place in the game: measured, 0 wins in 40.

**Integration tests.** `battle/integration.test.ts` runs six real scenarios across five seeds each
and checks the conservation laws at every step: every body accounted for, nothing gains health or
bodies, a broken stack stops firing, the report describes the simulation that actually happened.
Those are the tests that catch a bug nobody thought to look for.

**Still open:** veterancy (units do not learn from a fight), and no reinforcement mid-battle.

### Progression, missions, research

✅ Player levels (§I1, §I2) with a single XP write path.
✅ Missions (§E): board, launch, lazy resolution, officer assignment, §F5 Overseer modifiers.
✅ Research (§B9, §F2-F5): investigations, Overseer training, modification work. Lab cuts duration.

### Client

✅ Auth, character select, the painted city and its district tags, district page, missions, Bar,
research, assignees.
✅ Layout gates at five viewports: no overlap, no clipped text, no cut sprites, no document
overflow. Positive controls for each gate.

### Art delivery (ADR 0001, `docs/ART-BIBLE.md`)

The pipeline runs end to end: a master named `art-src/<key>.png` is encoded to `assets/<key>.<ext>`
by `pnpm --filter @frontline/scripts encode-art --landed`, and the client picks it up from the
`assets/` glob with **no TypeScript edit**. Every view falls back to procedural art per key, so a
half-delivered set is a normal state rather than a broken one.

**Painting today: 44 of 125:**

| Class    | Painted                                 |
| -------- | --------------------------------------- |
| building | all twelve                              |
| icon     | the six resources: 6 of 55              |
| unit     | 25 of 32; the seven left are procedural |

The district itself is now a **town view rather than a grid** (`features/base/plots.ts`): no sky,
the whole scene is ground seen from above. Since the delivered `plate-district` paints its own
buildings, the eleven structures are no longer cutouts pasted onto it: each is a **polygon traced
around its silhouette on the painting**, and that outline is the control: hovering it washes light
over that building, clicking it opens its window, and the browser hit-tests the shape rather than a
box around it. `plots.test.ts` pins the tracing as plane geometry (inside the frame, convex,
disjoint, centroid inside its own outline); `hideout.spec.ts` asks the browser the same question with
`elementFromPoint` at every vertex, which also catches chrome lying over a building. The scene is
sized from a measurement of the room the HUD and the nav leave, because a `max-height` on a
percentage width silently stops being the plate's aspect and crops the painting. Until the plate
lands the scene draws a bare procedural stand-in.

The brand wordmark is delivered too, but is **not** a manifest asset: it has no domain id and no
backend can render 64:27 with alpha, so it ships as an ordinary import from
`apps/client/src/brand/`. See the comment on `Wordmark.tsx`.

`docs/ART-ORDER.md` (`pnpm art:order`) is the board's order sheet and lists the other 79.

---

## Stubbed on purpose

### 🔵 §I3 unlocks (`packages/shared/src/progression/unlocks.ts`)

`PLAYER_LEVEL_UNLOCKS` is empty. The extension point exists; the catalogue was never filed.

---

## Not started

| Area                        | Notes                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| ⬜ **Forces in transit**    | Travel time is computed and shown, but a sent force resolves instantly rather  |
|                             | than arriving later. Marked `TODO-LATER` on `city/actions.ts`. Doing it would  |
|                             | also make intercepting a force possible.                                       |
| ⬜ **PvP**                  | The rules are all in place: a crew's home is raidable and places change hands  |
|                             | between crews, but only the seeded bot is a second crew. This still blocks the |
|                             | `Hostile` reputation label.                                                    |
| ⬜ **Market / trade** (§D5) | Left-nav entry exists, disabled. `PLUNDER_PRIORITY` should read off it when it |
|                             | lands, instead of a hard-coded order.                                          |
| 🟡 **Real art**             | 18 of 97 delivered and painting; the rest still procedural. See below.         |

---

## Known `TODO-LATER` markers in code

There are five, and each names what would close it:

| Where                      | What                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `battle/skirmish.ts`       | The real combat model. Everything it needs is already on the input.  |
| `city/actions.ts`          | Forces in transit: a sent force should arrive after `travelMinutes`. |
| `economy/reputation.ts:48` | `Hostile` needs a PvP attack tally. One bot is not PvP.              |
| `progression/unlocks.ts:6` | The §I3 unlock catalogue.                                            |
| `missions.ts:296`          | Historical note only: the driver it describes is live.               |

---

## Gotchas worth knowing before you change something

- **Everything settles lazily on read.** There is no scheduler and no tick anywhere in the system.
  `settleBase` runs the district first and payroll second, and that order is load-bearing in both
  directions.
- **Rounding an accrual robs fast-polling clients.** The district settle skips windows shorter
  than `PRODUCTION_MIN_STEP_MS` _without advancing its clock_, so nothing is lost.
- **`cn()` is plain `clsx`.** It does not resolve Tailwind conflicts. A base class and a caller's
  class both land, and stylesheet order decides, which is silent.
- **The clipping harness stops at `position: fixed`.** A modal is laid out against the viewport,
  not against the scrolling page it sits inside. There are positive controls at every viewport.
- **Migrations are applied lexicographically and tracked by filename.** Never rename one. There is
  already a `0003` collision on disk from exactly that mistake.
- **Place control rows are created lazily on first read**, not seeded by a migration. The place
  catalogue is TypeScript and SQL cannot read it; a migration that enumerated the map would be a
  second copy of it, guaranteed to drift.
- **A unified bonus must differ in _kind_ from the places in its own district.** There is a test.
  Four of the seven originally did not, and "more of what it already pays" makes finishing a
  district indistinguishable from farming its best place.
- **The map's coverage gate has a brightness floor.** It once matched `rgb(10,2,12)`: a marker's
  glow faded to effectively black, and called it bare ground. It has a positive control now.
