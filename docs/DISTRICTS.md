# The districts

The world has five cities and they are at three different stages, which is worth knowing before
reading any of this.

| City     | Ground                                                    | Documented here |
| -------- | --------------------------------------------------------- | --------------- |
| Ashfall  | Eight contested and four plots, playable                  | Yes, first      |
| Terminus | Eight contested and four plots, playable                  | Yes, at the end |
| Arca     | Eight contested and four plots, playable since 2026-10-07 | Yes, last       |
| Redline  | None. A name, a nickname and a blurb                      | Nothing to say  |
| Deepcut  | None. A name, a nickname and a blurb                      | Nothing to say  |

Saltmarch, a three-district sketch, held Arca's row until 2026-10-06 and was dropped when the
maintainer chose to keep the world screen at five.

Redline and Deepcut exist so the world screen can show five places (maintainer, 2026-09-24). A city
can be a row in the list long before anybody draws its districts, and `atlas.test.ts` holds the one
rule that keeps that honest: a city with no ground may not be `open`. The city list itself is
`packages/shared/src/city/cities.ts`.

Nothing about a map is generated: a map is only worth learning if it is the same map tomorrow.

Ashfall's half of this file is written from `packages/shared/src/city/districts.ts`, and Terminus's
and Arca's from `packages/shared/src/city/atlas.ts`. If a page and its source disagree, the source is right.

## An id is the name on the tag

A district's id is the name a player sees on its tag, lowercased and hyphenated, with a leading
"The" dropped (maintainer, 2026-09-25). The Steelbelt is `steelbelt` and its page is
`/game/city/steelbelt`; the Blacksite is `blacksite`, the Annexes are `annexes`, the CCS is `ccs`.
A location keeps its district's id as its prefix and adds its own word, so the Kessler Press is
`steelbelt-press`.

Nothing in an id says which city it is in. It used to: every district in Terminus carried a `tm-`
prefix and every one in Saltmarch an `sm-`, and code that wanted the city read the first three
characters. `cityOf` in `atlas.ts` is the question those readers were actually asking, and it is
the only one that still answers.

The four plots in each city are the exception, because they have no tag name to take: a plot's tag
shows whoever lives there, or "Open ground" when nobody does. They keep the names they were
authored under, which is what the tables below print in brackets.

## Ashfall at a glance

Ashfall, "the Frontline", has twelve districts: eight contested holding 60 locations between them,
and four residential plots holding none.

## Two kinds of ground

**Residential** districts hold crews. A crew's own district is its base, the eleven structures of
GDD §A1. It can be raided but never captured, so nobody loses everything they built because they
were asleep. There are four of them and they hold no capturable locations.

**Contested** districts hold **locations**: a substation, a pawn shop, a war machine graveyard. Each
is held by somebody, each is takeable on its own, and each pays for as long as you keep it. Take
every location in a district and the district is yours, which pays again through that district's
unified bonus. There are eight of them, holding 60 locations between them.

**A faction holds a district together** (maintainer, 2026-10-07). The members between them need
every location; then every member is paid the unified bonus, the gate is armed for all of them,
and whatever a location pays stays with the member holding it. The named defender of a fight on a
faction-held gate is the member holding the most locations there (ties to whoever held theirs
longest). When a member leaves, is kicked, or the faction disbands, any district that was whole
only because of them stops being whole: its gate falls to level 1 with any raise dropped, and the
units mates had posted on their ground walk home. On the map, a district held whole by your crew
or your faction wears a green tag and your faction's emblem; one held whole by anybody else (another
crew, another faction, the looters or the Combine) wears a red tag and their mark; one nobody holds
whole stays grey and bare. Location tags read the same way for their holder.

**Five levels** (maintainer, 2026-10-06). Every location outside a crew's own district is worked up
from 1 to 5, not 10: each level is worth a whole multiple of the first (a Market pays 30, 60, 90,
120, 150 caps an hour), the kinds whose figure is a share of a fight climb a gentler ladder to four
times (`COMBAT_LEVEL_SCALE`), and Arca's authored figures carry their own written ladder. The
upgrade to level n costs and takes what the old upgrade to 2n did, so the last one is still 33.7
times the kind's figure. Captured gates outside the home district cap at 5 too, each level priced
and timed as two of the home Gate's and worth 5% of defence; the home district's own structures
keep their 20 levels.

Every unified bonus is deliberately something _other_ than what its own locations give, so a
district is worth finishing rather than worth farming its best hold. `city.test.ts` fails the suite
if a unified bonus repeats an effect kind already present inside its own district.

## Reading the map

`position` is normalized 0..1 and the renderer scales it to the viewport. **y = 0 is the top of the
frame**, so a lower `y` is further up the city.

The layout is a climb. Water and crews at the bottom (the Docks, Kettle Row, the Steelbelt: the
cheapest ground in the game), the Combine at the top, with the Combine Spire looking down the
middle of the frame from the highest point on it. Difficulty rises with height almost monotonically
across the contested districts, which `city.test.ts` pins as a rank correlation above 0.85, so "further up" and "harder" are the
same direction and a player can read the next rung off the map without opening anything. Distance
costs time: `geography.ts` charges 85 minutes per map unit, so the corner-to-corner journey is about
two hours before any travel bonus.

Allegiance reads across that climb, and since 2026-09-19 it reads as an occupation. The Combine
holds six of the eight contested districts: the water at the bottom (the Docks and the Steelbelt),
the fields on the left, and the whole centre-right climb through the Annexes and the Blacksite to
the Spire. Two are not its: Chrome Row, which is open ground with looters on its best four plots,
and the Undergrid, which the looters hold outright.

That is the shape of the game now. A crew starts in a city that has already been taken, and almost
every direction it can walk is Combine ground.

One caution for anyone editing the list: **order is the art seed**. `art/manifest.ts` seeds
`district-*` off each entry's index in `CITY_DISTRICTS`, so moving an entry renumbers the seed of
every district after it. The list stays in first-authored order and the two districts added later
are appended at the end rather than filed with their own kind. Read the map by `kind`, never by
position in the array.

## The city at a glance

In catalogue order, which is the order the array is authored in and the order the plot numbers
are handed out in. It is not map order and not difficulty order.

`Open` is how many of a district's plots start unoccupied. It is the number that decides whether
the district's gate is armed: one party holding all of it is what arms a gate, and a gate is the
only thing a crew can hit on shut ground. Chrome Row and Glasshouse Fields are the two ways in.

`Difficulty` is a number the server reads (garrison size, musters, spy counters, mission pay) and
no screen prints (maintainer, 2026-09-30). Plots have none, so their cell is empty.

| District                                     | Kind        | Held by                | Difficulty | Position (x, y) | Holds | Open | Leader          |
| -------------------------------------------- | ----------- | ---------------------- | ---------- | --------------- | ----- | ---- | --------------- |
| Neon Docks                                   | contested   | Combine                | 1          | 0.15, 0.9       | 7     | 0    |                 |
| Unclaimed Player District (`ashen-terraces`) | residential | independent            |            | 0.84, 0.62      | none  |      |                 |
| Unclaimed Player District (`kettle-row`)     | residential | independent            |            | 0.38, 0.82      | none  |      |                 |
| Steelbelt                                    | contested   | Combine                | 2          | 0.63, 0.83      | 7     | 0    |                 |
| Chrome Row                                   | contested   | looters                | 4          | 0.3, 0.62       | 8     | 4    |                 |
| The Undergrid                                | contested   | looters                | 5          | 0.55, 0.58      | 7     | 0    |                 |
| The Annexes                                  | contested   | Combine                | 6          | 0.76, 0.38      | 7     | 0    | The Syndic      |
| Glasshouse Fields                            | contested   | Combine                | 3          | 0.1, 0.58       | 8     | 2    |                 |
| Blacksite                                    | contested   | Combine, seat of power | 8          | 0.33, 0.3       | 8     | 0    | The Executioner |
| CCS                                          | contested   | Combine, seat of power | 10         | 0.57, 0.13      | 8     | 0    | Directive Xero  |
| Unclaimed Player District (`upper-roofs`)    | residential | independent            |            | 0.91, 0.79      | none  |      |                 |
| Unclaimed Player District (`south-quay`)     | residential | independent            |            | 0.78, 0.93      | none  |      |                 |

## The Combine

Six districts, one regime, and four units that are never yours: the **Civic Levy** (conscripts with
surplus blades), the **Greycoats** (government infantry), the **Street Enforcers** (riot plate and
shock batons) and the **Suppressors** (a belt-fed gun on a tripod). They live in
`packages/shared/src/units/catalog.ts` behind `UnitSpec.faction`, which is what keeps them off
every roster, every muster bench, the census, the Scrapyard and the balance sheet.
`units/faction.test.ts` sweeps every feat, every mission and every blueprint to prove no content
path can put one on a player's books.

Which units stand where is `combineGarrison` in `packages/shared/src/city/combine.ts`, and it steps
with difficulty: Levy on the Docks, Greycoats behind them, Enforcers from the Annexes, Suppressors
from the Blacksite, all three in the CCS. How _many_ is `combineSlotBudget`, and it is measured in
**unit slots** rather than bodies, which matters: a Suppressor is four slots and a Levy is one, so
counting heads made the Blacksite four times the army the Annexes was at two rungs' difference.

The looters stand on the same budget (maintainer, 2026-09-29), in their own Razors and Scrapers
(`looterGarrison`), and a muster called out by a declaration is the same share of it for either
party. So a district's difficulty is one number whoever holds it: before, looters were a head count
on a flatter line of their own, and Chrome Row at 4 and the Undergrid at 5 fell to 20 Razors while
the Glasshouse Berm at 3 wanted 40. Measured on the real settle after the change (smallest Razor
column taking the district's hardest ordinary plot 9 fights in 12, leaders dead; pinned as a climb
by `apps/server/src/city/difficulty-ladder.test.ts`; re-walked 2026-10-01 after the Greycoat
went to 112 offense and the Suppressor to 400, which moved the Glasshouse and the Blacksite only,
and again 2026-10-02 after "outnumbered" started counting unit slots, which raised everything from
difficulty 6 up; the two top mixes were re-shared that day to keep the climb, 7 and 8 to 60%
Enforcers and 40% Suppressors, 9 and 10 to 10% Greycoats, 35% Enforcers and 55% Suppressors;
and again 2026-10-05 after morale started reading wounds, which lifted 7 and 8 a rung each and left
9 and 10 level with them, so 9 and 10 went to 5% Greycoats, 30% Enforcers and 65% Suppressors):

| District          | Holder, difficulty | Hardest ordinary plot         | Razors |
| ----------------- | ------------------ | ----------------------------- | ------ |
| Neon Docks        | Combine, 1         | `neon-docks-cranegate`        | 10     |
| Coldwater Halt    | looters, 1         | `coldwater-halt-signal`       | 14     |
| Steelbelt         | Combine, 2         | `steelbelt-bonefield`         | 20     |
| Ironmouth         | looters, 2         | `ironmouth-arches`            | 20     |
| Glasshouse Fields | Combine, 3         | `glasshouse-fields-berm`      | 24     |
| Marshalling Yards | looters, 3         | `marshalling-yards-signalbox` | 34     |
| Chrome Row        | looters, 4         | `chrome-row-cathode`          | 48     |
| Bonded Row        | looters, 4         | `bonded-row-crated`           | 57     |
| The Undergrid     | looters, 5         | `undergrid-lair`              | 68     |
| Telemetry Hill    | Combine, 6         | `telemetry-hill-array`        | 114    |
| The Annexes       | Combine, 6         | `annexes-scaffold`            | 114    |
| Viaduct           | Combine, 7         | `viaduct-archnineteen`        | 272    |
| Blacksite         | Combine, 8         | `blacksite-pile`              | 323    |
| Last Platform     | Combine, 9         | `last-platform-armoury`       | 323    |
| Blockhouse        | Combine, 10        | `blockhouse-chapel`           | 457    |
| CCS               | Combine, 10        | `ccs-armory`                  | 384    |

With its leader standing, a coarser walk (a root of two between rungs) read the Annexes at 113, the
Blacksite at 226 and the CCS past 320 before the 2026-10-02 re-walk, and was not re-taken then: the
leaders are a second climb on top of the garrison, and the figures above it moved up.

### The three who run it

Each commands a district and stands on exactly one plot in it. His power covers every Combine
defence in his district while he lives; his body fights only where it stands. Take that plot and he
is dead for the whole world, and the district fights without them from then on.

| Leader          | District  | Stands on         | What they are worth                                                                                                                                                                                             |
| --------------- | --------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Syndic      | Annexes   | Annexe Uplink     | Standing Orders: +25 penetration and +25 armour to the Combine's own line in the Annexes. Nothing at all on the sheet of whoever is sent against it. She is the one woman among the three.                      |
| The Executioner | Blacksite | Blacksite Armory  | Any attacking unit brought down to 30% of its vitality is finished where it stands, and what it had left is lost.                                                                                               |
| Directive Xero  | CCS       | The Chosen Chapel | His side fights at 100 morale and cannot be intimidated, and the attackers who would have been intimidated change sides and fight for him, for that fight only. After it they are dead, on a plot as at a gate. |

Directive Xero is the wall the whole map climbs towards. Measured on 2026-09-20 against a crew mix
sized in unit slots: the CCS wants about 230 slots to take a plot without him, and more than 400
with him, because Change of Heart turns the part of your line that §D3 would have silenced into
part of his. The report counts his turncoats in Died, and so do the Bone Market's refund and the
flawless-win feats, with a line of its own saying how many he turned (maintainer, 2026-09-29).

## Contested districts

### Neon Docks

`neon-docks`, called the Docks. Difficulty 1 of 10, Combine ground, at 0.15, 0.9 on the map.

Container stacks and a waterfront the Combine stopped patrolling years ago. Cheap ground, and far enough from the spire that nobody important looks at it.

The starter target. Difficulty 1, seven cheap holds, and close enough to the residential plots that a new crew’s first campaign is a real one rather than a march. It used to be the starter _home_; it was opened up as contested ground so that there would be something a first crew could actually take.

Garrison before anybody takes it: a thin line of Civic Levy with surplus blades.

**Unified bonus, The Whole Waterfront:** 12% off market prices, for holding every location in the district.

| Location            | Kind              | What holding it pays                                                                                                 |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| The Tideline Market | Market            | A cut of everything that changes hands.                                                                              |
| Dockside Pumphouse  | Water Works       | Supplies, because clean water is most of what growing it takes.                                                      |
| Runners' Tunnel     | Smuggler's Tunnel | Every crew you send anywhere is back sooner. There is a shorter way and you own it.                                  |
| The Wet Galley      | Soup Kitchen      | Supplies off the ration line, and a crew that has eaten fights like one.                                             |
| The Moored Barges   | Fence Camp        | More people than any building in your district could house, and every one of them looking for a reason to be useful. |
| Crane Site          | Watchtower        | Everything your spies do, they do better: everywhere in the city, not just here.                                     |
| The Chandlery       | Pawn Shop         | A smaller cut, and a fence who moves what a raid brings back.                                                        |

### Steelbelt

`steelbelt`, called the Belt. Difficulty 2 of 10, Combine ground, at 0.63, 0.83 on the map.

Rolling mills, press houses and a furnace row that has not gone cold in thirty years. The Combine holds every works on the Belt and keeps the gate shut behind them, and the crews who work it clock in under Greycoat guns.

Working industry, not a scrapyard: presses on shift, furnaces lit, a pump row selling to the hauliers. The id is still `steelbelt` because every location id and every saved control row is keyed on it.

Garrison before anybody takes it: Civic Levy with a squad of Greycoats behind them.

**Unified bonus, Run of the Belt:** 2% off what mustering units costs, for holding every location in the district (it was 10 until the general muster cuts were cut, 2026-10-01).

| Location           | Kind                  | What holding it pays                                                                                                   |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| No. 4 Press House  | Scrap Press           | Scrap, steadily, for as long as you hold it.                                                                           |
| The Breaker's Yard | War Machine Graveyard | Hulls, plate and running gear, a gantry that will lift anything, and troops that come back from more than they should. |
| Toolhouse Pawn     | Pawn Shop             | A smaller cut, and a fence who moves what a raid brings back.                                                          |
| The Slag Bowl      | Skate Ground          | Everything you field moves faster.                                                                                     |
| Furnace Row Pumps  | Gas Station           | Oil out of the ground, and the scrap off everything anybody abandoned on the forecourt.                                |
| The Doghouse       | The Doghouse          | Working dogs, augmented, and handlers who have done this before.                                                       |
| The Shift Canteen  | Soup Kitchen          | Supplies off the ration line, and a crew that has eaten fights like one. The Bone Market went to Arca (2026-10-06).    |

### Chrome Row

`chrome-row`, called the Old City Center. Difficulty 4 of 10, independent ground, at 0.3, 0.62 on the map.

What is left of downtown: bank halls turned into markets, a picture house that never closed, and a transmitter mast nobody has managed to hold for a whole season.

The old downtown. Eight holds, the widest spread of kinds on the map, and the district a crew usually takes second.

Garrison before anybody takes it: the looters on the plots they squat. The district screen counts
them rather than promising a sentence (maintainer, 2026-09-30).

**Unified bonus, The Row Runs For You:** missions run 10% faster, for holding every location in the district.

| Location                    | Kind              | What holding it pays                                                                          |
| --------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| The Exchange                | Downtown Market   | Every trade in the city is quoted to you at a better number than to anybody else.             |
| Cathode Tower               | Broadcast Tower   | Your name arrives before your people do.                                                      |
| The Overlook                | High Ground       | Everything you hold in this city is harder to take off you.                                   |
| Saint Ferrous               | Hospital          | What comes back from a fight comes back in better shape.                                      |
| Statue of the Revolutionary | Statue in a Plaza | It is what they are fighting for. A crew that holds it walks into a fight harder to frighten. |
| The Regal                   | Cinema            | Two hours somewhere else. A crew that gets that fights differently the next day.              |
| The Cracked Anvil           | Downtown Tavern   | A room where the city’s hardest people drink, and somebody who can introduce you.             |
| Coin-Op Row                 | The Arcade        | Reflex work disguised as an evening off. Recruits come off the bench quicker.                 |

### The Undergrid

`undergrid`, called the Power Spine. Difficulty 5 of 10, looter ground, at 0.55, 0.58 on the map.

The Combine meters the whole undercity from down here. Bundled conduit running the walls like roots, transformer housings the size of buildings, and older tunnels underneath that are on nobody’s drawings.

The Combine’s metering floor for the whole undercity, and the one district the looters hold outright: every plot squatted and the gate shut.

Garrison before anybody takes it: the looters on the plots they squat. The district screen counts
them rather than promising a sentence (maintainer, 2026-09-30).

**Unified bonus, Hand on the Power Spine:** building runs 12% faster, for holding every location in the district.

| Location             | Kind                 | What holding it pays                                                                     |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Undergrid Substation | Substation           | Fuel by the drum, off the standby tanks nobody has come back to meter.                   |
| Transformer Vault 9  | Substation           | Fuel by the drum, off the standby tanks nobody has come back to meter.                   |
| The Weeping Junction | Sewer Junction       | Your people can get places without being seen getting there.                             |
| Reagent Works        | Chemical Plant       | Oil, cracked on site.                                                                    |
| The Old Customs Run  | Smuggler's Tunnel    | Every crew you send anywhere is back sooner. There is a shorter way and you own it.      |
| Lamplight Depot      | Tram Depot           | The city gets smaller. Everything you send anywhere leaves sooner and arrives faster.    |
| The Laundry Stair    | Mad Scientist's Lair | Everything needed to make something that should not exist, and the notes explaining how. |

### The Annexes

`annexes`, called the Tech District. Difficulty 6 of 10, Combine ground, at 0.76, 0.38 on the map.

Faculty buildings the Combine never closed, because it was easier to move in. Everything worth knowing in this city is written down somewhere in here.

The university the Combine moved into instead of closing. Research, optics and signal, plus the only construction crane outside the Spire.

Garrison before anybody takes it: Greycoats with Street Enforcers on the corners.

**Unified bonus, The Faculty Answers To You:** +20% unit stealth, for holding every location in the district.

| Location               | Kind              | What holding it pays                                                                       |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| The Faculty Annexe     | University        | Every research project finishes sooner.                                                    |
| Annexe Uplink          | Satellite Uplink  | What goes over the air in this city, your spies have already read.                         |
| The Quiet Ward         | Gene Clinic       | Work can be done on people here that cannot be done anywhere else.                         |
| Cold Row               | Foundry           | High-quality metal. Nothing else in the city makes it in quantity.                         |
| The Orrery             | Planetarium       | A room built for thinking in, and an optical bench worth more than the building around it. |
| Nine Roofs             | Pirate Radio      | You hear what the city is saying, and some of what it would rather not.                    |
| The Unfinished Faculty | Construction Site | Lifting gear nothing else in the city has. Some things can only be assembled standing up.  |

### Glasshouse Fields

`glasshouse-fields`, called the Green Belt. Difficulty 3 of 10, Combine ground, at 0.1, 0.58 on the map.

State hydroponics behind a fence. Everything the undercity eats is grown here, and none of it is sold here.

State hydroponics on the western flank. Government ground, but the softest of it: difficulty 3, and the usual way in for a crew that is not ready for the Undergrid.

Garrison before anybody takes it: Civic Levy with a squad of Greycoats behind them.

**Unified bonus, The Green Belt Is Fed:** mustering runs 15% faster, for holding every location in the district.

| Location             | Kind         | What holding it pays                                                                                                             |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Glasshouse Intake    | Water Works  | Supplies, because clean water is most of what growing it takes.                                                                  |
| Fieldgate Market     | Market       | A cut of everything that changes hands.                                                                                          |
| The Berm             | High Ground  | Everything you hold in this city is harder to take off you.                                                                      |
| Hauler Yard          | Rail Yard    | Bogies, axles and drive parts by the wagonload: everything the garage has been improvising.                                      |
| The Long Ladle       | Soup Kitchen | Supplies off the ration line, and a crew that has eaten fights like one.                                                         |
| Chapel of the Furrow | The Chapel   | Everyone on your books holds together better under things that break people, and nobody runs because the person beside them did. |
| The Fence Camp       | Fence Camp   | More people than any building in your district could house, and every one of them looking for a reason to be useful.             |
| The Glasshouses      | Hydroponics  | Supplies straight off the beds, picked before they ever see a market.                                                            |

### Blacksite

`blacksite`, called the Military District. Difficulty 8 of 10, Combine ground and a seat of Combine power, at 0.33, 0.3 on the map.

Hardened ferrocrete, layered berms, and a Combine rifle company that has never had to leave. The first place anyone learns not to walk into.

A seat of Combine power (`seatOfPower: true`), so taking it counts as replacing the Combine rather than robbing it.

Garrison before anybody takes it: Street Enforcers behind Suppressor positions.

**Unified bonus, The Garrison Is Yours:** +15% unit offense, for holding every location in the district.

| Location         | Kind                    | What holding it pays                                                                                                   |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Blacksite Armory | Armory                  | Cheaper units, and a bench that will fit anything you can find a part for.                                             |
| Outer Berm       | Barricade               | A harder approach to everything behind it, held by people who will not leave it.                                       |
| The Watchtower   | Watchtower              | Everything your spies do, they do better: everywhere in the city, not just here.                                       |
| Robot Pit        | Fight Pit               | Your people are harder to frighten, and everybody on the books can hold a line, porters included.                      |
| Motor Pool       | War Machine Graveyard   | Hulls, plate and running gear, a gantry that will lift anything, and troops that come back from more than they should. |
| The Drill Hall   | The Gym                 | One more session in the day than the day has room for.                                                                 |
| Psychic Ward     | Black Clinic            | Syringes. Handed out before a fight, they bring somebody back to strength who had no right to be.                      |
| The Pile         | Abandoned Nuclear Plant | High-quality metal out of the turbine hall, and a fuelling crew who make every barrel of oil you burn go further.      |

### CCS (Civic Command Sector)

`ccs`, called the Spire. Difficulty 10 of 10, Combine ground and a seat of Combine power, at 0.57, 0.13 on the map.

The surface spire the government rules from, and the household guard that has never been tested. Taking this is not a raid. It is the end of something.

The last district in the game. The other seat of power, difficulty 10, at the top of the frame.

Garrison before anybody takes it: Suppressors, Enforcers and Greycoats, and whatever the spire can wake.

**Unified bonus, The Spire Is Taken:** one level of **ANTI-COMBINE** (+10% damage and vitality against the Combine) for holding every location in the district (maintainer, 2026-10-07: every city's last district pays this, and the levels stack to +30%). It was 20% off market prices until then.

| Location                | Kind              | What holding it pays                                                                                               |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Command Uplink          | Satellite Uplink  | What goes over the air in this city, your spies have already read.                                                 |
| Combine Armory          | Armory            | Cheaper units, and a bench that will fit anything you can find a part for.                                         |
| The Household Barricade | Barricade         | A harder approach to everything behind it, held by people who will not leave it.                                   |
| Command Broadcast       | Broadcast Station | Everyone on your books gets better at the half of the job that is talking to people.                               |
| The Ascension Clinic    | Gene Clinic       | Work can be done on people here that cannot be done anywhere else.                                                 |
| The Unfinished Wing     | Construction Site | Lifting gear nothing else in the city has. Some things can only be assembled standing up.                          |
| The Martyrs’ Ground     | Graveyard         | Holding this ground says something the city does not forget, and what is buried here was buried with its rings on. |
| The Chosen Chapel       | The Chosen Chapel | Your name walks in ahead of your people, and nobody you send out is frightened of anything that lives here.        |

## Residential districts

Four plots, where crews live. They hold no locations, they cannot be captured, and they can be
raided by anybody but their own resident. They differ only in where they sit. A plot has no
difficulty (maintainer, 2026-09-30): what stands behind its gate is whatever its crew built, so no
number authored against the ground could say how hard it is to hit, and none is shown to players.
An unclaimed plot opens as a window over the city map rather than as a screen of its own.

### `ashen-terraces`

At 0.84, 0.62. No capturable locations.

Stepped tenements up the northern slope, burnt once and rebuilt out of what was left. Whoever holds it can see the whole city coming.

### `kettle-row`

At 0.38, 0.82. No capturable locations. The starter district: every new crew is settled here.

A long terrace along the southern cut, boilers venting into the street. Warm, loud, and nobody asks where anybody came from.

### `upper-roofs`

At 0.91, 0.79. No capturable locations. Home of the seeded AI rival.

Roofs stacked on roofs above the wall, reached by ladders somebody bolted on in the dark. Nothing official has been up here in years and the view is the whole northern approach.

### `south-quay`

At 0.78, 0.93. No capturable locations.

The tail of the market where the stalls give out and the cut comes back up to meet the street. Damp, cheap, and out of everybody else’s way.

### What a plot is called

All four are stored under the name `Unclaimed Player District` and a claimed one is never drawn
under it. `districtDisplayName` decides what a screen says: a plot answers with the name of the crew
living on it, yours or anybody's, and an empty one with `Unclaimed Player District` (maintainer,
2026-10-06). Until then the other plots were numbered `Player District I`, `II`, `III` to keep a
stranger's crew name off the map; the ruling is that a claimed plot is simply that crew's. The
empty plot's name is reserved: a crew cannot call itself `Unclaimed Player District`.

`kettle-row` is the starter district (`STARTER_DISTRICT_ID`) and `upper-roofs` is where the seeded
AI rival lives (`BOT_DISTRICT_ID`). Neither is arbitrary. A starter home has to be ground nobody can
take, and it has to sit low and left so that the Spire reads as the far side of the city: from Kettle
Row, downtown is 18 minutes away and the Spire is 61. The rival is never the starter district, or
the rival would be the player's landlord.

## Locations that gate units

A location kind can be the requirement on a unit, authored on the unit rather than on the map
(`units/catalog.ts`). This is the main reason a specific hold is worth taking rather than any hold of
similar value, and why renaming ground has to leave its `kind` alone.

| Unit                              | Needs a hold of kind                 | Where that kind exists                                        |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Cyberhounds                       | `doghouse`                           | The Doghouse, Steelbelt (the only one in the city)            |
| Juggernauts, Hollow Men           | `gene_clinic`                        | The Quiet Ward (Annexes), The Ascension Clinic (Spire)        |
| The Condemned, The Crimson Dancer | `fight_pit`                          | Robot Pit, Blacksite                                          |
| The Specter                       | `satellite_uplink`                   | Annexe Uplink, Command Uplink                                 |
| The Abomination                   | `mad_scientist_lair`                 | The Laundry Stair, Undergrid                                  |
| The Colossus                      | `construction_site`                  | The Unfinished Faculty (Annexes), The Unfinished Wing (Spire) |
| The Saint                         | `tavern`                             | The Cracked Anvil, Chrome Row; the Wake House, Gravefields    |
| Death Cloaks                      | `mausoleum`                          | One in every Arca district                                    |
| The Loose End                     | `rail_yard`                          | Hauler Yard, Glasshouse Fields                                |
| The Cartographer                  | `rail_yard` + `satellite_uplink`     | Glasshouse Fields plus the Annexes or the Spire               |
| Twins                             | `mad_scientist_lair` + `gene_clinic` | The Undergrid plus the Annexes or the Spire                   |

## Where this comes from

| What                                              | File                                    |
| ------------------------------------------------- | --------------------------------------- |
| The district list, unified bonuses, display names | `packages/shared/src/city/districts.ts` |
| Location kinds, hold bonuses, upgrade ladders     | `packages/shared/src/city/locations.ts` |
| Travel time                                       | `packages/shared/src/city/geography.ts` |
| The city list                                     | `packages/shared/src/city/cities.ts`    |
| Environment labels per location kind              | `packages/shared/src/city/labels.ts`    |
| Mission boards per district                       | `packages/shared/src/missions.areas.ts` |
| The gradient, spacing and naming tests            | `packages/shared/src/city/city.test.ts` |

---

# Terminus

`terminus`, "the End of the Line". The second city, and the first one built to Ashfall's size:
**twelve districts, eight contested holding 60 locations between them, and four residential plots**.

It was authored as **Verge Station** in `packages/shared/src/city/atlas.ts` with three contested
districts and no server behind it. It was renamed and grown out on 2026-09-24. Three renames went
with that, and nothing was deleted:

| Was                                       | Is now                             |
| ----------------------------------------- | ---------------------------------- |
| The city `verge-station`                  | The city `terminus`                |
| The city nickname "the Last Platform"     | "the End of the Line"              |
| The district The Terminus (`vs-terminus`) | The district **The Last Platform** |

The nickname had to move because the district took the name. A city and its seat of power cannot
both be called the Last Platform on the same screen.

Built as a rail junction and abandoned as one, Terminus is where the Combine still keeps real
soldiers, because it is the only road out of the frontier. Where Ashfall is a city that was taken,
Terminus is a city that is still being held, and the difference shows in what there is to fight
over: not a power spine and a tech park, but a line, and everything the line needs to run.

## The railway

The city's one trait, and the reason to live here rather than in Ashfall.

**The line.** Seven of the eight contested districts hold exactly one **Station**, a new location
kind. Telemetry Hill does not: the line does not climb the ridge, which is the whole point of the
Hill being the odd district out.

**The link.** Hold the Station in two districts and you **may choose** to put a journey between them
on the train: a flat **15 minutes** on the rails, whatever the map says the distance is. It is a
rule rather than a slider: `travel_speed` bonuses are a percentage of a clock, and this replaces the
clock, so a Rail Yard cannot make a linked run faster and nothing can make it slower.

**What rides, and what does not** (maintainer, 2026-09-24). The railway carries **unit moves and
battle columns**, and nothing else. Both halves are built: a move between the crew's own places
(`moves/moves.ts`) and a column on its way to a declared fight (`battle/movement.ts`) each take a
`byRail` flag and each go through `city/railway.ts`, so the two cannot come to different answers
about the same journey. It does not count for missions, and it does not count for
spy jobs: those are crews sent out to work the ground rather than to arrive somewhere, and a
mission board priced off a railway would be pricing the wrong thing. **Vehicles and the Colossus
cannot board.** There is no flat bed on this line, so a column taking its machines is a column
walking, and that is a refusal rather than a penalty.

**The two ends are walked.** The fifteen minutes buys the middle leg only. A journey is the road
from where the units are to the platform they board at, plus fifteen, plus the road from the
platform they get off at to where they are going. Board at home and get off at your destination and
those two legs are nothing, which is the common case and the reason a Station is worth taking in the
district you actually work in. Telemetry Hill has no platform, so a journey that ends there always
pays a walk off the far platform, and that walk is what stops the Hill being fifteen minutes from
anywhere.

For scale, `geography.ts` charges 85 minutes per map unit, so the corner to corner walk across
Terminus is about two hours. Two held Stations turn that into fifteen minutes plus whatever the two
walks come to.

**The network.** Any two Stations you hold are linked, not only neighbouring ones, because a train
runs the whole line. A crew holding Coldwater, Bonded Row and Platform One moves between all three
at fifteen minutes. Lose one and that node drops out; the others still link to each other.

**The counterplay.** A Station is one location, not a district. A rival does not have to break your city to break your railway, only to
take one platform, which is what makes the line the thing Terminus crews actually fight over.

## The city at a glance

In catalogue order. `Open` is how many of a district's plots start unoccupied, which is what decides
whether its gate is armed. Coldwater Halt and Bonded Row are the two ways in.

| District                                 | Kind        | Held by                | Difficulty | Position (x, y) | Holds | Open | Station |
| ---------------------------------------- | ----------- | ---------------------- | ---------- | --------------- | ----- | ---- | ------- |
| Coldwater Halt                           | contested   | looters                | 1          | 0.08, 0.9       | 7     | 3    | yes     |
| Ironmouth                                | contested   | looters                | 2          | 0.22, 0.8       | 7     | 0    | yes     |
| The Marshalling Yards                    | contested   | looters                | 3          | 0.34, 0.7       | 7     | 0    | yes     |
| Unclaimed Player District (`carriage`)   | residential | independent            |            | 0.14, 0.64      | none  |      |         |
| Bonded Row                               | contested   | looters                | 4          | 0.47, 0.6       | 8     | 3    | yes     |
| Unclaimed Player District (`watertower`) | residential | independent            |            | 0.38, 0.88      | none  |      |         |
| Telemetry Hill                           | contested   | Combine                | 6          | 0.62, 0.34      | 7     | 0    | no      |
| The Viaduct                              | contested   | Combine                | 7          | 0.58, 0.48      | 8     | 0    | yes     |
| Unclaimed Player District (`embankment`) | residential | independent            |            | 0.7, 0.84       | none  |      |         |
| The Last Platform                        | contested   | Combine, seat of power | 9          | 0.8, 0.34       | 8     | 0    | yes     |
| The Blockhouse                           | contested   | Combine, seat of power | 10         | 0.9, 0.16       | 8     | 0    | yes     |
| Unclaimed Player District (`signalrow`)  | residential | independent            |            | 0.94, 0.56      | none  |      |         |

The layout is a climb west to east along the line, bottom left to top right, so difficulty and
height run the same direction the way they do in Ashfall. Telemetry Hill is the one inversion: it
sits higher than the harder Viaduct because it is literally a hill, off the line and above it.

## Contested districts

### Coldwater Halt

`coldwater-halt`, called the Halt. Difficulty 1 of 10, independent ground, at 0.08, 0.9 on the map.

A request stop on the flats at the west end, where the line crosses forty miles of nothing. The
train stops here because there is a town, and there is a town because the train stops here.

The starter target, and the cheapest ground in the city. Three open plots and no gate, so a first
crew's first campaign is a fight against whoever else wants it rather than against a wall.

Garrison before anybody takes it: nobody official. A stationmaster with a shotgun and whoever owes
him.

**Unified bonus, Everything Off the Train:** +15% loot capacity, for holding every location in the
district. Whoever owns the platform decides what comes off it, so every crew you send anywhere
comes back carrying more.

| Location           | Kind         | What holding it pays                                                                                                 |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Coldwater Platform | Station      | The first stop on the line. Linked to any other Station you hold, at fifteen minutes flat.                           |
| The Halt Market    | Market       | A cut of everything that changes hands.                                                                              |
| The Standpipe      | Water Works  | Supplies, because clean water is most of what growing it takes.                                                      |
| Trackside Kitchens | Soup Kitchen | Supplies off the ration line, and a crew that has eaten fights like one.                                             |
| The Fuelling Point | Gas Station  | Oil out of the ground, and the scrap off everything anybody abandoned on the forecourt.                              |
| Tent Row           | Fence Camp   | More people than any building in your district could house, and every one of them looking for a reason to be useful. |
| The Distant Signal | Watchtower   | Everything your spies do, they do better: everywhere in the city, not just here.                                     |

### Ironmouth

`ironmouth`, called the Cutting. Difficulty 2 of 10, looter ground, at 0.22, 0.8 on the map.

The west tunnel mouth, where the line goes under the ridge. A town grew in the cutting either side
of it and then grew into it: the ventilation shafts are streets, and the bricked arches are houses.

Looter ground, and the reason is simple. People who live inside a hill are hard to get out of it,
and the Combine decided a long time ago that it was not worth the company it would cost.

Garrison before anybody takes it: the looters on the plots they squat. The district screen counts
them rather than promising a sentence (maintainer, 2026-09-30).

**Unified bonus, Nobody Digs You Out:** +10% defence wherever you are the one defending, your own
district and every location you hold in any city, for holding every location in the district. Deliberately not more stealth: the shafts already pay that, and a
crew that has taken a hill should be harder to shift everywhere, not sneakier in one place.

| Location               | Kind              | What holding it pays                                                                                                             |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Ironmouth Halt         | Station           | The last stop before the tunnel. Linked to any other Station you hold, at fifteen minutes flat.                                  |
| The Ventilation Shafts | Sewer Junction    | Your people can get places without being seen getting there.                                                                     |
| The Bricked Arches     | Smuggler's Tunnel | Every crew you send anywhere is back sooner. There is a shorter way and you own it.                                              |
| Shaft Nine             | Chemical Plant    | Oil, cracked on site.                                                                                                            |
| The Spoil Heap         | Scrap Press       | Scrap, steadily, for as long as you hold it.                                                                                     |
| The Tunnel Chapel      | The Chapel        | Everyone on your books holds together better under things that break people, and nobody runs because the person beside them did. |
| Lampman’s Row          | Pawn Shop         | A smaller cut, and a fence who moves what a raid brings back.                                                                    |

### The Marshalling Yards

`marshalling-yards`, called the Yards. Difficulty 3 of 10, independent ground, at 0.34, 0.7 on the map.

Sixty miles of siding with a thousand wagons parked on it. Whoever sorts the yard decides what
leaves this city and when.

Authored under Verge Station and carried over with one change: the Turntable is replaced by Platform
Four, because the working heart of the railway could not be the one part of it without a platform.

Garrison before anybody takes it: yard crews who have sorted out worse than you.

**Unified bonus, You Sort the Yard:** missions run 12% faster, for holding every location in the
district.

| Location           | Kind            | What holding it pays                                                                        |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------- |
| The Hump           | Rail Yard       | Bogies, axles and drive parts by the wagonload: everything the garage has been improvising. |
| Platform Four      | Station         | Four boards and a lamp. Linked to any other Station you hold, at fifteen minutes flat.      |
| The Coaling Stage  | Gas Station     | Oil out of the ground, and the scrap off everything anybody abandoned on the forecourt.     |
| The Wagon Breakers | Scrap Press     | Scrap, steadily, for as long as you hold it.                                                |
| Box Nine           | Watchtower      | Everything your spies do, they do better: everywhere in the city, not just here.            |
| The Mess Room      | Downtown Tavern | A room where the city’s hardest people drink, and somebody who can introduce you.           |
| The Running Sheds  | Foundry         | High-quality metal. Nothing else in the city makes it in quantity.                          |

### Bonded Row

`bonded-row`, called the Bond. Difficulty 4 of 10, looter ground, at 0.47, 0.6 on the map.

Bonded warehouses, where freight waited for a clearance that stopped coming. The paperwork is still
in the office and the crates are still on the floor, and everybody in the city knows which is which.

The commercial end of the line, and the second way in: three open plots, the widest spread of kinds
in Terminus, and the district a crew usually takes second.

Garrison before anybody takes it: the looters on the plots they squat. The district screen counts
them rather than promising a sentence (maintainer, 2026-09-30).

**Unified bonus, The Bond Is Open:** 15% off what the black market charges in infamy, for holding
every location in the district. Not another discount on the ordinary market, which the Long Bond
already pays: what the whole district buys is the other counter.

| Location                | Kind              | What holding it pays                                                                              |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| Bond Street Halt        | Station           | The goods platform. Linked to any other Station you hold, at fifteen minutes flat.                |
| The Long Bond           | Downtown Market   | Every trade in the city is quoted to you at a better number than to anybody else.                 |
| The Seized Goods Office | Pawn Shop         | A smaller cut, and a fence who moves what a raid brings back.                                     |
| The Rendering Shed      | The Bone Market   | What you lose in a fight comes back as caps instead of coming back as nothing.                    |
| The Crated Yard         | Construction Site | Lifting gear nothing else in the city has. Some things can only be assembled standing up.         |
| The Kennels             | The Doghouse      | Working dogs, augmented, and handlers who have done this before.                                  |
| The Cold Store          | Black Clinic      | Syringes. Handed out before a fight, they bring somebody back to strength who had no right to be. |
| The Crate Ring          | Fight Pit         | Your people are harder to frighten, and everybody on the books can hold a line, porters included. |

### Telemetry Hill

`telemetry-hill`, called the Hill. Difficulty 6 of 10, Combine ground, at 0.62, 0.34 on the map.

Dishes and masts on the only rise for forty miles. Everything the Combine knows about the frontier,
it knows through here.

Authored under Verge Station and carried over unchanged. The one contested district with no Station:
the line runs past the foot of the ridge and does not climb it, so the hardest intel ground in the
city is the ground the railway will not take you to.

Garrison before anybody takes it: Greycoats, with Street Enforcers on the gate.

**Unified bonus, The Hill Listens For You:** +18% unit stealth, for holding every location in the
district.

| Location                  | Kind             | What holding it pays                                                                                                 |
| ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| The Uplink Farm           | Satellite Uplink | What goes over the air in this city, your spies have already read.                                                   |
| The Repeater Mast         | Broadcast Tower  | Your name arrives before your people do.                                                                             |
| The Quiet Room            | University       | Every research project finishes sooner.                                                                              |
| Somebody’s Transmitter    | Pirate Radio     | You hear what the city is saying, and some of what it would rather not.                                              |
| The Old Dome              | Planetarium      | A room built for thinking in, and an optical bench worth more than the building around it.                           |
| The Ground Array          | Substation       | Fuel by the drum, off the standby tanks nobody has come back to meter.                                               |
| The Technicians’ Bunkroom | Fence Camp       | More people than any building in your district could house, and every one of them looking for a reason to be useful. |

### The Viaduct

`viaduct`, called the Arches. Difficulty 7 of 10, Combine ground, at 0.58, 0.48 on the map.

Forty brick arches carrying the line over the river gorge, and the Combine holds every one of them,
because there is no line without them. Each arch is bricked up into something: a workshop, a
barracks, a clinic nobody asks about.

The last Combine ground before the Terminus itself.

Garrison before anybody takes it: Street Enforcers behind Suppressor positions on the parapet.

**Unified bonus, They Watched You Take the Arches:** +15% infamy on everything that earns any, for
holding every location in the district, in every city. Taking the viaduct is the most visible
thing anybody can do in this city, and the whole world prices you differently afterwards.

| Location           | Kind                 | What holding it pays                                                                       |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------ |
| Viaduct Halt       | Station              | The halt on the gorge side. Linked to any other Station you hold, at fifteen minutes flat. |
| The Arch Battery   | Barricade            | A harder approach to everything behind it, held by people who will not leave it.           |
| The Parapet        | High Ground          | Everything you hold in this city is harder to take off you.                                |
| The Gantry Walk    | Tram Depot           | The city gets smaller. Everything you send anywhere leaves sooner and arrives faster.      |
| Arch Nineteen      | Mad Scientist's Lair | Everything needed to make something that should not exist, and the notes explaining how.   |
| The Pier Works     | Foundry              | High-quality metal. Nothing else in the city makes it in quantity.                         |
| The Sappers’ Store | Armory               | Cheaper units, and a bench that will fit anything you can find a part for.                 |
| The Undercroft     | Gene Clinic          | Work can be done on people here that cannot be done anywhere else.                         |

### The Last Platform

`last-platform`, called Platform One. Difficulty 9 of 10, Combine ground and a seat of Combine power,
at 0.8, 0.34 on the map.

Where the line ends and the checkpoints begin. Everyone who ever left the frontier left from
platform one, and the Combine counts every one of them.

Authored under Verge Station as The Terminus, renamed here, and carried over with one change:
Platform One is the Station rather than high ground, because the end of the line has to be on the
line. A seat of Combine power, so taking it counts as replacing the Combine rather than robbing it.

Garrison before anybody takes it: Suppressors on the concourse, Enforcers on the gates, and a
Greycoat company that lives on the platform.

**Unified bonus, The Last Platform Is Shut:** +14% unit offense, for holding every location in the
district.

| Location                   | Kind                        | What holding it pays                                                                                                      |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Platform One               | Station                     | The end of the line. Linked to any other Station you hold, at fifteen minutes flat.                                       |
| The Customs Hall           | Downtown Market             | Every trade in the city is quoted to you at a better number than to anybody else.                                         |
| The Holding Pens           | Barricade                   | A harder approach to everything behind it, held by people who will not leave it.                                          |
| The Transit Clinic         | Hospital                    | What comes back from a fight comes back in better shape.                                                                  |
| The Platform Armoury       | Armory                      | Cheaper units, and a bench that will fit anything you can find a part for.                                                |
| The Stationmaster’s Office | Statue of the Revolutionist | Standing under it costs you less with the people who deal in the dark, and taking it is a statement the whole city hears. |
| The Cold Sidings           | War Machine Graveyard       | Hulls, plate and running gear, a gantry that will lift anything, and troops that come back from more than they should.    |
| The Iron Footbridge        | Smuggler's Tunnel           | Every crew you send anywhere is back sooner. There is a shorter way and you own it.                                       |

### The Blockhouse

`blockhouse`, called Control. Difficulty 10 of 10, Combine ground and a seat of Combine power, at
0.9, 0.16 on the map.

The signalling centre that owns every point and every signal on the frontier line, with the regional
garrison built around it. Whoever sits in Control decides which trains exist.

The last district in the city, and the other seat of power. Every hold in it is hard except the
parade ground.

Garrison before anybody takes it: Suppressors, Enforcers and Greycoats, and whatever Control can
call down the line.

**Unified bonus, The Blockhouse Is Taken:** one level of **ANTI-COMBINE** (+10% damage and
vitality against the Combine) for holding every location in the district (maintainer, 2026-10-07:
every city's last district pays this, and the three levels stack to +30%). It replaced "Everything
Leaves Through You", twenty per cent off the time every job in Terminus took; that by-city scope
on `mission_speed` went with it, since nothing else paid it. The Marshalling Yards go on paying
mission speed at 12, everywhere.

| Location            | Kind                    | What holding it pays                                                                                              |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The Officers’ Halt  | Station                 | The private platform the Combine's own trains use. Linked to any other Station you hold, at fifteen minutes flat. |
| The Panel           | Broadcast Station       | Everyone on your books gets better at the half of the job that is talking to people.                              |
| The Frontier Chapel | The Chosen Chapel       | Your name walks in ahead of your people, and nobody you send out is frightened of anything that lives here.       |
| The Interlocking    | Substation              | Fuel by the drum, off the standby tanks nobody has come back to meter.                                            |
| The Records Office  | University              | Every research project finishes sooner.                                                                           |
| The Parade Ground   | The Gym                 | One more session in the day than the day has room for.                                                            |
| The Reactor Shed    | Abandoned Nuclear Plant | High-quality metal out of the turbine hall, and a fuelling crew who make every barrel of oil you burn go further. |
| The Tower Box       | Watchtower              | Everything your spies do, they do better: everywhere in the city, not just here.                                  |

## Residential districts

Four plots, carried over from Verge Station with their ids re-prefixed. They hold no locations, they
cannot be captured, and they can be raided by anybody but their own resident. None of them has a
Station: a crew's own ground is never on the line, so the walk to the nearest platform is the price
of living here.

### `carriage`

At 0.14, 0.64. No capturable locations. Proposed starter district, and still only proposed: a crew is placed in Ashfall and reaches Terminus by marching (maintainer, 2026-09-24).

Old carriages set on blocks and lived in, a street of them with doors cut in the sides. It is at the
west end for the same reason Kettle Row is at the bottom of Ashfall: a starter home should be far
from the thing the city climbs towards, so the Blockhouse reads as the far side of the map.

### `watertower`

At 0.38, 0.88. No capturable locations.

A terrace in the shadow of a water tower nobody has drained in thirty years. Everybody who lives
there knows exactly how much is still in it.

### `embankment`

At 0.7, 0.84. No capturable locations.

Dug into the embankment itself, warm in winter and loud every time something rolls past.

### `signalrow`

At 0.94, 0.56. No capturable locations. Home of the seeded AI rival, the Signalmen (`seed/constants.ts`), since 2026-09-24.

The signalmen's cottages, the tidiest street on the frontier and the most watched. It sits under the
Blockhouse, which is the right address for a rival and the wrong one for a beginner.

## Units this city has to gate

A location kind can be the requirement on a unit (`units/catalog.ts`), so a city that is missing a
kind locks its residents out of the units behind it. All eight gating kinds are present in Terminus,
and this table is the check:

| Needs a hold of kind | Where it is in Terminus              |
| -------------------- | ------------------------------------ |
| `doghouse`           | The Kennels, Bonded Row              |
| `gene_clinic`        | The Undercroft, The Viaduct          |
| `fight_pit`          | The Crate Ring, Bonded Row           |
| `satellite_uplink`   | The Uplink Farm, Telemetry Hill      |
| `mad_scientist_lair` | Arch Nineteen, The Viaduct           |
| `construction_site`  | The Crated Yard, Bonded Row          |
| `tavern`             | The Mess Room, The Marshalling Yards |
| `rail_yard`          | The Hump, The Marshalling Yards      |

The Cartographer needs `rail_yard` and `satellite_uplink` together, which in Terminus means the
Yards plus the Hill, and Twins needs `mad_scientist_lair` and `gene_clinic`, which are both in the
Viaduct. That makes the Viaduct the single most valuable district in the city for a roster, on top
of being the gate to the Terminus.

## What this needs in code

**Written on 2026-09-24.** The list below is kept as the record of what the work was; every item is
done unless it says otherwise. In rough order:

1. `city/cities.ts`: rename `verge-station` to `terminus`, change the nickname, set `open: true`.
2. `city/locations.ts`: a new `rail_station` kind, **appended at the end of `LOCATION_KINDS`**
   because `art/manifest.ts` seeds `icon-location-*` off each kind's index, and a new
   `{ kind: 'rail_link' }` hold bonus in the rules family, which carries no percentage.
3. `city/geography.ts`: the flat fifteen minute link, applied before any `travel_speed` percentage
   rather than inside it.
4. `city/atlas.ts`: the five new districts, the three carried-over ones edited, the `vs-` to `tm-`
   id re-prefix, and the `ATLAS_UNIFIED_BONUSES` entries for all eight.
5. `city/city.test.ts`: the unified bonus rule currently sweeps `CONTESTED_DISTRICTS`, which is
   Ashfall only. Point it at `ALL_DISTRICTS` so Terminus is held to the same rule.
6. A seeded world, a mission board and a control ledger for the city, which is what `open: true`
   actually costs.
7. Feats. The city scoped measures already exist, but nothing counts a rail
   link, and a mechanic with no feat is invisible on the one screen that tells a player what there
   is to do.

Every unified bonus above was checked against the rule the suite enforces: a district's unified
bonus may not be an effect kind that already appears inside that district.

## The Combine's standing army

Ruled on 2026-09-24, and it applies to both cities.

A Combine or looter district's garrisons fight every assault on its gate, and until this ruling they
were **immortal and counted as killed anyway**: nothing wrote a control row back for a gate target,
so a crew could farm the same regiment for kills, infamy and feat tallies every 24 hours. The same
defect had already been fixed for the Combine legendary alone.

- **They erode.** Survivors of a gate or district fight are written back to the rows they were drawn
  from. The regime's army genuinely shrinks across a week of assaults.
- **They come back on Sunday.** At midnight Athens time, the instant before Monday begins, every
  garrison is restored to its authored strength on **every location the Combine or the looters still
  hold**. Ground a crew is standing on is left alone: that garrison is theirs. A fight marked for
  midnight exactly is settled first, against what is left of last week's garrison, and a plot it
  takes is not regrown (maintainer, 2026-09-29).
- **Taken ground stays taken** (maintainer, 2026-09-29). Nothing hands a plot back to the Combine or
  the looters: another crew can take it off the first, and a plot a crew lets go stands empty, but
  the regime never retakes ground. So a named leader whose plot falls is gone for good. The only
  way one comes back on Monday is by dying in a fight the regime won, with the plot still its own.

## How far a city is from a city

Ruled on 2026-10-07: "make the base (0 speed) of between cities to be 4 hours. Assume that relative
geography only happens inside a city, so it takes time to go from location to location. But city to
city, it's always the same, adding then the bonuses."

So `INTER_CITY_MINUTES` in `city/geography.ts` is **240 and it is the whole crossing**. Every
district in one city is four hours from every district in another, whichever two cities they are.
Inside a city nothing changed: the road is still the straight line at 85 minutes per map unit.

The journey used to be the road out to the middle of your own map, plus a two-hour frontier, plus
the road in from the middle of theirs, which put a crossing between 135 and 214 raw minutes
depending on how central the two ends happened to be. Those legs are gone because a position is an
inside-a-city number: it says how far a district is from its neighbours, and nothing on either map
measures its distance from the other city.

It is still a road, so the column's pace, its vehicles, the travel channel, the Cartographer's chair
and `road_shortcut` are all spent on the whole four hours, with no floor under a crossing and no cap
over it. A crew with nothing pays 240 minutes; a crew at every ceiling pays single digits, which is
logged in `open-issues.md`.

## Still open

- **The two seats of power have no leaders.** Ashfall has the Syndic, the Executioner and Directive
  Xero, each standing on one plot and dying for the whole world when it falls. The Last Platform and
  the Blockhouse want the same treatment, and that is three sentences of rules each rather than
  flavour.
- **Whether the line needs tuning.** It carries marches, which lets a crew holding two platforms
  defend two districts at once. That is the maintainer's ruling and it is deliberate; it is also
  the number most likely to move, and the knob is `RAIL_LINK_MINUTES` in `city/locations.ts`.
- **Whether four hours is the right crossing.** The figure is the maintainer's and the shape is
  settled (see "How far a city is from a city" above); what is a guess until somebody plays it is
  whether four hours is the commitment a foothold abroad should be.

# Arca

`arca`, "the Old Quarter". The cathedral city the Combine never modernised, so it wired it
instead: white stone and crimson banners, bells that are transmitters, a camera in every saint, and
more dead than living. Every district, location and unified bonus was chosen by the maintainer,
card by card, on 2026-10-06 and 2026-10-07, and opened (`open: true`) on 2026-10-07 when its
painting (`plate-city-arca`, 3780x1800) and the three Combine leaders' portraits landed.

## The ladder

| District       | Held by                | Difficulty |
| -------------- | ---------------------- | ---------- |
| Candlemarket   | looters                | 1          |
| Gravefields    | looters                | 2          |
| Bellfounders   | looters                | 3          |
| Bloodstone     | Combine                | 4          |
| Saint's Rest   | Combine                | 6          |
| The Printworks | Combine, seat of power | 7          |
| The Cloisters  | Combine, seat of power | 9          |
| The Nave       | Combine, seat of power | 10         |

The four plots are `almshouses`, `chantry-lane`, `lamplighters` and `waxworks`, and like every plot
they carry no name until a crew moves in. `waxworks`, on the east side against the industrial wall,
is home to the seeded AI rival, the Sextons (`seed/constants.ts`, `ARCA_RIVAL_DISTRICT_ID`). Every
contested district has a Mausoleum, and every contested district has a gate, which arms the way
every captured gate does when the district is held whole.

## The Mausoleums

The city's one trait, as the railway is Terminus's. Every contested district here holds one
**Mausoleum**, a location kind of its own, and it does three things:

- Holding any one lets the crew muster the **Death Cloaks**: rabble, three unit slots each, 300
  damage and 300 vitality, blunt, Collective, at home in Eerie and Dark ground and poor in Wet and
  Hot.
- Every Mausoleum held puts **+30 damage and +30 vitality** on each of them (their `faith` rule,
  `FAITH_PER_MAUSOLEUM` in `battle/effects.ts`).
- A crew may keep **fifty of them for every Mausoleum it holds** (`UnitSpec.capPerHold`), counted
  everywhere its people stand and on the muster bench; the roster's Max knows the ceiling and the
  route refuses past it (`at_the_cap`).

A Mausoleum also houses six, because people live in the tombs.

## What a plot here pays

Where Ashfall's and Terminus's locations pay what their kind pays, most of Arca's carry their
own figures (`LocationSchema.bonuses`, read through `baseBonusesOf`): the same kind of place, with
its icon, its ground and its gating, worth what this map says it is. A figure the maintainer set
level by level is written as a `ladder` on the bonus, five entries for the five levels, and a
bonus marked `whenDistrictWhole` is paid only while the district is held whole. Seven kinds exist
for this city alone (`workshop`, `shrine`, `bounty_wall`, `stage`, `trophy_hall`, `laboratory`,
`stores`), each needing an icon before the city opens.

Four units are raised on **doors** authored by name rather than by kind of place (`unit_door`,
`UnitRequirement.door`): the Saint at his Shrine (his taverns no longer muster him), the Condemned
at the Watch Cell (not the Fight Pit), the Crimson Dancer at her Stage (not the Fight Pit), and the
Juggernauts at the Reliquary Lab or any gene clinic. The door's level is the unit's: each has a
ladder of four steps on the unit's card (`doorSteps`), spent by the engine (`battle/doors.ts`).

Three tags changed with the city. **GUARD** replaces Dug In and Bulwark on every sheet that held
ground, and goes on the Cyberhounds too: a quarter more damage and a quarter more vitality in any
fight on the defending side. **ANTI-COMBINE** is what every city's last district pays its holder:
+10% damage and vitality against the Combine, three levels stacking to +30%. The **Fight Pit** pays
double infamy for every enemy unit that was intimidated before it died, and nothing else now.

## Candlemarket

`candlemarket`, called the Market. Difficulty 1 of 10, looter ground, at 0.12, 0.86 on the map.

A street market in the shadow of the cathedral under strings of bulbs, selling wax, relics and
knock-off implants, with a Combine confessional at the end that takes payment. The loud way in:
three of seven plots open and no gate.

**Unified bonus, Every Candle Lit:** +15% mission caps.

| Location            | Kind              | What holding it pays                               |
| ------------------- | ----------------- | -------------------------------------------------- |
| The Wax Stalls      | Market            | 40 caps an hour (a Market elsewhere pays 30).      |
| Pilgrim Hostels     | Fence Camp        | 50 unit slots, and no caps: beds and nothing else. |
| The Chandlery       | Chemical Plant    | 20 oil an hour (14 elsewhere).                     |
| Martyr's Plinth     | Statue in a Plaza | +10 morale, on rabble only.                        |
| The Night Watch     | Watchtower        | +38 spy points, everywhere.                        |
| Bulb-String Loft    | Pirate Radio      | +5 Communication and +5 Signals on every officer.  |
| The Chandlers' Tomb | Mausoleum         | The Death Cloaks, and six beds.                    |

## Gravefields

`gravefields`, called the Fields. Difficulty 2 of 10, looter ground, at 0.3, 0.93 on the map.

The terraced cemetery outside the walls, white stone gone grey and a red lamp on every tomb. The
clans that live in the mausoleums bury the city and sell what the dead no longer need. Held end to
end by the clans, so its gate is armed: Candlemarket is the way in, and this is the first thing
taken from inside.

**Unified bonus, Buried With Honours:** 3 XP for every unit slot of your own dead, after every fight.

| Location           | Kind            | What holding it pays                                                                 |
| ------------------ | --------------- | ------------------------------------------------------------------------------------ |
| The Bone Market    | The Bone Market | 12% of fight losses back as caps (tapers). Moved here from the Steelbelt.            |
| Mourners' Row      | Pawn Shop       | 2 HQ metal an hour: the dead's valuables end up here. No bigger truck.               |
| The Wake House     | Downtown Tavern | +5 Empathy and +5 Resolve on every officer.                                          |
| The Mausoleums     | Mausoleum       | The Death Cloaks, and six beds.                                                      |
| Stonecutters' Shed | Scrap Press     | Scrap and planks, steadily.                                                          |
| The Cemetery       | Graveyard       | +5% infamy from fights (declared battles and mission battle jobs), and nothing else. |

## Bellfounders

`bellfounders`, called the Foundry. Difficulty 3 of 10, looter ground, at 0.3, 0.62 on the map.

The old foundry streets, where the cathedral's bells were cast and where the last of them still
hangs. The furnaces pour plate now, and the quarter rings whether anybody wants it to or not.

**Unified bonus, Cast in Bell Metal:** every modification a unit wears is also +3 armour, stacking,
inside the 100 cap.

| Location            | Kind            | What holding it pays                                                                                                                                                     |
| ------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Clapper Works   | Scrap Press     | Scrap and planks, as a Scrap Press pays.                                                                                                                                 |
| The Casting Pit     | Foundry         | +3 armour on every Heavy-tier unit, rising 3, 4, 5, 6, 7 by level. No HQ metal.                                                                                          |
| The Tolling Tower   | Broadcast Tower | A switch (12-hour cooldown): on, every location in Bellfounders is Noisy I, for everybody who fights there, and your own units ignore Noisy everywhere. No intimidation. |
| The Apprentice Rows | Fence Camp      | 50 unit slots, no caps.                                                                                                                                                  |
| The Straw Sack      | Workshop        | +5 loot slots on every carrier, rising 5, 6, 7, 8, 10 by level.                                                                                                          |
| The Hammer Yard     | Workshop        | +10 damage on every blunt-damage unit, rising 10, 15, 20, 25, 30 by level. Not a Construction Site: it does not muster the Colossus and pays no build speed or planks.   |
| The Founders' Tomb  | Mausoleum       | The Death Cloaks, and six beds.                                                                                                                                          |

## The Printworks

`printworks`, called the Presses. Difficulty 7 of 10, Combine ground and a seat of power, at
0.54, 0.64 on the map. It was independent ground at difficulty 4 until the maintainer made it the
regime's third district here (2026-10-07): whoever decides what the presses print decides what the
city believes. It swapped rungs with Bloodstone, which took its 4.

Four storeys of presses that print the city its scripture and its propaganda, and a cellar that
prints everything else. The gutters run black and the walls are a street long of posters.

**Unified bonus, Every Press Running:** +10% payroll.

**The Combine leader: the Curate**, on the Great Press. Ballistic damage, 4 unit slots, and the
weakest legendary in the game: ten of her beat a force of 20 Razors on open ground where ten of the
Syndic beat 40. Her power is **Propaganda**: no location in the Printworks can be spied while she
is alive. Take the press hall and she is gone for good.

| Location                 | Kind              | What holding it pays                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Great Press          | Scrap Press       | Scrap and planks, as a Scrap Press pays.                                                                                                                                                                                                                                             |
| The Boiler House         | Power Station     | 20 oil an hour.                                                                                                                                                                                                                                                                      |
| The Scriptorium          | University        | A blueprint page a day, of a blueprint you have not finished, at odds by level (basic/intricate/advanced/masterpiece 70/25/5/0 at level 1 to 30/35/25/10 at level 5), and +5 Encyclopedia and +5 Logistics on every officer, rising to +10. No research speed.                       |
| The Pamphlet Wall        | Broadcast Tower   | One pin a level: a pinned unit type fights you at -5% damage and -5% vitality, whoever fields it. Pins are set all at once and locked until the wall is next worked up; at level 5 with every pin set, one pin can be changed for 5,000 caps on a 12-hour cooldown. No intimidation. |
| The Typesetters' Canteen | Soup Kitchen      | 14 supplies an hour and 15 unit slots. No morale.                                                                                                                                                                                                                                    |
| The Distribution Tunnels | Smuggler's Tunnel | 10% off the time of missions on this district's board, rising to 30% by level (written 11, 18, 25, 33, 43 on the divisor channel).                                                                                                                                                   |
| The Printers' Vault      | Mausoleum         | The Death Cloaks, and six beds.                                                                                                                                                                                                                                                      |

## Saint's Rest

`saints-rest`, called the Hill. Difficulty 6 of 10, Combine ground, at 0.1, 0.36 on the map.

A walled hospice-monastery on the hill, white stone and crimson banners, the best-run sick ward in
the city and the Saint's own shrine at the top of the steps. The Combine keeps it, and keeps it
quiet.

**Unified bonus, The Saint Walks With You:** units fighting in a force with the Saint get +2%
damage and vitality while he is alive.

| Location                | Kind         | What holding it pays                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Sisters' Dispensary | Black Clinic | Each day, a chance of one battle stim (an Adrenaline Syringes crate in the stash): 30% at level 1, 47, 65, 82, 100%. No standing stims.                                                                                                                                                                                                           |
| The Infirmary Cloister  | Hospital     | +2% casualty recovery a level: 2, 4, 6, 8, 10. No unit vitality.                                                                                                                                                                                                                                                                                  |
| The Saint's Shrine      | Shrine       | The Saint's one door. He costs 6,000 caps, 1,500 supplies and 600 HQ metal and takes 50 unit slots. Level 2: Holds the Line. Level 3: +10 evasion, speed and stealth. Level 4: INSPIRATION, every ally beside him ignores the ground that is bad for it. Level 5: +1 damage and vitality per unit slot beside him, to +1,000. His Dug In is gone. |
| The Watch Cell          | Watchtower   | The Condemned's door (moved off the Fight Pit): +30 damage and vitality for every level above the first, and at level 5 LAST CHANCE, one strike more as they die, one time in five. No spy points.                                                                                                                                                |
| The Exercise Yard       | Gym          | -5% training time a level, 5 to 25, and at level 5 one more training session a day.                                                                                                                                                                                                                                                               |
| The Wellhouse           | Water Works  | 26 supplies an hour.                                                                                                                                                                                                                                                                                                                              |
| The Saint's Inn         | Tavern       | +20 unit slots a level, 20 to 100, and the same again while the whole hill is held. No morale; it musters nobody.                                                                                                                                                                                                                                 |
| The Pilgrims' Tomb      | Mausoleum    | The Death Cloaks, and six beds.                                                                                                                                                                                                                                                                                                                   |

## Bloodstone

`bloodstone`, called the Stone. Difficulty 4 of 10, Combine ground, at 0.62, 0.42 on the map. It
was the Ossuary until the maintainer re-themed it (2026-10-06), and it stood at 7 until it swapped
rungs with the Printworks (2026-10-07).

The sellswords' quarter, licensed by the Combine and run by nobody. Contracts on a wall, blood on a
stage, every strong crew in the city drinking in one hall, and the Crimson Dancer at the top of the
bill.

**Unified bonus, Her Blades Lead:** units fighting alongside the Crimson Dancer get +5 penetration
while she is alive.

| Location             | Kind                  | What holding it pays                                                                                                                                                                                                                                                                                             |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Bounty Wall      | Bounty Wall           | Each battle job dealt on this district's board is golden with a chance of 20% at level 1, 40, 60, 80, 100%: a gold outline on the card, and +10% pay rising to +50%.                                                                                                                                             |
| The Red Lantern      | Downtown Tavern       | 60 caps an hour. No morale.                                                                                                                                                                                                                                                                                      |
| The Hiring Hall      | Fence Camp            | Rabble muster 4% cheaper a level, 4 to 20. No beds, no caps.                                                                                                                                                                                                                                                     |
| The Crimson Stage    | Stage                 | The Crimson Dancer's door (moved off the Fight Pit). Level 2: +100 damage and vitality. Level 3: SPECTACLE, her kills pay double infamy. Level 4: Crammed and Wet no longer weaken her, and +100 evasion. Level 5: PAPERCUT, every attack strips 5 armour from every enemy unit for the rest of the fight, to 0. |
| The Chop Shop        | War Machine Graveyard | One random component a day at levels 1 to 3, two from level 4, at rarities rising with level (the Scriptorium's table). No vitality, no seats for all.                                                                                                                                                           |
| The Trophy Hall      | Trophy Hall           | A list of every unit in the game, ticked as each is killed while the hall is held (reset when it is lost and retaken). Each ticked type pays 10 HQ metal and 100 of every other resource a day, times 1, 1.5, 2, 2.5, 3 by level.                                                                                |
| The Sellswords' Tomb | Mausoleum             | The Death Cloaks, and six beds.                                                                                                                                                                                                                                                                                  |

## The Cloisters

`cloisters`, called the Convent. Difficulty 9 of 10, a Combine seat of power, at 0.34, 0.24 on the
map.

A sealed convent-laboratory, four storeys of white wall with no doors on the outside. The sisters
copy the Combine's papers by hand, grow its soldiers in the old embalming rooms, and have not
spoken in forty years.

**Unified bonus, The Sisters' Blessing:** +5 morale on every rabble unit.

**The Combine leader: the Blood Priest**, in the Chapter of Silence. Chemical damage, 6 unit slots,
and level with Ashfall's Executioner on the strength ladder (ten of either beat 80 Razors on open
ground). His power is **Blood Baptism**: every location in the Cloisters is Eerie while he keeps
the rituals, and every Combine unit fighting there has +10 intimidation.

| Location               | Kind          | What holding it pays                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Reliquary Lab      | Laboratory    | A Juggernauts door (a gene clinic does as well; holding both stacks the clinic's vitality on top). They take 10 unit slots and lost Last Stand. Level 2: +20 range. Level 3: +100 vitality, and Wet, Cold and Snowy are home ground. Level 4: +50 damage and they taunt. Level 5: BLOWOUT, a dying Juggernaut deals its damage to enemy units covering up to its own unit slots, smallest units first, only units fully covered. |
| The Chapter of Silence | Chapel        | +20 defensive spy points a level, 20 to 60. No officer lift, no steady nerve. The crew's own offensive and defensive totals are printed on the Master of Whispers' seat, the Spy Reports tab and the district reports.                                                                                                                                                                                                           |
| The Novitiate          | Gym           | +3 to every physical attribute of every officer, rising 3, 4, 5, 6, 7 by level. No sessions.                                                                                                                                                                                                                                                                                                                                     |
| The Cold Vault         | Nuclear Plant | Every other source of oil and HQ metal pays +2% more, rising 2, 3, 4, 5, 6 by level. No HQ metal of its own.                                                                                                                                                                                                                                                                                                                     |
| The Choir Loft         | Planetarium   | +2% mission XP, rising 2, 3, 4, 5, 6 by level. No research speed, no spy points.                                                                                                                                                                                                                                                                                                                                                 |
| The Cloister Wall      | High Ground   | Every unit with GUARD gets +10 range and +10 armour, rising to +20 by level (10, 13, 15, 18, 20). No defence percent.                                                                                                                                                                                                                                                                                                            |
| The Sisters' Crypt     | Mausoleum     | The Death Cloaks, and six beds.                                                                                                                                                                                                                                                                                                                                                                                                  |

## The Nave

`nave`, called the Cathedral. Difficulty 10 of 10, the Combine's seat, at 0.5, 0.1 on the map.

The great cathedral itself, the Combine's seat in the city. Eight hundred voices every night, a
window the light through which falls on everything, and vaults under the floor deep enough for a
siege.

**Unified bonus, The Nave Is Taken:** one level of ANTI-COMBINE (+10% damage and vitality against
the Combine), stacking with the Spire's and the Blockhouse's.

**The Combine leader: the Hierarch**, under the Rose Window. Blunt damage, 10 unit slots, and level
with Directive Xero at the top of the strength ladder (ten of either beat 260 Razors on open
ground). Forty years a monk before the Combine made him its voice, and he still teaches every
morning. His power is **Martial Arts Instructor**: every Combine unit in the Nave fights with +15
evasion, 5% more damage and 5 more resistance to blunt.

| Location              | Kind       | What holding it pays                                                                                                                                                        |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Choir             | Cinema     | +5 Composure, Improvisation and Empathy on every officer, rising 5, 6, 7, 8, 10 by level. No morale.                                                                        |
| The Rose Window       | Chapel     | Units you send into a faction mate's fight get +2% damage and vitality, rising 2, 4, 6, 8, 10 by level.                                                                     |
| The Undercroft Stores | Stores     | +10% storage of HQ metal, planks, oil, scrap and supplies, rising 10, 13, 15, 18, 20 by level. Not caps.                                                                    |
| The Collection Plate  | Market     | Every passively producing structure in your district makes +10% more per modification fitted on it, rising to +20% per modification by level (10, 13, 15, 18, 20). No caps. |
| The Court of Arms     | Armory     | Unit modifications 10% cheaper in resources, rising 10, 14, 18, 22, 25 by level. No muster cut.                                                                             |
| The Cathedral Close   | Fence Camp | 50 unit slots and 6 caps an hour, as a Fence Camp pays.                                                                                                                     |
| The Bishops' Crypt    | Mausoleum  | The Death Cloaks, and six beds.                                                                                                                                             |

## The map

Tags on `plate-city-arca` (`DISTRICT_MARKS.arca` in `apps/client/src/features/game/CityView.tsx`).
These are where a player sees each district, which is not the atlas position above. The contested
and plot tags are where the maintainer placed them on a marked-up screenshot (2026-10-08);
Bellfounders was off its edge and keeps its first placement by eye. Almshouses stands on the crane
at the bottom of the river, inside the captured-gate panel's corner, so a crew holding a district
whole sees the panel over it.

| District     | Tag          |
| ------------ | ------------ |
| The Nave     | 0.409, 0.321 |
| Cloisters    | 0.471, 0.445 |
| Bellfounders | 0.895, 0.25  |
| Printworks   | 0.671, 0.235 |
| Saint's Rest | 0.198, 0.252 |
| Bloodstone   | 0.332, 0.544 |
| Candlemarket | 0.701, 0.784 |
| Gravefields  | 0.24, 0.445  |
| Almshouses   | 0.21, 0.8    |
| Chantry Lane | 0.491, 0.655 |
| Lamplighters | 0.122, 0.492 |
| Waxworks     | 0.708, 0.458 |

## What this still needs

- District plates, so a district can be walked into the way Ashfall's and Terminus's are.
- Painted icons for the seven new location kinds (`workshop`, `shrine`, `bounty_wall`, `stage`,
  `trophy_hall`, `laboratory`, `stores`): on the manifest, still drawn procedurally.
