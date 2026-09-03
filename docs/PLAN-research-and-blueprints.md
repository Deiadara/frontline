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

- The role weights table stays server-side (B8/B8a). The mark is the coarse hint its own leak guard
  allows, so the server computes it and ships the letter; the scale lives in shared and cannot
  reconstruct anything without the weights. The guard scans text, so do not name the scoring
  function in `packages/shared` or `apps/client`, not even in a comment.
- Marks gate research (C2) and communicate progress. Nothing pays out from them: every bonus reads
  the score (C3b).

## Gates

Nothing above counts as done until `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
and the e2e suite are green, and any screen that changed has been looked at in a screenshot.
