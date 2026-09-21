# The districts of Ashfall

Ashfall, "the Frontline", is the only city on the map today (`packages/shared/src/city/cities.ts`).
It has twelve districts, all hard-authored in `packages/shared/src/city/districts.ts`. Nothing about
the map is generated: a map is only worth learning if it is the same map tomorrow.

This file is written from that source. If the two disagree, the source is right.

## Two kinds of ground

**Residential** districts hold crews. A crew's own district is its base, the thirteen structures of
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
middle of the frame from the highest point on it. Difficulty rises with height almost monotonically,
which `city.test.ts` pins as a rank correlation above 0.85, so "further up" and "harder" are the
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

| District                           | Kind        | Held by                | Difficulty | Position (x, y) | Holds | Open | Leader          |
| ---------------------------------- | ----------- | ---------------------- | ---------- | --------------- | ----- | ---- | --------------- |
| Neon Docks                         | contested   | Combine                | 1          | 0.15, 0.9       | 7     | 0    |                 |
| Player District (`ashen-terraces`) | residential | independent            | 4          | 0.84, 0.62      | none  |      |                 |
| Player District (`kettle-row`)     | residential | independent            | 2          | 0.38, 0.82      | none  |      |                 |
| Steelbelt                          | contested   | Combine                | 2          | 0.63, 0.83      | 7     | 0    |                 |
| Chrome Row                         | contested   | looters                | 4          | 0.3, 0.62       | 8     | 4    |                 |
| The Undergrid                      | contested   | looters                | 5          | 0.55, 0.58      | 7     | 0    |                 |
| The Annexes                        | contested   | Combine                | 6          | 0.76, 0.38      | 7     | 0    | The Syndic      |
| Glasshouse Fields                  | contested   | Combine                | 3          | 0.1, 0.58       | 8     | 2    |                 |
| Blacksite                          | contested   | Combine, seat of power | 8          | 0.33, 0.3       | 8     | 0    | The Executioner |
| CCS                                | contested   | Combine, seat of power | 10         | 0.57, 0.13      | 8     | 0    | Directive Xero  |
| Player District (`upper-roofs`)    | residential | independent            | 2          | 0.91, 0.79      | none  |      |                 |
| Player District (`south-quay`)     | residential | independent            | 1          | 0.78, 0.93      | none  |      |                 |

## The Combine

Six districts, one regime, and four units that are never yours: the **Civic Levy** (conscripts with
surplus blades), the **Greycoats** (government infantry), the **Street Enforcers** (riot plate and
shock batons) and the **Suppressors** (a belt-fed gun on a tripod). They live in
`packages/shared/src/units/catalog.ts` behind `UnitSpec.faction`, which is what keeps them off
every roster, every training bench, the census, the Scrapyard and the balance sheet.
`units/faction.test.ts` sweeps all 496 feats, every mission and every blueprint to prove no content
path can put one on a player's books.

Which units stand where is `combineGarrison` in `packages/shared/src/city/combine.ts`, and it steps
with difficulty: Levy on the Docks, Greycoats behind them, Enforcers from the Annexes, Suppressors
from the Blacksite, all three in the CCS. How _many_ is `combineSlotBudget`, and it is measured in
**unit slots** rather than bodies, which matters: a Suppressor is four slots and a Levy is one, so
counting heads made the Blacksite four times the army the Annexes was at two rungs' difference.

### The three who run it

Each commands a district and stands on exactly one plot in it. His power covers every Combine
defence in his district while he lives; his body fights only where it stands. Take that plot and he
is dead for the whole world, and the district fights without them from then on.

| Leader          | District  | Stands on         | What they are worth                                                                                                                                                                        |
| --------------- | --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Syndic      | Annexes   | Annexe Uplink     | Standing Orders: +25 penetration and +25 armour to the Combine's own line in the Annexes. Nothing at all on the sheet of whoever is sent against it. She is the one woman among the three. |
| The Executioner | Blacksite | Blacksite Armory  | Any attacking unit left under 10% of its vitality after an exchange is finished where it stands.                                                                                           |
| Directive Xero  | CCS       | The Chosen Chapel | His side fights at 100 morale and cannot be intimidated, and the attackers who would have been intimidated change sides and are his for good.                                              |

Directive Xero is the wall the whole map climbs towards. Measured on 2026-09-20 against a crew mix
sized in unit slots: the CCS wants about 230 slots to take a plot without him, and more than 400
with him, because Change of Heart turns the part of your line that §D3 would have silenced into
part of his.

## Contested districts

### Neon Docks

`neon-docks`, called the Docks. Difficulty 1 of 10, Combine ground, at 0.15, 0.9 on the map.

Container stacks and a waterfront the Combine stopped patrolling years ago. Cheap ground, and far enough from the spire that nobody important looks at it.

The starter target. Difficulty 1, seven cheap holds, and close enough to the residential plots that a new crew’s first campaign is a real one rather than a march. It used to be the starter _home_; it was opened up as contested ground so that there would be something a first crew could actually take.

Garrison before anybody takes it: a thin line of Civic Levy with surplus blades.

**Unified bonus, The Whole Waterfront:** 12% off market prices, for holding every location in the district.

| Location            | Kind              | Fortified | What holding it pays                                                                                                 |
| ------------------- | ----------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| The Tideline Market | Market            | easy      | A cut of everything that changes hands.                                                                              |
| Dockside Pumphouse  | Water Works       | easy      | Supplies, because clean water is most of what growing it takes.                                                      |
| Runners' Tunnel     | Smuggler's Tunnel | medium    | Every crew you send anywhere is back sooner. There is a shorter way and you own it.                                  |
| The Wet Galley      | Soup Kitchen      | easy      | Supplies off the ration line, and a crew that has eaten fights like one.                                             |
| The Moored Barges   | Fence Camp        | easy      | More people than any building in your district could house, and every one of them looking for a reason to be useful. |
| Crane Site          | Watchtower        | medium    | Everything your scouts do, they do better: everywhere in the city, not just here.                                    |
| The Chandlery       | Pawn Shop         | easy      | A smaller cut, and a fence who moves what a raid brings back.                                                        |

### Steelbelt

`rustyard`, called the Belt. Difficulty 2 of 10, independent ground, at 0.63, 0.83 on the map.

Rolling mills, press houses and a furnace row that has not gone cold in thirty years. Nobody owns the Belt outright: the crews that work it hold their own gates, and none of them holds enough of it to stop anybody else walking in.

Working industry, not a scrapyard: presses on shift, furnaces lit, a pump row selling to the hauliers. The id is still `rustyard` because every location id and every saved control row is keyed on it.

Garrison before anybody takes it: Civic Levy with a squad of Greycoats behind them.

**Unified bonus, Run of the Belt:** 10% off what training units costs, for holding every location in the district.

| Location           | Kind                  | Fortified | What holding it pays                                                                    |
| ------------------ | --------------------- | --------- | --------------------------------------------------------------------------------------- |
| No. 4 Press House  | Scrap Press           | easy      | Scrap, steadily, for as long as you hold it.                                            |
| The Breaker's Yard | War Machine Graveyard | hard      | Hulls, plate and running gear, and troops that come back from more than they should.    |
| Toolhouse Pawn     | Pawn Shop             | easy      | A smaller cut, and a fence who moves what a raid brings back.                           |
| The Slag Bowl      | Skate Ground          | easy      | Everything you field moves faster.                                                      |
| Furnace Row Pumps  | Gas Station           | easy      | Oil out of the ground, and the scrap off everything anybody abandoned on the forecourt. |
| The Doghouse       | The Doghouse          | medium    | Working dogs, augmented, and handlers who have done this before.                        |
| The Bone Market    | The Bone Market       | easy      | What you lose in a fight comes back as caps instead of coming back as nothing.          |

### Chrome Row

`chrome-row`, called the Old City Center. Difficulty 4 of 10, independent ground, at 0.3, 0.62 on the map.

What is left of downtown: bank halls turned into markets, a picture house that never closed, and a transmitter mast nobody has managed to hold for a whole season.

The old downtown. Eight holds, the widest spread of kinds on the map, and the district a crew usually takes second.

Garrison before anybody takes it: whoever holds the ground and has decided to keep it.

**Unified bonus, The Row Runs For You:** missions run 10% faster, for holding every location in the district.

| Location                    | Kind              | Fortified | What holding it pays                                                                          |
| --------------------------- | ----------------- | --------- | --------------------------------------------------------------------------------------------- |
| The Exchange                | Downtown Market   | medium    | Every trade in the city is quoted to you at a better number than to anybody else.             |
| Cathode Tower               | Broadcast Tower   | hard      | Your name arrives before your people do.                                                      |
| The Overlook                | High Ground       | hard      | Everything you hold in this city is harder to take off you.                                   |
| Saint Ferrous               | Hospital          | easy      | What comes back from a fight comes back in better shape.                                      |
| Statue of the Revolutionary | Statue in a Plaza | easy      | It is what they are fighting for. A crew that holds it walks into a fight harder to frighten. |
| The Regal                   | Cinema            | easy      | Two hours somewhere else. A crew that gets that fights differently the next day.              |
| The Cracked Anvil           | Downtown Tavern   | medium    | A room where the city’s hardest people drink, and somebody who can introduce you.             |
| Coin-Op Row                 | The Arcade        | easy      | Reflex work disguised as an evening off. The drills go quicker.                               |

### The Undergrid

`undergrid`, called the Power Spine. Difficulty 5 of 10, looter ground, at 0.55, 0.58 on the map.

The Combine meters the whole undercity from down here. Bundled conduit running the walls like roots, transformer housings the size of buildings, and older tunnels underneath that are on nobody’s drawings.

The Combine’s metering floor for the whole undercity, and the first Combine ground on the climb.

Garrison before anybody takes it: an enforcer column with rolling counter-ICE support.

**Unified bonus, Hand on the Power Spine:** building runs 12% faster, for holding every location in the district.

| Location             | Kind                 | Fortified | What holding it pays                                                                     |
| -------------------- | -------------------- | --------- | ---------------------------------------------------------------------------------------- |
| Undergrid Substation | Substation           | hard      | Fuel by the drum, off the standby tanks nobody has come back to meter.                   |
| Transformer Vault 9  | Substation           | hard      | Fuel by the drum, off the standby tanks nobody has come back to meter.                   |
| The Weeping Junction | Sewer Junction       | easy      | Your people can get places without being seen getting there.                             |
| Reagent Works        | Chemical Plant       | medium    | Oil, cracked on site.                                                                    |
| The Old Customs Run  | Smuggler's Tunnel    | medium    | Every crew you send anywhere is back sooner. There is a shorter way and you own it.      |
| Lamplight Depot      | Tram Depot           | medium    | The city gets smaller. Everything you send anywhere leaves sooner and arrives faster.    |
| The Laundry Stair    | Mad Scientist's Lair | hard      | Everything needed to make something that should not exist, and the notes explaining how. |

### The Annexes

`datavault-sigma`, called the Tech District. Difficulty 6 of 10, Combine ground, at 0.76, 0.38 on the map.

Faculty buildings the Combine never closed, because it was easier to move in. Everything worth knowing in this city is written down somewhere in here.

The university the Combine moved into instead of closing. Research, optics and signal, plus the only construction crane outside the Spire.

Garrison before anybody takes it: Greycoats with Street Enforcers on the corners.

**Unified bonus, The Faculty Answers To You:** +20% unit stealth, for holding every location in the district.

| Location               | Kind              | Fortified | What holding it pays                                                                       |
| ---------------------- | ----------------- | --------- | ------------------------------------------------------------------------------------------ |
| The Faculty Annexe     | University        | medium    | Every research project finishes sooner.                                                    |
| Annexe Uplink          | Satellite Uplink  | hard      | You can see into districts without walking into them first.                                |
| The Quiet Ward         | Gene Clinic       | hard      | Work can be done on people here that cannot be done anywhere else.                         |
| Cold Row               | Foundry           | medium    | High-quality metal. Nothing else in the city makes it in quantity.                         |
| The Orrery             | Planetarium       | medium    | A room built for thinking in, and an optical bench worth more than the building around it. |
| Nine Roofs             | Pirate Radio      | easy      | You hear what the city is saying, and some of what it would rather not.                    |
| The Unfinished Faculty | Construction Site | hard      | Lifting gear nothing else in the city has. Some things can only be assembled standing up.  |

### Glasshouse Fields

`glasshouse-fields`, called the Green Belt. Difficulty 3 of 10, Combine ground, at 0.1, 0.58 on the map.

State hydroponics behind a fence. Everything the undercity eats is grown here, and none of it is sold here.

State hydroponics on the western flank. Government ground, but the softest of it: difficulty 3, and the usual way in for a crew that is not ready for the Undergrid.

Garrison before anybody takes it: Civic Levy with a squad of Greycoats behind them.

**Unified bonus, The Green Belt Is Fed:** training runs 15% faster, for holding every location in the district.

| Location             | Kind         | Fortified | What holding it pays                                                                                                 |
| -------------------- | ------------ | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Glasshouse Intake    | Water Works  | medium    | Supplies, because clean water is most of what growing it takes.                                                      |
| Fieldgate Market     | Market       | easy      | A cut of everything that changes hands.                                                                              |
| The Berm             | High Ground  | easy      | Everything you hold in this city is harder to take off you.                                                          |
| Hauler Yard          | Rail Yard    | medium    | Bogies, axles and drive parts by the wagonload: everything the garage has been improvising.                          |
| The Long Ladle       | Soup Kitchen | easy      | Supplies off the ration line, and a crew that has eaten fights like one.                                             |
| Chapel of the Furrow | The Chapel   | easy      | Everyone on your books holds together better under things that break people.                                         |
| The Fence Camp       | Fence Camp   | easy      | More people than any building in your district could house, and every one of them looking for a reason to be useful. |
| The Glasshouses      | Hydroponics  | medium    | Supplies straight off the beds, picked before they ever see a market.                                                |

### Blacksite

`blacksite-7`, called the Military District. Difficulty 8 of 10, Combine ground and a seat of Combine power, at 0.33, 0.3 on the map.

Hardened ferrocrete, layered berms, and a Combine rifle company that has never had to leave. The first place anyone learns not to walk into.

A seat of Combine power (`seatOfPower: true`), so taking it counts as replacing the Combine rather than robbing it. Difficulty 8 and hard fortification on six of eight holds.

Garrison before anybody takes it: Street Enforcers behind Suppressor positions.

**Unified bonus, The Garrison Is Yours:** +15% unit offense, for holding every location in the district.

| Location         | Kind                    | Fortified | What holding it pays                                                                                              |
| ---------------- | ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Blacksite Armory | Armory                  | hard      | Cheaper units, and a bench that will fit anything you can find a part for.                                        |
| Outer Berm       | Barricade               | hard      | A harder approach to everything behind it.                                                                        |
| The Watchtower   | Watchtower              | hard      | Everything your scouts do, they do better: everywhere in the city, not just here.                                 |
| Robot Pit        | Fight Pit               | medium    | Your people are harder to frighten, and better for the practice.                                                  |
| Motor Pool       | War Machine Graveyard   | hard      | Hulls, plate and running gear, and troops that come back from more than they should.                              |
| The Drill Hall   | The Gym                 | medium    | One more session in the day than the day has room for.                                                            |
| Psychic Ward     | Black Clinic            | hard      | Syringes. Handed out before a fight, they bring somebody back to strength who had no right to be.                 |
| The Pile         | Abandoned Nuclear Plant | hard      | High-quality metal out of the turbine hall, and a fuelling crew who make every barrel of oil you burn go further. |

### CCS (Civic Command Sector)

`combine-spire`, called the Spire. Difficulty 10 of 10, Combine ground and a seat of Combine power, at 0.57, 0.13 on the map.

The surface spire the government rules from, and the household guard that has never been tested. Taking this is not a raid. It is the end of something.

The last district in the game. The other seat of power, difficulty 10, at the top of the frame.

Garrison before anybody takes it: Suppressors, Enforcers and Greycoats, and whatever the spire can wake.

**Unified bonus, The Spire Is Taken:** 20% off market prices, for holding every location in the district.

| Location                | Kind              | Fortified | What holding it pays                                                                                               |
| ----------------------- | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Command Uplink          | Satellite Uplink  | hard      | You can see into districts without walking into them first.                                                        |
| Combine Armory          | Armory            | hard      | Cheaper units, and a bench that will fit anything you can find a part for.                                         |
| The Household Barricade | Barricade         | hard      | A harder approach to everything behind it.                                                                         |
| Command Broadcast       | Broadcast Station | hard      | Everyone on your books gets better at the half of the job that is talking to people.                               |
| The Ascension Clinic    | Gene Clinic       | hard      | Work can be done on people here that cannot be done anywhere else.                                                 |
| The Unfinished Wing     | Construction Site | hard      | Lifting gear nothing else in the city has. Some things can only be assembled standing up.                          |
| The Martyrs’ Ground     | Graveyard         | medium    | Holding this ground says something the city does not forget, and what is buried here was buried with its rings on. |
| The Chosen Chapel       | The Chosen Chapel | hard      | Your name walks in ahead of your people, and nobody you send out is frightened of anything that lives here.        |

## Residential districts

Four plots, where crews live. They hold no locations, they cannot be captured, and they can be
raided by anybody but their own resident. They differ only in where they sit and how hard the ground
around them is.

### `ashen-terraces`

Difficulty 4, at 0.84, 0.62. No capturable locations.

Stepped tenements up the northern slope, burnt once and rebuilt out of what was left. Whoever holds it can see the whole city coming.

### `kettle-row`

Difficulty 2, at 0.38, 0.82. No capturable locations. The starter district: every new crew is settled here.

A long terrace along the southern cut, boilers venting into the street. Warm, loud, and nobody asks where anybody came from.

### `upper-roofs`

Difficulty 2, at 0.91, 0.79. No capturable locations. Home of the seeded AI rival.

Roofs stacked on roofs above the wall, reached by ladders somebody bolted on in the dark. Nothing official has been up here in years and the view is the whole northern approach.

### `south-quay`

Difficulty 1, at 0.78, 0.93. No capturable locations.

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
| Travel time, vision, nearest districts            | `packages/shared/src/city/geography.ts` |
| The city list                                     | `packages/shared/src/city/cities.ts`    |
| Environment labels per location kind              | `packages/shared/src/city/labels.ts`    |
| Mission boards per district                       | `packages/shared/src/missions.areas.ts` |
| The gradient, spacing and naming tests            | `packages/shared/src/city/city.test.ts` |
