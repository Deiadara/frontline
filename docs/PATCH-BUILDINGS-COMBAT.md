# Patch spec: buildings, garage, officers in battle

Board request, transcribed requirement by requirement. Every line here is a thing that must be
true when the patch lands. Where the board's wording left a number open, the number chosen is
marked **(chosen)** and is a decision to be reviewed, not a quote.

Current state was surveyed before writing this; "today" below means what the code does now.

---

## A. Removals

### A1. The power mechanic goes, completely

Today `BuildingSpec.basePowerDraw`, `building/power.ts`, `TerritoryEffects.powerSupply`, the
`power_supply` hold bonus and a `power` icon all exist and the Generator supplies a grid.

- Delete `building/power.ts` and every reference to power/energy: `basePowerDraw`, `powerSupply`,
  `power_supply` (a `HoldBonus` kind), `powerDraw`, the `power` effect channel if one exists.
- Locations that granted `power_supply` need their bonus replaced with something else of
  comparable worth, not simply dropped: a location that pays nothing is a dead location. Replace
  with `resource` (oil) at a comparable magnitude.
- Perks that granted `power_supply` likewise.
- The `power` icon may stay in the icon set (unused icons are not a bug) but must not be rendered
  for a power mechanic.
- No screen may mention power, energy or a grid.

### A2. The Cistern goes, completely

- Remove `cistern` from `BUILDING_KINDS` / `BUILDING_CATALOG`, from `production.ts`
  (`CISTERN_YIELD_PER_LEVEL`, `CISTERN_HOUSING_PER_LEVEL`), from `parts.ts`, from
  `modifications.ts`, from unit requirements, from the art prompts/manifest subject list if it is
  keyed by building kind, and from fixtures.
- **The district artwork stays exactly as it is.** Only the plot's _tag_ disappears: the plot is
  removed from the district's plot list so no label is drawn over that part of the painting.
- A save holding a `cistern` building row must still load. Migrate: drop the row, do not fail the
  parse. Whatever the Cistern was giving (housing, greenhouse yield) is absorbed by the buildings
  that now own those jobs (Quarters, Greenhouse).

---

## B. Buildings, one at a time

### B1. The Nexus: the permission tree

- Every other building's **first level** already requires a Nexus level. Keep that.
- **New:** every _upgrade_ also requires a minimum Nexus level, and the requirement is
  **per building and per level, asymmetric**. A Lab going to 5 may need Nexus 4 while a Gate going
  to 5 needs Nexus 2.
- Model it as a function of `(kind, targetLevel) -> minimum nexus level`, authored per building as
  a table, not derived by one formula for all of them. The table is the design surface.
- The Nexus itself has no Nexus requirement.
- A refused upgrade must say _which_ Nexus level is needed, on the building's own dialog, before
  the player spends anything.
- **Certain actions also gate on Nexus level.** Founding a faction requires both a player level
  (as today) and a Nexus level **(chosen: Nexus 3)**. The refusal names both.
- The Nexus **no longer** discounts build cost or build time. That moves to the Generator (B4).
  The Nexus keeps its permission role and whatever else it does today that is not the discount.

### B2. The Quarters: population

- Raises the district's population capacity. This is already `HOUSING_PER_QUARTERS_LEVEL`; keep it
  and make it the Quarters' whole stated role.
- Absorbs the Cistern's old housing contribution so the ceiling does not drop when the Cistern is
  removed.

### B3. The Apothecary: the stockpile ceiling

- Upgrading raises the cap on how much of each resource the district can hold. Already true
  (`storageCapacity`); keep and make it the stated role.

### B4. The Generator: build speed, and a paid boost

- Upgrading it costs **mainly oil**, plus planks and scrap. Rebalance `baseCost` accordingly.
- **Passive:** reduces the build/upgrade time of every other building, by level. This is the
  discount moved off the Nexus. Cost discount: the board only asked for _time_, so the Nexus's
  cost discount is **removed from the game** rather than moved.
- **Active:** a boost the player clicks. Pay **X oil (chosen: 250 x generator level)** and for
  **2 hours** every queued upgrade takes **Y% less time (chosen: 25%)**.
  - One boost at a time; buying it while one runs extends nothing and is refused with a clear line.
  - The boost applies to work already in the queue as well as work queued during it.
  - It is a timestamp on the district, settled lazily like everything else.
  - It survives a reload and shows a countdown on the Generator's dialog.

### B5. The Greenhouse: supplies

- **Passively generates supplies**, continuously, the way Grepolis generates per-minute resources.
  This is the existing `perHour` production path; the Greenhouse becomes the supplies producer.
- Upgrading generates more.
- Upgrading also **lowers the supplies cost of training units by a percentage**, by level
  **(chosen: 2% per level, capped at 30%)**. This is a _supplies-only_ discount and must not touch
  the other resources a unit costs.

### B6. The Gauntlet: training speed and unit unlocks

- Training time for **every** unit falls as the Gauntlet level rises, including units it cannot
  train **(chosen: 2% per level, capped at 40%)**.
- The Gauntlet **unlocks** exactly these units by level, and nothing else:
  `scavengers`, `haulers`, `razors`, `scrapers`, `ash_walkers`, `netrunners`, `stitchers`,
  `ghosts`, `road_reavers`, `breakers`, `wardens`, `sluggers`.
  - Author a level per unit, ascending roughly with tier. The exact ladder is a design call.
  - `road_reavers` additionally requires a **Garage level** and **motorcycles unlocked in the
    Garage** (see C). Both clauses, not either.
- Every other unit keeps or gains a different gate (a location, a blueprint, another building).
  No unit may become unreachable: if a unit's only gate was the Gauntlet and it is not on the list
  above, give it another one.

### B7. The Gate: defence and counter-intel

- Upgrading raises a **percentage of defence for all units defending your district**. Already
  partly true via `districtDefense`; make it explicit and level-scaled.
- Upgrading also makes the district **harder to scout**: it raises `intelResistancePercent`.
- The same rule applies to a Gate on **any** district a crew has closed off and upgraded, not only
  the home district.

### B8. The Lab: the door to research

- Research stops being a bottom-nav tab. Remove it from `BottomNav`.
- Clicking the Lab in the district opens its dialog, and the dialog carries a button that takes
  the player to the research page.
- `/game/research` keeps working as a route (deep links, the Lab's button, notifications).
- **Do not change how research itself works** in this patch.

### B9. The Scrapyard: its own page of add-ons

- Clicking the Scrapyard opens **its own page** (a route, not a modal), listing what can be built.
- What it builds are **add-ons/upgrades**: things attached to a building or to a unit that raise
  some part of it or give it a boost. Building modifications and unit upgrades both live here.
- Most entries **require a researched blueprint** first.
- **Cost is scrap only**, and **high-quality metal as well for advanced entries**. No other
  resource appears on this page.

### B10. The Infirmary: recovering the dead, and treating officers

- On a **won** battle or a won mission fight, a percentage of the units that died come back, by
  Infirmary level **(chosen: 4% per level, capped at 40%)**. Already partly exists as
  `casualtyRecoveryPercent`; make the Infirmary its source and make it apply on wins only.
- The Infirmary is also where an injured officer recovers (see D4).

### B11. The Garage: vehicles (see C)

- The Garage **grants nothing passively**. Its whole value is the vehicles built in it.
- Clicking it opens **its own page**.

---

## C. The Garage and vehicles

Today `building/vehicles.ts` has two vehicles (`motorcycle`, `rotorcraft`) that exist only as a
flat travel-speed percentage on the base. All of that is replaced.

### C1. The vehicle catalogue

- A separate **vehicles inventory**, held on the base, distinct from units.
- Classes, ascending: **motorbikes**, **car-like**, **truck-like**, and late-game **flying**
  (balloons, helicopters).
- Each vehicle has: id, name, class, a blueprint requirement, a build cost in **scrap, oil and
  high-quality metal** (different amounts each), a **speed contribution**, and a **population
  capacity**.
- Each has an **image**. The board supplies the artwork later: ship **placeholders** through the
  existing procedural/delivered art path, named so a delivered file overrides with no code change.

### C2. Building them

- Built in the Garage page, which works "a bit like the units tab": a list of what you can build,
  what it costs, what it gives, and what is locked and why.
- Each **needs a blueprint researched** before it can be built.
- Built vehicles sit in the Garage, available, until used.

### C3. Using them

- When sending units on a **mission** or to a **battle**, the player may choose to take vehicles.
- Vehicles make the force arrive **faster**. Each vehicle class gives a different amount:
  a two-hour march might be one hour on motorbikes, less on better vehicles.
- Each vehicle **carries up to a population capacity** of units. The force's speed is decided by
  what is actually carried, not by what is parked at home.
- **If every unit riding a vehicle dies, the vehicle is destroyed** and the destroyer earns
  **infamy equal to the vehicle's population capacity**.
- Vehicles that come home go back to the Garage.

---

## D. Officers in battle

None of this exists today. Officers are a crew sheet and perks; they have never been on a field.

### D1. One officer may lead

- A battle or a mission may be led by **at most one** officer. Leading is optional.
- Leading is worth two things: their own attributes fight, and their battle perks apply.

### D2. The attribute mapping

An officer becomes a combatant with these stats. Source attributes are the officer's own sheet.

| Battle stat        | Formula                                                                              | Range               |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------- |
| Damage (`offense`) | `ceil(Strength * 1.5 + Dexterity)`                                                   | uncapped            |
| Vitality           | `Toughness * 2 + Stamina * 0.5`                                                      | uncapped            |
| Speed              | `0.75 * Speed + 0.25 * Stamina`                                                      | clamped to [0, 100] |
| Armor              | `Toughness`                                                                          | clamped to [0, 30]  |
| Range              | `Dexterity * 0.75 + Improvisation * 0.25`                                            | clamped to [0, 20]  |
| Stealth            | `Stealth * 0.65 + Improvisation * 0.15 + Deception * 0.1 + Reflexes * 0.1`           | [0, 100]            |
| Morale             | `Resolve * 0.5 + Composure * 0.25 + Leadership * 0.25`                               | [0, 100]            |
| Penetration        | `Intuition * 0.15 + Strength * 0.5 + Logic * 0.15 + Strategy * 0.1 + Analysis * 0.1` | [0, 100]            |
| Evasion            | `Reflexes * 0.6 + Intuition * 0.1 + Composure * 0.3`                                 | [0, 100]            |
| Intimidation       | `Intimidation * 0.75 + Authority * 0.25`                                             | [0, 100]            |

- **Every capped stat must be able to reach 100.** Check each formula's maximum at
  `MAX_ATTRIBUTE = 100` and scale if it cannot: e.g. Penetration's weights sum to 1.0 so it
  reaches 100; Speed's sum to 1.0; Stealth's to 1.0; Morale's to 1.0; Evasion's to 1.0;
  Intimidation's to 1.0. Armor is deliberately capped at 30 and Range at 20: those two are the
  stated exceptions and are **not** scaled to 100.
- Rounding: integers, because `UnitStatsSchema` requires them.

### D3. Fighting

- With those stats the officer fights **as a normal unit** in the engine.
- Their battle perks apply to the whole side.
- **They are half as likely to be targeted** as a unit while any other friendly unit is alive.
- **They never die.** The worst outcome is injured.

### D4. Injury

- An officer who would have died comes home **injured**.
- An injured officer's **services and bonuses are inactive** for **24 hours**.
- **An officer returning injured means no battle report for that fight** ("the same as if he
  died"): the report is withheld, because the person who would have written it did not.
- Recovery is a timestamp; settled lazily like every other clock.
- Losing badly must make injury likelier than winning easily: injury chance falls with how
  decisively the side won.

### D5. Battle perks for officers

New perk keywords that only pay when the officer is **leading**, e.g.:

- extra evasion to all friendly units
- extra offense to all friendly units
- a percentage more loot from the fight
- extra armour, extra morale, faster arrival
  Add a handful; they fold through the existing `CrewEffects`/perk machinery.

### D6. Showing it

- An injured officer's portrait is **tinted red**, carries an **"Injured"** label across the
  middle, and shows a **timer** counting down to when they are available.
- Applies wherever an officer's portrait is drawn: crew page, crew window, training board.

---

## E. Building modifications, adjustable

- Every building shows **three clear slots**.
- A slot can be **filled** from what the player has researched/built, and **emptied**.
- Both actions happen **on the building itself**, from its dialog, not on a separate screen.
- A slot that cannot be filled yet says why (needs a level, needs research).

---

## F. Rules that apply to the whole patch

- Shared domain types and Zod schemas in `@frontline/shared` are the single source of truth.
- Real tests alongside the code, with a positive control for anything load-bearing.
- Gates before handing back: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
  the e2e suite for anything with a screen.
- No em dashes, en dashes, or double hyphens as punctuation, anywhere.
- Migrations are immutable history: add new ones, never edit an applied one.
- Zero visual bugs: no cut text, no overflow, no overlap. Verify with screenshots.
