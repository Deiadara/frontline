# Research, marks and blueprints: the work list

The board's brief of 2026-09-03, written out so it can be checked off. Every line is a thing that
was asked for. Nothing here is an inference about what was meant unless it is marked **[call]**,
which flags a decision taken in the absence of an instruction and the reason for it.

Status key: `[ ]` not started, `[~]` in progress, `[x]` done and gated.

---

## A. The Lab opens the wrong way

- [?] A1. Opening the Lab and clicking Research goes to the Research tab **and also** scrolls the
  page down through the other sections of the game. It should go to Research and nowhere else.

      **Not reproduced, needs the board.** Walked the exact path (district at level 19, click the
      Lab plot, press "Open research") and measured: the URL changes, the old screen is gone within
      one frame (district present at 0ms, Research rendered at 50ms), window scroll stays 0, and no
      scroller on either screen holds an offset. Research renders at the top of itself.
      A scroll-reset was written for the most likely cause (the sheet's own scroller keeping its
      offset across a route change) and **reverted**, because it could not be made to fail: React
      remounts the sheet, so the offset never carries. Section C rebuilds this page anyway, so the
      fix will land there once the symptom is pinned down. What would settle it: a screenshot, or
      the window size and whether the district was scrolled at the time.

      **Measured a second time after Section C rebuilt the page, and still not reproduced.** The
      variable missed the first time was viewport height, since "scrolls down through the other
      sections of the game" sounds like the shell scrolling rather than the sheet. Driven at
      1440x900, 1280x720, 1024x640 and 900x560, with `window.scrollTo(0, scrollHeight)` and every
      scrollable element set to its own bottom *before* the jump (2 elements were scrolled at the
      Base each time), the arrival at Research reports `window.scrollY` 0 and no element with a
      non-zero `scrollTop`, at all four sizes. The page is also no longer the page the report was
      written against.

      Left flagged rather than closed. Two independent measurements failing to reproduce is not
      proof there is nothing there, and the one thing that would settle it is still a screenshot or
      the window size it happened at.

---

## B. Officer marks

A role already produces a hidden fit score for an officer (`roleFit`). Turn that into something a
player reads.

- [x] B1. Compute the **realistic floor**: the fewest points any officer can actually produce in a
      role. Not a sheet of zeroes; the worst real officer-and-role combination.
- [x] B2. Compute the ceiling, with a small margin under it, so the top band is reachable.
- [x] B3. Split `[min, max]` into 21 equal bands, in this order:
      `F- F F+ E- E E+ D- D D+ C- C C+ B- B B+ A- A A+ S- S S+`.
- [x] B4. An officer assigned to a role gets a mark. The same officer in a different role can get a
      different mark, because the mark is about the fit and not about the person.
- [x] B5. The mark is shown **when you get someone and assign them to a role**. On the crew card,
      where an officer sits in a chair, and it follows them when they are moved to another one.

  **[call]** Deliberately _not_ on the Bar's pre-hire role picker. `BarPage` carries an explicit §B8
  note that nothing on a recruit's card may say what they would be good at, because the player is
  meant to read the sheet and decide. A mark beside that picker would turn hiring into shopping for
  a letter, which is the thing the rule exists to stop. If the board wants it there anyway it is a
  one line change and a rule to retire.

- [x] B6. The mark is **not** shown on the standing bar.
- [x] B7. The mark renders as a **hand drawn red stamp** over the officer portrait, and everywhere
      else a mark appears it is that same stamp.

---

## C. Research

### C1. Structure

- [x] C1a. Research is split into **tracks, one per officer role**.
- [x] C1b. A track can only be progressed while the crew has the **corresponding officer** for it.
- [x] C1c. **A Head of Research is required for everything**, on every track.
- [x] C1d. Both sheets matter: the Head of Research's skills affect the track, and so do the
      corresponding officer's.
- [x] C1e. Each track has **10 things to research**.

### C2. Gating

- [x] C2a. Each level of a track requires the corresponding officer to be at least a minimum mark.
- [x] C2b. The requirement is not harsh early and gets harder late.
- [x] C2c. The curve does not have to be linear.
- [x] C2d. The highest requirement any level may ask for is **S**, never S+.
- [x] C2e. The Head of Research has a minimum mark of their own, required at thresholds: **after the
      3rd, 5th and 7th** item of each track.

### C3. Numbers

- [x] C3a. The Head of Research's **points** cut the time every research takes, by a percentage
      derived from those points.
- [x] C3b. Marks are thresholds and player-facing communication only. **Every actual bonus reads the
      points**, so training one attribute moves the number even slightly.

### C4. What research gives

- [x] C4a. Each track's ten items pay out in a way that fits that officer's trade, drawn from:
      unlock something buildable, cut a time or a resource cost, passively gain a resource, boost
      something in battle, make the crew harder to spy on, cut travel time.
- [x] C4b. Each track is clearly indicated **with graphics**.
- [x] C4c. The page looks really good: custom hand drawn art, in the theme of the other pages.

---

## D. Blueprints: pages

- [x] D1. A blueprint is made of **pages**. Each page is a unique, named part of that blueprint.
- [x] D2. Blueprints have names (for example "Colossus Blueprint").
- [x] D3. A blueprint needs **up to 8 pages**: easy ones 2 or 3, harder ones up to 8, scaling.
- [x] D4. There is a **Blueprints page inside the Satchel page**, hand drawn like the rest, with
      clear sections.
- [x] D5. A blueprint you have **no** pages for does not appear at all. You do not know it exists.
- [x] D6. With at least one page it appears **locked and darkened**, with a row of squares: empty
      for pages you do not have, normal colour for the ones you do.
- [x] D7. A **lock** shows on the finished blueprint while it is incomplete.
- [x] D8. Every blueprint carries its own **graphic**, used consistently wherever it appears.
- [x] D9. With every page collected, a hand drawn **Unlock** button appears.
- [x] D10. Clicking Unlock: the whole blueprint bar goes to normal colour, you acquire the
      blueprint, the button becomes "unlocked" and stops being clickable, and the blueprint moves to
      the **unlocked blueprints** page.

### D11. Categories

- [x] D11a. **Unit blueprints** (vehicles count as units for this).
- [x] D11b. **Upgrade blueprints** (buildings or units).
- [x] D11c. **Consumable blueprints** (battle boosts, district consumables).
- [x] D11d. The Blueprints page separates blueprints by category.

### D12. What needs a blueprint

- [x] D12a. Units: Snipers, Demolishers, The Twins, Cyberhounds, Kite Crews, Juggernauts, Hollow
      Men, Ironsides.
- [x] D12b. Road Reavers require the **motorbike blueprint, the same one as the vehicle**.
- [x] D12c. Every vehicle has its own blueprint.
- [x] D12d. Uniques: The Abomination, The Colossus, The Specter, The Crimson Dancer, The Loose End.
- [x] D12e. Various battle boosts.
- [x] D12f. Almost all building upgrades.
- [x] D12g. Most unit upgrades.
- [x] D12h. Many of these are built in the Scrapyard and still require the blueprint. The gate
      Wired: `vehicleRefusal`, `upgradeRefusal`, `modificationBuildRefusal`, the server Scrapyard
      blockers, and a synthesised blueprint clause first in `unitUnlockClauses`. Each takes the
      answer as a predicate rather than an inventory, because `blueprints/` already sits above
      `building/` and `units/` in the import graph and reaching back would close the loop at load.
      helpers exist and are tested (`blueprintGateMet`, `modificationGateMet`,
      `describeBlueprintGate`); the Scrapyard, Garage and training call sites still read the old
      flat blueprint items. Section E wires them.
- [x] D12i. **Move the Hollow Men into the wonders of engineering.**

---

## E. The Scrapyard

- [x] E1. Its own screen that opens up, rather than what it is now.
- [x] E2. It has a menu.
- [x] E3. It lists everything you can build, based on the blueprints you hold and what you have
      researched.
- [x] E4. Same style and layout as the other pages.

---

## F. Where pages come from

### F1. Missions (the common way)

- [x] F1a. Pages turn up as random mission rewards.
- [x] F1b. Before the mission, the reward line says only the **category**: an Upgrade Blueprint's
      Page, a Consumable Blueprint's Page, or a Unit Blueprint's Page.
- [x] F1c. It does **not** say which page.
- [x] F1d. Duplicates are possible.
- [x] F1e. The page arrives **on completion**, into the inventory.
- [x] F1f. The **mission report** names exactly which page was won.
- [x] F1g. Rate: about **one page per 7 rotations**, a rotation being the full set of 3 missions
      shown.
- [x] F1h. Harder missions improve the chance, but only slightly. It never becomes easy to farm.

### F2. The Black Market

- [x] F2a. Pages can be bought there.
- [x] F2b. You can see exactly which page you are buying.
- [x] F2c. They cost **infamy**.

### F3. The Runner

- [x] F3a. The Runner sometimes carries pages.
- [x] F3b. Rarely, and they are expensive.
- [x] F3c. They cost **caps**.

---

## G. Duplicates and Reimagining

- [x] G1. **Reimagining** is a research item.
- [x] G2. With Reimagining researched **and** a Head of Research in post, the Blueprints page
      offers a trade: consume **3 pages**, receive **1 page you do not already own**, guaranteed.
      The rule is written and tested (`reimagine`, `reimaginingRefusal`, `unseenPages`): it spends
      the most duplicated pages first, so it never breaks into a set the player is one short of,
      and it refuses without taking anything when the crew cannot spare three or when there is
      nothing left in the game to want. **Waiting on the route and the button**, which need the
      research predicate section C is building.
- [x] G3. The new page may be from any category. The pool is every page nobody holds a copy of,
      drawn without regard to category.
- [x] G4. The section is on the Blueprints page even when it is not available, shown locked,
      stating the requirements. Built with section D; `BlueprintsPage.test.tsx` checks it names
      both a Head of Research and the Reimagining research with nothing held.

---

## Section E as built

The Scrapyard is a rail-plus-detail screen in the house frame: a menu (Everything, Refits, then one
door per structure with add-ons, each carrying a ready-of-total count), a pinned control strip, and
a scrolling workspace. What is buildable is decided **server side**: every row arrives with its
blocker already worded out of the documents held and the Lab projects finished, so the screen never
re-derives a rule.

**[call]** An advanced modification now has two gates rather than one: the retrofit document (§D12f)
and the Lab project for that bracket, which already existed. Split into `needs_blueprint` and
`needs_research` rather than silently retiring the older gate, document first because it opens all
five of a structure's brackets while a project opens one.

**[call]** The motorcycle lost its blueprint exemption. That exemption existed because Road Reavers
were gated on a flat item off a shelf that restocks twice a month; a document assembled from mission
pages is a different thing, so the reason is gone.

**D12e was defined and enforced nowhere.** `blueprintForBattleBoost` existed with no consumer, so
the four manufactured boosts were buyable without their drawings. `boostAvailable` now takes the
spec and a gate predicate and checks the document before the proposer, at both the battle view and
the buy route.

## Section F as built

Measured on the boards and shelves the game really produces, not asserted off the constants:

- **Missions**: one page per **7.39 rotations** (target 7), evenly spread across the three
  categories. The odds are rolled per _offer_ at a third of the rotation rate, so no card on a board
  is a tell about which of the three carries it. The base is divided by a measured
  `BOARD_DIFFICULTY_BLEND` of 1.25: applying the hard lift to the hard share of the board made a
  flat one-in-twenty-one come out at one page per 5.96 rotations, 17% more generous than the brief.
  **The 71% hard share first recorded here was wrong.** Re-measured over ten years of real dates it
  is 64.8%, and 64.4% against the synthetic stamps this note originally used, so the figure does not
  reproduce under either. The blend 64.8% implies is 1.227 against the shipped 1.25, which makes
  pages about 1.9% rarer than intended. The end-to-end rate is what actually matters and it was
  re-measured independently: 7.45 rotations per page over a year, 7.28 over three, 7.05 over ten,
  against a target of 7. The constant was left alone; only the note was wrong.
- **Black Market**: pages are **18.9%** of the shelf, about the same share as whole blueprints. Only
  `PAGES_ON_THE_SHELF` (4) of the 157 are in the deck on any day: all of them made nine tenths of
  every shelf a page.
- **The Runner**: a page on about **one barrow in six**, priced in caps. No special markup: a page's
  own `capsValue` already scales from 360 to 1440 by document length, against ordinary goods from
  120, so "expensive" is carried by the item and the one markup band still holds for every line.
  The page **replaces** a line rather than adding one, because a seventh line on exactly the days a
  page is present would tell a player what they had before they read it.

## Section D as built

39 blueprints and 157 pages: 21 unit, 14 upgrade, 4 consumable, page counts 2 to 8. Verified against
the shipped catalogue rather than the report.

Judgement calls made in D that the brief did not settle, all **[call]**:

- **Unlocking consumes the pages** and grants the document. D10 says you acquire the blueprint and
  not what becomes of the pages. Consuming makes the button a transaction and leaves duplicates
  worth something to Reimagining.
- **"Almost all building upgrades" (D12f)** reads as the _advanced_ half of each structure's
  modifications, a line the Scrapyard already draws, gated by one retrofit document per structure:
  32 of 55 modifications behind 11 documents rather than 32.
- **"Various battle boosts" (D12e)** reads as the four that are manufactured. The three that are
  open to anybody stay ungated.
- **Pages and documents are items**, so they persist in `inventory_json` and need no migration and
  no new column. `ITEM_IDS` stays the goods-only list the shops draw from, so the Runner did not
  silently become a page dispenser.
- **The old flat `blueprint_*` items are still there.** Research and the Black Market name them, so
  retiring them belongs with whoever does F2 and G.
- **Moving Hollow Men to `wonder` (D12i) opened a gate by accident**: the notoriety-to-field rule
  only covered `heavy`, so the requirement silently dropped from 2 to 0. Fixed by extending the
  exemption to `wonder`, so every unit answers exactly as it did before the move.

## H. Bugfix and consistency pass (queued 2026-09-03)

Everything above is built. This section is the sweep over it: the new features, the code they
replaced, and the seams where the two meet. It is not a re-review of the briefs, it is a hunt for
defects.

- [x] H1. **Research tracks against everything that used to read the old tree.** `findTech` is now
      an alias, and `battle/traps.ts`, `battle/boosts.ts` and `crew/standing.ts` still read it.
      Fifteen legacy ids were re-homed onto role tracks: check every one still resolves and still
      unlocks what it unlocked, and that a save written before this change still parses.
- [x] H2. **Officer marks against the §B8 hidden table.** The mark, the time cut and the cost cut
      are all monotone functions of `roleFit`. Measure what a determined reader can invert from the
      wire, at roster scale rather than per officer.
- [x] H3. **Blueprints, pages and the three shops.** Pages are items, so they flow through the
      satchel, the barrow, the Black Market, the Scrapyard, missions, trades between players and
      storage caps. Look for the ones nobody wired: a page that cannot be sold, a page that counts
      against a cap it should not, a duplicate that is not spendable.
- [x] H4. **The attribute rename.** Signals, Craft and Encyclopedia replaced Hacking, Fabrication
      and Demolition in two JSON columns. Check for anything still reading an old key, and that
      0075 is idempotent against a database that has already run it.
- [x] H5. **Every new route and payload.** `blueprints/unlock`, `blueprints/reimagine`, the research
      routes, `MarketResponse.reimagining`, `missions.pagePrize`/`pageWon`. Refusals, authorisation,
      what happens on a retry, and whether the client sends what the server requires.
- [x] H6. **Dead code and dead values.** This brief has already turned up three things computed and
      consumed by nobody. Sweep for the rest.

### H5 as done

Four checks, three findings.

1. **Every client call against every server route.** 83 client calls, 85 server routes, one
   unmatched and it was my own regex failing on `/base/:id`. The class of bug that hid the missing
   Unlock route is now clear.
2. **Every required request field against the whole client source**, as a permanent guard in
   `packages/shared/src/api.contract.test.ts`. This is the failure no other gate can see: unit tests
   call the reducer, typecheck builds its own literal, and the mocked e2e answers whatever is asked,
   so a required field the client never sends is green everywhere until it meets a real server. A
   narrower first version that looked only at the call site produced three false alarms, so it was
   widened to "named anywhere in the client", which has none and still catches the real thing.
   **Found:** `BattleRequestSchema` was exported and read by nobody on either side, a second and
   wrong way to declare a fight next to `DeclareBattleRequestSchema`. Removed.
3. **New payload fields are all actually rendered**: `pageWon`, `pagePrize`, `reimagining`, `mark`,
   `timeCutPercent`, `costCutPercent`. None is computed and dropped.
4. **Refusal paths. Found:** a server refusal on the Reimagining trade was silent. `unlock.error`
   had a banner and `trade.error` did not, so a crew whose Head of Research was unseated in another
   tab pressed the button and watched nothing happen. Fixed, and the message goes through the
   wording map so the player never reads `not_available`. The same defect exists on the **Unlock**
   button (`unlockRefusal` returns machine names and the banner prints them raw); handed to the
   agent that owns `blueprints/state.ts`.

Not a defect, checked and cleared: 21 exports in `api.ts` with no outside consumer are all component
schemas composed inside the file itself, matching its existing pattern. And `0003` appears twice in
the migration directory, which is harmless: the runner sorts and records by full filename.

### The bug pass, as run

Three lanes: two review agents on H1/H2/H4 and H3/H6, and me on H5 and the integration. Everything
below was watched failing with its fix reverted.

**Defects fixed**

1. **The research payload put the hidden role table on the wire exactly.** Prices and clocks were
   computed off the raw `roleFit` while the card printed it rounded, so ten integer prices per
   track, each rounding a different four-digit catalogue figure, pinned the score to a single value.
   Seating officers one at a time recovered a role's weight vector in **4 officers**; the whole
   19-role table fell out of about 80 seatings. Every published figure now goes through one
   `published()` helper first, so the wire says the printed number and nothing behind it. See H2
   below for what is left, which is a balance call and not an engineering one.
2. **Reimagining handed back pages of documents you had already assembled.** `unseenPages` measured
   "never seen" as `itemCount === 0`, and unlocking spends one of every page, so a finished document
   put its whole page set straight back in the pool. It also made `nothing_left_to_find` unreachable,
   since every unlock refilled the pool that refusal exists to empty.
3. **The Black Market refused purchases it would have allowed.** `takeRefusal` compared infamy
   against the undiscounted price while the shelf marked affordability and the door charged the
   discounted one, so a crew holding the Statue of the Revolutionist with infamy between 85% and
   100% of a price saw a lit button and was told the dealer had not heard enough of them. The
   discount rule now lives in `market/blackmarket.ts` beside the price it modifies, so the quote,
   the charge and the guard are one function.
4. **An untradeable item could change hands.** `offerRefusal` checked `give.items` for `tradeable`
   and not `want.items`, and `acceptOffer` moves the buyer's items with no check of its own. Not
   reachable from the composer, reachable from the API.
5. **The offer composer listed items the market would then refuse**, including unlocked blueprints:
   a guaranteed dead end for anyone who had assembled a document.
6. **A spare page of an assembled document was invisible.** Following fix 2 those copies are
   spendable, and the card suppressed the count badge for unlocked documents entirely.
7. **A server refusal on the Reimagining trade was silent**, and would have shown the player the raw
   string `not_available` if it had not been.
8. **`BattleRequestSchema`** was exported and read by nobody, a second and wrong way to declare a
   fight next to `DeclareBattleRequestSchema`.
9. **The mission page badge broke the mission card count** (see above), and six catalogue items
   promised unlocks that no longer existed.
10. Dead code removed: `holdsBlueprint` and `describeParts` (both exported, zero consumers,
    `describeParts` byte-identical to the private copy actually running), a `BlueprintCategory`
    redeclared by hand in `MissionBoard.tsx`, and `packages/shared/vitest.config.js`, a compiled twin
    of the `.ts` config shadowed by it.
11. Stale copy: five attribute references still naming Hacking or Fabrication, a notification that
    said "A modification is fitted" twenty lines below the code that deliberately does not fit it,
    and a Black Market doc block counting four kinds when there are five.

**Guards added, so these cannot come back quietly**

- Every required field of every request schema must be named somewhere in the client
  (`api.contract.test.ts`). This is the failure no other gate can see: unit tests call the reducer,
  typecheck builds its own literal, and the mocked e2e answers whatever is asked.
- Every percentage the research payload ships must be a whole multiple of `PUBLISHED_CUT_GRAIN`, so
  a new field that forgets to round fails without anybody remembering the file exists.
- An item whose copy claims it unlocks something must have a gate that reads its id.
- Each of the fifteen re-homed legacy tech ids must still pay into the channel it used to.
- The page badge's test id must stay out of the `offer-` namespace the card count reads.

**Findings left open, deliberately**

- **The trap feature is shipped and unreachable, and fixing it is a feature build.**
  `battle/view.ts` computes `traps` on every battle view, `BattlesResponse` ships it, `POST
/battles/trap` is live and guarded, and `useLayTrap` exists on the client. **No component calls
  the hook and no component reads `traps`.** It is the same class as the Unlock button posting to a
  route that did not exist, one step worse. It cannot be wired as-is either: the route needs a
  `locationId` and nothing in `BattlesResponse` carries the crew's held locations or which of them
  already have something buried under them. So closing it means extending the payload, projecting
  held locations server-side, and building a panel. That is a feature nobody has asked for in any
  brief, and it predates all of this work, so it is recorded here rather than invented.
- **The §B8 grain is a balance call.** The exact-inversion defect is fixed and the table now costs
  5.6 officers per role instead of 4. The marks alone cost 30.3, so the research payload is still
  the cheapest route in by about five times. Closing that gap means publishing coarser, and the
  table in `PUBLISHED_CUT_GRAIN`'s doc block prices it: a grain of 1 buys 23.7 officers per role but
  costs eight points of training before the card moves, which is what §C3b asks not to happen. One
  constant, one line, measured both ways. Not an engineering decision.

**Findings closed with a decision rather than a change**

- The Blueprints door counts **distinct** page ids under "Pages you are holding", not copies. Left
  as distinct: clicking through shows one row per distinct page, so the number should predict what
  the next screen looks like rather than how much is in the bag. The spare copies are counted on the
  Blueprints page itself, where they are the thing you can act on.
- `EMPTY_COPY.page` in `InventoryPage.tsx` can never render, because `SATCHEL_KINDS` filters `page`
  out. Left alone: the `Record<ItemKind, string>` type requires the key, so removing the string
  means loosening the type, which is worse.
- Five exports with no consumer anywhere, tests included, were removed: `findItem`, `itemsOfKind`,
  `emptyInventory`, `isBlueprintId`, `isBlueprintPageId`. Three more are test-only
  (`blueprintOfPage`, `blueprintsOfCategory`, `blueprintForBattleBoost`) and were kept, because a
  test is a consumer.

**Measurements that did not reproduce, and were corrected in this document**: the 71% hard share
(really 64.8%) and "invertible to a tenth" (really invertible exactly). Measurements that did
reproduce: the page drop rate (7.05 to 7.45 rotations per page against a target of 7), the Black
Market page share (19.05%), and the Runner's page odds (15.01%).

- [x] H7. **Visual.** Every screen this touched, at four sizes, looked at rather than asserted.

### H7 as done

Two things the layout guards could not see, both found by looking.

**The Reimagining panel contradicted itself.** After a successful trade it printed "The Lab
wants 3 pages you do not need. You are short." directly above "Slab Armour x3 went in. Charge
Moulds came out." Both lines were correct (the trade had just spent the spares), and together
they read as a failure. Reordered so the panel reads as a sequence: what happened, what is
left, then why the button is off.

**The page badge does not clip, and now there is a test that would notice if it did.** The
haul band is `h-28 overflow-hidden` with a fixed height on purpose, so the deploy buttons on
three cards land on one line, and the badge was added as a fourth line inside it without
anyone checking what happens when the rewards above already take two. `overflow-hidden` is
what makes this invisible to every other gate: nothing spills, the text is simply not drawn.
Measured on the worst card the game can deal (every resource in the haul plus a page): the
badge sits inside the band. `mission-page-badge.spec.ts` measures the badge's rectangle
against the box that clips it; shrinking the band to `h-20` fails it by 20px.

## I. Research page rebuilt, the desk and the files removed, traps as consumables (brief of 2026-09-03)

Status key as above. `[call]` marks a reading of the brief that was not spelled out.

### I1. The research page has two sections and a door

- [x] I1a. The research page holds exactly two sections: **Programmes** and **Blueprints**. Nothing
      else on the rail.
- [x] I1b. Research is a door on the bottom bar again, with its own icon, level-gated like the rest.
- [x] I1c. **Programmes** is the nineteen officer tracks as built under Section C, unchanged in rule.
- [x] I1d. **Blueprints** is the page built under Section D (every document with at least one page
      held, grouped by category, Unlock, the unlocked list, Reimagining), moved from the Satchel
      into the research page. Reachable at `/game/research/blueprints`; the old
      `/game/inventory/blueprints` redirects there. The Satchel's door to it points at the new home.
- [x] I1e. The desk is gone: no Investigate, no Develop, no Modify bench, no "The desk" door.
- [x] I1f. The files are gone: no facts, no pairings, no consultation panel, no "The files" door.
- [x] I1g. A programme in flight still shows at the top of the page with its clock.

### I2. The files system is removed everywhere, not hidden

- [x] I2a. `facts`, `DiscoveredFact`, pairings, `MAX_ROLE_FACTS`, `MAX_PAIRINGS`, `recordFacts`,
      `knowsFact`, `roleFactsIn`, `pairingsIn`, `consultOnAssignment` and the discovery module
      (`apps/server/src/research/discover.ts`) are deleted, with their tests.
- [x] I2b. The `investigation` research project kind is deleted. `HIRING_INSIGHT_ROLES`,
      `unlocksCrossReference`, `extraFactsFrom` and their two threshold constants go with it.
- [x] I2c. The `training` research project kind is deleted. The Overseer develops attributes on the
      Training tab already (`OVERSEER_SUBJECT`); the desk's Develop bench was a second door to the
      same thing.
- [x] I2d. The `modification` research project kind is deleted, with `modificationBlocker`,
      `modificationOptions`, `hasLeadEngineer`, `isModificationDrawn`, `ModificationOption` and
      `ModificationBlocker`. `addons.researched` stops being read. The Scrapyard gates an advanced
      modification on the structure's retrofit blueprint alone.
- [x] I2e. `ResearchProject` is the technology rung and nothing else. `ResearchState` carries
      `active` and `technologies`; `facts` is dropped from the schema.
- [x] I2f. **Migration.** `BaseSchema.parse` runs on every row read, so a stored `active` of a
      deleted kind would throw for that crew for ever. A migration nulls `research_json.active`
      where its kind is not `technology`, and strips `facts`. Idempotent, and tested against a row
      of each old kind.
- [x] I2g. `GET /research` carries `active`, `completesAt`, `technologies`, `tracks`, `head`,
      `caps`, `serverNow`, `levelUp`. `POST /research` (the desk) is deleted; `POST /research/tech`
      stays. The client's `startResearch` and `useStartResearch` go with the route.
- [x] I2h. Every comment, notification body and doc line that still describes investigations,
      facts, the desk or the files is corrected or deleted. `pnpm --filter @frontline/scripts test`
      stays green.

### I3. Modifications live at the building and the Workshop, not in research

- [x] I3a. A structure's own dialog is where a built modification is fitted into a bracket
      (already true under §E). It gains a door to make more: "Build more in the Scrapyard", opening
      the yard on that structure's bench.
- [x] I3b. `[call]` The Workshop page gains a **Modifications** view: every structure, what is built
      and waiting on the shelf, what is fitted where, and a door per structure to the Scrapyard bench
      that builds more. The brief says "a common Modifications page ... over at workshop"; the yard
      keeps building them (Section E, explicit), and the Workshop is the page that shows the whole
      picture and points at both the yard and the structure.
- [x] I3c. Unit refits stay as built: the Workshop builds them, the Units page bolts them on
      (`UpgradeSlots`). Verified, not changed.

### I4. Traps are a defensive consumable

- [x] I4a. A trap is an **item** of the new `consumable` kind, one per trap in `TRAP_CATALOG`,
      built in the Scrapyard on a **Traps** bench for scrap and metal. `ScrapyardEntry.kind` gains
      `trap`; building one adds it to the satchel, not to a shelf.
- [x] I4b. Each trap has a **blueprint document** (consumable category, 2 to 4 pages) and the
      existing Lab rung (`requiresTech`). `[call]` Both gate the build: the brief says "researched /
      be a blueprint first", and the Security Officer track's rungs already name these traps as what
      they unlock.
- [x] I4c. On a fight this crew is **defending**, beside the one boost, the crew can set **one
      trap**, chosen from the traps it holds. `trapId` lives on the deployment row beside
      `boostId`. Free to change up to the mark; nothing is spent by naming it.
- [x] I4d. At the mark the trap is spent out of the satchel, then springs exactly as the engine
      already runs it (`springTrap`): before contact, a bite off the attacking force, never a wall.
      A trap named on two fights lands on whichever resolves first and the second finds the bag
      empty, exactly as contraband does.
- [x] I4e. `POST /battles/trap` takes `{ battleId, trapId }` and refuses an attacker, a bystander, a
      trap the crew does not hold, and a fight already on the ground. One trap per side, enforced
      at the door as the officer is.
- [x] I4f. `BattlesResponse.traps` moves onto each fight's view as `traps` (held, available, why
      not) and `trapId`. `location_control.trap_json` is no longer read or written.
- [x] I4g. The battle report still names the trap and what it took.
- [x] I4h. The satchel shows consumables on their own panel with their own glyph.

### I1 to I3 as built

The research page is a rail of two doors, Programmes and Blueprints, with the section following
the URL (`/game/research`, `/game/research/blueprints`; `/game/inventory/blueprints` redirects).
`ResearchPage.tsx` went from 1271 lines to about 560. The Blueprints page moved file-for-file into
`features/research/BlueprintsSection.tsx` (a git rename, staged so the history follows it). Research
is a door on the bottom bar again, after Crew, level-gated as before.

Deleted outright: `research/facts.ts`, `research/discover.ts` and its leak test, the three desk
project kinds, `HIRING_INSIGHT_ROLES`, the cross-reference and extra-fact thresholds,
`ResearchState.facts`, `POST /research`, `startResearch`/`useStartResearch`, the desk's refusal
codes in `errors.ts`, and every comment that still described investigations or files. Migration
0077 nulls a stored `active` of a retired kind and strips `facts`, tested on six rows including a
technology rung that must survive byte-identical and a second application that must change nothing.

Modifications: a structure's dialog gained "Build more in the Scrapyard", which opens the yard on
that structure's bench (`?bench=<kind>`, landed by the other lane mid-task). The Workshop gained a
Modifications view: per structure, the three brackets, the shelf, the fitted count, and doors to the
yard bench and the district. It reads off `/me`; no new route or field was needed. Unit refits were
verified unchanged.

**Nothing was held back over the §B8 grain.** Re-checked after the brief's note: `roleFit` is not
imported anywhere in the client, and the wire carries the mark plus the two derived percentages,
never the score. That is exactly the rule as restated (grades on the front end, the number never),
so `PUBLISHED_CUT_GRAIN` stays at a tenth and the guard stays.

Left as found, on purpose, and worth a line each:

- `ResearchResponse.levelUp` is declared and never set, and was before this work. `settleResearch`
  awards XP that can cross a level. Wiring it is a behaviour change nobody asked for.
- The `desk` icon in `Icon.tsx` is now drawn by nothing. Removing it touches the art manifest.
- `modificationBuildRefusal` in `building/addons.ts` was the last reader of `addons.researched`,
  consumer-free after the yard stopped calling it. Removed by me after the lanes landed (below).

### I4 as built

Three consumable items (`trap_pressure_plates`, `trap_gas_shell`, `trap_collapse`), untradeable
and kept off every goods list, built on a **Traps** bench in the Scrapyard for the trap's own bill.
Three consumable documents (`bp_pressure_plates` 2 pages, `bp_buried_shell` 3, `bp_prepared_collapse`
4), so the catalogue is 42 documents and 166 pages. The build is gated on the document, then the
Lab rung, then the bill, and a test walks all four states so neither gate can pass on the other's
back.

`trapId` sits on the deployment row beside `boostId` (migration 0078). `POST /battles/trap` takes
`{ battleId, trapId | null }`; refusals in the fiction's order: no such trap, no such fight, not in
it, not the defender, already on the ground, not carrying one, one per side. Nothing leaves the bag
at the door. At the mark the defending side's row is read, the crew's satchel re-checked, one
removed, and the trap springs as the engine always ran it. `location_control.trap_json` is no
longer read or written; the column stays.

Calls made where the brief was silent: **an ally may set the trap** if nobody on the side has (the
same fold `combinedSide` applies to a boost), out of that ally's own bag; **clearing is free**
(`trapId: null`), like un-sending a leader; caps values 900 / 2,400 / 6,000, above each trap's caps
line; `advanced` on a trap row means it costs high-quality metal; traps are the one exception to the
yard's scrap-and-metal price rule, and the invariant test is scoped to the two bolted benches with a
separate test pinning trap prices to the catalogue.

Page rate re-measured after the three documents landed: 7.45 / 7.28 / 7.05 rotations per page over
1 / 3 / 10 years, identical to Section F's figures, because `pagePrizeFor` rolls per offer and never
reads the page count. Black Market page share 19.7% over two years of real dates; the Runner carries
a page on one barrow in 7.30. Eighteen mutants watched failing, listed in the lane's report.

One thing worth knowing for anyone screenshotting the battle page: the detail beside the rail is its
own scroller, so a `fullPage` shot is the viewport again and a panel below the fold is simply absent.
Scroll to the panel and shoot it as an element.

### I5. The record

- [x] I5a. `requirements.txt` (the previous brief) re-verified against the moved Blueprints page
      and the Programmes section after the move: every item of Sections C, D and G still holds.
      I5a verified by reading what the moved tests assert rather than by trusting the tick marks
      above them. `BlueprintsSection.test.tsx` still pins every Section D behaviour: a crew with
      no pages sees nothing, one page reveals exactly its document, squares per page, locked and
      darkened short of a page, Unlock only when every page is in, the unlocked view, categories,
      Reimagining locked with both requirements, spares counted. `ResearchTracks.test.tsx` and
      `tracks.test.ts` still pin Section C: nineteen tracks of ten, the ladder F- to S with nothing
      asking for S+, the first three rungs open to a fresh recruit, the Head binding at 4, 6 and 8,
      both cuts reading points and moving on a fraction of one. 32 + 74 tests, all green after the
      move.

- [x] I5b. Full gates and a clean full e2e run, with screenshots of the research page (both
      sections, four sizes), the Workshop's modifications view, a structure dialog, the Scrapyard's
      Traps bench, the battle page as a defender with a trap set, and the satchel.

### I5 as done

Clean full e2e after both lanes and my own follow-ups: **403 passed, exit 0** (7.4 minutes), on a tree where format, lint, typecheck and the four unit suites (2239 / 479 / 773 / 221) were all green first.

I5b, the looking half, done by me on the lanes' screenshots rather than by trusting their descriptions. At 1280x800: the research rail is two doors with Research lit on the bottom bar; Programmes shows the trades rail, the B+ stamp on the Head Spy and the rung ladder with Done states; Blueprints shows Collecting/Unlocked, three category panels, page squares, locks and Unlock buttons; the Workshop's Modifications view shows one card per structure with three brackets, the shelf and both doors. At 1280x720: the Scrapyard's Traps bench with BUILT x2 and a live Build under a blueprint line; the defender's Trap panel with the set trap and its clear control above the picker. No cut text, no overlap, no blank panel at these sizes. The other sizes were looked at by the lanes.

## N. The Console: fog of war in admin mode, and the rename (brief of 2026-09-04)

- [x] N1. **Every district scouted in admin mode**, by default and before anybody is sent
      anywhere. Computed, not written: the city repo gained `visibleDistricts`, an admin-aware read
      beside the raw `scouted`, with the admin flag injected where repositories are built; the
      city view reads it, and the board and the battles follow from the city view.
- [x] N2. **Tick and un-tick on the Console.** A Fog of war panel lists every district with a
      checkbox; un-ticking stores that one district in a small exception table (migration 0079),
      never touching scouting intel, so admin mode off shows exactly what the crew has seen. Home
      is ticked and fixed. Scout everything / Hide everything for the lot.
- [x] N3. **Bench is Console**: the page title, the nav door and its test id, the spec, the
      harness, the docs and every comment.
      N1 to N3 as built. `createRepositories(db, { admin })` hands the flag to the city repo, whose
      `visibleDistricts` is every district minus the Console's exceptions in admin mode and the raw
      `scouted` otherwise; `cityContextFor` reads it, and the board, the battles and the declare
      route all read `cityContextFor`, so one seam. `POST /admin/fog { districtId, visible }`
      stores or clears the exception; the snapshot lists every district with `visible` and `home`.
      Six route tests against both builds, four mutants watched failing (admin flag ignored; hidden
      set not subtracted; home hidable; the knob writing scouting intel instead of the exception).
      One of those controls did not fail at first: hiding home is invisible on the map because home
      is always shown, so the test now observes the exception table, which is the only thing the
      guard actually controls. The panel's labels truncated with an ellipsis at 1280 and the sweep
      caught it; they wrap now, three columns only at 2xl. Bench is Console in the title, the door,
      its test id, the spec, the harness, the docs and every comment.

- [x] N4. Full gates and a clean full e2e, run alone. The first run after Section N was 413 of
      414 with one timeout (`government.spec.ts`, the mission board's card tags at 1024, waiting on
      an offer under a 9.8 minute run); it passed alone in 1.4s, and the clean run after Sections O
      and P below (414 passed, exit 0, 7.8 minutes, on a tree where format, lint, typecheck and the
      four unit suites, 2251 / 523 / 779 / 221, were green first) covers Section N as well.

## O. Chrome Row, second pass: four signs moved and the Statue of the Revolutionary (brief of 2026-09-04)

- [x] O1. **Cathode Tower** a little to the right (0.37 to 0.405), off the Exchange.
- [x] O2. **The Exchange** on the bank hall itself, between the two central columns just under
      their capitals (0.24, 0.5 to 0.222, 0.25).
- [x] O3. **The Long Pawn is gone, and the statue is a location.** A new kind,
      `revolutionary_statue` ("Statue in a Plaza"), appended to `LOCATION_KINDS` so no icon seed
      before it moves: +10 unit morale on the existing `unit_morale` channel, base defence 4, open
      and elevated, three upgrade lines. Catalogue, battlefield contexts (`open_ground`, `urban`),
      icon prompt (`icon-location-revolutionary-statue`, seed 160074) and its row in the prompts
      doc, the manifest pinned at 238 assets, the order sheet regenerated. Chrome Row's row is
      `statue`, "Statue of the Revolutionary", easy, in the place The Long Pawn had; the sign sits
      on the plinth's face (0.435, 0.565), which is blank stone. The board's own `docs/DISTRICTS.md`
      row, which sketched exactly this on 2026-09-03, is back to what the board wrote. The location
      id changed under it (`chrome-row-longpawn` to `chrome-row-statue`), so any `location_control`
      row written against the old id in a development database is orphaned; nothing reads it.
- [x] O4. **The district gate** slightly down (0.69 to 0.705), a few pixels clear of the gate's
      top rail at both 1024 and 1440.
- [x] O5. **The Overlook** just right of the lookout tower (0.82 to 0.91), clear of the scaffold
      and touching nothing. Looked at in screenshots at 1024x768 and 1440x900: no sign touches a
      building or another sign at either.

## P. The faction's back room painted (brief of 2026-09-04)

- [x] P1. **The plate.** `images/faction-room-37800x1800.jpeg` (a 3780x1800 delivery; the name
      has an extra zero), renamed to its manifest key as a PNG with pixels unchanged, registered as
      `plate-faction-room` with its own 21:10 delivery spec, its prompt block, its rows in the
      prompts doc and the four key lists that pin plate keys, encoded by key (897 KB), the order
      sheet regenerated, the bible row written. `encode-art` resolves keys from the built shared
      package, so `pnpm --filter @frontline/shared build` comes before encoding a new key.
- [x] P2. **The room on it.** `Room` draws `plate-faction-room` whole, at the aspect read off the
      manifest. The five places were re-read off the painting: a row at chest height (y 0.55) from
      the near shoulder of the man with his back to us to the old man at the far right (x 0.30,
      0.44, 0.585, 0.745, 0.895), below every painted chin, the fourth nudged right so an empty
      chair clears the painted woman's hair. The seat row's height is pinned by the table panel at
      1024x768, where the band is 470px and the panel's top edge is at 0.645 of the picture.
- [x] P3. **The chrome readjusted.** The crest and its fight chips hang over the right half of the
      frame instead of the middle, because the middle of this painting is the man standing at the
      far side of the table and a centred crest put its chips across his face at 1024; over the
      right they cover the hall behind the table. The column and the table panel stay where they
      were. `seats.test.ts` follows the plate (narrowest picture 987x470); `SEAT_WIDTHS` re-measured
      for a plate fitted by height (1065px at 1280x720, 1367px at 1536x864). The room e2e passes at
      all four sizes, and screenshots at 1024x768 and 1440x900 were looked at: no figure over a
      painted face, no panel over a figure, the banner and the pinboard clear.
- [x] P4. Full gates and a clean full e2e, run alone: 414 passed, exit 0 (7.8 minutes), the same
      run that closes N4 and Section O.

## Q. A general bug pass (brief of 2026-09-04)

Two reviewers swept the server with shared, and the client with its mocked contract, for defects
only; every finding was re-read at the cited line before anything was changed, and every fix below
was watched failing with the fix reverted (one line-anchored mutant per site, sixteen caught).

- [x] Q1. **Garrisons could never come home.** The garrison route takes signed deltas and the
      withdrawal branch was live, but the only picker counted from zero over the home roster.
      `ForcePicker` now takes who is standing there and a row goes down to minus that many; a number
      below zero brings them back. `ForcePicker.test.tsx`.
- [x] Q2. **Countdowns on the browser's clock.** The district's "Work under way" and "Digging in"
      lines, the research bar and the Settings clock preview all read `Date.now()` on pages whose
      response carries `serverNow`; a fast machine showed "0s left" and "Landing…" while the server
      said otherwise, and the Settings preview never ticked at all. All three read `useServerClock`
      now, the district's card through a `now` prop. Tests on the research bar and the preview.
- [x] Q3. **Level-ups dropped on the floor.** A signing's level-up was never read; a refused build's
      level-up rides on the 409 (MOU-280) and the district read only the success; and `/me`, the one
      poll that settles a build finished while the player was elsewhere, discarded its awards.
      The Bar and the district latch both; `/me` returns `levelUp` and `ShellLevelUp` draws it over
      whatever screen is open, held until dismissed. `me.test.ts`, `ShellLevelUp.test.tsx`, the
      refusal case in `District.test.tsx`.
- [x] Q4. **Small client faults.** The declare dialog seeded its mark once and could post one the
      board had dropped (derived now, `DeclareDialog.test.tsx`); the Console's level and infamy
      fields kept the numbers they mounted with (they follow the snapshot); the scout's "Go there"
      pointed at `/game/city`, which is no route (the district itself, pinned in
      `scouting.test.ts`); an unreachable battle-result modal and its state left in the district
      view since the instant-attack routes went were removed.
- [x] Q5. **The Console on in production.** `adminDefault` is on outside tests and
      `assertDeployable` never looked at it, so a deploy that forgot `ADMIN=false` served every
      registered player the knobs. Refused at boot now, like a development secret.
- [x] Q6. **A fight that minted resources.** `defenderOf` answers the district's holder for a
      building, so a crew could declare against a structure on its own plot; the settle looted the
      resident (itself) and paid the haul back off a stockpile read before the loot: measured at
      +150 caps from nothing. Declaring against your own structure is `own_ground` now, and the
      haul is banked off a fresh read of the row. `own-building.test.ts`.
- [x] Q7. **Holding your ground paid as a won raid.** The defender's books went through
      `infamyForRaidWon`, seat-of-power premium included: 140 for a bloodless hold on the Spire,
      farmable between two accounts. The defender is paid for the kills only.
      `defence-infamy.test.ts`.
- [x] Q8. **Anybody on a side could buy the side's one boost**, and the one applied was whichever
      row sorted first, so an ally's purchase either displaced the principal's or burned unread.
      The boost route refuses everybody but the principal; an NPC defence, which has none, keeps
      letting its one crew buy. Pinned in `reinforce.test.ts`.
- [x] Q9. **The mission board after a recall** was rebuilt without the crew's standing effects and
      without settling first, so every card repainted at bare timings until the next poll. It is
      priced the way the read prices it now. The two HTTP settles are transactions, the way the
      world clock's is, so a write failing halfway no longer leaves a crew marked home with its
      haul gone.
- [x] Q10. **The signing quoted a payroll step the crew would not pay**: `ledgerFor` in `hire.ts`
      never took the step discount the read and the payroll route apply. It does, on hire and on
      release. Pinned over HTTP in `bar.test.ts`.
- [x] Q11. **Migration 0075 missed the training book.** `bases.training_json` names an attribute in
      every session and in `last`, both validated against the live enum, so a crew that had
      drilled Signals under its old name failed the schema on every read and every route answered
      500 for it. Migration 0080 sweeps the renames; `rowToBase` drops what was retired, the floor
      every other salvaged column has. `salvage.test.ts`. The live development database had no
      such row.

### Found and left open, because they are decisions rather than fixes

- **The raid on a home is unreachable in normal play.** Every residential district is authored
  with no locations, `districtHolder` is null for one, so its gate is never `shut` and a `gate`
  target is refused with "no gate" while a `building` target is refused with "the gate is
  standing". `breakin.test.ts` reaches the loot phase only by breaking the gate through the
  repository. Reproduced against a real app. Fixing it means deciding what a home district's gate
  _is_ (the resident's own Gate structure rather than a location sweep), which is design.
- **A break-in is settled against `residentOf`, not against the battle's defender.** For a
  non-location target the defender row names nobody, so the crew being robbed is a bystander to
  its own fight (no muster, no traps, "You are not in that fight"), while the settle conscripts
  its army and loots its stockpile and sends it no report. Latent behind the point above; the fix
  belongs with it.
- **Vehicles cut a mission's pay and XP below the card's quote**: the launch folds
  `carriedSpeedPercent` into the frozen clock and the settle prices rewards off that clock, about
  12% less for using the Garage. The module's own note says pay is untouched by vehicles. Wants a
  separate priced clock on the mission row.
- **Level-ups the world clock settles are unannounced.** The clock brings crews home every second
  and discards `levelUp`, so a mission's level-up never reaches `GET /missions`; `/me` now covers
  builds, but a mission's needs a durable "unannounced" marker written by the clock.
- **Two old migrations.** `0029` drops `scheduled_battles` with foreign keys enforced, so a
  database that stopped before it and holds a deployment row cannot boot (reproduced; every
  database past 0029 and every backup since is unaffected). `0045`'s NULL-primary-key claim is
  false and its `PRAGMA foreign_keys = OFF` is a no-op inside the migration transaction, though
  no double-write is reachable today. Applied migrations are immutable here, so both are recorded
  rather than edited.

- [x] Q12. Full gates and a clean full e2e, run alone. Unit suites 2251 / 534 / 787 / 221.

## R. The faction screen redone for the painted room (brief of 2026-09-04)

The brief: redo the screen from scratch to match the back-room painting, cover none of the
people in it, keep the information the table needs, and drop the chat (the faction's messages
are the mailbox's).

- [x] R1. **The plates hang on the painted people.** The five people round the table are the
      five seats. Each name plate (`w-[9rem]`, sigil, name, rank) is bottom-anchored below the
      face it belongs to, on the table or a lap, never across a face: the leader on the map under
      the standing man's hands, then clockwise from the nearest chair. An empty seat is a marked
      plate ("Empty seat, ask somebody in", a control for a chief or the leader). `seats.ts`
      pins the places; `seats.test.ts` checks the clearance and that no two plates overlap at
      the narrowest picture (987x470).
- [x] R2. **The chrome is in three corners.** The crest (badge, name, rank, since, motto) is
      pinned top left over the pinboard, 18rem wide so it stops short of the banner. The four
      readings (seats, bodies, earned, fights) are tiles in a row top right over the hall, with
      the way in ("Looking for members", the invite door) under them and the fight chips under
      that, growing downward over the hall and never over the standing man. Four doors (Members,
      The ledger, The book, What we field) run along the near edge of the table at the foot.
- [x] R3. **The chat is gone.** `TablePanel`, `Column`, `Tabs`, `talk.ts` and its test are
      removed. The ledger is a window behind its door; the description is read and edited in the
      book; the members list is a window behind its door and still opens a person's file. Nothing
      from the mailbox is drawn on the room, and the e2e says so.
- [x] R4. Looked at in screenshots at 1024x768, 1280x720, 1440x900 and 1920x1080: no plate over
      a face, no panel over a plate, no name cut. The room e2e (`social.spec.ts`) was rewritten
      for the new screen: the geometry sweep now checks the seats against the crest, the
      readings, the chips and the doors at all four sizes, and that no name plate truncates its
      name.
- [x] R5. Full gates and a clean full e2e, run alone.
- [x] R6. **Second pass on the board's look.** Bodies is the population the table's battle units
      take up (`supplyUsed`, summed), and the hover says so. The four doors stand at the crest's
      shoulder, top left. The empty seats are one row along the foot of the room, split evenly
      across its width with a margin at each end (`emptyRow`), a little above where the lowest
      plate was; the people's plates stay on the painted people. Plates are a quarter bigger
      (11.25rem, 36px sigil). `seats.test.ts` checks every spare count for overlaps; the room e2e
      pins the bodies figure.
- [x] R7. **The leader in the row, in the middle.** All five seats are now one row along the
      foot, split evenly across the width: the leader in the middle slot, the table filling
      outward from the leader in rank order, the spare chairs at the ends. Plates are 10.75rem
      below `xl` and 11.25rem from it, which is what keeps five of them clear of each other on the
      987px picture at 1024 with the names uncut. Looked at again at 1024 and 1440.
- [x] R8. **Cards, the log, the whole table's units, no rank sermons.** The row sits a little
      lower (its foot at 0.93). Each seat carries its card instead of the drawn sigil, dealt by
      slot: the joker at the far left, the king of diamonds, the ace of spades in the leader's
      middle seat, the queen of hearts, the jack of clubs at the far right (`CardGlyph`, drawn,
      named for a screen reader). The ledger door is "The log". "What we field" lists the
      reader's own crew too, marked "you": the projection had left the reader out, pinned in
      `project.test.ts` with its control. A member's file no longer preaches what a rank is for.
      The e2e fixture's leader now carries the `me` user's id, which it never had, so "you" and
      the self highlight are real in the browser suite.
- [x] R9. **The cards restyled and the plates a tenth taller.** Faces are solid black (spades,
      clubs, the joker) or solid red (hearts, diamonds) with the marks knocked out, parchment on
      both and brass for the joker's star. Plates are 58px with the card at 44px, the row's foot
      moved down so the top edge stayed where it was.
- [x] R10. **The card mechanic.** Each seat's card is responsible for one aspect of the faction
      and reads three of its holder's attributes (the Overseer's own sheet): the ace of spades
      (Attacks) reads Strength, Strategy and Authority and pays `unitOffensePercent`; the king of
      diamonds (Defences) reads Toughness, Organization and Resolve for `defensePercent`; the
      queen of hearts (Planning) reads Logic, Analysis and Logistics for `missionSpeedPercent`;
      the jack of clubs (Infamy) reads Intimidation, Charisma and Deception for
      `infamyGainPercent`; the joker (Luck) reads Improvisation, Intuition and Stealth for
      `casualtyRecoveryPercent`. The mean of the three is marked on the officer ladder
      (`markFromPoints`) and the mark pays half a point a band, rounded, to every member of the
      table on that channel (F+ is 1%, B is 7%, S+ is 10%), folded in `standingEffectsFor` so every
      consumer of a crew's standing sees it. The deal and the order are shared
      (`factions/cards.ts`: `seatOrder`, `SEAT_SLOT_ORDER`, `CARD_BY_SLOT`, `dealCards`), the
      server deals once per table (`factions/cards.ts` on the server) for both the screen and the
      fold, and every member row carries `card` and `cardMark`. The Members window shows each
      row's card, aspect, what it reads and the mark stamped the way an officer's is; a member's
      file has a "Their card" section with the effect line; the seat plate's hover says the
      aspect, the mark and the pay. Tests: the shared deal and marks (`cards.test.ts`), the server
      screen-and-fold agreement with its control (`factions/cards.test.ts`), and the room e2e.
      **Numbers are a first cut for the board to tune**: which attributes each card reads and the
      half-point-a-band payout are in one table in `packages/shared/src/factions/cards.ts`.

## S. The road, live (brief of 2026-09-04)

- [x] S1. **Everything away, on one page.** The Actions screen listed only columns walking to a
      fight, so a crew whose army was out on missions read "nobody is out". It now gathers four
      kinds of away from the reads the game already makes (`features/actions/road.ts`): columns
      on the road (`/actions`), forces standing at a fight they have reached or fighting it (the
      caller's own muster on `/battles`, "Fighting now" once the mark has passed), crews out on a
      job with the leg they are on (`/missions`, active runs: on the road out, on the job, heading
      home, turned around), and the scout on the road, which `/actions` now carries
      (`scoutingRun`, the same view the district page draws). Every countdown ticks on the road's
      own server clock, and the header adds the bodies up. `road.test.ts` pins the filters and the
      count; `scouting.test.ts` pins the scout on the wire; the road e2e in `bench.spec.ts` walks
      all four.
- [x] S2. Full gates and a clean full e2e, run alone: 414 passed, exit 0, on a tree where
      format, lint, typecheck and the unit suites (2259 / 533 / 789 / 221) were green first. The
      same run closes R9 and R10.

## T. Research rewards re-dealt (brief of 2026-09-04)

The brief: the tracks paid a flat percentage per rung; find rewards a crew is planned around, some
of them doors (a second crew out), some of them a favour to a kind of unit or to the other
officers, and keep percentages where a percentage is the honest shape.

- [x] T1. **A rung pays any bonus the game has.** `ResearchPayout.bonus` is a `ResearchBonus`:
      every `PerkBonus` (the crew fold's channels, a tier or one unit's own stat, flat points on
      every officer in a group or on one attribute, a resource an hour, a resource that goes
      further, vision, syringes, training sessions, one structure cheaper, the Gate and the whole
      district, allied offence, infamy, experience) plus three grants no perk makes:
      `mission_slots` (another crew out on a job at once), `recruit_slots` (another chair at the
      Bar) and `declarations` (another fight called at once). The `magnitude` curve is gone: each
      rung's number is authored. `researchEffects` returns a whole `CrewEffects` and is folded by
      `mergeCrewEffects` (new, walks the whole crew struct) in both standing folds, so every
      consumer of a crew's standing sees a tier's armour or a chair the same way it sees a
      percentage. Families widened from six to eight (`people`, `command`).
- [x] T2. **The three doors reach their doors.** The mission board's limit and the launch gate
      read `concurrentMissionSlots(level) + missionSlotsFlat`; the Bar's chairs and the hire
      refusal read `recruitSlots + recruitSlotsFlat`; the declaration cap reads
      `MAX_PENDING_DECLARATIONS + declarationsFlat`. One test per door over HTTP with a mutation
      control each, and the dead-channel guard folds research so the three are not "channels
      nothing pays into".
- [x] T3. **All 190 rungs re-dealt** in `packages/shared/src/research/tracks.ts`, names, blurbs
      and unlocks kept (every id a save can hold still resolves; what a rung is worth changed on
      purpose). Every track mixes at least four kinds; the deep rungs hold the doors: the
      Cartographer's tenth is a second crew out, the Right Hand's ninth and the Consigliere's tenth
      a chair each, the Field Commander's and the Raid Boss's tenth a fight each, the Head of
      Growth's tenth a chair. Tier and unit boosts (Ghosts, Juggernauts, Ironsides, Haulers,
      Snipers, Breakers; rabble, specialist, heavy, wonder), officer lifts (a group or one
      attribute for every officer), caps and scrap and high quality metal an hour, syringes,
      sessions and vision sit in the middle; the honest percentages stay where they were honest.
      `tracks.test.ts` pins the mix, the doors' depth, the fold and the words; the shared, server
      and client suites are green (2261 / 792 / 533).
- [x] T4. Full gates and a clean full e2e, run alone.

## U. Ctrl+C and the server that would not stop (2026-09-04)

- [x] U1. **Why.** The board pressed Ctrl+C and the server kept running. Reproduced: it is the
      e2e's web server. Playwright spawned it as a shell over pnpm over tsx over node, and on an
      interrupted run Playwright kills the process it spawned and nothing below it, so the node at
      the bottom was reparented to launchd and kept port 4010 (measured: four survivors, the
      listener among them). A plain `pnpm dev` was never the problem: Ctrl+C there ends the whole
      process group in about a tenth of a second, before and after this change.
- [x] U2. **Fix.** `playwright.config.ts` starts the server as `exec node --import tsx
src/index.ts` from `apps/server`, so the process Playwright kills is the server itself;
      interrupting a run now leaves nothing behind (re-measured: no survivors, port free). The
      server also handles SIGINT and SIGTERM now (`index.ts`): stops the world clock and the
      backups, drops keep-alive sockets, closes Fastify, closes the database, and exits within two
      seconds whatever a plugin does. Under `tsx watch` the parent force-kills the child before that
      finishes, which is tsx's own behaviour and harmless.

## V. Battle engine pass, and what to expect from a fight (2026-09-07)

The brief: a quick bug pass on the engine, check it is wired, and run it enough times to say what
the expected outcome of a matchup is.

- [x] V1. **Wiring, read end to end.** `resolveOne` hands the engine both sides' standing effects
      (boosts and the allied and whole-district conditions folded, the leader's perks applied), both
      sides' fitted upgrades and cohesion, the Gate on the defender's side, the trap's survivors as
      the attacking force, both rings, and the officer leading each side; the ground is built once
      and stamped on the report. Nothing the engine reads is left unset. The wrapper's ledger adds
      up over 500 fights: everybody who set out is home, fled or dead.
- [x] V2. **Two counting faults, fixed with tests and controls** (`engine.ts`, `engine.test.ts`).
      The cowed (§D3) stood in the line and took fire but their count never moved, so as a stack
      thinned the silenced number ate the shooters: ten bodies with six cowed lost five and had
      nobody left firing. They now fall with the rest of the line, through damage and through the
      run-down both. And the "outnumbered" reading counted porters, so forty Scavengers behind
      twenty Razors handed every Warden, Juggernaut, Anodic and Condemned sent against them a last
      stand (+25%) it had not earned; the line is counted off the units that form one.
- [x] V3. **Run to convergence.** `pnpm --filter @frontline/scripts battle-sim [runs]` fights a
      fixed matrix `runs` times (3000 by default) and prints the attacker's win rate with a 95%
      interval, the mean length, what each side walks away with, and how often the round cap called
      it. At 3000 runs on open ground, attacker first:

| Matchup                               | Attacker wins | Rounds | Survive A / D |
| ------------------------------------- | ------------- | ------ | ------------- |
| Razors 20 vs 20 Razors                | 46%           | 7      | 35% / 35%     |
| Razors 18 vs 20                       | 0.4%          | 5      | 33% / 56%     |
| Razors 22 vs 20                       | 98%           | 6      | 54% / 31%     |
| Razors 30 vs 20                       | 100%          | 3      | 80% / 37%     |
| Razors 30 vs 20, press dug in to 3    | 100%          | 5      | 67% / 46%     |
| Snipers 20 vs 20 Razors               | 100%          | 2      | 82% / 14%     |
| Razors 20 vs 20 Snipers               | 0%            | 2      | 14% / 82%     |
| Ghosts 20 vs 20 Ghosts                | 49%           | 10     | 20% / 20%     |
| Breakers 20 vs 20 Breakers            | 39%           | 6      | 47% / 49%     |
| Breakers 20 vs 20 Ironsides           | 0%            | 9      | 66% / 93%     |
| Wardens 20 vs 20 Wardens              | 0%            | 10     | 43% / 68%     |
| Juggernauts 20 vs 20 Juggernauts      | 0.2%          | 6      | 70% / 86%     |
| Juggernauts 5 vs 30 Razors            | 100%          | 2      | 100% / 73%    |
| Ironsides 10 vs 30 Razors             | 0.4%          | 8      | 70% / 93%     |
| Ironsides 20 vs 20 Ironsides          | 0% (cap)      | 12     | 100% / 100%   |
| 10 Razors 6 Snipers 4 Ironsides vs 20 | 100%          | 3      | 98% / 32%     |
| 20 Razors 6 Stitchers vs 24 Razors    | 100%          | 5      | 80% / 41%     |
| 60 vs 30 Razors, frontage 12          | 100%          | 4      | 90% / 64%     |
| ...the same with 50% cohesion         | 100%          | 3      | 93% / 61%     |
| 20 Razors vs 40 Scavengers            | 100%          | 0      | 100% / 100%   |

What the table says, for planning: **numbers decide almost everything.** Ten percent more of
the same unit takes a mirror from a coin flip to a near certainty in both directions (18 vs
20 is 0.4%, 22 vs 20 is 98%), and luck only speaks at parity. **Holding the ground is worth a
lot to the heavy tiers**: Razors mirror at 46% but a Warden, Slugger or Juggernaut line on
its own ground beats the same line attacking every time, and two Ironside walls cannot hurt
each other at all (twelve rounds, nobody scratched, called on power to the holder). **A
counter is absolute** at equal numbers: Snipers delete Razors in two rounds and Razors cannot
touch Snipers. Fortification caps at level 3 (10% on medium ground) by design. A field
hospital pays: six Stitchers turn 20 Razors into a force that beats 24. The sixty-run
forecast a player sees agrees with the long run to within its own granularity. Every row
here is reproducible from the script, and a retune should be run through it before it ships.

- [x] V4. Full gates and a clean full e2e, run alone.

## M. Chrome Row painted (brief of 2026-09-04)

- [x] M1. **The plate.** `images/chrome-row-final-3780x1800.jpeg`, a 3780x1800 delivery, renamed to
      its manifest key as a PNG (pixels unchanged), registered as `plate-district-chrome-row` with
      its own 21:10 delivery spec, its prompt block, its rows in the prompts doc and the four key
      lists that pin plate keys, encoded by key (982 KB), the order sheet regenerated, the bible row
      written. The manifest's asset count pin moved from 235 to 236.
- [x] M2. **The signs.** Chrome Row has eight locations, not seven, so the marks test now reads the
      count off the catalogue instead of a typed 8, which would have passed with one sign missing.
      No labelled copy was delivered; the eight signs and the gate were placed by eye against a
      twentieth grid of the plate, at the foot of each feature on open stone or on a roof where the
      ground in front is people: the market's stalls, the mast's foot, the theatre forecourt, the
      hospital's lower wall, the lookout platform, the pawn shop's front, the arcade row's roof, the
      tavern's roof, and the stone above the gate beam. Looked at at 1024x768 and 1440x900: all
      nine on screen, none over anything that matters, none overlapping; the tavern's name wraps to
      two lines at 1024 and stays inside the frame.
      Two e2e specs went red the moment Chrome Row was painted, and both were the specs, not the
      screen. `battles.spec.ts` used Chrome Row as "the shut district" and asserted the card
      layout's `call-gate` button; on a painted contested district the gate is a sign on the
      painting and clicking it is what calls the fight (the `call-gate` button in the painted
      header is the residential raid, gated on `raidable`, which is a flag about somebody's home).
      `live.spec.ts` asserted the card column after scouting whichever district the seeded account
      is granted, which is Chrome Row. Both now walk the painted path: the gate sign opens the
      caller, a location sign opens the window that holds the same card, and in the fixture that
      ground is the viewer's own, so the window says Yours and offers no fight. The live spec keeps
      working for an unpainted district too, since which one is granted depends on where the
      account was planted.

- [x] M3. Full gates and a clean full e2e, run alone. Format, lint, typecheck and the four unit suites (2243 / 523 / 773 / 221) green; **414 e2e passed, exit 0** in 7.7 minutes.

## L. The faction page, closer to Hero Zero's team screen (brief of 2026-09-04)

The board attached Hero Zero's team screen as the example: a room with the members standing in it,
the crest and name over the room with three timers under them, an Information/Members column on
the left, and a Chat/Notes/Description panel under the room with a feed and a line to write to the
team. Frontline's own data fills the slots; nothing of Hero Zero's is copied.

- [x] L1. **The room.** The Bar painting as the faction's back room, drawn `whole` the way the Bar
      draws it, with each member standing in it as their drawn sigil at a seat, name under them,
      rank stamped, and empty seats drawn as ghosted places. Clicking a figure opens their file.
- [x] L2. **Over the room.** The crest and the name centred over the painting; under them, the
      coming fights as timed chips (Hero Zero's three timers), each opening "Send help".
- [x] L3. **The left column, two tabs.** _Information_: the four readings as icon rows, the seats
      line, "Looking for members" when seats are open and this rank can invite (it opens the
      invite), since, and the doors (the book, what we field). _Members_: the roster as rows.
- [x] L4. **Under the room, three tabs.** _Talk_: the faction-audience messages the inbox already
      carries, newest last, with a "To the table" line that sends one through the messages API.
      _Ledger_: a feed derived from the payload (joined, asked to join, fights called, help sent),
      newest first. _Description_: the blurb, editable by the ranks that may.
- [x] L5. Every existing function survives (found, identity, badge, description, members, invites,
      answer, leave, disband, reinforce, armies). `Reinforce.test.tsx` and both faction e2e specs
      stay green. Zero visual bugs at four sizes, looked at.
      L1 to L5 as built. The Bar painting is the back room, drawn whole as the Bar draws it,
      with five seats at x 0.275 / 0.386 / 0.497 / 0.608 / 0.719 and y 0.49: the painting's own
      stools, evened out so two name plates cannot collide at 1024, and one y that lands in the
      clear band between the fixed crest and table panels at every size. A member is their sigil on
      a dark pool with the rank struck across its foot and a glass name plate under it; an empty
      seat is a ghosted chair labelled Empty that opens the invite for a rank that can. The crest
      and name sit centred over the room with the fights as timed chips under them (three, then
      "+N more"), each opening the send-help window. The left column has Information (the four
      readings as icon rows, "Looking for members" as a door when seats are open and the rank can
      invite, the founding date, the book and what-we-field doors) and Members (compact rows in seat
      order, so the third row is the third figure). Under the room, Talk (the faction-audience
      messages from inbox and sent, oldest first, with a "To the table" line through the messages
      API), Ledger (a pure derived feed: founding, joins, invitations pending, fights called, help
      sent), and Description (editable by the ranks that may). Nothing collapses at 1024; the column,
      figures and panel scale down and the tabs drop their glyphs. Eight mutants watched failing
      and six defects found by looking and fixed, listed in the lane's report. The figures sit over
      the painted drinkers' backs; with the pool and the plate that reads as a figure in shadow, and
      it is the one composition call worth the board's eye.

- [x] L6. Full gates and a clean full e2e. Format, lint, typecheck and the four unit suites (2239 / 519 / 773 / 221) green; **414 e2e passed, exit 0** in 7.8 minutes, run alone.

### A note on measuring the full e2e

Running the four unit suites beside the full Playwright run made the real-backend spec
(`live.spec.ts`) time out on a screenshot at 120 seconds, in a run that took 12 minutes instead of
the usual seven and a half. The spec passed alone in 46 seconds. The full e2e is a load-sensitive
measurement and is run on its own from here on; a number taken beside other work is not one.

### L as built

Two follow-ups by me after the lane landed: the e2e harness now answers `POST /messages` in the mutation shape (every send had been failing its schema); and the two dial helpers the redesign orphaned (`arcPath`, `valueFontSize`) were removed with their tests. Left alone on purpose: the fixture's session user is still `operator` while the same person's faction row is `Nikos`, because `backroom.spec.ts` pins the settings username; a cosmetic mismatch in screenshots only.

## K. Signs without lines, the deploy dialog, and the faction page (brief of 2026-09-03)

- [x] K1. **Contested signs.** On the Steelbelt and the Neon Docks the location tags lose their
      leader lines. Each tag sits where the location is, the way the home district's plot labels
      do, and covers nothing that matters. Looked at on both screens at four sizes.
      K1 as built: `Mark` is now a sign's centre line and top edge, with an optional `side` for
      the two signs that would run off the right edge; `plate` and the leader-line layer are gone
      from `marks.ts` and `ContestedScene`. Each of the sixteen signs was placed on open ground
      just under its feature, read off the paintings at 1440 wide and checked at 1024. One moved
      after looking: the plate room crops the bottom tenth of the painting at 1024x768, so the
      Furnace Row Pumps sign at 0.94 was not on screen there at all; it stands on the road at the
      row's left end now, and the marks test refuses anything below nine tenths. The tests assert
      the new rule (no offsets, inside the frame allowing for width, no two signs overlapping) and
      three mutants were watched failing. Three signs moved again at the board's request after looking: Toolhouse Pawn up and left onto the open ground inside the palisade, clear of the gate sign; the Slag Bowl onto the floor of the bowl itself, on the band between the people standing in it (read off a gridded crop of the plate rather than guessed); Dockside Pumphouse up to the foot of its building.

- [x] K2. **Half and Max.** In the battle deploy dialog every unit's stepper gains a Half and a Max
      button (half of what is at home, all of it).
- [x] K3. **The unit card on hover.** Hovering a unit's name in that dialog shows the full unit
      card from the Units page: icon, stats, abilities, everything. The card is exported once and
      used in both places, never redrawn.
- [x] K4. **Line only.** The dialog opened by "Move people" is the line and nothing else: the Ring
      column is gone and so is the "Line" heading, because the button said where they are going.
- [x] K5. **Station units in the periphery.** A second button beside "Move people", with a hover
      explaining what the ring is, opening the same kind of dialog for the ring alone.
      K2 to K5 as built: `UnitCard` and its helpers moved verbatim into
      `features/units/UnitCard.tsx` and both screens render it; the dialog fetches the roster
      itself, so nothing on the server changed. Half is `max(1, floor(home/2))`, Max is everything
      at home, both through the stepper's own clamp. The dialog is one component in two modes:
      "Move people" opens the line with no heading and no ring; "Station units in the periphery"
      opens the ring with a hover that explains the cordon and the withdrawal cost. `HoverCard`
      gained a `card` size (42rem) so the twelve-stat sheet is not crushed beside the portrait, and
      `Button`'s classes were extracted so the hover trigger wears the ghost skin without nesting a
      second button. Six mutants watched failing. One defect found by looking: the confirm button's
      fade-in was caught mid-transition in a screenshot and is now pinned at full opacity first.

- [x] K6. **The faction page redesigned.** Graphic, intricate, grouped, and calm: what a player
      sees on arrival is a picture rather than a wall of text, with detail behind panels and
      hovers. Every existing function survives (found, identity, badge, members, invites, leave,
      disband, reinforce, the fights, the book). Zero visual bugs at four sizes, looked at.
      K6 as built. The page is a crest band and two panels: the badge drawn large as a seal with
      the name, the motto and three chips (rank, seats, since), four readings as drawn dials
      (seats, bodies, earned, fights), and two doors. Under it, the table: one card per seat with
      a drawn sigil, a red rank stamp, and two figures, empty seats drawn as chairs with a line on
      who can fill them; beside it, the fights as a strip with "Send help" unfolding inside the
      card. Everything that is a form went behind a door: a member's file (readings, what they
      field, the actions a higher rank can take), "What we field" (every ally's roster), and the
      book (name and badge builder, description, what each rank carries, the way out). Founding a
      faction kept its two-panel screen. A plain member sees no invite control and the seats say a
      chief or the leader fills them. The lane that built it (eleven modules, nineteen tests, both
      of its e2e specs) was cut off three times by a server-side 529 after the page was
      substantially done; I took it over for the last step: the two panels hugged their content
      at `xl` instead of stretching to the frame, because a 1080p browser showed two framed boxes
      three quarters empty. Looked at in every state at 1024x768, 1280x720, 1440x900 and 1920x1080,
      with the book, the armies window, help unfolded, a founder alone and a plain member's view.

- [x] K7. Full gates and a clean full e2e. Format, lint, typecheck and the four unit suites (2239 / 504 / 773 / 221) green; **404 e2e passed, exit 0**. The one format warning on the tree is `docs/DISTRICTS.md`, an untracked file the board is writing, left alone on purpose.

## J. The Steelbelt redelivered, and crews in flight as a stack (2026-09-03)

- [x] J1. **The Steelbelt plate.** The board delivered `images/steelbelt-portrait-3780x1800.jpeg`,
      a genuine 3780x1800 export of the same painting the 1584x672 file was cut from, and a
      labelled copy. Renamed to its manifest key as a PNG (`encode-art` takes PNG and WebP masters
      only; pixels unchanged), the delivery spec moved to 3780x1800 at 21:10 in the manifest and in
      the manifest test that has to agree with it, encoded by key (`--landed` aborts on an unrelated old overseer master, so the plate was encoded on its own), the order
      sheet regenerated, the bible row rewritten. Shipped plate: 3780x1800, 797 KB, against the
      Docks' 962 KB.
- [x] J2. **The seven marks.** Re-read off the labelled copy the same way the Docks' were: the two
      masters differ only where the board drew, so differencing them isolates each label with its
      leader line, and the anchor is the far end of the line, or the dot for the two labels without
      one. Every anchor landed within half a percent of the old value, which says the board
      re-exported the same composition rather than repainting it; four moved by a few pixels, three
      did not move at all. Looked at on the district screen at 1440x900: the plate fills the frame
      with no letterbox, and all seven signs and the gate sit on the things they name.
- [x] J3. **Crews in flight.** The shell's horizontal strip of chips wrapped under the board's tab
      row with two or three crews out. The missions page now has a column of its own on the left
      (from `xl`): the crews in flight as a stack, soonest home first (the server hands them back in
      launch order, so a day-long expedition sat on top for a day while short runs landed under
      it), in a scroller of its own so a long stack never pushes the board; recently returned under
      it; the board on the right. Below `xl` the board keeps its width (three cards need about 300px each for a six-resource haul) and the stack follows it in the flow. Two frames, then: above `xl` the sheet fills the window and each column scrolls inside itself, with the crews in flight taking at most half the column so one crew out is never clipped by the list under it; below `xl` the sheet scrolls as a whole at natural height, because a fixed frame shared three ways at 768px tall left the board a strip too short to show its own cards. Both found by looking at the screenshots after the layout guards had passed. One more the guards did catch: with the board a fifth narrower at `xl`, a six-resource haul wraps a row deeper and the page badge under it went 8px past the card's fixed haul band, which `mission-page-badge.spec.ts` reported on the full run. The band is 8rem from `xl` and stays 7rem below it, because at 1024x768 the extra rem pushed a card's own bottom tags under the fold of the screen and `government.spec.ts` said so on the next full run; shrinking the band to 5rem fails the badge test by 40px. The strip stays on
      Actions, where it is the only clock display, and leaves the missions page rather than showing
      the same crews a second time. Two mutants watched failing: the sort removed, the scroller
      removed.

## Section C as built

Nineteen tracks, one per `OFFICER_ROLE`, ten rungs each (190 items) in
`packages/shared/src/research/tracks.ts`. It replaced the old five-theme tree rather than sitting
beside it, and `research/tech.ts` is now a one-line alias so `battle/traps.ts`, `battle/boosts.ts`
and `crew/standing.ts` did not have to move.

A rung is a project on the Lab's one bench, not an outright purchase. C3a asks the Head of
Research's points to cut the time, and a programme that lands the moment it is paid for has no time
to cut.

The mark ladder over the rungs runs `F- F F+ E- E+ D C B A S`, gaps of 1,1,1,2,2,3,3,3,3: convex,
and topping out at `S` exactly. The measured recruitment median is 20.77, which is `F+`, so the
first three rungs of every track are open to a crew that has just hired somebody and rung 4 is the
first refusal. The Head of Research's own thresholds start at rungs 4, 6 and 8, always one band
above the track requirement at the rung where each starts, so neither sheet is decoration.

Both bonuses read points, never the letter: `researchTimeCutPercent` is `(points-10)/90*45` and the
track officer's own `trackCostCutPercent` is `(points-10)/90*30`. Only the derived percentages go
on the wire.

**One §B8 widening, recorded deliberately, and this note understated it.** `timeCutPercent` is a
monotone function of one seated officer's `roleFit`, so it is invertible for that one role. "To a
tenth of a point" was wrong: it was invertible _exactly_, because the prices and the clock were
computed off the raw score while the card printed it rounded, and ten integer prices per track each
rounding a different four-digit figure pinned the score to a single value. Fixed, measured, and
written up under H2 below.

No migration was needed: `research_json.technologies` is still `string[]` and all fifteen ids the
old tree could have written still resolve, re-homed onto role tracks.

## Section G as built

G1 is rung 6 of the Fabricator track, `REIMAGINING_RESEARCH_ID`.

G2 is `POST /blueprints/reimagine`. It takes no body, because nothing about the trade is the
player's to choose: which pages go is decided by `reimagine` (most-duplicated first) and which page
comes back is seeded off the base and the moment, so a request retried because the connection
dropped cannot be retried until the Lab offers something better. The gate is re-checked against the
base record rather than trusted from the payload that drew the button, since both halves of it live
on screens the Blueprints page never loads.

The two booleans reach the client on `MarketResponse.reimagining`, computed in `market/board.ts`
from the same base record the route re-reads. The panel drops its requirement list once the Lab is
open and prints what went in and what came out, which is the only place a player is ever told which
page they gained.

## Two defects found and fixed on the way

The §F page badge shipped with the test id `offer-page-<template>`, which sits under the `offer-`
prefix that the visual and layout sweeps use to count the cards on a mission board. Three offers
plus one badge counted as four cards, and six e2e tests went red from a component on the far side of
the repo from the assertion. Renamed to `page-prize-<template>`, and the badge now has unit tests of
its own, one of which pins the namespace rather than the appearance.

The second is quieter. The six pre-war `blueprint_*` items in `items/catalog.ts` gated the old
research tree and the old single-item unit unlocks, both of which this brief replaced. Nothing reads
them now, but the Runner's barrow and the Black Market both still stock them and each one carried a
`usedFor` line naming a track or an upgrade line it would open. A player could pay 4,600 caps for
"Unlocks helicopters in the Garage" and get an item that does nothing.

The items were kept: crews hold them, both shops draw from them, and deleting an item somebody is
holding is a migration and a theft. The copy was corrected, and a general guard now fails whenever
an item's copy says it unlocks something and no gate reads its id. **Whether these six should be
retired from the shelves or turned into page sets is a content call nobody has made.**

## Measurements this work rests on

- The **mark scale floor is 10**, from the lowest score any real officer can produce in any role:
  measured over 142,500 generated officer-and-role combinations across the whole calibre band the
  Bar offers. The worst was 10.23 (a Scout), the recruitment median 20.77, the best recruitable
  35.85.
- The **ceiling is 100**, not the best recruitable 35.85, because attributes train to 100. Anchored
  at 35.85 every trained officer would sit at S+ within a week and the scale would stop saying
  anything. Twenty one bands over `[10, 100]` puts S+ at 95.7 and above, which is the brief's "small
  margin under the maximum".
- A fresh recruit therefore lands around **F+**, with the ladder ahead of them.

## Notes for whoever picks this up

- **The statue the board sketched is built (Section O, 2026-09-04).** `docs/DISTRICTS.md` arrived
  on 2026-09-03 with a hand-written Chrome Row row, _Statue of the Revolutionary_, in the place of
  The Long Pawn; the row was set back to the source when the file was formatted and the idea kept
  here. It is now the kind `revolutionary_statue`, and the row in the board's file is the board's
  again. Adding a location kind touches `city/locations.ts`, `battle/battlefield.ts`, the icon
  prompt in `art/prompts.ts`, the prompts doc's table, and the manifest test's pinned rows and
  count; append the kind rather than inserting it, because icon seeds are ordinal.

- The role weights table stays server-side (B8/B8a). The mark is the coarse hint its own leak guard
  allows, so the server computes it and ships the letter; the scale lives in shared and cannot
  reconstruct anything without the weights. The guard scans text, so do not name the scoring
  function in `packages/shared` or `apps/client`, not even in a comment.
- Marks gate research (C2) and communicate progress. Nothing pays out from them: every bonus reads
  the score (C3b).

## W. The Garage: documents named after their machines, and the Offie (2026-09-07)

- [x] W1. Every vehicle document is named after the machine as the yard lists it. "Motorbike
      Blueprint" became "Scrappy Blueprint"; a leading "The" is dropped the way the unit documents
      drop the plural. Pinned in `blueprints.test.ts` (control: the old name fails it).
- [x] W2. The Dirt Runner is gone. In its place the board's Offie, a reinforced pickup, painted in
      `images/offie-portrait-pickup.png`. It is the middle car now rather than a second bike:
      Garage level 5, 10 seats, 26% off the road, priced above the Scar.
      The class ladder tests in `vehicles.test.ts` still hold.
- [x] W3. The ids stay: `dirt_runner`, `bp_dirt_runner`, the three `pg_dirt_runner_*` pages and the
      `vehicle-dirt-runner` asset key. The Scar set the precedent (`scrap_car`): the id keys every
      stored fleet and every page already in a satchel, and a label change is not worth a
      migration. The pages read Bed Plating, Bull Bar and Lift Kit.
- [x] W4. Portrait through the pipeline: master at `art-src/vehicle-dirt-runner.png`, shipped as
      `assets/vehicle-dirt-runner.webp` (opaque 1024 square, no matte, as the Scrappy and the
      Scar), ART-BIBLE row, prompt subject rewritten in `prompts.ts` and transcribed into
      ART-PROMPTS.md, ART-ORDER.md regenerated. Checked on the Garage page in a screenshot.
- [x] W5. The Armoured Car is gone. In its place the board's Cheese Wagon, a school bus in plate,
      painted in `images/cheese-wagon-portrait.png`. A truck by the numbers: Garage level 7, 30
      seats, 16% off the road, priced between the Flatbed and the War Hauler. Same id policy as
      W3: `armoured_car`, `bp_armoured_car` and its four pages keep their ids; the pages read Hull
      Plating, Window Mesh, Ram Plough and Roof Rack. Portrait through the same pipeline as W4.
- [x] W6. No class sections on the Garage page. One list, every machine, in the order the Garage
      lets them out. The catalogue is now written in Garage-level order and `vehicles.test.ts`
      pins that (control: swapping two rows fails it). The class stays in the domain as the rule
      behind the speed and seats ladder; its labels and blurbs had no reader left and are gone.

## X. Vehicles: a wiring, bug and balance pass (2026-09-07)

Read end to end: the Garage builds into `base.fleet`; a fight takes machines off it on
`/battles/vehicles` and holds them on the deployment row; `sendColumn` prices the walk off that
row; the settle wrecks a share and hands the rest back; a mission takes them at launch and returns
them at settle, never wrecking one. Six things were not as intended.

- [x] X1. **An ally's machines were never settled.** The settle handled the declarer's row and the
      defending base's row and nobody else's, so a faction member who loaded their yard onto a
      friend's fight had it sit on the deployment row for ever. `settleSideVehicles` now settles
      every row on both sides, each against its own share of the survivors (`splitSurvivors`).
- [x] X2. **A column's clock ignored machines picked after it left.** The picker and the deploy
      share a screen and nothing orders them. `/battles/vehicles` now re-times this crew's columns
      still walking to that fight, from departure, so a narrower set lengthens the walk the same
      way (`retimeColumns`, `battle/movement.ts`).
- [x] X3. **Empty machines could be wrecked, and a crew that fielded nobody lost everything.** Two
      War Haulers under ten bodies wrecked both on a wipe and paid the enemy eighty infamy for a
      seating plan. Only what the force could fill is at risk now (`loadable`, which existed and
      was called by nothing); the idle ones and a fielded-nobody yard go home.
- [x] X4. **Riding cut a mission's pay and XP** (the open finding from Section Q). The launch
      froze the machines' cut into `travelMinutes` and the settle priced rewards, salvage and XP
      off that clock: about 12% less for using the Garage on a long road. The row now carries
      `pricedMinutes`, the card's own total without the machines (migration 0081, zero on old rows
      meaning "price off the row's clock"), and everything is priced off it.
- [x] X5. **The road cap made the Garage's top half pointless.** Battle roads capped at 60 and
      mission roads at 50 (the job cap). The machine ladder runs 34 to 52 before the ground's own
      +28 (Rail Yard, Tram Depot), so with both held any machine at all hit the cap and a
      Rotorcraft on a mission was capped alone. `MAX_ROAD_SPEED_BONUS = 100` now governs both
      roads (`hastenedRoadMinutes` for the mission leg); the job leg keeps its 50. The best column
      in the game halves the walk and every rung still moves the clock.
- [x] X6. **Where the machines are.** The road screen showed the walkers and nothing they rode in:
      columns and forces at a fight now carry ride chips like jobs do (`MovementView.vehicles`).
      The Garage row says "1 in the yard · 2 out" instead of "none" for a committed yard
      (`GarageVehicle.out`). The battle receipt names what was wrecked ("Wrecked on the way: 1
      Cheese Wagon"), since the report's table has no row for machines. A crew defending its own
      district gets no picker: there is no road to shorten, only a yard to put at risk.
- [x] X7. Tests: idle machines, fielded-nobody, re-timing, out counts and an ally's row in
      `officer-in-battle.test.ts`; pay parity in `missions.test.ts`; the road cap in the shared
      `missions.test.ts`; ride chips in `bench.spec.ts`. Each watched failing with its fix
      reverted.

Left alone, and recorded: a defender side's allied _survivors_ (bodies, not machines) all go to
the defending base (`resolve.ts`, "A home defence's survivors are the roster"); an ally who came
to hold a friend's ground gets none of their people back. Same shape as X1, older, and outside a
vehicle pass.

## Y. Hovers: one tooltip, drawn by the game (2026-09-07)

Every explanation on hover goes through two things the game draws: `HoverCard` (a portalled card,
the info windows) and `TooltipLayer` (the delegated `data-tip` name). The pass found the browser's
own tooltip still in nine places, one tooltip nothing could open, and two browser widgets.

- [x] Y1. Native `title` attributes converted to `data-tip`: the deploy dialog's Half and
      Everybody buttons, the unit card's Max, the attribute rows' importance, the blueprint page
      squares, the faction fights' side plate and the `Figure` chips. The card glyph dropped its
      SVG `<title>`, which browsers draw as an OS tooltip over every seat; the `aria-label` still
      names it.
- [x] Y2. `MarkStamp` carried a `title` on a `pointer-events-none` span: a tooltip on an element
      the pointer passes through, so "Head of Research: C+" had never once shown. It is a
      `data-tip` on a span that takes the pointer now (clicks still reach the card under it), and
      the prop is `tip`.
- [x] Y3. `TooltipLayer` sets a sentence in the body face. A name ("Battles", "Bed Plating") stays
      in the chrome's small capitals; a tip past a label's length or with a full stop in it was
      the same spaced capitals across two lines, and now reads like the note under a card.
- [x] Y4. The last native `<select>` on a game screen, in the faction fights drawer, is the
      painted `Dropdown`; the admin page's range slider is the `NumberField` every other count
      uses. `Reinforce.test.tsx` drives the combobox instead of a select element.
- [x] Y5. Checked and left: no native confirm/alert/prompt anywhere; every input carries the
      chrome's classes; the nav's `title` props are `aria-label` text, not attributes. The tips
      read as needed: none repeats a visible label, and the HUD icons, swatches, page squares and
      stamps are the ones that have no words of their own.

## Z. The Bar is an auction (2026-09-07)

The board replaced the wage haggle with a city-wide daily auction. The rules as built, with the
gaps the brief left filled in and recorded here so they can be reversed on purpose:

- [x] Z1. **One room, one day.** The roster is the same eight (plus a crew's Charisma seats) for
      everybody, generated from the Athens date, and it turns over whole at Athens midnight. A
      seat is not refilled when somebody wins it: the ids keep their `bar-<day>-<seat>-0` grammar
      and the seat turnover machinery (`bar_slots`) is gone.
- [x] Z2. **Open until thirty minutes before midnight.** Every bid is public: amount, crew, time,
      who leads. A bid must beat the leader by 5% and at least one cap (`nextMinimumBid`); the
      table opens at the officer's floor (`reservationWage` of the asking price, printed on the
      card); a leader cannot raise their own bid.
- [x] Z3. **Sealed for the last thirty minutes.** One secret final value per crew per table, locked
      once, never lower than the reserve, the crew's own open bid or the leading open bid. A crew
      with no open bid may still seal. Nobody sees anybody's value; the bidder count still counts
      them.
- [x] Z4. **The close.** Each crew's final is the higher of its open bid and its sealed value.
      Highest signs, onto the bench, at that price; a tie goes to a coin hashed off the auction and
      the crew (`rankBids`), so two settles agree and bid order does not matter. Every gate a hire
      always had stands at midnight: a free chair, the officer's doors, a wage the book can hold.
      A winner who cannot take them passes to the next final; a table nobody can take goes unsold.
      Settled lazily on the first Bar read after midnight and by the world clock.
- [x] Z5. **Two tables at once** (`MAX_OPEN_AUCTIONS`), counted from a crew's first bid until the
      table closes. The level-40 milestone that bought a second signing a day buys a third table.
- [x] Z6. **Payroll, still.** Nothing is charged. The price is the weekly wage committed to the
      book, talked down by the winner's own negotiators (`committedWage`, the sink for
      `wageDiscountPercent`); the price everybody sees and the result rows carry stay the shared
      number. The payroll-fit gate reads the discounted figure at the bid and at the close.
- [x] Z7. **Told.** The winner gets `officer_hired` ("X signed with you at N a week"); everybody
      else at the table gets `bar_outbid`. The Bar's "Last night" door lists yesterday's tables the
      reader sat at: won, lost, passed, unsold.
- [x] Z8. **Drawn.** The room keeps its painting and stool. Each seat carries the table: reserve or
      leader, who holds it, crews in, a live countdown to the seal or the close, a phase badge. The
      bidding window is the auction screen: the person on the left, the leading figure, the clock
      (oxblood in the last five minutes), payroll headroom and the table cap, the painted stepper
      with +1 step / +5% / +10%, the history newest first with the reader's rows marked, and in the
      sealed phase the lock behind a confirmation and then the sealed card. A "Your tables" strip on
      the painting counts the cap. The bar query polls every ten seconds; every clock runs off
      `serverNow`.
- [x] Z9. Server: migration 0082 (drops `bar_negotiations`, `bar_standoffs`, `bar_slots`; adds
      `bar_bids`, `bar_auction_results`), `bar/auction.ts`, `POST /bar/bid`, `POST /bar/seal`,
      `/bar/negotiate` and `/bar/hire` removed, 45 bar tests with controls on the increment, the
      cap, the sealed refusal, the tie and the discount. Client: `AuctionWindow`, `AuctionParts`,
      the strip and results on `BarPage`, `NegotiationDialog` gone, `bidding.spec.ts` replacing
      `negotiation.spec.ts`. Docs: GDD H7a, SPEC-server, SPEC-client, INTERFACES, ARCHITECTURE,
      STATUS.

- [x] Z10. **Bug dive** (2026-09-07, after the build). Read end to end for several crews reading
      one table, live reads, floors and the numbers a player is offered. The engine held: one
      process, synchronous storage, every bid inside a transaction against a fresh read of the
      table, so two crews at the same number are served in order and the second hears the new
      minimum; the close is one function of stored rows with the tie coin hashed, so the world
      clock and a page read agree; a crew winning two tables in one close is re-read between them.
      Five things were off and are fixed: bid times printed in UTC (now the player's own clock,
      `formatClock`); the window capped the field at the raw book while the server takes bids up
      to the talked-down figure, so `BarResponse.bidCeiling` carries the exact edge and the field
      and the gate agree (`bidCeilingFor`, with an off-by-one at the rounding edge caught by its
      own test); a full roster was refused only by the server (the window says so first); a crew
      leading more tables than it has chairs is now warned before the bid ("One chair free for 2
      tables"); the results panel only ever read last night, so a crew that skipped a night found
      it empty (it reads back a week for the last night it sat at a table, and prints the date).
      The settings layout gate's fixed probe height was a knife edge the new notification row
      tripped; it grows to the content now.

Calls the board may want to reverse: the close applies no admin waivers (an admin build can bid on
somebody it cannot hold and lose them as `passed`); the roster for a past day is regenerated at
today's city average, so an officer signed at the close can be a shade stronger than the card that
was bid on if the city levelled overnight; `BarRecruit.hired` is always false now and nothing
draws it; the bid field is floored at the reserve rather than at the moving minimum, with a warning
on screen and the server having the last word.

## AA. A server bug pass, and three numbers to plan against (2026-09-07)

The brief: walk every module in `packages/shared/src` and `apps/server/src` looking for a settle that
runs twice or never, a gate on one side of the wire and not the other, money made outside the ledger
that names it, and anything exported, catalogued or migrated that nothing reads. Then re-run §V's
table and price three things the last two days changed.

- [x] AA1. **§V's table has not moved.** `pnpm --filter @frontline/scripts battle-sim` at 3000 runs
      reproduces every row of §V to the digit: the Razors mirror at 46%, 18 vs 20 at 0.4%, 22 vs 20
      at 98.4%, two Ironside walls at 0% on the round cap with nobody scratched, and 0 ledger
      mismatches in 500. Nothing in this pass touched the engine, and the sim says so.
- [x] AA2. **The vehicle ladder, after the Offie and the Cheese Wagon.** Every rung still moves the
      clock and no class inverts. Corner to corner (Neon Docks to the Combine Spire, 75 minutes on
      foot), one machine carrying a full load, no ground bonus:

| Machine      | Garage | Seats | Road | Corner to corner |
| ------------ | ------ | ----- | ---- | ---------------- |
| on foot      |        |       |      | 75m              |
| The Scrappy  | 1      | 2     | +34% | 56m              |
| Scar         | 4      | 8     | +24% | 60m              |
| The Offie    | 5      | 10    | +26% | 59m              |
| Flatbed      | 6      | 24    | +14% | 65m              |
| Cheese Wagon | 7      | 30    | +16% | 64m              |
| Gas Balloon  | 9      | 10    | +44% | 52m              |
| War Hauler   | 10     | 40    | +18% | 63m              |
| Rotorcraft   | 12     | 18    | +52% | 49m              |

A later machine being slower than an earlier one is the class trade rather than an inversion:
the Scar seats four Scrappies and the War Hauler seats twenty. Within a class the ladder is
strictly monotone on seats, speed, price and build time, which was a sentence in `vehicles.ts`
with nothing asking it and is now a test (`vehicles.test.ts`, control: swapping the Scar and
the Offie fails it). The cross-class bands are unchanged: no car keeps up with a bike, no
truck keeps up with a car, and both flyers outrun everything on the ground.

- [x] AA3. **§X5 raised the road cap to 100 and the ground catches it again at location level 3.**
      X5 measured the ground at +28, which is the Rail Yard and the Tram Depot at **level 1**. Both
      scale on `LEVEL_SCALE`, so a crew that works them up runs out of road again:

| Rail Yard + Tram Depot | Ground | On foot | Scrappy | Rotorcraft |
| ---------------------- | ------ | ------- | ------- | ---------- |
| level 1                | +28    | 58m     | 46m     | 41m        |
| level 2                | +42    | 53m     | 42m     | 38m        |
| level 3                | +56    | 48m     | 39m     | 37m        |
| level 5                | +84    | 41m     | 37m     | 37m        |
| level 10               | +154   | 37m     | 37m     | 37m        |

From level 3 the best machine in the game is already at the ceiling; from level 6 the walk is,
and the whole Garage buys nothing on that road. The mission road has the same shape one
location kind along: two Smuggler's Tunnels at level 5 (+72) put a Rotorcraft on the cap, and
two at level 10 (+132) put the walk there. This is the same finding X5 fixed, one level of the
upgrade ladder further out, and it is a balance call rather than a bug: either the cap moves
again, or `travel_speed` and `mission_speed` stop scaling with the location's level. Recorded,
not changed.

- [x] AA4. **No mission is strictly better per minute than every other at its difficulty**, walking
      or riding, on value or on XP. Priced at level 1 off the misc board, value counted in
      `RESOURCE_KG` (the carry weight, which is the game's only ordering on what a resource is
      worth), against the best column in the game (+80 on the road):

| Difficulty | Best value per real minute | Best XP per real minute   |
| ---------- | -------------------------- | ------------------------- |
| easy       | water-run, 13.0 riding     | debt-collection, 7.4      |
| hard       | convoy-ambush, 15.8 riding | checkpoint-shakedown, 7.9 |

The two leaders are different jobs in both bands, which is the property that matters: a player
optimising for materials and a player optimising for levels are not sent to the same card. The
spread inside a band is wide (easy runs from 2.3 to 13.0 value per minute) and it is the
travel band doing it, not the reward table: the short jobs are the efficient ones and the long
ones pay in a lump. Riding shortens the road and not the job, so its edge is 3% on
`deep-expedition` (26 hours, one hour of it road) and 22% on `water-run` (18 minutes, most of
it road), which is the intended shape of §C3 and is what makes the Garage a mid-game purchase
rather than an opening one.

- [x] AA5. **The Bar's floor is inside the payroll book at every stage, and the chairs run out after
      the book does.** Reserves measured over seven consecutive rooms, eight seats each:

| City level | Room calibre | Open-door reserve | Whole room | Book at that stage        |
| ---------- | ------------ | ----------------- | ---------- | ------------------------- |
| 1          | 0            | 30 to 52          | 30 to 52   | 225 (Nexus 1, no steps)   |
| 10         | 3            | 56 to 85          | 56 to 85   | 450 (Nexus 10, no steps)  |
| 20         | 6            | 92 to 124         | 92 to 124  | 600 (Nexus 10, 5 steps)   |
| 30         | 10           | 145 to 177        | 145 to 177 | 1000 (Nexus 20, 10 steps) |

A day-one crew can open **any** table in the room: its whole book is 225 and the dearest seat
opens at 52, so both its chairs are affordable at the floor with 120 left over. §H2a's
three-seat open-door floor means at least three of them are reachable whatever the §H3 rolls
do. At the other end a level-10 crew (eleven chairs by §H8) has a 450 book against a room
asking 56 to 85, so it can take the best person on any table easily and can fill about five of
its eleven chairs before the book, not the chairs, refuses the sixth. That is the book working
as designed (§H7: "payroll is a capacity") rather than a gap, and it is the reason
`Increase Payroll` exists; worth knowing that the chair count and the book diverge by a factor
of two from level 10 onwards. Nothing in the room ever approaches the theoretical ceiling: a
perfect sheet would ask 1447 and open at 1158, and the strongest room the generator produces
at `MAX_CALIBRE` tops out at 177.

- [x] AA6. **Six defects fixed, each watched failing with its fix reverted.** A mission's pay and
      salvage were still priced off the ridden clock (§X4 landed `pricedMinutes` at the launch and
      the settle went on reading `missionTimings`, so the Garage still cost a crew about 3 to 12%
      of its take); `district_attacked` had no emitter anywhere in the server, so §A4's "the
      defender is told" was never true; §A4's raid disruption had a reader in `settleDistrict` and
      no writer at all, so the one thing a raid victim cannot buy back never happened; the Lab
      settled on its own two routes and nowhere else, so a finished rung's doors stayed shut and
      its bell stayed silent until the player opened Research; `MAX_PER_VEHICLE` was counted against
      the yard rather than against the machines out on the road, so sending a full yard out and
      building another doubled it; and a level-up the world clock banked reached nobody, which is
      the last of §Q's open findings (migration 0083, a durable marker drained by whichever response
      announces). `payroll_due` is gone from the notification catalogue: the weekly wage draw it
      described was removed with §H7's book.

## AB. The file-by-file pass, and the receipts on the HUD (2026-09-07)

Two engineers walked the tree in parallel, one on the client and one on server and shared, with
the orchestrator on the cross-cutting leftovers. Everything below has a test that was watched
failing with its fix reverted unless it says otherwise.

- [x] AB1. **Receipts.** Every stockpile chip, the infamy chip, the unit counts and the satchel's
      item counts throw a figure the moment they move: `-1,200` in oxblood for a spend, `+400` in
      verdigris for a gain, on a plate with the readout's icon, 18px, rising and fading over 2.4
      seconds, several in a row in their own lanes (`lib/deltas.ts`, `components/ui/Delta.tsx`).
      The passive trickle is not a receipt: a rise no larger than the district's own per-hour rate
      (plus a margin for held ground and perks, which `/me` does not carry) over the server-clock
      gap between two readings is suppressed; falls never are. Reduced motion fades without the
      rise. The training and cancel harness stubs now charge and refund, so the e2e sees a real
      stockpile move.
- [x] AB2. **Server bugs.** A mission's pay and salvage were still priced off the ridden clock at
      the settle (X4 froze the XP and missed the resources). `district_attacked` had no emitter, on
      a kind a player cannot mute. The §A4 raid disruption had a reader and no writer, so a raid
      never cost the victim its quarter of production. The Lab only settled on its own routes, so
      a rung finishing elsewhere opened nothing until the page was visited (`settleResearchFor` in
      `settleBase`). `MAX_PER_VEHICLE` counted the yard and not the machines out (build twelve,
      send twelve, build twelve more). Level-ups the world clock banked reached nobody; a durable
      marker (migration 0083) is drained by the announcing responses.
- [x] AB3. **Client bugs.** The build dialog quoted the catalogue price and measured affordability
      against it while `/me` carried the real quote nobody read. The build clock was derived twice;
      `/me` now carries `buildClocks`, the exact seconds the order freezes (`orderSeconds`, one
      writer). `GET /overseer/me` returned the sheet's fold with every perk-only channel at zero,
      so the district panel quoted the payroll step at full price and greyed a button the route
      would take; it returns every numeric channel of the crew fold now. The level-up card
      re-showed on any redelivery (latched on the level, not object identity). Stale Bar copy on
      the crew screen. Figures without separators on six screens. Fixture drift: a zero priced clock and two missing notification kinds.
- [x] AB4. **Leftovers.** The delivered Gas Balloon portrait was never encoded (it is the fifth
      painted machine now); the removed Cistern still shipped two assets; `payroll_due` described a
      draw §H7 deleted; `settleUpgrade` was a second, uncalled settle beside the live one; a dead
      modal, three CSS classes, a dead skyline table and two plot helpers. Left on purpose and
      recorded: `src/render/` is imported by nothing (the art policy names it, so a board call);
      129 officer faces delivered against a pool of 99 (widening re-maps every face); 36 exported
      symbols nothing imports (listed in the server report, a cleanup for a quiet tree); the
      residential gate and the break-in against `residentOf` stay as Q left them; `battle_incoming`
      and `training_done` are still emitted by nothing, named in a receipts test that refuses any
      new kind without an emitter.
- [x] AB5. **Edge cases and balance.** Tests at the reserve and one under, a sealed value level
      with the leader, the Athens boundary on both summer-time nights, an officer injured through
      midnight, a recall at the exact turnaround, a vehicle ladder monotone within each class, and a
      training batch half-delivered. Section V reproduces to the digit. One balance call recorded
      in Section AA rather than changed: the road cap catches the ground again once the speed
      locations reach level 3, and the whole Garage buys nothing at level 6.

## AC. Receipts that mean something, experience on the chip, the joker, and sound (2026-09-08)

- [x] AC1. **No passive receipts.** The +1 oil and +1 planks after a mission launch were the
      trickle: the launch refreshed the HUD, that read settled a few seconds of production, and a
      one-unit rise cleared an allowance that was a fraction of a unit. The rule now: a fall always
      shows; a rise on a stockpile shows only past `max(2, allowance)`, with the allowance floored
      at one whole unit because a settle banks whole units however slow the rate; readouts with no
      passive source (infamy, units, items, XP) announce every move. Measured cost: no job in the
      catalogue is small enough in every line to go silent; a one-line rounding refund can.
- [x] AC2. **Every click that spends refreshes the HUD on the same read.** The audit of all 31
      mutation hooks found the training path already correct and two that were not: fitting an
      upgrade slot never refreshed the stockpile, and the faction mutation refreshed only on
      success while the reinforce route settles before it refuses. Research starts now have a
      harness handler (they were driving a route the harness did not stub) and an e2e receipt.
- [x] AC3. **Experience.** Missions pay the figure frozen at launch, at the settle, and they are
      the main source by five to ten times over any other event: a median job is 388 XP against a
      100 XP first level, 543 against 1,500 at level five, 737 against 5,500 at ten (7.5 missions
      a level). The curve is unchanged; the lever if the tail should be longer is
      `PLAYER_XP_LEVEL_STEP` (100 to 160 gives 12 missions a level at ten). The level chip throws
      `+120 XP` in verdigris, diffed on XP behind the level so a crossing never reads as a loss.
- [x] AC4. **The joker** carries the word JOKER across the top of the face, star kept, legible at
      the seat's 44px and the file's 64px with clear edges.
- [x] AC5. **Sound.** Six CC0 sounds from Kenney's UI Audio and Interface Sounds packs (recorded in
      ART-BIBLE §11 with sha256), 47 KB in all: `click` on any button, `confirm` on primary and
      danger buttons, `page` on any link, `done` on a live base or notification event, `call` on a
      battle event and on calling a fight, `refuse` when an alert appears. One delegated listener
      at the root, the tooltip layer's pattern; `data-sound` overrides or silences a subtree. One
      decode per file, a gain node per play, rate-limited so a batch of settles plays once, silent
      until the first gesture as the platform demands, and a no-op at zero. A "Sounds" bar in the
      settings, painted and keyboard-operable, persisted on the user (`soundVolume`, default 60,
      migration 0084) and mirrored to local storage for the first frame. The curve is
      `(percent / 100) ^ (5/3)`, so the middle of the bar is half as loud rather than a quarter.
      Research and the rules for what stays silent (hover, typing, scrolling, polls) are in
      docs/SOUND.md. Background sound comes later, as the board said.
- [x] AC6. **The board's picks** (2026-09-08), off a listening board of all 151 files in the two
      packs: the tab change is `switch9` (the rising swish was rejected), the battle call is
      `scratch_005`, the refusal is `error_001`; the click, the confirm and the done chime stand.
      Gains re-measured so the interface still sits under the events.

## AD. The red mark, and a fight on demand (2026-09-08)

- [x] AD1. **One sound for a fight called and a fight coming.** Both already play the `call` kind:
      the "Call it" button carries it, and the `district_attacked` bell arrives as a live `battle`
      event, which the announcer plays as `call` over the chime when the two land together. The
      file behind it is the board's pick, `scratch_005`.
- [x] AD2. **The red mark.** `UnreadCounts.fightsOnYou` rides the `/me` poll: fights still to come
      that somebody else called on ground this crew defends (`fightsCalledOn`, counted the way the
      settler finds the defender). The bottom bar draws it on the left as a pulsing oxblood tile
      with the road-sign triangle and a count past one, a link straight to the board, on every
      screen; a quiet day draws nothing.
- [x] AD3. **The console calls a fight on you.** `POST /admin/mock-battle`: the seeded rival (or
      any other crew) declares on the reviewer's ground through `declareBattle` itself, at the
      earliest mark, so the bell, the mark and the board are the real ones. A crew holding nothing
      is handed one unheld location first, since a residential district has no gate and no
      locations to be called on (Section Q, still true); the caller is marked as having scouted
      the ground. Tests: the server route end to end (declaration, handed ground, the count, the
      bell; 404 without the console), the mark and its link in `battles.spec.ts`, the console
      button in `backroom.spec.ts`.
- [x] AD4. **Every press makes its sound.** The faction book, the badge swatches, the member file,
      the bidding window and every other window were silent because `Modal`'s panel stops click
      propagation (so a press does not fall through to the backdrop) and the sound layer listened
      in the bubbling phase. It captures now, so nothing in the tree can hide a press from it. The
      pressable set grew from buttons and links to checkboxes, radios, `summary` and the `button`,
      `option`, `switch`, `tab` and `menuitem` roles, so the settings switches, the board's
      filters, the hold-the-ground tick and the painted picker's options click. Starting a
      research programme and burning an upgrade say `confirm`; a tooltip trigger that only
      explains itself says nothing. Test: a press inside a panel that stops propagation is heard
      (control: the bubbling listener fails it).
- [x] AD5. **The picker's second frame.** The painted frame (`.painted::before`, the rivet dots)
      sat on the scrolling list, so once a picker held more than eighteen rems of chairs the frame
      scrolled with the options and drew a second brass box across the menu. The frame is on a
      wrapper that never scrolls; the options scroll inside it.

## AE. Speed is one stat, and one clock runs on it (brief of 2026-09-08)

The board: _"the total population riding the vehicle has exactly the speed of the vehicle, so no
off-the-road percentage. Everything is calculated based on the speed itself... A 30 speed unit makes
it 30% faster to go there, and a 100 speed unit makes it 100% faster, e.g. 20 mins down to 10
mins... Other bonuses like 10% less travel time stack on top."_

Two quantities had been sharing one name. A machine carried a "percentage off the road" that was
added into the ground's travel bonus and divided in; a unit carried a `speed` the road had never
read at all. So a Rotorcraft and a Rail Yard were the same kind of thing, a Cyberhound walked at the
pace of an Ironside, and `carriedSpeedPercent` handed forty walkers the average of the two bikes in
front of them.

- [x] AE1. **`roadMinutes(base, speed, reductionPercent)`** (`time/speed.ts`), and every road in the
      game goes through it: `travelMinutesBetween` for a march and a scouting run,
      `hastenedRoadMinutes` for a mission's travel leg. Speed **divides** (`base / (1 + speed/100)`,
      so 100 halves the road and 30 takes twenty minutes to fifteen), the reduction **multiplies**
      what is left, and the two compose in that order. A walk with nobody quick and no holdings is
      the base, which is what made this safe to put under a road that had no speed in it before.
      `MAX_TRAVEL_SPEED_BONUS` survives as the reduction's ceiling, reread as a percent off and
      lowered to 60; `MAX_ROAD_SPEED_BONUS` had no reader left and is gone; the job leg keeps its
      own divisor and its 50 (`MAX_MISSION_SPEED_BONUS`), because there is no column on a job.
      `travelMinutesBetween(from, to, pace)` takes an object now: the third argument used to mean
      the reduction, and a caller that kept passing its old number positionally would have been
      claiming its ground makes the walkers faster.
- [x] AE2. **`columnSpeed(fleet, force, effectiveSpeedOf)`** replaces `carriedSpeedPercent`
      everywhere (`battle/movement.ts`, `missions/launch.ts`, the Garage projection, and the
      client's own quote). A column is a set of groups, each at one speed: every unit type still on
      foot at its own effective speed, every machine carrying anybody at that machine's. The answer
      is the **minimum**, because a column arrives when its last people do, which `vehicles.ts` has
      promised in prose since the vehicles were rewritten and the weighted average never delivered.
      Seats are filled fastest machine first, and the **slowest walkers board first**: seating the
      Cyberhounds and leaving the Ironsides on foot buys nothing at all.
- [x] AE3. **Vehicles carry `speed`, 0 to 100, on the units' own scale.** `VehicleSpec.speedPercent`
      is gone. `GarageVehicle.speed` is the wire field; `GarageVehicle.speedPercent` ships equal to
      it for one release as a deprecated duplicate and then goes.
- [x] AE4. **The Heli Porter** (`heli_porter`), the board's strongest machine and the top of the
      catalogue: flying, speed 95, 30 seats, Garage 14, 15000 scrap / 5800 oil / 3400 high-quality
      metal, an eleven-hour build, behind the new four-page `bp_heli_porter`. Painted from
      `images/heli-porter-portrait.png` through the usual pipeline (`art-src/`, `vehicle-heli-porter`
      at seed 161009, ART-BIBLE row, ART-PROMPTS transcription, ART-ORDER regenerated). The
      **Rotorcraft** sits below it at 78 with 18 seats and gets the first painting of its own, and it
      is the only `fragile: true` machine in the yard: at any loss share `wrecked` writes off the
      fragile machines before the sound ones, so a crew flying both into the same mauling loses the
      Rotorcraft. Nothing else reads the flag, and its description says so in the Garage.
- [x] AE5. **The Colossus does not ride.** `UNIT_RULES.no_ride` ("Too big to ride"), the first
      negative rule on a sheet and the reason `UnitRuleSpec.tone` exists (`'positive'` by default,
      `'negative'` here, so the card can draw it red). `columnSpeed` never seats such a unit and
      `loadable` is not asked to keep a truck on the road for one, so a Colossus holds its whole
      column to 15 whatever is in the yard. The blurb has said "it arrives slowly" since the first
      draft and nothing enforced it.
- [x] AE6. **The two ladders, rebalanced.** Corner to corner, Neon Docks to the Combine Spire, a
      74.6-minute road before anything:

| Machine      | Class     | Garage | Seats | Speed | Corner to corner |
| ------------ | --------- | ------ | ----- | ----- | ---------------- |
| nobody quick |           |        |       | 0     | 75m              |
| The Scrappy  | motorbike | 1      | 2     | 65    | 45m              |
| Scar         | car       | 4      | 8     | 55    | 48m              |
| The Offie    | car       | 5      | 10    | 58    | 47m              |
| Flatbed      | truck     | 6      | 24    | 45    | 51m              |
| Cheese Wagon | truck     | 7      | 30    | 48    | 50m              |
| War Hauler   | truck     | 10     | 40    | 50    | 50m              |
| Gas Balloon  | flying    | 9      | 10    | 70    | 44m              |
| Rotorcraft   | flying    | 12     | 18    | 78    | 42m              |
| Heli Porter  | flying    | 14     | 30    | 95    | 38m              |

The class rule is unchanged and is still a test rather than a taste: within a class the later
machine is faster, bigger and dearer; no car keeps up with a bike, no truck with a car, and both
bands of flyer outrun everything on the ground. The Road Reavers ride the Scrappy and are written
at exactly its 65, which is the board's own rule and its own test.

Units, fastest first. Everything not named as an exception sits at or under 50, which is under
every machine above the Flatbed:

| Unit               | Tier       | Speed | Unit            | Tier       | Speed |
| ------------------ | ---------- | ----- | --------------- | ---------- | ----- |
| The Loose End      | legendary  | 95    | The Abomination | legendary  | 40    |
| The Crimson Dancer | legendary  | 92    | Ash Walkers     | rabble     | 35    |
| Cyberhounds        | wonder     | 90    | Stitchers       | specialist | 35    |
| The Cartographer   | legendary  | 88    | Snipers         | specialist | 30    |
| Kite Crews         | wonder     | 85    | The Twins       | wonder     | 30    |
| The Specter        | legendary  | 80    | Scavengers      | carrier    | 30    |
| Road Reavers       | wonder     | 65    | Sluggers        | heavy      | 30    |
| Scrapers           | rabble     | 50    | Wardens         | heavy      | 28    |
| Ghosts             | specialist | 50    | Demolishers     | specialist | 28    |
| Razors             | rabble     | 45    | Juggernauts     | heavy      | 25    |
| Hollow Men         | wonder     | 45    | Ironsides       | heavy      | 22    |
| The Saint          | legendary  | 45    | Haulers         | carrier    | 22    |
| Anodics            | rabble     | 40    | The Colossus    | legendary  | 15    |
| Sparks             | rabble     | 40    |                 |            |       |
| Breakers           | heavy      | 40    |                 |            |       |
| Netrunners         | specialist | 40    |                 |            |       |
| Sleepers           | specialist | 40    |                 |            |       |
| The Condemned      | rabble     | 40    |                 |            |       |

One number moved off the brief's proposal: the Specter went to **80** rather than 75. At 75 it was
slower than the Rotorcraft, so "the named exceptions beat every machine but the Heli Porter" was not
a property the roster had and could not be a test. 80 puts it one rung above the Rotorcraft's 78 and
well under the Porter's 95.

- [x] AE7. **§V's table has not moved, and the engine was not compensated.** Speed reaches a fight
      through `engagementEdge` alone (`reach = range - their speed`, `closing = speed - their speed`
      weighted by their range) and through `pursuitSpeed` and the perimeter roll. Every sheet in the
      sim's matrix moved, most of them down by 2 to 10 points, and because both terms are
      _differences_ the matrix is nearly invariant to a uniform shift. `battle-sim` at 3000 runs,
      before and after, attacker's win rate:

| Matchup                               | Before   | After    |
| ------------------------------------- | -------- | -------- |
| Razors 20 vs 20 Razors                | 46%      | 46%      |
| Snipers 20 vs 20 Snipers              | 45%      | 46%      |
| Ghosts 20 vs 20 Ghosts                | 49%      | 49%      |
| Breakers 20 vs 20 Breakers            | 39%      | 39%      |
| Wardens 20 vs 20 Wardens              | 0.0%     | 0.0%     |
| Sluggers 20 vs 20 Sluggers            | 0.1%     | 0.1%     |
| Juggernauts 20 vs 20 Juggernauts      | 0.2%     | 0.2%     |
| Ironsides 20 vs 20 Ironsides          | 0% (cap) | 0% (cap) |
| Razors 18 vs 20                       | 0.4%     | 0.4%     |
| Razors 22 vs 20                       | 98.4%    | 98.4%    |
| Razors 30 vs 20                       | 100%     | 100%     |
| Razors 30 vs 20, press dug in to 3    | 100%     | 100%     |
| 60 vs 30 Razors, frontage 12          | 100%     | 100%     |
| ...the same with 50% cohesion         | 100%     | 100%     |
| Snipers 20 vs 20 Razors               | 100%     | 100%     |
| Razors 20 vs 20 Snipers               | 0%       | 0%       |
| Breakers 20 vs 20 Ironsides           | 0%       | 0%       |
| Ironsides 10 vs 30 Razors             | 0.4%     | 0.4%     |
| Juggernauts 5 vs 30 Razors            | 100%     | 100%     |
| 10 Razors 6 Snipers 4 Ironsides vs 20 | 100%     | 100%     |
| 20 Razors 6 Stitchers vs 24 Razors    | 100%     | 100%     |
| 20 Razors vs 40 Scavengers            | 100%     | 100%     |

The largest move is one point, on the Snipers mirror, inside its own ±1.8 interval. Rounds and
survivor shares are within a point everywhere too: the sharpest is Snipers against Razors, where the
defenders' survival goes 14% to 11% because the Razors' 55 to 45 widens the sniper's reach. Nothing
in the engine was touched and no normalisation was needed. The forecast still agrees with the long
run and the wrapper's ledger is 0 mismatches in 500.

Two roster facts moved with the numbers, and two tests were retuned to follow them rather than to be
made to pass. `matchup.test.ts` used the Road Reavers as its exemplar of "the fast unit"; at 65 they
are a quick brawler and the Cyberhounds (90) are the extreme, so the three tests in "range works
against slow units" and "fast units kill snipers easier" name the hounds. `morale.test.ts` pins
`pursuitSpeed` at the fastest sheet on the winning side, which is 65 now rather than 92.

- [x] AE8. **Scouting is on the same arithmetic**, and it walks at the scout's own speed
      (`officerBattleStats().speed`) rather than at a crew's ordinary nothing. Sending the Finance
      Officer to case the Undergrid is a slow night in two ways now: the looking and the road. The
      city view's travel estimates go through `roadMinutes` too, at speed 0, because a distance on
      the map is not a column.
- [x] AE9. **A mission's pay is still the card's number.** `pricedMinutes` is frozen at speed 0 and
      the ground's reduction only, which is exactly what `offerFor` quotes: the card is drawn before
      a crew is picked, so a fast unit shortens the road for free the same way a machine does and
      neither is a discount on the take (§X4, §AA6).
- [x] AE10. **Tests, each watched failing with its fix reverted.** New: `time/speed.test.ts`
      (`roadMinutes` at 0, 30 and 100, the reduction stacking on top, both ceilings, the minute
      floor; `effectiveSpeed` and the flat +3 that cannot pass 100); `vehicles.test.ts`
      (`columnSpeed` with nobody riding, everybody riding, seats short of the force, the slowest
      walkers boarding first with a naive-order control, seats past the force, a `no_ride` unit
      dragging a Heli Porter column to 15 with the trait-off control; `wrecked` taking the fragile
      machine first written both ways round; the Road Reavers equal to the Scrappy; the named
      exceptions above every machine but the Porter; the Porter unbeaten); `city.test.ts` (the
      divide-then-multiply order); `officer-in-battle.test.ts` (the battle road and the mission road
      landing on the same minutes for the same length and the same two speeds);
      `scouting.test.ts` (the road is the officer's own, out and back, plus the ground). Retuned and
      why: `missions.test.ts`'s timer read the template's clock where the row's is now shorter,
      because the walkers' own speed shortens it; its three riding tests moved to the longest road
      the board authors, because `roadMinutes` rounds to the minute and a five-minute leg cannot
      tell 45 from 65; the settled-ride test now seats its whole four hundred, because a fleet that
      leaves 184 people walking is a column at the walkers' pace, correctly.

Left alone, and recorded: `MAX_TRAVEL_SPEED_BONUS` at 60 means a crew holding the Rail Yard and the
Tram Depot at level 3 (+56, §AA3) is close to the reduction ceiling again, but the shape of §AA3's
finding is gone: the ceiling now bounds only the _ground's_ cut, and the column's own speed is
uncapped by it, so every rung of the Garage still moves the clock however much ground a crew holds.
Whether `travel_speed` should keep scaling with a location's level is still the open balance call
§AA3 recorded.

### AE11. The bug pass over AE, and what the clock actually reads (review of 2026-09-08)

Five bugs, each fixed, each with a test watched failing with the fix reverted.

1. **A seat could make somebody slower.** `columnSpeed` filled machines unconditionally, so two
   Cyberhounds (90) handed a Scrappy (65) climbed on and the column reported 65. Owning the
   cheapest machine in the game made the fastest sheet in it a quarter slower, and the only way to
   travel at the pace the roster promised was to leave a bike at home, which is the exact opposite
   of the module's own promise that "a crew that owns a truck is never punished for it". `boarding`
   is slowest first, so one line stops at the first group the machine cannot outrun: nobody behind
   it would be helped either. The seats a fast group declines are still spent on the slow group
   behind them, which a plain "skip the machine" would have got wrong, and that case is a control
   in the test.
2. **The settle counted a Colossus as a rider.** `settleSideVehicles` passed `forceSize` to
   `loadable`, whose contract has said `bodies` means the **riders** since it was written (the
   client's own quote reads it that way). One Colossus therefore made a thirty-seat Cheese Wagon
   "carrying somebody": on a wipe the crew lost a bus nobody was ever in and handed the enemy thirty
   infamy for a seating plan. `ridingBodies` (`units/catalog.ts`) is the count, next to
   `unitColumnSpeed` because both need a sheet that `building/` cannot see.
3. **A mission's road ignored `unitSpeedPercent`.** `battle/movement.ts` has fed the channel to
   `columnSpeed` since the column had a speed at all; `launchMission` called
   `columnSpeed(vehicles, force, unitColumnSpeed)` with no bonus. So the same Razors walked to a
   fight quicker than to a job on the same streets, and the Skate Ground, whose entire reward line
   is "everything you field moves faster", bought nothing on the screen a player uses it on most.
   The route folds it in beside `missionSpeedPercent`, which stays a separate number because the
   two are spent differently: this one divides, that one is a percentage off what is left.
4. **Neither road read the workshop.** `upgradedStats` is what `battle/effects.ts` hands the engine,
   so a Neural Lace is twelve points of speed inside a fight; both roads read `unit.stats.speed`
   straight off the catalogue. The same body crossed the city slower than it crossed the
   battlefield it was crossing the city to reach, and the armour line's "survivability paid for in
   speed" was paid for on one clock only. `unitColumnSpeed` takes `fitted` now and folds it exactly
   as the engine does. Two call sites, `battle/movement.ts` and `missions/launch.ts`, and one
   line-anchored control each.
5. **The engine doc said speed does nothing in a fight.** `BATTLE-ENGINE.md` and
   `bonuses.test.ts` both claimed the round loop never reads speed, on a measurement taken where
   both sides move at the same pace: `engagementEdge` is a **difference**, so a mirror cancels it by
   construction. Give one side the bonus and it is worth plenty. Measured, 1500 runs: +20%
   `unitSpeedPercent` on 20 Razors against 20 Snipers takes the Razors' survivors from 10.8% to
   13.6%, and the Razors mirror from 44.4% to 46.9% attacker wins. §AE7's finding is unaffected and
   is the same fact from the other side: a **uniform** rebalance of every sheet is nearly invisible.
   `upgrades.ts`'s worked example of the clamp-ordering fix was also written on the Cyberhounds at
   92; at 90 the example no longer clamps at all, so it is the Loose End at 95 now.

`battle-sim` at 3000 runs reproduces §AE7's after-table to the digit, every row, and the ledger is
still 0 mismatches in 500.

**What the clock reads, in minutes.** Corner to corner is Neon Docks to the CCS, 74.6 minutes raw.
Every machine carrying a full load, against the same people walking:

| Machine      | Class     | Seats | Speed | Riders           | Ride | They walk |
| ------------ | --------- | ----- | ----- | ---------------- | ---- | --------- |
| The Scrappy  | motorbike | 2     | 65    | 2 Razors (45)    | 45m  | 51m       |
| Scar         | car       | 8     | 55    | 8 Razors         | 48m  | 51m       |
| The Offie    | car       | 10    | 58    | 10 Razors        | 47m  | 51m       |
| Flatbed      | truck     | 24    | 45    | 24 Razors        | 51m  | 51m       |
| Cheese Wagon | truck     | 30    | 48    | 30 Razors        | 50m  | 51m       |
| War Hauler   | truck     | 40    | 50    | 40 Razors        | 50m  | 51m       |
| Gas Balloon  | flying    | 10    | 70    | 10 Razors        | 44m  | 51m       |
| Rotorcraft   | flying    | 18    | 78    | 18 Razors        | 42m  | 51m       |
| Heli Porter  | flying    | 30    | 95    | 30 Sluggers (30) | 38m  | 57m       |

Nobody quick at all is 75m, which is the base back, as AE1 promises.

The mission's long leg (`furthest`, 60 minutes), no ground held:

| Column                     | Pace | Leg |
| -------------------------- | ---- | --- |
| 10 Scavengers on foot      | 30   | 46m |
| 10 Scavengers in the Offie | 58   | 38m |
| 20 Scavengers in the Offie | 30   | 46m |
| 10 Razors on foot          | 45   | 41m |

A scouting run, corner to corner and back (`scoutRunMinutes` adds the looking on top of this):

| Officer speed | One way | Out and back |
| ------------- | ------- | ------------ |
| 0             | 75m     | 150m         |
| 40            | 53m     | 106m         |
| 80            | 41m     | 82m          |

And the ground's cut on top, corner to corner. Rail Yard (10) plus Tram Depot (18) is 28% at level
1 and 56% at level 3 (`LEVEL_SCALE` is linear, so level 3 is 2x):

| Held                      | Off | Nobody quick | Razors | Heli Porter |
| ------------------------- | --- | ------------ | ------ | ----------- |
| nothing                   | 0%  | 75m          | 51m    | 38m         |
| Rail Yard + Tram Depot L1 | 28% | 54m          | 37m    | 28m         |
| Rail Yard + Tram Depot L3 | 56% | 33m          | 23m    | 17m         |
| the ceiling               | 60% | 30m          | 21m    | 15m         |

The cap bites at 60% and level 3 of both is already 56, so for a crew holding both, the Tram Depot's
fourth level buys the last four points and its top six levels buy nothing at all. That is §AA3's
open call, still open and now measurable: a question about `travel_speed` scaling with a location's
level, not about the ceiling.

**Two things for the board, not fixed here.**

- **The Flatbed is worth nothing to a Razor column.** At 45 it is exactly the Razors' own speed, so
  a Garage-6 machine costing 5200 scrap moves a column of the game's commonest unit by zero minutes.
  It is worth real time to anything slower (Sluggers 30, Ironsides 22), so this is a gap in the
  ladder rather than a broken machine, and moving it is a balance call the board should make.
- **The Heli Porter's blueprint is the easiest vehicle document in the game.** Four pages, against
  the Rotorcraft's seven, the War Hauler's six and the Gas Balloon's five. Pages drop uniformly
  over the category, so page count _is_ the gate, and the strongest machine in the catalogue is
  currently the quickest one to unlock once the Garage reaches 14. AE4 wrote "four-page" so this may
  be deliberate; if it is not, six or seven pages puts it back in order.

## AF. The bug pass on the speed round (2026-09-08)

Two reviewers, one on shared and server, one on the client, over everything Section AE touched.
Nine faults, each fixed with a test watched failing under the fix reverted:

- [x] AF1. A seat could make somebody slower: two Cyberhounds handed a Scrappy climbed on and the
      column read 65. Nobody boards a machine slower than their own legs now, and the seats a
      fast group declines still go to the slow group behind them.
- [x] AF2. The settle counted a Colossus as a rider, so a wipe wrecked a bus nobody was in and paid
      the enemy thirty infamy for it. `ridingBodies` counts only who can board.
- [x] AF3. A mission's road ignored `unitSpeedPercent` (the Skate Ground bought nothing on the one
      screen it is for), and neither road read the workshop's refits while the fight did. Both
      roads fold the crew's channel and the fitted sheet, exactly as the engine does.
- [x] AF4. The engine doc claimed speed did nothing in a fight; measured, a +20% speed channel is
      worth about three points of survivors and two of the mirror, hidden on a mirror because
      `engagementEdge` is a difference.
- [x] AF5. The screen's column sentence named the wrong holder (a Flatbed carrying nobody), and its
      quotes read the printed sheet rather than the refitted one, under a label that says "at
      most". The quote runs all three seating rules and takes the crew's loadouts. It stays a
      bound: the territory half of `unitSpeedPercent` and the crew's `travelSpeedPercent` are not
      on the battle or mission payloads, and both only shorten a road. Putting the standing fold's
      two figures on `BattleView` and `MissionsResponse` would make it exact; recorded, not done.
- [x] AF6. The battle board announced units by their wire id; "Rides at 0" while the roster was
      still loading; the Garage note and the picker's doc still told the weighted-average story;
      the travel bonus read "+12% travel speed" where it is 12% off the clock; the Speed stat's
      explainer was fight-only.
- [x] AF7. Nothing reads the old model: no `speedPercent` reader but the one-release wire shim, no
      hand-rolled road arithmetic, no old-scale threshold, no "ground" in copy. Battle-sim
      reproduces Section AE's table to the digit; the road table is AE11. The two e2e cases seen
      flaky under load passed 5 of 5 alone and inside their files; the likely mechanism (a Vite
      dependency re-optimisation reloading the page inside the live test's window) is written
      down with a diagnostic for the next time.

Left for the board: the Heli Porter's four-page blueprint against the Rotorcraft's seven makes the
strongest machine the quickest to unlock; the Flatbed's 45 equals the Razors' speed; the oxblood
rule chip shares its colour with a bad characteristic chip; the roster fixture ships the printed
sheet beside a filled bracket.

## AG. The card closes on its picture, and the machines join the roster (2026-09-08)

Three board requests in one message, on the units screen and the yard.

- [x] AG1. **The unit card closes on its portrait.** The picture had 12px over it and 42px under
      it: the frame had grown 2rem for the marks band's headroom while the portrait stayed capped
      at 24rem, and the difference showed as a strip of card. Now the frame is the column beside
      the picture, budgeted to the pixel for the tallest card in the game (header 39, gap 8, sheet
      199 with two rows of marks, 12 to the brackets, 24 of brackets, 12 to the price box, box 92,
      plus padding and border: 25.75rem), and the sheet stretches to take what a shorter card
      leaves. The portrait fills the frame with the same 12px over and under it. The brackets sit
      12px under the sheet's rule and the price box 12px under them, and the box's bottom edge is
      the portrait's bottom edge on every card of every tier. The box came down from 96px to 92,
      which is a two-line price (five materials wrap at every width the card is drawn at, and none
      reach three), the stepper row, and the box's own padding and border, measured. A new gate in
      `visual.spec.ts` unlocks every unit (the late-game fixture locks most of the roster, so the
      old sweep had never laid out a five-material price) and measures the four claims on every
      card at five viewports; each was watched failing under its own mutant (the sheet not
      stretching, the box floating up, the box at 80px eating its padding).
- [x] AG2. **Vehicles is the roster's last tab.** The Garage's catalogue is a tab on the units
      screen after the six tiers, in the units' own two-up grid, with the same cards (the card and
      the catalogue moved to `features/garage/VehicleCard.tsx` and `VehicleCatalogue.tsx`, which
      owns the yard query and the Build). The open tab lives in the URL (`?tab=vehicles`, the way
      the Scrapyard's bench does), replacing rather than pushing, so one press of Back leaves the
      roster. The Garage page keeps its note and the yard panel (level, seats) and is a door: one
      button, "See the machines", that lands on the tab. `garage.spec.ts` covers the door, the
      list (every machine in catalogue order, a Build that posts) and the history; the roster's
      visual sweep walks the tab at every viewport with its own screenshot.
- [x] AG3. **The War Hauler and the Flatbed are gone** (by agent, reviewed). Out of the vehicle
      catalogue, the blueprint catalogue (ten pages between them), the art subjects and the
      manifest (the vehicle seeds after them renumbered, the order sheet regenerated, the prompt
      transcription edited by hand because it is not generated), and every comment, doc and test
      that used them as the example. The tests keep their intent on machines that exist: the
      Cheese Wagon is the big prize and the bus nobody was in, the Scrappy and the Road Reavers
      are the equal-speed pair, and two tests got teeth they lacked (the "wastes seats" case had
      no bite with one machine type; the Garage-too-low case was refused for the missing
      blueprint whatever the level check did). Stored fleets are swept both ways: migration 0085
      strips the two keys from every fleet column, and the missions repo now repairs a retired
      id on read the way sieges and bases already did, which was a live fault (a stored mission
      carrying one would have thrown out of its schema). Left on purpose: the "Flatbeds and a
      crane" loot-capacity upgrade and the rail yard's parked flatbeds in its art prompt, neither
      of which is the machine. The Flatbed's open balance call in Section AF closes with it.

## AH. The market reworked: one frame, a centred Broker, an auction at the barrow (2026-09-09)

The board's brief, in order, and what was built for each:

- [x] AH1. **The Broker on the centre line.** Hand over (six tiles), the number with its
      fractions and the deal it makes on one line, walk away with (six tiles), Trade: every row
      centred, so the trade is read straight down. The pickers grew a `sm` size for it.
- [x] AH2. **The market's own furniture.** A tape of the street's figures running under the tabs
      (built from the board: every lot's leading bid, the Broker's rate, the run's ration, the
      offers standing), neon on the Runner's clock and the Broker's plaque, an awning over the
      barrow, and holographic price tags on the lots. All of it lives in `index.css` under the
      market's own comment, honours reduced motion, and appears on no other screen.
- [x] AH3. **Offers on their own page** (by agent, reviewed). `/game/market/offers`, the second
      tab: They offer and You offer as two halves, one big card per listing with the piles as
      chips, the seller, how long it stands and the verdict from the reader's side; the composer
      as the obvious "put something up" card at the top of You offer, and a counter opens it
      named at the crew it answers. The verdict on a crew's own listings now reads from their
      side (it called a giveaway "in your favour").
- [x] AH4. **The front does not scroll.** `PageShell fills`; the Runner over the supply run, the
      Broker beside them, the Runner's row floored at one row of lots so the run is what gives.
      Measured to the pixel at 1280x720 (quote 26, tabs 36, the two rows 345) and pinned by a
      gate in the market's visual sweep that reads the sheet's and the panels' scroll heights,
      watched failing with the floor removed. The one concession is 1024 wide, where six lots
      cannot share a row and the barrow's second row scrolls.
- [x] AH5. **The Runner's hours on the tab row**, right-aligned, as the page's standing note with
      the live clock in its label and the rules on its hover. The hours themselves are also on the
      barrow's head at 1200 and up.
- [x] AH6. **The quote**: "Nobody owns the market. Some people just think they do."
- [x] AH7. **The barrow is an auction** (server by agent, reviewed; wire and screen by hand).
      Every line is a lot on each visit; bids in the open under the crew's name; the highest when
      he packs up takes one and pays their bid, their own ground discount coming off what they pay
      the way negotiators come off a wage. Nothing escrowed at the bid; a winner who cannot cover
      it at the close passes to the next; a tie to a coin seeded on the lot; the close runs on the
      world clock and on the next read of the market. Migration 0086 (`vendor_bids`,
      `vendor_lot_results`), `POST /market/bid`, `market_won` and `market_outbid` bells, results
      from the last visit on the wire and on a hover off the barrow's head. The bid window is the
      Bar's without the sealed phase, and the harness judges a bid with the shared step so an
      under-bid is refused in the server's words. Buying off the barrow is gone.

Left for the board: the line price on the wire is the city's number now, so a crew holding the
Downtown Market sees its discount at the close rather than on the card (the reserve has to be one
figure for everybody); and a crew may sit at any number of lots at once, unlike the Bar's two.

## AI. A general UI and UX pass (2026-09-09)

Two lanes, each over half the screens: every screen and everything it opens, at 1280x720,
1440x900 and 1920x1080, looked at as pictures and read as code. The first half (city, district,
units, missions, bar, crew, research) is in; the second (faction, training, market, workshop,
satchel, settings, garage, scrapyard, battles, the social screens, the shell) follows below when it
lands.

- [x] AI1. **The row of doors was three rows.** The bottom bar aligned its doors to their bottoms,
      so a door behind a level (which carries an extra line) sat 13px above its neighbours, and the
      two pinned doors (Settings and the red fight mark) were centred in the bar rather than on
      the row: three baselines in one row. Aligned to the top, pinned at the bar's own padding,
      gated by a sweep in `screens.spec.ts` that reads every door's top at two widths.
- [x] AI2. **The crew screen opened on four empty chairs** with every officer below the fold, and
      a vacancy was drawn at a portrait's height (a 410px box for a 58px chair). People first, the
      empties after them in catalogue order, and a vacancy no taller than it needs; a card only
      moves when somebody sits down.
- [x] AI3. **A locked unit cut a word in half.** The locked box joined every clause into one line
      and clamped it; it now prints two clauses and "N more", the whole list still on the hover.
- [x] AI4. **The Blueprints view had no empty state**: with nothing in the satchel the body was a
      collapsed hover chip, indistinguishable from a failed read. The sentence is printed.
- [x] AI5. **The level-up notice's only way off did not look like a control.** It is a button.
- [x] AI6. Two seeds from the orchestrator's own look were measured and dismissed: the Research
      door is lit on its page, and there is no browser checkbox on the desk.

Reported, not changed: `/game/overseer`, `/game/garage` and `/game/scrapyard` light no door
(there is none to light; a design call); the missions board at 1280x720 puts "Send a crew" at the
foot of a card taller than the first screen; the ALL CITIES view has two controls for the way back
(deliberate, per its own comment); the late-game fixture queues an upgrade on a Quarters it does
not carry.

The second half:

- [x] AI7. **Seven screens drew their loading and failure states under the top bar.** The market,
      offers, the black market, the workshop, the scrapyard, the garage and the gym returned a
      bare `ScreenLoad` into the outlet at the top of the frame, behind the opaque standing bar: a
      failed read drew a blurred district and nothing else. Settings drew "Pulling your file" for
      every state that was not data. A `ScreenLoadSheet` in `PageShell` puts both states on the
      sheet where the screen would be, and all eight use it.
- [x] AI8. **The training sheet cut its last row through the digits.** The sheet is a scroller
      and can never fit at every size (455px of rows against 187 at 1024x768), so its height snaps
      to a whole row and prints "Scroll for N more drills" under it, the character select's own
      move; gated at every viewport by a whole-row sweep.
- [x] AI9. **The battle pane kept its scroll offset** between fights, so the next fight opened
      halfway down its page; the report's side heading cut a crew's name mid-word.
- [x] AI10. **The leaderboard's faction column had two left edges**, the badge slot now
      reserved; the console's fog list named every unclaimed plot "Player District", now I, II
      and III through the map's own rule.
- [x] AI11. **Your own listing on the offers board was below the fold** behind the empty
      composer; listings first, composer under. The character select's bios were clamped
      mid-word on the one screen where you choose on the description; the whole bio is on the
      hover. The settings' twelve mark glyphs wrapped to an orphan; two rows of six.

Reported, not changed: the messages fixture's unread count disagrees with its rows; the satchel's
"Blueprints, no pages" door sits over a "Blueprint" panel (two item kinds share the word); the
Garage page is two one-line panels over empty sheet since the machines moved; the faction log and a
seat's file print ISO dates; the notifications screen's two controls wear two type registers; the
faction founding sheet does not close on Escape (an inline sheet, not a Modal); the drill dialog's
"Already in a session" says nothing about what to do; a finished fight's report carries no date;
the scrapyard rail repeats one sentence six times.

## AJ. Raiding another crew's district (2026-09-09)

The board's rules, as built (by agent, reviewed; one follow-up on the production channel):

- [x] AJ1. **Their name over their district.** Visiting a residential district prints its display
      name on the same brass plate the standing bar draws your own crew's name on.
- [x] AJ2. **A home is shut.** A residential district with a resident counts as shut, so the only
      fight that can be called on somebody's home while their Gate stands is at the gate. Before
      this a home had no gate in the rules at all: the plates offered fights the server refused.
      The gate's defence reads the resident's own Gate level, as it already did.
- [x] AJ3. **A breach lasts a day.** 24 hours, one reader (`gateIsBroken`) everywhere.
- [x] AJ4. **One raid, not a fight per building.** The `building` target is gone; inside a breach
      the only target on a home is the district itself. Migration 0087 rebuilds the battles table
      (every row rewritten, history included, under the original name so the two child tables'
      references survive the rebuild; the migration test plants a row in each child).
- [x] AJ5. **What a won raid does.** A quarter of every stored line except caps, in the raid
      priority order, bounded by what the force can carry; the district disrupted for six hours
      (production down 25% on the settle's walk, and the same 25% off every positive percent bonus
      the crew holds, 36 channels, production itself exempt so it is not cut twice, the exemption
      pinned by a literal after a mutant slipped through the derived list); and three standing
      structures damaged, tallest first, as a building fight did. The report and the bell read
      "a raid on <district>".
- [x] AJ6. **The visited screen has one call**: Break the gate while it stands, Raid the district
      with the time left while it is down; the plates open an information-only dialog.

Left for the board: the disruption's bonus cut is read at the moment of the settle while
production is cut per segment, so a settle spanning the expiry is exact on production and all or
nothing on the bonuses; the storage ceiling is among the channels cut (a raided crew's store is
tighter for six hours), which reads as intended but is a call.

## AK. Bonuses that change a rule (2026-09-09)

The board's brief: bonuses and labels across the units and the one-time bonuses that add or change
something rather than scale a number. The inventory first (by agent): unit modifiers 100% percent,
crew perks 92%, officer channels 85%, faction cards 100%, research rungs 92%, location bonuses 87%;
the milestones and the three unit rules were the only rule-shaped bonuses in the game. Twelve new
kinds, each honoured end to end and each with a mutant watched failing:

- [x] AK1. **Unit marks**: Opening Volley (35% of a round fired before the exchange: Snipers,
      Crimson Dancer), Holds the Line (cannot rout over half strength: Wardens, the Saint), Wall
      Breaker (cuts the defender's fortification by up to 40% at a quarter of the line:
      Demolishers, Colossus), Runs in Packs (0.6 offense per other body of the same unit, capped
      at 25: Cyberhounds, the Condemned), Picks the Field (12 flat load per body after the carry
      percentage: Scavengers, Ash Walkers).
- [x] AK2. **Holdings, perks and rungs share seven kinds**: a flat road cut in minutes (Tram
      Depot 4, a perk 3, a rung 2), porters fight at half strength, anything can be put on a
      machine (the one counter to a legend holding a column to 15), a named unit granted a mark
      (a location, a perk and a rung each grant one), steady nerve (the morale cascade cut, the
      line still breaks from its own losses), a second scouting party, and a structure priced a
      level lower (worth a constant 28% of the bill).
- [x] AK3. **A bug the pass found**: the Lab's effect fold ended in a count merge that read a
      boolean as an empty record, so every crew held all three permissions and no readout showed
      it. Fixed with a boolean arm and pinned.

Left for the board: twelve kinds is the floor of the range asked for; a second trap per fight and a
free defensive garrison are designed but not built (one needs the report's trap note to become a
list, the other the survivors ledger to skip stacks nobody owns); workshop refits still move only
numbers, the rule-changing refits arriving as rungs and holdings instead.

## AL. The board's notes on the crew and the market (2026-09-09)

- [x] AL1. **Every crew card the same height.** With the people first, a vacancy in a row of its
      own had shrunk to the chair drawing while one beside a portrait stood at the portrait's
      height. The rows are one height (`auto-rows-fr`); the gate reads every card rather than
      the leanest.
- [x] AL2. **A benched officer carries an Assign door.** The card's footer has a drawn button
      that opens their file with the chair list in it; the picture still opens the file too.
- [x] AL3. **The market, again.** The tape under the tabs is gone with its stylesheet and the
      gate exemption it needed. The hours line and the In / Back in chip left the Runner's head,
      since the standing note on the tab row carries both. The Broker's rows spread down the
      column and the tiles take their full size on a screen 800px tall or more, so the counter is
      filled rather than huddled on its centre line. The supply run is one line, three parts with
      a hairline between each: the material, how many, the price with the button on it; it wraps
      whole at 1280 wide.
- [x] AL4. **Faction Offers.** The tab reads Faction Offers, and the board's note is on the tab
      row as "How Faction Offers Work", two sentences.
- [x] AL6. **Typing a count.** The number field is a text input with a numeric keypad holding a
      draft while it has focus: it can be emptied, an exact figure typed, a leading zero is never
      kept, the figure opens selected so the first key replaces it, the ceiling holds while typing
      and the floor waits for the field to be left. It is sized to six digits in tabular figures
      rather than to the number in it, and the supply run's two figures sit in seven-character
      slots, so a count growing from 1 to 123,456 moves nothing beside it (measured: the Buy
      button's box before and after). The run's column took more of the width so the line holds
      at 1440.
- [x] AL7. **The board's second set of notes.** The Runner's hours chip sits on the Runner's
      own head, right-aligned beside the last visit; the offers page prints no verdict badge and
      offers no item slot (materials only; the wire keeps items so a listing is one shape); a crew
      may have five listings standing, not eight, pinned by a literal; the shelf's "How the shelf
      works" note is gone; the Research rail's caps box is gone (the standing bar prints the
      figure); the Bar's Your tables strip sits at the top left of the room, the note and the
      readouts keeping the foot.
- [x] AL5. A flaky gate found and fixed on the way: the market's washed-out sweep screenshotted
      the first sheet on the page, which is the loading sheet now and is replaced a frame later.
      It waits for the barrow.

## Gates

Nothing above counts as done until `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
and the e2e suite are green, and any screen that changed has been looked at in a screenshot.
