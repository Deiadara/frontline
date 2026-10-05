# The districts

The world has five cities and they are at four different stages, which is worth knowing before
reading any of this.

| City      | Ground                                                 | Documented here |
| --------- | ------------------------------------------------------ | --------------- |
| Ashfall   | Eight contested and four plots, playable               | Yes, first      |
| Terminus  | Eight contested and four plots, playable               | Yes, at the end |
| Saltmarch | Three contested and four plots, a sketch in `atlas.ts` | Not yet         |
| Redline   | None. A name, a nickname and a blurb                   | Nothing to say  |
| Deepcut   | None. A name, a nickname and a blurb                   | Nothing to say  |

Redline and Deepcut exist so the world screen can show five places (maintainer, 2026-09-24). A city
can be a row in the list long before anybody draws its districts, and `atlas.test.ts` holds the one
rule that keeps that honest: a city with no ground may not be `open`. The city list itself is
`packages/shared/src/city/cities.ts`.

Nothing about a map is generated: a map is only worth learning if it is the same map tomorrow.

Ashfall's half of this file is written from `packages/shared/src/city/districts.ts` and Terminus's
from `packages/shared/src/city/atlas.ts`. If a page and its source disagree, the source is right.

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

| District                           | Kind        | Held by                | Difficulty | Position (x, y) | Holds | Open | Leader          |
| ---------------------------------- | ----------- | ---------------------- | ---------- | --------------- | ----- | ---- | --------------- |
| Neon Docks                         | contested   | Combine                | 1          | 0.15, 0.9       | 7     | 0    |                 |
| Player District (`ashen-terraces`) | residential | independent            |            | 0.84, 0.62      | none  |      |                 |
| Player District (`kettle-row`)     | residential | independent            |            | 0.38, 0.82      | none  |      |                 |
| Steelbelt                          | contested   | Combine                | 2          | 0.63, 0.83      | 7     | 0    |                 |
| Chrome Row                         | contested   | looters                | 4          | 0.3, 0.62       | 8     | 4    |                 |
| The Undergrid                      | contested   | looters                | 5          | 0.55, 0.58      | 7     | 0    |                 |
| The Annexes                        | contested   | Combine                | 6          | 0.76, 0.38      | 7     | 0    | The Syndic      |
| Glasshouse Fields                  | contested   | Combine                | 3          | 0.1, 0.58       | 8     | 2    |                 |
| Blacksite                          | contested   | Combine, seat of power | 8          | 0.33, 0.3       | 8     | 0    | The Executioner |
| CCS                                | contested   | Combine, seat of power | 10         | 0.57, 0.13      | 8     | 0    | Directive Xero  |
| Player District (`upper-roofs`)    | residential | independent            |            | 0.91, 0.79      | none  |      |                 |
| Player District (`south-quay`)     | residential | independent            |            | 0.78, 0.93      | none  |      |                 |

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
| The Bone Market    | The Bone Market       | What you lose in a fight comes back as caps instead of coming back as nothing.                                         |

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

**Unified bonus, The Spire Is Taken:** 20% off market prices, for holding every location in the district.

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

All four are stored under the name `Player District` and none of them is drawn under it.
`districtDisplayName` decides what a screen says: your own plot answers with your crew name, and
everybody else's answers with a number, `Player District I`, `II`, `III`, in catalogue order.

The numbering is viewer-relative, so it always runs from one with no gap: your own plot is not in
the sequence. The other plots are numbered rather than named after whoever lives there on purpose.
Only one crew on this map is you, and the map's job is to say "somebody plays there", not to publish
another player's crew name to the whole city. Those names are reserved: a crew cannot call itself
`Player District II`.

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
| The Saint                         | `tavern`                             | The Cracked Anvil, Chrome Row                                 |
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

| District                       | Kind        | Held by                | Difficulty | Position (x, y) | Holds | Open | Station |
| ------------------------------ | ----------- | ---------------------- | ---------- | --------------- | ----- | ---- | ------- |
| Coldwater Halt                 | contested   | looters                | 1          | 0.08, 0.9       | 7     | 3    | yes     |
| Ironmouth                      | contested   | looters                | 2          | 0.22, 0.8       | 7     | 0    | yes     |
| The Marshalling Yards          | contested   | looters                | 3          | 0.34, 0.7       | 7     | 0    | yes     |
| Player District (`carriage`)   | residential | independent            |            | 0.14, 0.64      | none  |      |         |
| Bonded Row                     | contested   | looters                | 4          | 0.47, 0.6       | 8     | 3    | yes     |
| Player District (`watertower`) | residential | independent            |            | 0.38, 0.88      | none  |      |         |
| Telemetry Hill                 | contested   | Combine                | 6          | 0.62, 0.34      | 7     | 0    | no      |
| The Viaduct                    | contested   | Combine                | 7          | 0.58, 0.48      | 8     | 0    | yes     |
| Player District (`embankment`) | residential | independent            |            | 0.7, 0.84       | none  |      |         |
| The Last Platform              | contested   | Combine, seat of power | 9          | 0.8, 0.34       | 8     | 0    | yes     |
| The Blockhouse                 | contested   | Combine, seat of power | 10         | 0.9, 0.16       | 8     | 0    | yes     |
| Player District (`signalrow`)  | residential | independent            |            | 0.94, 0.56      | none  |      |         |

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

**Unified bonus, Everything Leaves Through You:** **20% off the time every mission in Terminus
takes**, for holding every location in the district (maintainer, 2026-09-24: "twenty per cent off
the time every job in this city takes"; scoped to the city 2026-09-30). A job on another city's
board or on the misc board gets nothing from it. Written in the catalogue as
`{ kind: 'mission_speed', percent: 25, inOwnCity: true }`, because a speed channel is spent as
`time / (1 + percent/100)` and 25 there is exactly a fifth off the clock; the card reads "-20%
mission time in this city (tapers, no hard stop)". 25 is the knee of `missionSpeedCut`
(2026-10-05), so the card alone is paid at face value. Not another research or morale line, which the Records Office and the
Chapel already pay.

The Marshalling Yards pay the same kind at 12, everywhere, and a crew holding both ends of the line
gets both on Terminus work, summed and then tapered past the knee. That is allowed and it is the point: the rule the suite enforces is that
a district's unified bonus may not be a kind that already appears _inside that district_, and
nothing in the Blockhouse pays mission speed. Assembling both is the strongest economy in the game
and costs the whole city.

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

## Still open

- **The two seats of power have no leaders.** Ashfall has the Syndic, the Executioner and Directive
  Xero, each standing on one plot and dying for the whole world when it falls. The Last Platform and
  the Blockhouse want the same treatment, and that is three sentences of rules each rather than
  flavour.
- **Whether the line needs tuning.** It carries marches, which lets a crew holding two platforms
  defend two districts at once. That is the maintainer's ruling and it is deliberate; it is also
  the number most likely to move, and the knob is `RAIL_LINK_MINUTES` in `city/locations.ts`.
- **How far a city is from a city.** `INTER_CITY_MINUTES` in `city/geography.ts` is two hours, plus
  the road out to the middle of one map and in from the middle of the other. Taking a foothold
  abroad should cost an afternoon; whether two hours is that afternoon is a guess until somebody
  plays it.
