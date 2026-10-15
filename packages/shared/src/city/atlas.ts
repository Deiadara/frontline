import {
  CITY_DISTRICTS,
  UNIFIED_BONUSES,
  districtFrom,
  type District,
  type UnifiedBonus,
} from './districts.js';
import { COMBAT_LEVEL_SCALE, fiveLevelLadder, stationBonuses, type Location } from './locations.js';
import { DEFAULT_CITY_ID } from './cities.js';
import { envLabel } from './labels.js';

/** Terser than `envLabel` in every location's ground. */
const L = envLabel;

/**
 * The other two cities (maintainer request, 2026-09-14).
 *
 * ## Why they are not in `CITY_DISTRICTS`
 *
 * Eighty-one call sites read that array, and every one of them means "the city this crew is
 * standing in": the painted map, the mission board's areas, the control ledger, the seeder, the
 * feats that count contested ground. Appending fourteen districts to it would have silently
 * doubled the map every one of those screens draws, and the first thing to notice would have been a
 * test counting districts rather than anything a player could see.
 *
 * So Ashfall keeps its own array untouched, and the atlas is the layer above: `districtsOfCity`
 * answers for any city, and `ALL_DISTRICTS` is the flat set for the things that genuinely span the
 * world (the standings' "everywhere" scope, `cityOf`). Moving a screen from one to the other is a
 * deliberate edit rather than a surprise.
 *
 * ## What a city is made of
 *
 * Eight contested districts and four plots, the shape Ashfall has: a second playable city a third
 * of the size read as a side area rather than as somewhere to live (maintainer, 2026-09-24). The
 * plots carry no authored name for the reason `UNCLAIMED_DISTRICT_NAME` gives: they are ground a
 * crew moves into, and the name they get is the crew's own.
 *
 * Difficulty runs 1 to 10 across the whole world rather than within a city, so a player crossing
 * over is picking an opponent and not only a postcode. Saltmarch, the three-district sketch that
 * sat here from 2026-09-14, was dropped when Arca took its place on the world screen
 * (maintainer, 2026-10-06).
 */

export const TERMINUS_CITY_ID = 'terminus';

const TERMINUS: readonly District[] = [
  districtFrom({
    id: 'coldwater-halt',
    cityId: TERMINUS_CITY_ID,
    name: 'Coldwater Halt',
    nickname: 'the Halt',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.08, y: 0.9 },
    difficulty: 1,
    blurb:
      'A request stop on the flats at the west end, where the line crosses forty miles of nothing. The train stops here because there is a town, and there is a town because the train stops here.',
    locations: [
      /*
       * Every Station pays caps off its ticket office, ten an hour per point of the district's
       * difficulty at level 1 (maintainer, 2026-10-09). Coldwater's is the exception at twenty, so
       * the first platform on the line is worth taking for its own sake.
       */
      {
        slug: 'platform',
        name: 'Coldwater Platform',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(20),
        labels: [L('open', 2), L('windy', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'market',
        name: 'The Halt Market',
        icon: 'market',
        blurb: 'Awnings, arguments, and a hundred people moving goods nobody has papers for.',
        reward:
          'Whoever runs the market at the halt talks to the Broker first, and gets the better number.',
        bonuses: [{ kind: 'broker_rate', percent: 10, ladder: fiveLevelLadder(10, 35) }],
        labels: [L('crammed', 2), L('noisy', 3)],
        contexts: ['urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The pitches are numbered and rented instead of fought over.',
          'A covered row along the north side, so the market keeps trading in the rain.',
          'Your own weigh house at the gate. Nothing crosses it uncounted.',
        ],
      },

      {
        slug: 'standpipe',
        name: 'The Standpipe',
        icon: 'water_works',
        blurb: 'Intake screens, settling beds and a pumphouse under a corrugated roof.',
        reward: 'Supplies, because clean water is most of what growing it takes.',
        bonuses: [
          { kind: 'resource', resource: 'supplies', perHour: 35, ladder: fiveLevelLadder(35, 110) },
        ],
        labels: [L('wet', 2), L('crammed', 1), L('noisy', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 150,
        upgrades: [
          'Better plumbing: the leaking main under the yard is dug up and replaced.',
          'The settling beds are dredged and the intake screens stop clogging weekly.',
          'A chlorination house at the outfall. Nothing that leaves here makes anybody ill.',
        ],
      },

      {
        slug: 'kitchens',
        name: 'Trackside Kitchens',
        icon: 'soup_kitchen',
        blurb: 'Trestle tables, a queue that starts before dawn, and two women who never sit down.',
        reward: 'The rabble eat here before a fight, and walk into it harder to put down.',
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'vitality',
            flat: 10,
            tier: 'rabble',
            ladder: fiveLevelLadder(10, 20),
          },
        ],
        labels: [L('crammed', 2), L('noisy', 2), L('hot', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 100,
        upgrades: [
          'A second serving line, so the queue clears before the food does.',
          'Cold store out the back. Nothing is thrown away at the end of a day any more.',
          'Bread ovens. People come here who did not have to, which is worth more than the bread.',
        ],
      },

      {
        slug: 'fuelling',
        name: 'The Fuelling Point',
        icon: 'gas_station',
        blurb:
          'Four pumps under a sagging canopy, a shop with nothing in it, and tanks underneath that turned out to be mostly full.',
        reward:
          'Diesel off the tanks, and the fitters who keep the line’s engines running build yours for less scrap.',
        bonuses: [
          { kind: 'resource', resource: 'oil', perHour: 25, ladder: fiveLevelLadder(25, 75) },
          { kind: 'vehicle_scrap', percent: 5, ladder: fiveLevelLadder(5, 10) },
        ],
        labels: [L('open', 2), L('toxic', 1), L('windy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The underground tanks are pumped out properly instead of siphoned by hand.',
          'A filtration rig in the back bay, so what comes up is worth selling.',
          'The forecourt is fenced, lit and manned. Nothing walks off it any more.',
        ],
      },

      {
        slug: 'tentrow',
        name: 'Tent Row',
        icon: 'refugee_camp',
        blurb:
          'Two thousand people along the green belt fence, in whatever they could carry, because the food is on the other side of it.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [{ kind: 'unit_slots', flat: 50, ladder: fiveLevelLadder(50, 175) }],
        labels: [L('crammed', 2), L('cold', 2), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      {
        slug: 'signal',
        name: 'The Distant Signal',
        icon: 'watchtower',
        blurb:
          'A lattice mast with a cabin on top, a working pair of glasses, and a line of sight over four districts.',
        reward: 'Everything your spies do, they do better: everywhere in the city, not just here.',
        bonuses: [{ kind: 'intel', percent: 40, ladder: fiveLevelLadder(40, 140) }],
        labels: [L('elevated', 3), L('windy', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'ironmouth',
    cityId: TERMINUS_CITY_ID,
    name: 'Ironmouth',
    nickname: 'the Cutting',
    kind: 'contested',
    // Looter ground. `allegiance` says only whether the Combine owns it; who stands on the plots
    // of everything else is `startingHolder`, and how many of them is `SQUATTED_PLACES` below.
    allegiance: 'independent',
    position: { x: 0.22, y: 0.8 },
    difficulty: 2,
    blurb:
      'The west tunnel mouth, where the line goes under the ridge. A town grew in the cutting either side of it and then grew into it: the ventilation shafts are streets, and the bricked arches are houses.',
    locations: [
      {
        slug: 'halt',
        name: 'Ironmouth Halt',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(20),
        labels: [L('open', 2), L('foggy', 1), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'shafts',
        name: 'The Ventilation Shafts',
        icon: 'sewer_junction',
        blurb: 'A brick chamber where six storm drains meet. It goes everywhere.',
        reward: 'Your people can get places without being seen getting there.',
        // Flat stealth on every unit, 5 rising to 10 (maintainer, 2026-10-09), where a sewer
        // junction paid a share.
        bonuses: [
          { kind: 'unit_stat_flat', stat: 'stealth', flat: 5, ladder: fiveLevelLadder(5, 10) },
        ],
        labels: [L('crammed', 2), L('dark', 2), L('wet', 1)],
        contexts: ['underground'],
        baseDefense: 2,
        upgradeCost: 130,
        upgrades: [
          'The collapsed eastern run is dug out. Two more ways in and out.',
          'Duckboards and lamps the whole length, so a crew moves at walking pace.',
          'A mapped network with marked exits in six districts. Nobody goes the wrong way.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'arches',
        name: 'The Bricked Arches',
        icon: 'smugglers_tunnel',
        blurb:
          'Cut by hand under the old customs line, shored with railway sleepers, and in continuous use since before anybody now alive.',
        reward:
          'Every crew you send to work in this city gets there and back sooner. There is a shorter way under the ridge and you own it.',
        // The road to every job in Terminus, not the work on site: 10 rising to 20
        // (maintainer, 2026-10-09).
        bonuses: [{ kind: 'mission_travel', percent: 10, ladder: fiveLevelLadder(10, 20) }],
        labels: [L('crammed', 2), L('dark', 2), L('eerie', 1)],
        contexts: ['underground'],
        baseDefense: 4,
        upgradeCost: 250,
        upgrades: [
          'The flooded section is pumped and the shoring replaced. It is safe at a run.',
          'A second shaft at the far end, so traffic stops meeting itself in the middle.',
          'Trolley rails the whole length. What used to be a night is now an hour.',
        ],
      },

      {
        slug: 'shaftnine',
        name: 'Shaft Nine',
        icon: 'chemical_plant',
        blurb: 'Cracking towers and a tank farm. Everything downwind of it tastes of it.',
        reward:
          'Oil, cracked at the bottom of the shaft, and enough of it spare that running your Generator hot costs you less.',
        // Oil, and a cheaper burn at the Generator (maintainer, 2026-10-09).
        bonuses: [
          { kind: 'resource', resource: 'oil', perHour: 30, ladder: fiveLevelLadder(30, 80) },
          { kind: 'boost_oil', percent: 10, ladder: fiveLevelLadder(10, 20) },
        ],
        labels: [L('toxic', 2), L('noisy', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 170,
        upgrades: [
          'The third cracking tower is repacked and lit.',
          'Feedstock lines rerouted off the ruined header. Nothing is being flared off any more.',
          'Catalyst recovery, so the expensive part of the process stops leaving in the smoke.',
        ],
      },

      {
        slug: 'spoil',
        name: 'The Spoil Heap',
        icon: 'scrap_press',
        blurb: 'Baling presses and a sorting floor that has not stopped since before the war.',
        reward:
          'Forty years of tipped spoil and the people who sort it. Everything your yard cuts, they teach your crew something from.',
        // XP for every press at the Scrapyard, 200 scaled up to 1000 (maintainer, 2026-10-09).
        bonuses: [{ kind: 'scrapyard_xp', flat: 200, ladder: fiveLevelLadder(200, 1000) }],
        labels: [L('noisy', 2), L('elevated', 1), L('crammed', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 2,
        upgradeCost: 160,
        upgrades: [
          'The second baler comes back online and the sorting floor stops backing up.',
          'A magnetic separator over the belt, so nobody is picking metal out by hand.',
          'Night shift. The presses run until somebody stops them, and nobody does.',
        ],
      },

      {
        slug: 'chapel',
        name: 'The Tunnel Chapel',
        icon: 'chapel',
        blurb:
          'Twelve pews, a working bell, and a man who has buried more of this district than anybody would like to count.',
        reward:
          'Everyone on your books comes out of the tunnel better with their hands, harder to break, and surer of the way.',
        // Three named skills on every officer, 5 scaled up to 10 (maintainer, 2026-10-09), where the
        // kind pays the mental group and the steady nerve.
        bonuses: [
          { kind: 'officer_skill', attribute: 'craft', flat: 5, ladder: fiveLevelLadder(5, 10) },
          { kind: 'officer_skill', attribute: 'resolve', flat: 5, ladder: fiveLevelLadder(5, 10) },
          {
            kind: 'officer_skill',
            attribute: 'navigation',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
        ],
        labels: [L('eerie', 2), L('dark', 1), L('cold', 1)],
        contexts: ['indoor'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The roof is made good and the bell rings on the hour again.',
          'A vestry for people who want to talk without a congregation listening.',
          'Somebody is here at any hour, and the district has noticed.',
        ],
      },

      {
        slug: 'lampman',
        name: 'Lampman’s Row',
        icon: 'pawn_shop',
        blurb: 'A barred window, a long counter, and a back room with better stock.',
        reward:
          'Every lamp in the cutting is filled and trimmed from this row. Light them and the tunnel streets lose their dark and their fog; put them out and nobody down there sees a thing. Worked all the way up, the whole city goes the way you choose.',
        // The lamps, which the holder lights or puts out (maintainer, 2026-10-09).
        bonuses: [{ kind: 'lamps_switch' }],
        labels: [L('crammed', 2), L('dark', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 80,
        upgrades: [
          'The back room is cleared and shelved. Twice the stock, half the arguments.',
          'A second counter for people who would rather not queue where they can be seen.',
          'A yard behind with a gate on it. Whole truckloads, not armfuls.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'marshalling-yards',
    cityId: TERMINUS_CITY_ID,
    name: 'The Marshalling Yards',
    nickname: 'the Yards',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.34, y: 0.7 },
    difficulty: 3,
    blurb:
      'Sixty miles of siding with a thousand wagons parked on it. Whoever sorts the yard decides what leaves this city and when.',
    locations: [
      {
        slug: 'hump',
        name: 'The Hump',
        icon: 'rail_yard',
        blurb: 'Sidings, a turntable, and rolling stock that will move if pushed hard enough.',
        reward:
          'The yard gang know how to load a wagon past what the plate on its side says. Every machine you own carries more of your people.',
        // Bigger loads on every machine, 10 scaled up to 20 (maintainer, 2026-10-09). It no
        // longer opens the Loose End, which the Hauler Yard in Glasshouse Fields still does.
        bonuses: [{ kind: 'vehicle_capacity', percent: 10, ladder: fiveLevelLadder(10, 20) }],
        labels: [L('open', 3), L('noisy', 1), L('windy', 1)],
        contexts: ['open_ground'],
        baseDefense: 4,
        upgradeCost: 270,
        upgrades: [
          'The turntable is freed off, so stock stops having to be dragged out backwards.',
          'A lifting shop over the pit road. Bogies come out whole instead of in pieces.',
          'Two sidings cleared and a locomotive that runs. The yard starts feeding itself.',
        ],
      },

      // Was the Turntable, a construction site. The working heart of the railway could not be the
      // one part of it without a platform (maintainer, 2026-09-24).
      {
        slug: 'platformfour',
        name: 'Platform Four',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(30),
        labels: [L('open', 2), L('windy', 2), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'coalstage',
        name: 'The Coaling Stage',
        icon: 'gas_station',
        blurb:
          'Four pumps under a sagging canopy, a shop with nothing in it, and tanks underneath that turned out to be mostly full.',
        reward:
          'Oil off the coaling road, and the fitters who keep the yard engines hot keep yours hotter. Every machine you own runs faster.',
        // Faster machines and oil, each on the ladder with the doubled last step (maintainer,
        // 2026-10-09).
        bonuses: [
          { kind: 'vehicle_speed', percent: 5, ladder: fiveLevelLadder(5, 10) },
          { kind: 'resource', resource: 'oil', perHour: 40, ladder: fiveLevelLadder(40, 140) },
        ],
        labels: [L('open', 2), L('toxic', 2), L('foggy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The underground tanks are pumped out properly instead of siphoned by hand.',
          'A filtration rig in the back bay, so what comes up is worth selling.',
          'The forecourt is fenced, lit and manned. Nothing walks off it any more.',
        ],
      },

      {
        slug: 'breakers',
        name: 'The Wagon Breakers',
        icon: 'scrap_press',
        blurb: 'Baling presses and a sorting floor that has not stopped since before the war.',
        reward:
          'Wagons broken down to the frame on the far sidings. Every morning something worth keeping comes off them, and it comes to you.',
        /*
         * Components at the day's turn, of a rarity the level fixes (maintainer, 2026-10-09): one
         * basic, one intricate, two intricate, two advanced, three advanced.
         */
        bonuses: [
          {
            kind: 'daily_component',
            count: 1,
            ladder: [1, 1, 2, 2, 3],
            rarities: ['basic', 'intricate', 'intricate', 'advanced', 'advanced'],
          },
        ],
        labels: [L('noisy', 3), L('crammed', 2)],
        contexts: ['urban', 'indoor'],
        baseDefense: 2,
        upgradeCost: 160,
        upgrades: [
          'The second baler comes back online and the sorting floor stops backing up.',
          'A magnetic separator over the belt, so nobody is picking metal out by hand.',
          'Night shift. The presses run until somebody stops them, and nobody does.',
        ],
      },

      {
        slug: 'signalbox',
        name: 'Box Nine',
        icon: 'watchtower',
        blurb:
          'A lattice mast with a cabin on top, a working pair of glasses, and a line of sight over four districts.',
        reward:
          'The signal box sees the whole yard, and so do the spotters you put in it. Your Snipers shoot further and harder from here, and at the top nobody frightens them.',
        /*
         * Spotters for your Snipers (maintainer, 2026-10-09): range and damage from level 2, and
         * SAFE DISTANCE at level 5. Level 1 is the door: holding the box is what lets a crew train
         * Snipers (`place` in their requirements).
         */
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'range',
            flat: 0,
            unitId: 'snipers',
            ladder: fiveLevelLadder(0, 10),
          },
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            flat: 0,
            unitId: 'snipers',
            ladder: fiveLevelLadder(0, 100),
          },
          { kind: 'unit_mark', unitId: 'snipers', mark: 'safe_distance', fromLevel: 5 },
        ],
        labels: [L('elevated', 3), L('windy', 2), L('open', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },

      {
        slug: 'messroom',
        name: 'The Mess Room',
        icon: 'tavern',
        blurb:
          'Low ceiling, long bar, and a corner table that has been the same three people’s corner table for twenty years.',
        reward:
          'Where the Breakers drink between jobs. Yours come out of it hitting harder and harder to put down, and at the top they go looking for the Rabble.',
        /*
         * The Breakers' bar (maintainer, 2026-10-09): damage and vitality from level 2, and DRUNK
         * at level 5. Level 1 is the door: holding it lets a crew train Breakers (`place` in their
         * requirements). It opens nothing else.
         */
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            flat: 0,
            unitId: 'breakers',
            ladder: fiveLevelLadder(0, 100),
          },
          {
            kind: 'unit_stat_flat',
            stat: 'vitality',
            flat: 0,
            unitId: 'breakers',
            ladder: fiveLevelLadder(0, 150),
          },
          { kind: 'unit_mark', unitId: 'breakers', mark: 'drunk', fromLevel: 5 },
        ],
        labels: [L('crammed', 3), L('noisy', 2), L('dark', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The cellar is restocked and the back room is yours whenever you want it.',
          'A door policy. The people worth meeting stop being drowned out by the people who are not.',
          'You are the house. Every introduction in this room goes through you now.',
        ],
      },

      {
        slug: 'sheds',
        name: 'The Running Sheds',
        icon: 'foundry',
        blurb: 'Two cupola furnaces and a pour floor, running whenever there is fuel for it.',
        reward:
          'The engine sheds, where they still know how to plate a locomotive. They plate your Heavies the same way.',
        // Armour plate for your Heavies, 5 scaled up to 10, and nothing else (maintainer,
        // 2026-10-09).
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            flat: 5,
            tier: 'heavy',
            ladder: fiveLevelLadder(5, 10),
          },
        ],
        labels: [L('hot', 2), L('noisy', 2), L('foggy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 290,
        upgrades: [
          'The second cupola is relined and lit for the first time in a decade.',
          'A proper sand plant, so a bad mould stops costing a whole pour.',
          'Induction holding furnace. The metal comes out the same every single time.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'bonded-row',
    cityId: TERMINUS_CITY_ID,
    name: 'Bonded Row',
    nickname: 'the Bond',
    kind: 'contested',
    // Looter ground, same as Ironmouth: see the note there.
    allegiance: 'independent',
    position: { x: 0.47, y: 0.6 },
    difficulty: 4,
    blurb:
      'Bonded warehouses, where freight waited for a clearance that stopped coming. The paperwork is still in the office and the crates are still on the floor, and everybody in the city knows which is which.',
    locations: [
      {
        slug: 'halt',
        name: 'Bond Street Halt',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(40),
        labels: [L('open', 2), L('noisy', 2), L('windy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'longbond',
        name: 'The Long Bond',
        icon: 'downtown_market',
        blurb:
          'The old exchange floor, still trading, with the board on the wall repainted every morning by somebody who knows.',
        reward:
          'The bonded warehouse still clears freight for whoever holds the book. Whatever you buy on the supply run comes through it cheaper.',
        // The supply run, 10 scaled up to 20 off, and nothing else (maintainer, 2026-10-09).
        bonuses: [{ kind: 'supply_discount', percent: 10, ladder: fiveLevelLadder(10, 20) }],
        labels: [L('crammed', 2), L('noisy', 3)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 170,
        upgrades: [
          'Your people are on the floor at open, which is where the day’s price is decided.',
          'A seat on the board. The number goes up when you say it does.',
          'The clearing book runs through your hands. Everyone else trades on your terms.',
        ],
      },

      {
        slug: 'seized',
        name: 'The Seized Goods Office',
        icon: 'pawn_shop',
        blurb: 'A barred window, a long counter, and a back room with better stock.',
        reward:
          'Paperwork seized at the border and never claimed. Every morning a clerk finds a page of somebody’s plans in it, and it comes to you.',
        /*
         * A blueprint page a day that the crew does not hold yet (maintainer, 2026-10-09): one,
         * one, two, two, three a day, at odds that improve at levels 2 and 4.
         */
        bonuses: [{ kind: 'daily_page', counts: [1, 1, 2, 2, 3], odds: [1, 2, 2, 3, 3] }],
        labels: [L('crammed', 3), L('dark', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 80,
        upgrades: [
          'The back room is cleared and shelved. Twice the stock, half the arguments.',
          'A second counter for people who would rather not queue where they can be seen.',
          'A yard behind with a gate on it. Whole truckloads, not armfuls.',
        ],
      },

      {
        slug: 'rendering',
        name: 'The Rendering Shed',
        icon: 'bone_market',
        blurb:
          'Where the city sells what is left of people and machines. Brisk, unsentimental, and open every day of the year.',
        reward: 'What you lose in a fight comes back as caps instead of coming back as nothing.',
        bonuses: [{ kind: 'salvage_refund', percent: 12 }],
        labels: [L('eerie', 2), L('toxic', 2), L('crammed', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'Your own recovery crew works the field before anybody else gets there.',
          'A rendering shed, so what comes back is sorted rather than sold in a heap.',
          'Standing contracts with three districts. Nothing you lose is lost entirely.',
        ],
      },

      {
        slug: 'crated',
        name: 'The Crated Yard',
        icon: 'construction_site',
        blurb:
          'A tower crane, a poured raft the size of a city block, and thirty years of nobody finishing it.',
        reward:
          'Crates nobody ever cleared, stacked three high. Break them open and there is timber in the crates and food in some of them.',
        /*
         * Planks and supplies off the crates, and nothing else (maintainer, 2026-10-09): planks
         * 30 a step of 25, supplies 20 a step of 15, the last level a double step. No build clock,
         * and it does not open the Colossus.
         */
        bonuses: [
          { kind: 'resource', resource: 'planks', perHour: 30, ladder: fiveLevelLadder(30, 155) },
          { kind: 'resource', resource: 'supplies', perHour: 20, ladder: fiveLevelLadder(20, 95) },
        ],
        labels: [L('open', 2), L('elevated', 2), L('windy', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 6,
        upgradeCost: 460,
        upgrades: [
          'The tower crane is recommissioned and passes a load test at full radius.',
          'A second crane on the east raft, so two things can be built at once.',
          'The site is decked, lit and enclosed. It becomes a yard rather than a hole.',
        ],
      },

      {
        slug: 'kennels',
        name: 'The Kennels',
        icon: 'doghouse',
        blurb:
          'Kennels under the flyover, a surgery at the back, and forty animals that go quiet when the right person walks in.',
        reward:
          'Kennels behind the bonded warehouses, and a vet who asks no questions. The hounds raised here are yours, and the best of them look after your rabble.',
        /*
         * Cyberhounds and nothing else (maintainer, 2026-10-09): holding it opens them (named in
         * their requirements), every level makes yours tougher and harder-hitting, and at level 5
         * they are GOOD BOYs. No intimidation.
         */
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            flat: 5,
            unitId: 'cyber_dogs',
            ladder: fiveLevelLadder(5, 30),
          },
          {
            kind: 'unit_stat_flat',
            stat: 'vitality',
            flat: 30,
            unitId: 'cyber_dogs',
            ladder: fiveLevelLadder(30, 180),
          },
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            flat: 30,
            unitId: 'cyber_dogs',
            ladder: fiveLevelLadder(30, 180),
          },
          { kind: 'unit_mark', unitId: 'cyber_dogs', mark: 'good_boy', fromLevel: 5 },
        ],
        labels: [L('noisy', 3), L('crammed', 1), L('dark', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The surgery gets a clean room, and the survival rate stops being a talking point.',
          'A run and a scent yard, so the animals are trained rather than merely kept.',
          'A breeding line of your own. What comes out of here is better than what went in.',
        ],
      },

      {
        slug: 'coldstore',
        name: 'The Cold Store',
        icon: 'black_clinic',
        blurb:
          'A basement with good lighting, a locked cabinet, and a doctor who lost their licence for reasons nobody discusses.',
        reward:
          'Blood and plasma kept on ice under the bond. Every Stitcher you send carries some, and everybody beside them is harder to put down.',
        /*
         * Blood and plasma on ice, and nothing else (maintainer, 2026-10-09): every Stitcher you
         * field puts one vitality a level on every other unit beside it, +1 to +5, the top not
         * doubled, and at level 5 the Stitchers work from a SAFE DISTANCE. No battle stims.
         */
        bonuses: [
          { kind: 'stitcher_vitality', flat: 1 },
          { kind: 'unit_mark', unitId: 'stitchers', mark: 'safe_distance', fromLevel: 5 },
        ],
        labels: [L('cold', 2), L('crammed', 2), L('toxic', 1)],
        contexts: ['indoor', 'underground'],
        baseDefense: 4,
        upgradeCost: 150,
        upgrades: [
          'A second bench and a chemist on it. Output goes from a trickle to a supply.',
          'Cold storage, so a batch stops going off before it is used.',
          'A formula that does not take as much out of the person it goes into.',
        ],
      },

      {
        slug: 'ring',
        name: 'The Crate Ring',
        icon: 'fight_pit',
        blurb: 'A sunk ring, a standing crowd, and a bookmaker who knows everyone.',
        reward:
          'A ring of shipping crates where an old toymaker sets his work against whoever will fight it. Hold it and he works for you, and the better the ring, the better the work.',
        /*
         * The Geppetto's door and nothing else (maintainer, 2026-10-09): holding it opens him
         * (named in his requirements) and its level sets his robots. No infamy for the
         * intimidated, and it opens nothing else.
         */
        bonuses: [{ kind: 'ad_hoc_army' }],
        labels: [L('crammed', 3), L('noisy', 3)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 130,
        upgrades: [
          'Tiered benches and a bell. Twice the crowd and four times the noise.',
          'A card every night instead of whenever somebody feels like it.',
          'A trainer on the payroll who used to be somebody. People come to lose to him.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'telemetry-hill',
    cityId: TERMINUS_CITY_ID,
    name: 'Telemetry Hill',
    nickname: 'the Hill',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.62, y: 0.34 },
    difficulty: 6,
    blurb:
      'Dishes and masts on the only rise for forty miles. Everything the Combine knows about the frontier, it knows through here.',
    locations: [
      {
        slug: 'uplink',
        name: 'The Uplink Farm',
        icon: 'satellite_uplink',
        blurb: 'A dish on a mast, aligned by hand, talking to something still in orbit.',
        reward:
          'A field of dishes tuned to everything the Combine says to itself. Every officer you have learns a little more of the language.',
        /*
         * Four skills on every officer, 5 scaled up to 10 like the Tunnel Chapel, and nothing else
         * (maintainer, 2026-10-09): no spy points, and it does not open the Specter, who comes off
         * other cities' dishes.
         */
        bonuses: [
          { kind: 'officer_skill', attribute: 'signals', flat: 5, ladder: fiveLevelLadder(5, 10) },
          {
            kind: 'officer_skill',
            attribute: 'cryptography',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'cybernetics',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'navigation',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
        ],
        labels: [L('elevated', 3), L('windy', 3), L('cold', 1)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 180,
        upgrades: [
          'The dish is re-aimed properly and the signal stops dropping out at dusk.',
          'A second receiver, so two birds can be tracked instead of one.',
          'Decryption on site. What comes down is read here rather than carried somewhere.',
        ],
      },

      {
        slug: 'repeater',
        name: 'The Repeater Mast',
        icon: 'broadcast_tower',
        blurb:
          'A mast with a working transmitter, and whoever holds it decides what the city hears.',
        reward:
          'The highest place in the city, and perfect for paragliding. Your Kite Crews launch from the top of the mast and come down on whoever is below.',
        /*
         * The Kite Crews' ground and nothing else (maintainer, 2026-10-09): holding it is one of
         * their requirements, every level makes yours tougher and harder-hitting (+30 to +180),
         * and at level 5 they fly from the ROOFTOP.
         */
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            flat: 30,
            unitId: 'kite_crews',
            ladder: fiveLevelLadder(30, 180),
          },
          {
            kind: 'unit_stat_flat',
            stat: 'vitality',
            flat: 30,
            unitId: 'kite_crews',
            ladder: fiveLevelLadder(30, 180),
          },
          { kind: 'unit_mark', unitId: 'kite_crews', mark: 'rooftop', fromLevel: 5 },
        ],
        labels: [L('elevated', 3), L('foggy', 2), L('windy', 2)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 150,
        upgrades: [
          'Output doubled. The signal reaches the upper levels for the first time.',
          'A standby set, so being knocked off air stops being a thing that happens.',
          'Your own hour, every evening, and the city has started planning around it.',
        ],
      },

      {
        slug: 'quiet',
        name: 'The Quiet Room',
        icon: 'university',
        blurb: 'Lecture halls turned workshops, and a library nobody got round to burning.',
        reward:
          'A soundproofed room where the operators learned their trade in silence. Whoever studies in it learns faster.',
        /*
         * Training and nothing else (maintainer, 2026-10-09): drills 2.5% shorter a level to 10%
         * at level 4, and level 5 keeps the 10% and adds a session a day. Written out, not doubled.
         */
        bonuses: [
          { kind: 'training_time', percent: 2.5, ladder: [2.5, 5, 7.5, 10, 10] },
          { kind: 'training_sessions', flat: 1, ladder: [0, 0, 0, 0, 1] },
        ],
        labels: [L('crammed', 2), L('dark', 2), L('eerie', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The east reading room is reopened and catalogued.',
          'Power to the workshops, so the equipment in them stops being furniture.',
          'Three of the old faculty come back. That is the upgrade; the rooms were never the problem.',
        ],
      },

      {
        slug: 'lodge',
        name: 'Hilltop Lodge',
        icon: 'pirate_radio',
        blurb:
          'A transmitter in a loft, a wire aerial over four roofs, and an operator who moves it every few weeks.',
        reward:
          'A timber lodge on the crown of the hill, with a stove that never goes out and bunks for a company. Everybody who walks up the hill wants to sleep here.',
        // Beds and nothing else (maintainer, 2026-10-09): 80, 110, 140, 170, 230 unit slots.
        bonuses: [{ kind: 'unit_slots', flat: 80, ladder: fiveLevelLadder(80, 230) }],
        labels: [L('crammed', 2), L('elevated', 2), L('cold', 1), L('dark', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 100,
        upgrades: [
          'A directional aerial. Twice the reach and half the chance of being found.',
          'A second set in another building, so being raided stops meaning being off air.',
          'Listeners in six districts calling things in. The station stops being the source.',
        ],
      },

      {
        slug: 'dome',
        name: 'The Old Dome',
        icon: 'planetarium',
        blurb:
          'A dome, a projector the size of a car, and a hundred and eighty seats nobody has sat in for years.',
        reward:
          'An observatory dome on the crest with every street of the frontier charted on its ceiling. The Cartographer learned the city here, and she still comes back to read it.',
        /*
         * The Cartographer's ground and nothing else (maintainer, 2026-10-09): she is trained here
         * (named in her requirements), every level makes yours quicker and harder to put down
         * (+5 to +30 speed, +100 to +600 vitality), and at level 5 she has PERCEPTION.
         */
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'speed',
            flat: 5,
            unitId: 'the_cartographer',
            ladder: fiveLevelLadder(5, 30),
          },
          {
            kind: 'unit_stat_flat',
            stat: 'vitality',
            flat: 100,
            unitId: 'the_cartographer',
            ladder: fiveLevelLadder(100, 600),
          },
          { kind: 'unit_mark', unitId: 'the_cartographer', mark: 'perception', fromLevel: 5 },
        ],
        labels: [L('dark', 4), L('eerie', 2), L('crammed', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 190,
        upgrades: [
          'The projector is rebuilt and the dome is dark again for the first time in years.',
          'The optical bench is stripped and repurposed. It is the best glass in the district.',
          'Sessions every night. Your researchers start solving things in the dark.',
        ],
      },

      {
        slug: 'array',
        name: 'The Ground Array',
        icon: 'power_station',
        blurb:
          'A Combine switching yard off the old trunk, with a bunded tank farm behind it for the standby sets.',
        reward:
          'A field of earthing rods and capacitor banks under the dishes. Everything you field that fires energy draws off it and hits harder.',
        // Energy weapons and nothing else (maintainer, 2026-10-09): +10% damage to +20%.
        bonuses: [
          {
            kind: 'damage_type_offense',
            damageType: 'energy',
            percent: 10,
            ladder: fiveLevelLadder(10, 20),
          },
        ],
        labels: [L('noisy', 3), L('toxic', 2), L('open', 1)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 230,
        upgrades: [
          'The cracked tank at the north end is patched and brought back into service.',
          'Valve gear replaced, so one leak stops taking the whole bund out of use with it.',
          'A second draw line off the spur. Twice the throughput and half the spills.',
        ],
      },

      {
        slug: 'bunkroom',
        name: 'The Technicians’ Bunkroom',
        icon: 'refugee_camp',
        blurb:
          'Two thousand people along the green belt fence, in whatever they could carry, because the food is on the other side of it.',
        reward:
          'Bunks for the technicians who keep the dishes turning, and a blackboard nobody wipes. Whoever drills beside them picks up more than they came for.',
        /*
         * Training and nothing else (maintainer, 2026-10-09): a finished drill pays a point more
         * one time in ten at level 1 up to one in two at level 5, written out and not doubled, and
         * level 5 adds a session a day.
         */
        bonuses: [
          { kind: 'drill_bonus', percent: 10, ladder: [10, 20, 30, 40, 50] },
          { kind: 'training_sessions', flat: 1, ladder: [0, 0, 0, 0, 1] },
        ],
        labels: [L('crammed', 3), L('cold', 2), L('noisy', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'viaduct',
    cityId: TERMINUS_CITY_ID,
    name: 'The Viaduct',
    nickname: 'the Arches',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.58, y: 0.48 },
    difficulty: 7,
    blurb:
      'Forty brick arches carrying the line over the river gorge, and the Combine holds every one of them, because there is no line without them. Each arch is bricked up into something: a workshop, a barracks, a clinic nobody asks about.',
    locations: [
      {
        slug: 'halt',
        name: 'Viaduct Halt',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(70),
        labels: [L('elevated', 3), L('windy', 3), L('open', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'battery',
        name: 'The Arch Battery',
        icon: 'barricade',
        blurb: 'Sea containers, rubble and rebar, arranged by somebody who had thought about it.',
        reward:
          'A gun battery bricked into an arch over the gorge. Whoever stands in front for you stands behind a yard of brick.',
        // TAUNT units 10% to 20% tougher and nothing else (maintainer, 2026-10-13): no defence, and
        // it no longer hands the Ironsides Holds the Line.
        bonuses: [
          {
            kind: 'unit_stat_percent',
            stat: 'vitality',
            percent: 10,
            rule: 'taunts',
            ladder: fiveLevelLadder(10, 20),
          },
        ],
        labels: [L('crammed', 3), L('elevated', 2), L('windy', 1)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 260,
        upgrades: [
          'The gaps are filled and the whole line is tied together with rebar.',
          'A second course of containers, offset, so nothing has a straight run at it.',
          'Firing slits, a sally port, and a roof over the fighting step.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'parapet',
        name: 'The Parapet',
        icon: 'high_ground',
        blurb:
          'A roofline, a water tower, a spoil heap. Whatever counts as looking down around here.',
        reward:
          'The parapet along the top of the viaduct, with the whole gorge under it. Anything that shoots far shoots better from here.',
        // The long guns and nothing else (maintainer, 2026-10-13): range above 50, +10% to +20%
        // damage. No defence.
        bonuses: [
          {
            kind: 'unit_stat_percent',
            stat: 'offense',
            percent: 10,
            rangeAbove: 50,
            ladder: fiveLevelLadder(10, 20),
          },
        ],
        labels: [L('elevated', 4), L('open', 2), L('windy', 2)],
        contexts: ['open_ground'],
        baseDefense: 4,
        upgradeCost: 210,
        upgrades: [
          'Sandbagged firing positions instead of whatever people were crouching behind.',
          'A cut stair up the back, so the position can be reinforced under fire.',
          'Overhead cover and a ready magazine. It stops being a vantage and becomes a work.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'gantry',
        name: 'The Gantry Walk',
        icon: 'tram_depot',
        blurb:
          'Eight roads under one roof, half the fleet still on them, and overhead line that is live in places.',
        reward:
          'A walkway along the tram gantries, from one end of the line to the other. Whoever works this city works it faster from up here.',
        // Every job in this city runs 10% to 20% faster, the whole clock (maintainer, 2026-10-13).
        // The misc board is worked in the home city, so it counts there. No road cut.
        bonuses: [
          { kind: 'mission_speed', percent: 10, inCity: true, ladder: fiveLevelLadder(10, 20) },
        ],
        labels: [L('elevated', 2), L('crammed', 2), L('dark', 2), L('noisy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 230,
        upgrades: [
          'Two cars are made roadworthy and the depot road is cleared to the street.',
          'The overhead is repaired as far as the junction. No more towing.',
          'A running timetable on three routes. Your people stop walking anywhere.',
        ],
      },

      {
        slug: 'archnineteen',
        name: 'Arch Nineteen',
        icon: 'mad_scientist_lair',
        blurb:
          'Down a service stair behind a laundry: tanks, a generator, an operating table, and forty years of notes in one handwriting.',
        reward:
          'An arch bricked up and lit from inside, where people go in and something else comes out. The Hollow Men are made here, and made better the longer you keep it.',
        /*
         * The Hollow Men's ground and nothing else (maintainer, 2026-10-13): they are made here
         * (named in their requirements), every level to 4 makes yours tougher and harder-hitting
         * (+50 vitality and +30 damage a level), and level 5 keeps level 4 and adds Terror, in
         * gold and stronger than anybody else's. No research, no offense, and it does not open the
         * Abomination or the Twins.
         */
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'vitality',
            flat: 50,
            unitId: 'hollow_men',
            ladder: [50, 100, 150, 200, 200],
          },
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            flat: 30,
            unitId: 'hollow_men',
            ladder: [30, 60, 90, 120, 120],
          },
          {
            kind: 'unit_modifier',
            unitId: 'hollow_men',
            modifier: 'golden_terror',
            golden: true,
            fromLevel: 5,
          },
        ],
        labels: [L('crammed', 2), L('toxic', 2), L('dark', 2), L('eerie', 2)],
        contexts: ['underground', 'indoor'],
        baseDefense: 7,
        upgradeCost: 290,
        upgrades: [
          'The tanks are drained, cleaned and refilled. Whatever was in them is gone.',
          'Power off your own grid rather than the generator, so nothing is interrupted again.',
          'The notes are transcribed and understood. That is the upgrade, and it is the frightening one.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'pierworks',
        name: 'The Pier Works',
        icon: 'foundry',
        blurb: 'Two cupola furnaces and a pour floor, running whenever there is fuel for it.',
        reward:
          'Two furnaces on the pier under the arch, burning day and night. What comes out of them comes to you.',
        // Scrap and HQ metal and nothing else (maintainer, 2026-10-13): 30 to 130 and 15 to 65.
        bonuses: [
          { kind: 'resource', resource: 'scrap', perHour: 30, ladder: fiveLevelLadder(30, 130) },
          {
            kind: 'resource',
            resource: 'highQualityMetal',
            perHour: 15,
            ladder: fiveLevelLadder(15, 65),
          },
        ],
        labels: [L('hot', 3), L('noisy', 3), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 290,
        upgrades: [
          'The second cupola is relined and lit for the first time in a decade.',
          'A proper sand plant, so a bad mould stops costing a whole pour.',
          'Induction holding furnace. The metal comes out the same every single time.',
        ],
      },

      {
        slug: 'sappers',
        name: 'The Sappers’ Store',
        icon: 'armory',
        blurb: 'Racks, a workbench, and a door that took three people to open the first time.',
        reward:
          'The sappers’ armoury, where every refit gets a second look. Whatever you have bolted onto a unit, it wears better.',
        // Fitted cards pay in toughness and nothing else (maintainer, 2026-10-13): +1% vitality a
        // card, rising to +5%. No muster or modification discounts.
        bonuses: [{ kind: 'modification_vitality', percent: 1, ladder: fiveLevelLadder(1, 5) }],
        labels: [L('crammed', 3), L('dark', 2), L('toxic', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 270,
        upgrades: [
          'The armourer’s bench is set up properly and somebody is on it every day.',
          'Pattern jigs, so a unit modification is repeatable instead of one man’s good afternoon.',
          'A proving butt out the back. Nothing leaves here that has not been fired.',
        ],
      },

      {
        slug: 'camp',
        name: "Refugee's Camp",
        icon: 'gene_clinic',
        blurb: 'Sealed theatres, cold storage, and a waiting room nobody waits in.',
        reward:
          'The old clinic under the arches, its wards full of people who came over the bridge with nothing. Whoever keeps them fed has hands to spare.',
        // Beds and nothing else (maintainer, 2026-10-13): 70, 95, 120, 145, 195 unit slots. No
        // vitality, and it does not open the Twins or the Juggernauts.
        bonuses: [{ kind: 'unit_slots', flat: 70, ladder: fiveLevelLadder(70, 195) }],
        labels: [L('crammed', 3), L('cold', 3), L('eerie', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 200,
        upgrades: [
          'Theatre two is recommissioned and the cold store is stocked properly.',
          'A sequencer that works, which changes what can be attempted here at all.',
          'Three surgeons on rotation. The theatre stops being idle six days a week.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },
    ],
  }),
  districtFrom({
    id: 'last-platform',
    cityId: TERMINUS_CITY_ID,
    name: 'The Last Platform',
    nickname: 'Platform One',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.8, y: 0.34 },
    difficulty: 9,
    blurb:
      'Where the line ends and the checkpoints begin. Everyone who ever left the frontier left from platform one, and the Combine counts every one of them.',
    locations: [
      // Was high ground. The end of the line has to be on the line (maintainer, 2026-09-24).
      {
        slug: 'platform',
        name: 'Platform One',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(90),
        labels: [L('open', 3), L('windy', 3), L('cold', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'customs',
        name: 'The Customs Hall',
        icon: 'downtown_market',
        blurb:
          'The old exchange floor, still trading, with the board on the wall repainted every morning by somebody who knows.',
        reward:
          'The hall where everything leaving the frontier is opened and weighed. What the inspectors keep, you keep.',
        // What the checkpoint confiscates, and nothing else (maintainer, 2026-10-13): planks,
        // scrap, supplies and HQ metal by the hour. No price cut, no caps.
        bonuses: [
          { kind: 'resource', resource: 'planks', perHour: 40, ladder: fiveLevelLadder(40, 140) },
          { kind: 'resource', resource: 'scrap', perHour: 20, ladder: fiveLevelLadder(20, 70) },
          { kind: 'resource', resource: 'supplies', perHour: 20, ladder: fiveLevelLadder(20, 70) },
          {
            kind: 'resource',
            resource: 'highQualityMetal',
            perHour: 10,
            ladder: fiveLevelLadder(10, 35),
          },
        ],
        labels: [L('crammed', 3), L('noisy', 3), L('eerie', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 170,
        upgrades: [
          'Your people are on the floor at open, which is where the day’s price is decided.',
          'A seat on the board. The number goes up when you say it does.',
          'The clearing book runs through your hands. Everyone else trades on your terms.',
        ],
      },

      {
        slug: 'holding',
        name: 'The Holding Pens',
        icon: 'barricade',
        blurb: 'Sea containers, rubble and rebar, arranged by somebody who had thought about it.',
        reward:
          'Pens where the checkpoint holds the people it has not decided about. Your crews learn how to handle a crowd here.',
        // Rabble and nothing else (maintainer, 2026-10-13): your units hit Rabble 10% to 20%
        // harder. No defence, no Holds the Line.
        bonuses: [
          {
            kind: 'offense_vs_tier',
            tier: 'rabble',
            percent: 10,
            ladder: fiveLevelLadder(10, 20),
          },
        ],
        labels: [L('crammed', 3), L('cold', 2), L('eerie', 2)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 260,
        upgrades: [
          'The gaps are filled and the whole line is tied together with rebar.',
          'A second course of containers, offset, so nothing has a straight run at it.',
          'Firing slits, a sally port, and a roof over the fighting step.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'transit',
        name: 'The Transit Clinic',
        icon: 'hospital',
        blurb: 'Four working theatres, a generator, and staff who stayed when the funding did not.',
        reward:
          'The clinic at the end of the line, where the medics learned to keep one man going with what the last one did not need.',
        // The dead keep the living going and nothing else (maintainer, 2026-10-14): every body of
        // yours that dies in a fight heals your most hurt one by 10% to 20% of its vitality.
        bonuses: [{ kind: 'death_heal', percent: 10, ladder: fiveLevelLadder(10, 20) }],
        labels: [L('toxic', 3), L('crammed', 2), L('eerie', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 170,
        upgrades: [
          'The generator is overhauled, so a theatre stops going dark mid-operation.',
          'A blood bank. The thing they most often ran out of stops running out.',
          'A trauma bay at the door. The ones who used to die on the step do not.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'armoury',
        name: 'The Platform Armoury',
        icon: 'armory',
        blurb: 'Racks, a workbench, and a door that took three people to open the first time.',
        reward:
          'The platform guard’s armoury, which keeps its best plate for the people worth putting it on.',
        // Plate for the legends and nothing else (maintainer, 2026-10-14): +25 to +50 armour.
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            flat: 25,
            tier: 'legendary',
            ladder: fiveLevelLadder(25, 50),
          },
        ],
        labels: [L('crammed', 3), L('dark', 3), L('cold', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 270,
        upgrades: [
          'The armourer’s bench is set up properly and somebody is on it every day.',
          'Pattern jigs, so a unit modification is repeatable instead of one man’s good afternoon.',
          'A proving butt out the back. Nothing leaves here that has not been fired.',
        ],
      },

      {
        slug: 'stationmaster',
        name: 'The Stationmaster’s Office',
        icon: 'revolutionist_statue',
        blurb:
          'Nine metres of bronze with one arm raised, and a plinth the Combine has repeatedly failed to have removed.',
        reward:
          'The office that has run the timetable for forty years. Every officer you have learns how a thing that size is kept on time.',
        // Five skills on every officer, 5 scaled up to 10, and nothing else (maintainer,
        // 2026-10-14): Organization, Analysis, Logic, Diplomacy and Authority.
        bonuses: [
          {
            kind: 'officer_skill',
            attribute: 'organization',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'analysis',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'logic',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'diplomacy',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'authority',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
        ],
        labels: [L('open', 2), L('elevated', 2), L('windy', 2), L('cold', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 130,
        upgrades: [
          'The plinth is cleaned and the inscription re-cut. People start meeting here again.',
          'Floodlights. It is the first thing anybody sees coming into the district.',
          'A standing crowd, most nights. What is said under it is repeated everywhere.',
        ],
        /** §D8: the one location whose *capture* is the event, not its output. */
        captureInfamy: 6,
      },

      {
        slug: 'sidings',
        name: 'The Cold Sidings',
        icon: 'war_machine_graveyard',
        blurb: 'A field of dead armour, half of it sunk, some of it not as dead as it looks.',
        reward:
          'Sidings full of wrecks nobody came back for. Whatever of yours does not come home is stripped here before the cold gets it.',
        /*
         * The dead pay their way and nothing else (maintainer, 2026-10-14): 5 to 25 scrap and 1 to 5
         * HQ metal for each body of yours that dies in a fight, credited after it. No vitality,
         * and nothing seated on a machine.
         */
        bonuses: [
          {
            kind: 'death_salvage',
            resource: 'scrap',
            perBody: 5,
            ladder: fiveLevelLadder(5, 25),
          },
          {
            kind: 'death_salvage',
            resource: 'highQualityMetal',
            perBody: 1,
            ladder: fiveLevelLadder(1, 5),
          },
        ],
        labels: [L('open', 3), L('eerie', 3), L('toxic', 2), L('cold', 1)],
        contexts: ['open_ground'],
        baseDefense: 6,
        upgradeCost: 300,
        upgrades: [
          'A gantry crane over the north field. Whole hulls instead of what could be carried.',
          'The sunk row is dug out and drained: the best of it was always at the bottom.',
          'A cutting shop on site, so what leaves is stock rather than wreckage.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'footbridge',
        name: 'The Iron Footbridge',
        icon: 'smugglers_tunnel',
        blurb:
          'Cut by hand under the old customs line, shored with railway sleepers, and in continuous use since before anybody now alive.',
        reward:
          'An iron footbridge over the tracks that nobody checks papers on. Whoever you send anywhere is back sooner.',
        // Every job anywhere runs 15% to 25% faster, the whole clock, and nothing else
        // (maintainer, 2026-10-14).
        bonuses: [{ kind: 'mission_speed', percent: 15, ladder: fiveLevelLadder(15, 25) }],
        labels: [L('crammed', 3), L('dark', 3), L('elevated', 2)],
        contexts: ['underground'],
        baseDefense: 4,
        upgradeCost: 250,
        upgrades: [
          'The flooded section is pumped and the shoring replaced. It is safe at a run.',
          'A second shaft at the far end, so traffic stops meeting itself in the middle.',
          'Trolley rails the whole length. What used to be a night is now an hour.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'blockhouse',
    cityId: TERMINUS_CITY_ID,
    name: 'The Blockhouse',
    nickname: 'Control',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.9, y: 0.16 },
    difficulty: 10,
    blurb:
      'The signalling centre that owns every point and every signal on the frontier line, with the regional garrison built around it. Whoever sits in Control decides which trains exist.',
    locations: [
      {
        slug: 'officershalt',
        name: 'The Officers’ Halt',
        icon: 'rail_station',
        blurb:
          'A platform, a lamp and a board with the times chalked on it. Whoever holds it decides who the train stops for.',
        reward:
          'Linked to any other Station you or your faction hold: fifteen minutes on the rails from a new platform, five from one worked all the way up. The ticket office pays caps.',
        bonuses: stationBonuses(100),
        labels: [L('open', 3), L('windy', 3), L('cold', 2), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 240,
        upgrades: [
          'The points either side are yours, so nothing comes through that you did not let through.',
          'The water column and the coal stage work again. A train can be held here as long as you like.',
          'The board is rewritten in your hand. The timetable is whatever you say it is.',
        ],
      },

      {
        slug: 'panel',
        name: 'The Panel',
        icon: 'broadcast_station',
        blurb:
          'Two studios, a records library, and a switchboard that still connects to places nobody can name.',
        reward:
          'The control panel the whole frontier is run from, and the drawer of schematics under it. Every officer you have learns from it, and a page of something useful comes off it every morning.',
        /*
         * Four skills and the drawings, and nothing else (maintainer, 2026-10-14): Engineering,
         * Signals, Cybernetics and Chemistry 5 to 10 on every officer, and blueprint pages each
         * morning the way the Seized Goods Office pays them: one at levels 1 to 3, two at 4 and 5,
         * at the odds rows 1, 2, 3, 3 and 5.
         */
        bonuses: [
          {
            kind: 'officer_skill',
            attribute: 'engineering',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'signals',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'cybernetics',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          {
            kind: 'officer_skill',
            attribute: 'chemistry',
            flat: 5,
            ladder: fiveLevelLadder(5, 10),
          },
          { kind: 'daily_page', counts: [1, 1, 1, 2, 2], odds: [1, 2, 3, 3, 5] },
        ],
        labels: [L('crammed', 3), L('dark', 3), L('eerie', 3)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 130,
        upgrades: [
          'Studio two is brought back, so training stops competing with transmission.',
          'The records library is catalogued. Nine thousand hours of how people talked.',
          'A standing school. Your officers are taught here, and it shows in a room.',
        ],
      },

      {
        slug: 'chapel',
        name: 'The Frontier Chapel',
        icon: 'combine_chapel',
        blurb:
          'A chapel in name. Glass, steel and a long table under the vault, and the room the whole city is run from. The pews were taken out a long time ago.',
        reward:
          'The Combine’s chapel on the frontier, where nobody has been afraid of the dark for years. Whoever prays here fights steadier, and nothing about a room unsettles them.',
        // Nerve and nothing else (maintainer, 2026-10-14): your units are immune to Eerie ground
        // in a fight, and +5 to +10 morale.
        bonuses: [
          { kind: 'ignore_label', label: 'eerie' },
          { kind: 'unit_morale', flat: 5, ladder: fiveLevelLadder(5, 10) },
        ],
        labels: [L('elevated', 2), L('crammed', 2), L('eerie', 3), L('dark', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 9,
        upgradeCost: 420,
        upgrades: [
          'The long table is yours, and the people who used to sit at it know it.',
          'The vault is lit again. Whoever looks up at the spire sees a different flag on it.',
          'Orders go out from here, and the city does what it always did with orders from here.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
        /** §D8: taking the room the Combine ran the city from is the event of the whole game. */
        captureInfamy: 40,
      },

      {
        slug: 'interlocking',
        name: 'The Interlocking',
        icon: 'power_station',
        blurb:
          'A Combine switching yard off the old trunk, with a bunded tank farm behind it for the standby sets.',
        reward:
          'The signal interlocking for the whole yard, every lever on one frame. It runs on its own oil, and nothing moves past it unseen.',
        // Spy defence and oil, and nothing else (maintainer, 2026-10-14): +50 to +75 defensive
        // spy points and 50 to 100 oil an hour.
        bonuses: [
          { kind: 'spy_defence', percent: 50, ladder: fiveLevelLadder(50, 75) },
          { kind: 'resource', resource: 'oil', perHour: 50, ladder: fiveLevelLadder(50, 100) },
        ],
        labels: [L('noisy', 4), L('toxic', 3), L('open', 2)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 230,
        upgrades: [
          'The cracked tank at the north end is patched and brought back into service.',
          'Valve gear replaced, so one leak stops taking the whole bund out of use with it.',
          'A second draw line off the spur. Twice the throughput and half the spills.',
        ],
      },

      {
        slug: 'records',
        name: 'The Records Office',
        icon: 'university',
        blurb: 'Lecture halls turned workshops, and a library nobody got round to burning.',
        reward:
          'Every deed on the frontier is filed here, and whoever keeps the files knows what a building should cost.',
        // Cheaper ground and nothing else (maintainer, 2026-10-14): every location upgrade 15% to
        // 25% cheaper.
        bonuses: [
          { kind: 'location_upgrade_discount', percent: 15, ladder: fiveLevelLadder(15, 25) },
        ],
        labels: [L('crammed', 3), L('dark', 3), L('cold', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The east reading room is reopened and catalogued.',
          'Power to the workshops, so the equipment in them stops being furniture.',
          'Three of the old faculty come back. That is the upgrade; the rooms were never the problem.',
        ],
      },

      {
        slug: 'parade',
        name: 'The Parade Ground',
        icon: 'gym',
        blurb:
          'Chalk, cast iron and a single working fan. Everything in here has been repaired more than once.',
        reward:
          'The square where the Combine drills its officers at dawn. Whoever holds it drills theirs harder.',
        // Drill and nothing else (maintainer, 2026-10-14): a training session a day, two at level
        // 5, and +1 to +5 on every Physical attribute of every officer.
        bonuses: [
          { kind: 'training_sessions', flat: 1, ladder: [1, 1, 1, 1, 2] },
          { kind: 'officer_group', group: 'physical', flat: 1, ladder: [1, 2, 3, 3, 5] },
        ],
        labels: [L('open', 3), L('hot', 3), L('noisy', 3)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 140,
        upgrades: [
          'The upstairs room is cleared out, which doubles the floor.',
          'Proper plates and a rack that is not welded together. Nobody is waiting.',
          'Somebody good is running the sessions, and the sessions are worth turning up to.',
        ],
      },

      {
        slug: 'reactor',
        name: 'The Reactor Shed',
        icon: 'nuclear_plant',
        blurb:
          'Two cooling towers, a turbine hall with the roof half off, and a reactor building nobody has opened on purpose.',
        reward:
          'A shed of spent fuel the Combine never got round to moving. Whoever holds it can make one kind of soldier very dangerous to kill.',
        // RADIOACTIVE on one unit type the holder chooses, locked for 12 hours once chosen, and
        // nothing else (maintainer, 2026-10-14). The same at every level for now.
        bonuses: [{ kind: 'reactor_choice' }],
        labels: [L('toxic', 4), L('dark', 3), L('eerie', 3), L('crammed', 1)],
        contexts: ['indoor', 'underground'],
        baseDefense: 7,
        upgradeCost: 400,
        upgrades: [
          'The turbine hall is shored and lit, so the salvage crews stop working blind.',
          'One coolant loop is brought back under control. The building stops getting worse.',
          'A working shift room behind shielding. People can be in there for a whole day.',
        ],
      },

      {
        slug: 'towerbox',
        name: 'The Tower Box',
        icon: 'watchtower',
        blurb:
          'A lattice mast with a cabin on top, a working pair of glasses, and a line of sight over four districts.',
        reward:
          'A signal box on stilts over the whole yard. Anybody you put up there with a long gun can see everything coming.',
        // The long guns and nothing else (maintainer, 2026-10-14): your units with range 50 or more
        // deal +20% to +40% damage. No spy points. It stacks with the Parapet's, which is range
        // over 50 where this is 50 or more, as written.
        bonuses: [
          {
            kind: 'unit_stat_percent',
            stat: 'offense',
            percent: 20,
            rangeAtLeast: 50,
            ladder: fiveLevelLadder(20, 40),
          },
        ],
        labels: [L('elevated', 4), L('windy', 3), L('cold', 3)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },
    ],
  }),
  ...plots(TERMINUS_CITY_ID, [
    [
      'carriage',
      { x: 0.14, y: 0.64 },
      'Old carriages set on blocks and lived in, a street of them with doors cut in the sides.',
    ],
    [
      'watertower',
      { x: 0.38, y: 0.88 },
      'A terrace in the shadow of a water tower nobody has drained in thirty years. Everybody who lives there knows exactly how much is still in it.',
    ],
    [
      'embankment',
      { x: 0.7, y: 0.84 },
      'Dug into the embankment itself, warm in winter and loud every time something rolls past.',
    ],
    [
      'signalrow',
      { x: 0.94, y: 0.56 },
      'The signalmen’s cottages, the tidiest street on the frontier and the most watched. It sits under the Blockhouse, which is the right address for a rival and the wrong one for a beginner.',
    ],
  ]),
];

export const ARCA_CITY_ID = 'arca';

/**
 * Arca: the cathedral city, in crimson and white (maintainer, 2026-10-06).
 *
 * Eight contested districts and four plots, the same shape as Terminus. The ladder the maintainer
 * set: Candlemarket 1, Gravefields 2, Bellfounders 3, the Printworks 4 (all looter ground), Saint's
 * Rest 6, Bloodstone 7, the Cloisters 9 and the Nave 10 (the Combine's, the last two its seats of
 * power). Every location was chosen by the maintainer card by card (2026-10-06 and 2026-10-07);
 * the record of each choice is in `docs/DISTRICTS.md`.
 *
 * The city's trait is the **Mausoleum**: one in every contested district, the ground the Death
 * Cloaks are raised on, and every one held makes them stronger (`faith` in `units/catalog.ts`).
 * Where the other cities' locations pay what their kind pays, several here carry their own
 * figures (`LocationSchema.bonuses`): the same kind of place, worth what this map says it is.
 *
 * Every written ladder pays its last step double (maintainer, 2026-10-09): levels 1 to 4 as they
 * were, level 5 at level 4 plus twice the step from 3 to 4. The Distribution Tunnels take it on
 * the time saved (10, 15, 20, 25, then 35% off), written as points into the clock's curve. Counts
 * of whole things (the Chop Shop's components, the Exercise Yard's extra session) stay as they
 * were. The two daily chances keep 100% at the top and take the double step below it (maintainer,
 * 2026-10-13): the Dispensary's stim 30, 44, 58, 72, 100 and the Bounty Wall's golden jobs 20, 36,
 * 52, 68, 100, its pay premium half the chance.
 */
const ARCA: readonly District[] = [
  districtFrom({
    id: 'candlemarket',
    cityId: ARCA_CITY_ID,
    name: 'Candlemarket',
    nickname: 'the Market',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.12, y: 0.86 },
    difficulty: 1,
    blurb:
      'A street market in the shadow of the cathedral, under strings of bulbs that never go off: wax, relics real and otherwise, knock-off implants, and a Combine confessional at the far end that takes payment. The easy way into the city, and the loud one.',
    locations: [
      {
        slug: 'waxstalls',
        name: 'The Wax Stalls',
        icon: 'market',
        blurb:
          'Awnings, arguments, and more candles than the cathedral could burn in a year. Everything a pilgrim buys on the way in is bought here.',
        reward: 'A cut of everything that changes hands.',
        bonuses: [{ kind: 'resource', resource: 'caps', perHour: 40 }],
        labels: [L('crammed', 2), L('noisy', 3)],
        contexts: ['urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The pitches are numbered and rented instead of fought over.',
          'A covered row along the north side, so the market keeps trading in the rain.',
          'Your own weigh house at the gate. Nothing crosses it uncounted.',
        ],
      },

      {
        slug: 'hostels',
        name: 'Pilgrim Hostels',
        icon: 'refugee_camp',
        blurb:
          'Doorways, undercrofts and the floors of shut shops, and thousands of people sleeping in them who came for a blessing and stayed for want of a way home.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [{ kind: 'unit_slots', flat: 50 }],
        labels: [L('crammed', 2), L('cold', 1), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      {
        slug: 'chandlery',
        name: 'The Chandlery',
        icon: 'chemical_plant',
        blurb:
          'Tallow vats, solvent tanks and a chimney the whole market smells of. The wax comes from here, and so does everything the wax is cut with.',
        reward: 'Oil, cracked on site.',
        bonuses: [{ kind: 'resource', resource: 'oil', perHour: 20 }],
        labels: [L('toxic', 2), L('hot', 1), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 170,
        upgrades: [
          'The third cracking tower is repacked and lit.',
          'Feedstock lines rerouted off the ruined header. Nothing is being flared off any more.',
          'Catalyst recovery, so the expensive part of the process stops leaving in the smoke.',
        ],
      },

      {
        slug: 'plinth',
        name: "Martyr's Plinth",
        icon: 'revolutionary_statue',
        blurb:
          'A saint nobody remembers the name of, draped in crimson by whoever holds the market that week. Every road through the stalls ends under it.',
        reward:
          'It is what they are fighting for. A crew that holds it walks into a fight harder to frighten.',
        // Two a level and four for the last (maintainer, 2026-10-11); on the old shared curve it
        // reached 60 and put every rabble sheet at the morale cap.
        bonuses: [{ kind: 'unit_morale', flat: 10, tier: 'rabble', ladder: [10, 12, 14, 16, 20] }],
        labels: [L('open', 3), L('elevated', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 120,
        upgrades: [
          'The plinth is scrubbed and the name re-cut. People stop to read it again.',
          'Floodlit. The first thing anybody sees coming into the district, and it is yours.',
          'A crowd under it most nights. What is said there is repeated in every district.',
        ],
      },

      {
        slug: 'nightwatch',
        name: 'The Night Watch',
        icon: 'watchtower',
        blurb:
          'A bell tower with the bell sold and a cabin built in its place, a working pair of glasses, and a line of sight over every approach to the market.',
        reward: 'Everything your spies do, they do better: everywhere in the city, not just here.',
        // Fifteen a level and thirty for the last (maintainer, 2026-10-11); a watchtower's 38
        // on the plain curve reached 228, three times the strongest Combine counter on its own.
        bonuses: [{ kind: 'intel', percent: 35, ladder: [35, 50, 65, 80, 110] }],
        labels: [L('elevated', 3), L('windy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },

      {
        slug: 'loft',
        name: 'Bulb-String Loft',
        icon: 'pirate_radio',
        blurb:
          'A transmitter in a loft above the stalls, run off the same wire as the bulbs. Whoever keeps it hears the whole market talking, and the market talks to everyone.',
        reward: 'You hear what the city is saying, and some of what it would rather not.',
        bonuses: [
          { kind: 'officer_skill', attribute: 'communication', flat: 5 },
          { kind: 'officer_skill', attribute: 'signals', flat: 5 },
        ],
        labels: [L('crammed', 2), L('dark', 1), L('elevated', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 100,
        upgrades: [
          'A directional aerial. Twice the reach and half the chance of being found.',
          'A second set in another building, so being raided stops meaning being off air.',
          'Listeners in six districts calling things in. The station stops being the source.',
        ],
      },

      {
        slug: 'tomb',
        name: 'The Chandlers’ Tomb',
        icon: 'mausoleum',
        blurb:
          'The guild tomb of the candle-makers, under the market, with a lamp in it that the guild still pays to keep lit.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 2), L('cold', 1), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'gravefields',
    cityId: ARCA_CITY_ID,
    name: 'Gravefields',
    nickname: 'the Fields',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.3, y: 0.93 },
    difficulty: 2,
    blurb:
      'The terraced cemetery outside the walls, white stone gone grey and a red lamp on every tomb. The clans that live in the mausoleums bury the city and sell what the dead no longer need. The other way in, and the quiet one.',
    locations: [
      {
        slug: 'bonemarket',
        name: 'The Bone Market',
        icon: 'bone_market',
        blurb:
          'Where the city sells what is left of people and machines, at the cemetery gate so nothing has to be carried far. Brisk, unsentimental, and open all night.',
        reward: 'What you lose in a fight comes back as caps instead of coming back as nothing.',
        bonuses: [{ kind: 'salvage_refund', percent: 12 }],
        labels: [L('eerie', 2), L('noisy', 1), L('dark', 1), L('crammed', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'Your own recovery crew works the field before anybody else gets there.',
          'A rendering shed, so what comes back is sorted rather than sold in a heap.',
          'Standing contracts with three districts. Nothing you lose is lost entirely.',
        ],
      },

      {
        slug: 'mourners',
        name: "Mourners' Row",
        icon: 'pawn_shop',
        blurb:
          'The grave-goods counters along the lower terrace. Whatever the dead were buried with that was worth anything ends up here within the week, and the best of it is metal.',
        reward: 'A smaller cut, and a fence who moves what a raid brings back.',
        bonuses: [{ kind: 'resource', resource: 'highQualityMetal', perHour: 2 }],
        labels: [L('crammed', 2), L('dark', 1), L('eerie', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 80,
        upgrades: [
          'The back room is cleared and shelved. Twice the stock, half the arguments.',
          'A second counter for people who would rather not queue where they can be seen.',
          'A yard behind with a gate on it. Whole truckloads, not armfuls.',
        ],
      },

      {
        slug: 'wakehouse',
        name: 'The Wake House',
        icon: 'tavern',
        blurb:
          'Where every clan drinks after a burial, and there is a burial every day. A room where people say what they mean, and somebody listens.',
        reward: 'A room where the city’s hardest people drink, and somebody who can introduce you.',
        bonuses: [
          { kind: 'officer_skill', attribute: 'empathy', flat: 5 },
          { kind: 'officer_skill', attribute: 'resolve', flat: 5 },
        ],
        labels: [L('crammed', 2), L('noisy', 3)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The cellar is restocked and the back room is yours whenever you want it.',
          'A door policy. The people worth meeting stop being drowned out by the people who are not.',
          'You are the house. Every introduction in this room goes through you now.',
        ],
      },

      {
        slug: 'mausoleums',
        name: 'The Mausoleums',
        icon: 'mausoleum',
        blurb:
          'The great family tombs along the top terrace, each one a house now, with a lamp in the door and a clan name over it that was a saint’s once.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 2), L('dark', 1), L('cold', 1), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },

      {
        slug: 'stonecutters',
        name: "Stonecutters' Shed",
        icon: 'scrap_press',
        blurb:
          'Where headstones and coffins are made, and where the old ones are broken down into something useful when nobody is left to object.',
        reward: 'Scrap, steadily, for as long as you hold it.',
        bonuses: [
          { kind: 'resource', resource: 'scrap', perHour: 24 },
          // §D5b: a press takes wrecks apart, and a wreck is not all metal. Mirrors the Scrapyard
          // building, which yields both for the same reason.
          { kind: 'resource', resource: 'planks', perHour: 18 },
        ],
        labels: [L('noisy', 3), L('crammed', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 2,
        upgradeCost: 160,
        upgrades: [
          'The second baler comes back online and the sorting floor stops backing up.',
          'A magnetic separator over the belt, so nobody is picking metal out by hand.',
          'Night shift. The presses run until somebody stops them, and nobody does.',
        ],
      },

      {
        slug: 'cemetery',
        name: 'The Cemetery',
        icon: 'graveyard',
        blurb:
          'The paupers’ ground below the terraces, and the only part of the fields the city still buries in. Holding it says something the city does not forget.',
        reward:
          'Holding this ground says something the city does not forget, and what is buried here was buried with its rings on.',
        bonuses: [{ kind: 'infamy_gain', percent: 5 }],
        labels: [L('eerie', 2), L('open', 1), L('foggy', 1), L('cold', 1)],
        contexts: ['open_ground'],
        baseDefense: 3,
        upgradeCost: 100,
        upgrades: [
          'The lodge is manned and the gates are shut at night. It becomes yours visibly.',
          'The subsided terrace is worked properly instead of dug at by whoever turns up.',
          'The register is found. You know who is here, and so does everyone you tell.',
        ],
      },
    ],
  }),

  districtFrom({
    id: 'bellfounders',
    cityId: ARCA_CITY_ID,
    name: 'Bellfounders',
    nickname: 'the Foundry',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.3, y: 0.62 },
    difficulty: 3,
    blurb:
      'The old foundry streets, where the cathedral’s bells were cast and where the last of them still hangs. The furnaces pour plate now, and the quarter rings whether anybody wants it to or not.',
    locations: [
      {
        slug: 'clapperworks',
        name: 'The Clapper Works',
        icon: 'scrap_press',
        blurb:
          'Where cracked bells and their frames are broken down for anything worth keeping, which is most of a bell.',
        reward: 'Scrap, steadily, for as long as you hold it.',
        bonuses: [
          { kind: 'resource', resource: 'scrap', perHour: 24 },
          // §D5b: a press takes wrecks apart, and a wreck is not all metal. Mirrors the Scrapyard
          // building, which yields both for the same reason.
          { kind: 'resource', resource: 'planks', perHour: 18 },
        ],
        labels: [L('noisy', 3), L('crammed', 2)],
        contexts: ['urban', 'indoor'],
        baseDefense: 2,
        upgradeCost: 160,
        upgrades: [
          'The second baler comes back online and the sorting floor stops backing up.',
          'A magnetic separator over the belt, so nobody is picking metal out by hand.',
          'Night shift. The presses run until somebody stops them, and nobody does.',
        ],
      },

      {
        slug: 'castingpit',
        name: 'The Casting Pit',
        icon: 'foundry',
        blurb:
          'The great bell pit, pouring armour plate instead of bronze. Bell metal, once it has been liquid, goes onto whoever can wear it.',
        reward: 'High-quality metal. Nothing else in the city makes it in quantity.',
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            tier: 'heavy',
            flat: 3,
            ladder: [3, 4, 5, 6, 8],
          },
        ],
        labels: [L('hot', 3), L('noisy', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 290,
        upgrades: [
          'The second cupola is relined and lit for the first time in a decade.',
          'A proper sand plant, so a bad mould stops costing a whole pour.',
          'Induction holding furnace. The metal comes out the same every single time.',
        ],
      },

      {
        slug: 'tollingtower',
        name: 'The Tolling Tower',
        icon: 'broadcast_tower',
        blurb:
          'The last bell the foundry cast, hung with loudspeakers. When it rings, every street in the quarter hears it, and the people who live under it stopped hearing it years ago.',
        reward: 'Your name arrives before your people do.',
        bonuses: [{ kind: 'noise_switch' }],
        labels: [L('elevated', 3), L('windy', 2), L('noisy', 1)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 150,
        upgrades: [
          'Output doubled. The signal reaches the upper levels for the first time.',
          'A standby set, so being knocked off air stops being a thing that happens.',
          'Your own hour, every evening, and the city has started planning around it.',
        ],
      },

      {
        slug: 'apprentices',
        name: 'The Apprentice Rows',
        icon: 'refugee_camp',
        blurb:
          'Bunk rooms over the workshops, full of apprentices nobody pays, every one of them waiting to be given something to do.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [{ kind: 'unit_slots', flat: 50 }],
        labels: [L('crammed', 3), L('noisy', 1), L('cold', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      {
        slug: 'strawsack',
        name: 'The Straw Sack',
        icon: 'workshop',
        blurb:
          'A sack-maker’s loft above the forge, turning out straw bags by the hundred. Whoever carries for you carries more.',
        reward: 'Whatever this workshop makes, your people carry it.',
        bonuses: [{ kind: 'carrier_loot_flat', flat: 5, ladder: [5, 6, 7, 8, 10] }],
        labels: [L('crammed', 2), L('hot', 2), L('noisy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The loft is cleared and a second bench goes in. Twice the hands.',
          'A hearth that stays lit. The work stops waiting for the morning.',
          'A master takes the floor, and the apprentices start finishing what they begin.',
        ],
      },

      {
        slug: 'hammeryard',
        name: 'The Hammer Yard',
        icon: 'workshop',
        blurb:
          'A yard of hammers, from the kind a man swings to the kind a crane drops. Everything you field that hits hard hits harder.',
        reward: 'Whatever this workshop makes, your people carry it.',
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            damageType: 'blunt',
            flat: 10,
            ladder: [10, 15, 20, 25, 35],
          },
        ],
        labels: [L('noisy', 3), L('open', 1), L('hot', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The loft is cleared and a second bench goes in. Twice the hands.',
          'A hearth that stays lit. The work stops waiting for the morning.',
          'A master takes the floor, and the apprentices start finishing what they begin.',
        ],
      },

      {
        slug: 'tomb',
        name: 'The Founders’ Tomb',
        icon: 'mausoleum',
        blurb:
          'The guild tomb under the casting floor, its door a bell cut in half, warm from the furnaces above it.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 2), L('dark', 1), L('hot', 1), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'printworks',
    cityId: ARCA_CITY_ID,
    name: 'The Printworks',
    nickname: 'the Presses',
    kind: 'contested',
    /*
     * The regime's third district in Arca (maintainer, 2026-10-07): whoever decides what the
     * presses print decides what the city believes, so the Combine was never going to leave it
     * independent. It took Bloodstone's 7 and Bloodstone took its 4, which keeps one district at
     * each rung of the ladder.
     */
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.54, y: 0.64 },
    difficulty: 7,
    blurb:
      'Four storeys of presses that print the city its scripture and its propaganda, and a cellar that prints everything else. The gutters run black and the walls are a street long of posters.',
    locations: [
      {
        slug: 'greatpress',
        name: 'The Great Press',
        icon: 'scrap_press',
        blurb:
          'A rotary press the size of a chapel. Whatever breaks on it is stripped for the next one.',
        reward: 'Scrap, steadily, for as long as you hold it.',
        bonuses: [
          { kind: 'resource', resource: 'scrap', perHour: 24 },
          // §D5b: a press takes wrecks apart, and a wreck is not all metal. Mirrors the Scrapyard
          // building, which yields both for the same reason.
          { kind: 'resource', resource: 'planks', perHour: 18 },
        ],
        labels: [L('noisy', 4), L('crammed', 2), L('hot', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 2,
        upgradeCost: 160,
        upgrades: [
          'The second baler comes back online and the sorting floor stops backing up.',
          'A magnetic separator over the belt, so nobody is picking metal out by hand.',
          'Night shift. The presses run until somebody stops them, and nobody does.',
        ],
      },

      {
        slug: 'boilerhouse',
        name: 'The Boiler House',
        icon: 'power_station',
        blurb:
          'The steam plant that turns every press in the quarter, and lights whoever holds it.',
        // §A1 took the district grid out of the game, and a location that fed it would now feed
        // nothing. Re-pointed at the fuel bunkers behind the yard rather than dropped: this was one of
        // the strongest holds on the map, and a place worth taking that pays nothing is a dead marker.
        reward: 'Fuel by the drum, off the standby tanks nobody has come back to meter.',
        bonuses: [{ kind: 'resource', resource: 'oil', perHour: 20 }],
        labels: [L('hot', 3), L('noisy', 2), L('foggy', 2)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 230,
        upgrades: [
          'The cracked tank at the north end is patched and brought back into service.',
          'Valve gear replaced, so one leak stops taking the whole bund out of use with it.',
          'A second draw line off the spur. Twice the throughput and half the spills.',
        ],
      },

      {
        slug: 'scriptorium',
        name: 'The Scriptorium',
        icon: 'university',
        blurb:
          'The old copying hall, now the Combine’s archive of everything ever printed. A page of something useful turns up in it every day, for whoever is reading.',
        reward: 'Every research project finishes sooner.',
        bonuses: [
          { kind: 'daily_page' },
          // 7 to 12 since 2026-10-14 (maintainer: Arca's top Combine ground to the Blockhouse's
          // Panel, four skills at 5 to 10 and up to two pages); it was 5 to 10.
          { kind: 'officer_skill', attribute: 'encyclopedia', flat: 7, ladder: [7, 8, 9, 10, 12] },
          { kind: 'officer_skill', attribute: 'logistics', flat: 7, ladder: [7, 8, 9, 10, 12] },
        ],
        labels: [L('crammed', 3), L('dark', 2), L('cold', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The east reading room is reopened and catalogued.',
          'Power to the workshops, so the equipment in them stops being furniture.',
          'Three of the old faculty come back. That is the upgrade; the rooms were never the problem.',
        ],
      },

      {
        slug: 'pamphletwall',
        name: 'The Pamphlet Wall',
        icon: 'broadcast_tower',
        blurb:
          'A wall of posters a street long. Whoever holds it chooses who the quarter reads about, and what it reads is not kind.',
        reward: 'Your name arrives before your people do.',
        bonuses: [{ kind: 'pamphlets', pins: 1 }],
        labels: [L('elevated', 3), L('windy', 2), L('open', 2)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 150,
        upgrades: [
          'Output doubled. The signal reaches the upper levels for the first time.',
          'A standby set, so being knocked off air stops being a thing that happens.',
          'Your own hour, every evening, and the city has started planning around it.',
        ],
      },

      {
        slug: 'canteen',
        name: 'The Typesetters’ Canteen',
        icon: 'soup_kitchen',
        blurb:
          'Three shifts fed from one kitchen, and bunks above it for the ones too tired to go home.',
        reward: 'Supplies off the ration line, and a crew that has eaten fights like one.',
        bonuses: [
          { kind: 'resource', resource: 'supplies', perHour: 14 },
          // 35 to 110 since 2026-10-14, against the Viaduct's Refugee's Camp (70 to 195, beds
          // alone); it was 15 to 90 off the plain scale.
          { kind: 'unit_slots', flat: 35, ladder: [35, 50, 65, 80, 110] },
        ],
        labels: [L('crammed', 3), L('noisy', 3), L('hot', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 100,
        upgrades: [
          'A second serving line, so the queue clears before the food does.',
          'Cold store out the back. Nothing is thrown away at the end of a day any more.',
          'Bread ovens. People come here who did not have to, which is worth more than the bread.',
        ],
      },

      {
        slug: 'tunnels',
        name: 'The Distribution Tunnels',
        icon: 'smugglers_tunnel',
        blurb:
          'The paper tunnels that carry the morning sermon to every church in the quarter. A crew that knows them is back from anywhere in it sooner.',
        reward:
          'Every crew you send anywhere is back sooner. There is a shorter way and you own it.',
        /*
         * Points into the mission clock's curve (`missionSpeedCut`, knee 25, ceiling 60), chosen
         * so the time saved reads 10, 15, 20, 25 and 35% by level. The ladder was 11, 18, 25,
         * 33, 54 on a plain divisor, which pays 24% and 31% at the top two levels once the curve
         * bends it (bug pass, 2026-10-11); `atlas.test.ts` measures the saving the way the
         * clock does.
         */
        bonuses: [
          { kind: 'mission_speed', percent: 11, inDistrict: true, ladder: [11, 18, 25, 35, 86] },
        ],
        labels: [L('dark', 4), L('crammed', 3), L('eerie', 1)],
        contexts: ['underground'],
        baseDefense: 4,
        upgradeCost: 250,
        upgrades: [
          'The flooded section is pumped and the shoring replaced. It is safe at a run.',
          'A second shaft at the far end, so traffic stops meeting itself in the middle.',
          'Trolley rails the whole length. What used to be a night is now an hour.',
        ],
      },

      {
        slug: 'tomb',
        name: 'The Printers’ Vault',
        icon: 'mausoleum',
        blurb: 'A vault under the presses where the guild buried its own, between the type cases.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 3), L('dark', 2), L('crammed', 1), L('noisy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'saints-rest',
    cityId: ARCA_CITY_ID,
    name: "Saint's Rest",
    nickname: 'the Hill',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.1, y: 0.36 },
    difficulty: 6,
    blurb:
      'A walled hospice-monastery on the hill, white stone and crimson banners, the best-run sick ward in the city and the Saint’s own shrine at the top of the steps. The Combine keeps it, and keeps it quiet.',
    locations: [
      {
        slug: 'dispensary',
        name: 'The Sisters’ Dispensary',
        icon: 'black_clinic',
        blurb:
          'Tinctures and stimulants dispensed through a grille, no questions asked. Some days there is one going spare.',
        reward:
          'Syringes. Handed out before a fight, they bring somebody back to strength who had no right to be.',
        bonuses: [{ kind: 'daily_stim', percent: 30, ladder: [30, 44, 58, 72, 100] }],
        labels: [L('toxic', 3), L('crammed', 2), L('dark', 2)],
        contexts: ['indoor', 'underground'],
        baseDefense: 4,
        upgradeCost: 150,
        upgrades: [
          'A second bench and a chemist on it. Output goes from a trickle to a supply.',
          'Cold storage, so a batch stops going off before it is used.',
          'A formula that does not take as much out of the person it goes into.',
        ],
      },

      {
        slug: 'infirmary',
        name: 'The Infirmary Cloister',
        icon: 'hospital',
        blurb:
          'The monks’ sick ward, still the best-run in the city. More of yours come back from a fight than should.',
        reward: 'What comes back from a fight comes back in better shape.',
        bonuses: [{ kind: 'casualty_recovery', percent: 2, ladder: [2, 4, 6, 8, 12] }],
        labels: [L('crammed', 3), L('toxic', 2), L('noisy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 170,
        upgrades: [
          'The generator is overhauled, so a theatre stops going dark mid-operation.',
          'A blood bank. The thing they most often ran out of stops running out.',
          'A trauma bay at the door. The ones who used to die on the step do not.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'shrine',
        name: 'The Saint’s Shrine',
        icon: 'shrine',
        blurb:
          'The relic everybody climbs the hill to see, under a Combine banner. The Saint answers to whoever keeps it, and keeps it better the more is poured into it.',
        reward: 'A saint answers to whoever keeps the shrine.',
        bonuses: [{ kind: 'unit_door', unitId: 'the_saint' }],
        labels: [L('elevated', 3), L('eerie', 2), L('open', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 320,
        upgrades: [
          'The reliquary is reset and the lamps relit. Pilgrims come up the hill again.',
          'A guard on the stair, and the saint sleeps lighter.',
          'The shrine is dressed in your colours. What the saint does, he does in your name.',
        ],
      },

      {
        slug: 'watchcell',
        name: 'The Watch Cell',
        icon: 'watchtower',
        blurb:
          'A hermit’s cell on the highest rock, where the condemned are sent to wait. The ones who come down are not the ones who went up.',
        reward: 'Everything your spies do, they do better: everywhere in the city, not just here.',
        bonuses: [{ kind: 'unit_door', unitId: 'the_condemned' }],
        labels: [L('elevated', 4), L('windy', 2), L('cold', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },

      {
        slug: 'yard',
        name: 'The Exercise Yard',
        icon: 'gym',
        blurb:
          'The cloister garth, where the novices drill at dawn. Whoever holds it drills faster, and at the top of it, more.',
        reward: 'One more session in the day than the day has room for.',
        bonuses: [
          { kind: 'training_time', percent: 5, ladder: [5, 10, 15, 20, 30] },
          { kind: 'training_sessions', flat: 1, ladder: [0, 0, 0, 0, 1] },
        ],
        labels: [L('open', 3), L('noisy', 2), L('cold', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 140,
        upgrades: [
          'The upstairs room is cleared out, which doubles the floor.',
          'Proper plates and a rack that is not welded together. Nobody is waiting.',
          'Somebody good is running the sessions, and the sessions are worth turning up to.',
        ],
      },

      {
        slug: 'wellhouse',
        name: 'The Wellhouse',
        icon: 'water_works',
        blurb: 'The deep well under the hill, the cleanest water in Arca.',
        reward: 'Supplies, because clean water is most of what growing it takes.',
        bonuses: [{ kind: 'resource', resource: 'supplies', perHour: 26 }],
        labels: [L('wet', 3), L('dark', 2), L('cold', 2)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 150,
        upgrades: [
          'Better plumbing: the leaking main under the yard is dug up and replaced.',
          'The settling beds are dredged and the intake screens stop clogging weekly.',
          'A chlorination house at the outfall. Nothing that leaves here makes anybody ill.',
        ],
      },

      {
        slug: 'inn',
        name: 'The Saint’s Inn',
        icon: 'tavern',
        blurb:
          'The guesthouse at the foot of the steps, a bed for every pilgrim and twice as many when the whole hill is one house.',
        reward: 'A room where the city’s hardest people drink, and somebody who can introduce you.',
        bonuses: [
          { kind: 'unit_slots', flat: 20, ladder: [20, 40, 60, 80, 120] },
          { kind: 'unit_slots', flat: 20, ladder: [20, 40, 60, 80, 120], whenDistrictWhole: true },
        ],
        labels: [L('crammed', 4), L('noisy', 3)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The cellar is restocked and the back room is yours whenever you want it.',
          'A door policy. The people worth meeting stop being drowned out by the people who are not.',
          'You are the house. Every introduction in this room goes through you now.',
        ],
      },

      {
        slug: 'tomb',
        name: 'The Pilgrims’ Tomb',
        icon: 'mausoleum',
        blurb:
          'The tomb at the foot of the hill where the pilgrims who did not make it up are kept.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 3), L('dark', 2), L('cold', 1), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'bloodstone',
    cityId: ARCA_CITY_ID,
    name: 'Bloodstone',
    nickname: 'the Stone',
    kind: 'contested',
    /*
     * Licensed by the Combine and run by nobody, which is the whole joke of the place: the regime
     * signs the contracts and does not set foot in the hall. It swapped rungs with the Printworks
     * on 2026-10-07, when the presses became the regime's third district here.
     */
    allegiance: 'government',
    position: { x: 0.62, y: 0.42 },
    difficulty: 4,
    blurb:
      'The sellswords’ quarter, licensed by the Combine and run by nobody. Contracts on a wall, blood on a stage, every strong crew in the city drinking in one hall, and the Crimson Dancer at the top of the bill.',
    locations: [
      {
        slug: 'bountywall',
        name: 'The Bounty Wall',
        icon: 'bounty_wall',
        blurb:
          'Every contract in the city is posted here first, and the best of them are posted in gold.',
        reward: 'The best contracts in the district come to you first.',
        bonuses: [
          {
            kind: 'golden_jobs',
            chancePercent: 20,
            rewardPercent: 10,
            ladder: [20, 36, 52, 68, 100],
          },
        ],
        labels: [L('crammed', 3), L('noisy', 2)],
        contexts: ['urban'],
        baseDefense: 3,
        upgradeCost: 200,
        upgrades: [
          'The clerk keeps your book first. Contracts reach you before they are posted.',
          'A runner on the wall day and night. Nothing is posted that you have not seen.',
          'The wall is yours: every contract in the quarter clears through your clerk.',
        ],
      },

      {
        slug: 'redlantern',
        name: 'The Red Lantern',
        icon: 'tavern',
        blurb:
          'The hall every crew in the city ends up in, and where the next job gets talked into. The house takes its cut of every one.',
        reward: 'A room where the city’s hardest people drink, and somebody who can introduce you.',
        bonuses: [{ kind: 'resource', resource: 'caps', perHour: 60 }],
        labels: [L('crammed', 3), L('noisy', 2), L('dark', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The cellar is restocked and the back room is yours whenever you want it.',
          'A door policy. The people worth meeting stop being drowned out by the people who are not.',
          'You are the house. Every introduction in this room goes through you now.',
        ],
      },

      {
        slug: 'hiringhall',
        name: 'The Hiring Hall',
        icon: 'refugee_camp',
        blurb:
          'Sellswords between contracts, sleeping where they drink. Rabble come cheap to whoever runs the hall.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [{ kind: 'muster_cost', percent: 4, tier: 'rabble', ladder: [4, 8, 12, 16, 24] }],
        labels: [L('crammed', 2), L('noisy', 2), L('cold', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      {
        slug: 'stage',
        name: 'The Crimson Stage',
        icon: 'stage',
        blurb:
          'A red-lit stage over the main pit, where she dances before she fights. Her home in the city, and whoever keeps it keeps her.',
        reward: 'The Crimson Dancer answers to whoever keeps the stage.',
        bonuses: [{ kind: 'unit_door', unitId: 'the_crimson_dancer' }],
        labels: [L('dark', 3), L('noisy', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 300,
        upgrades: [
          'The boards are relaid and the lamps rewired. She dances every night now.',
          'A band, a bar and a door policy. The crowd is yours as much as the stage is.',
          'The stage is dressed in your colours, and she dances for nobody else.',
        ],
      },

      {
        slug: 'chopshop',
        name: 'The Chop Shop',
        icon: 'war_machine_graveyard',
        blurb:
          'Stolen machines broken down and rebuilt by morning. Something useful comes off the bench every day.',
        reward:
          'Hulls, plate and running gear, a gantry that will lift anything, and troops that come back from more than they should.',
        bonuses: [{ kind: 'daily_component', count: 1, ladder: [1, 1, 1, 2, 2] }],
        labels: [L('open', 2), L('toxic', 2), L('noisy', 1)],
        contexts: ['open_ground'],
        baseDefense: 6,
        upgradeCost: 300,
        upgrades: [
          'A gantry crane over the north field. Whole hulls instead of what could be carried.',
          'The sunk row is dug out and drained: the best of it was always at the bottom.',
          'A cutting shop on site, so what leaves is stock rather than wreckage.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'trophyhall',
        name: 'The Trophy Hall',
        icon: 'trophy_hall',
        blurb:
          'Every crew’s trophies on the walls, and a keeper who writes down whose. Holding it says you are the strongest in the room, and pays like it.',
        reward: 'Every kind of enemy you have put on the wall pays you, every day.',
        bonuses: [{ kind: 'trophies' }],
        labels: [L('eerie', 2), L('dark', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 260,
        upgrades: [
          'The hall is lit and the keeper paid. The wall starts filling.',
          'A second hall is opened. There is room for everything you will take.',
          'People come to see the wall, and pay at the door.',
        ],
      },

      {
        slug: 'tomb',
        name: 'The Sellswords’ Tomb',
        icon: 'mausoleum',
        blurb:
          'Where the quarter buries the ones who took the wrong contract, under the names of the crews they died for.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 3), L('dark', 2), L('cold', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'cloisters',
    cityId: ARCA_CITY_ID,
    name: 'The Cloisters',
    nickname: 'the Convent',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.34, y: 0.24 },
    difficulty: 9,
    blurb:
      'A sealed convent-laboratory, four storeys of white wall with no doors on the outside. The sisters copy the Combine’s papers by hand, grow its soldiers in the old embalming rooms, and have not spoken in forty years.',
    locations: [
      {
        slug: 'lab',
        name: 'The Reliquary Lab',
        icon: 'laboratory',
        blurb:
          'Saints’ bones under glass and a centrifuge beside them. The Juggernauts are grown here, and grown better the deeper the work goes.',
        reward: 'What is grown here fights for whoever keeps it.',
        bonuses: [{ kind: 'unit_door', unitId: 'juggernauts' }],
        labels: [L('cold', 3), L('eerie', 2), L('crammed', 2), L('toxic', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 400,
        upgrades: [
          'The theatre is scrubbed and the cold store restocked. The work starts again.',
          'A second theatre, and the sisters stop having to choose.',
          'The laboratory answers to you alone, and what it makes is made to your order.',
        ],
      },

      {
        slug: 'chapter',
        name: 'The Chapter of Silence',
        icon: 'chapel',
        blurb:
          'A room where nobody has spoken in forty years. Nothing said in it leaves it, and nothing a spy wants is said anywhere else.',
        reward:
          'Everyone on your books holds together better under things that break people, and nobody runs because the person beside them did.',
        // 50 to 75 since 2026-10-14, the Blockhouse's Interlocking; it was 20 to 70.
        bonuses: [{ kind: 'spy_defence', percent: 50, ladder: [50, 55, 60, 65, 75] }],
        labels: [L('eerie', 4), L('dark', 2), L('cold', 2)],
        contexts: ['indoor'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The roof is made good and the bell rings on the hour again.',
          'A vestry for people who want to talk without a congregation listening.',
          'Somebody is here at any hour, and the district has noticed.',
        ],
      },

      {
        slug: 'novitiate',
        name: 'The Novitiate',
        icon: 'gym',
        blurb:
          'Where the novices are drilled before dawn, every day, until the body stops arguing.',
        reward: 'One more session in the day than the day has room for.',
        bonuses: [{ kind: 'officer_group', group: 'physical', flat: 3, ladder: [3, 4, 5, 6, 8] }],
        labels: [L('cold', 3), L('crammed', 3), L('noisy', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 140,
        upgrades: [
          'The upstairs room is cleared out, which doubles the floor.',
          'Proper plates and a rack that is not welded together. Nobody is waiting.',
          'Somebody good is running the sessions, and the sessions are worth turning up to.',
        ],
      },

      {
        slug: 'coldvault',
        name: 'The Cold Vault',
        icon: 'nuclear_plant',
        blurb:
          'The reactor under the convent that runs the labs, and runs everything else of yours a little better.',
        reward:
          'High-quality metal out of the turbine hall, and a fuelling crew who make every barrel of oil you burn go further.',
        bonuses: [
          // 5 to 15 since 2026-10-14, against the Last Platform's Customs Hall income; it was 2 to 7.
          { kind: 'resource_yield', resource: 'oil', percent: 5, ladder: [5, 7, 9, 11, 15] },
          {
            kind: 'resource_yield',
            resource: 'highQualityMetal',
            percent: 5,
            ladder: [5, 7, 9, 11, 15],
          },
        ],
        labels: [L('toxic', 4), L('dark', 2), L('cold', 2), L('crammed', 1)],
        contexts: ['indoor', 'underground'],
        baseDefense: 7,
        upgradeCost: 400,
        upgrades: [
          'The turbine hall is shored and lit, so the salvage crews stop working blind.',
          'One coolant loop is brought back under control. The building stops getting worse.',
          'A working shift room behind shielding. People can be in there for a whole day.',
        ],
      },

      {
        slug: 'choirloft',
        name: 'The Choir Loft',
        icon: 'planetarium',
        blurb:
          'A domed loft with an instrument in it that is not an organ. Crews that work under it learn faster.',
        reward:
          'A room built for thinking in, and an optical bench worth more than the building around it.',
        bonuses: [{ kind: 'mission_xp', percent: 2, ladder: [2, 3, 4, 5, 7] }],
        labels: [L('dark', 3), L('eerie', 3), L('noisy', 1), L('elevated', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 190,
        upgrades: [
          'The projector is rebuilt and the dome is dark again for the first time in years.',
          'The optical bench is stripped and repurposed. It is the best glass in the district.',
          'Sessions every night. Your researchers start solving things in the dark.',
        ],
      },

      {
        slug: 'wall',
        name: 'The Cloister Wall',
        icon: 'high_ground',
        blurb:
          'Four storeys of white wall with no doors on the outside. Whoever holds it holds every wall better.',
        reward: 'Everything you hold in this city is harder to take off you.',
        bonuses: [
          {
            kind: 'unit_stat_flat',
            stat: 'range',
            rule: 'guard',
            flat: 10,
            ladder: [10, 13, 15, 18, 24],
          },
          // Armour 20 to 40 since 2026-10-14, against the Platform Armoury's 25 to 50 on the fewer
          // legendaries; it was 10 to 24. Range has no like on Terminus ground and stays.
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            rule: 'guard',
            flat: 20,
            ladder: [20, 24, 28, 32, 40],
          },
        ],
        labels: [L('elevated', 4), L('windy', 3), L('cold', 1)],
        contexts: ['open_ground'],
        baseDefense: 4,
        upgradeCost: 210,
        upgrades: [
          'Sandbagged firing positions instead of whatever people were crouching behind.',
          'A cut stair up the back, so the position can be reinforced under fire.',
          'Overhead cover and a ready magazine. It stops being a vantage and becomes a work.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'tomb',
        name: 'The Sisters’ Crypt',
        icon: 'mausoleum',
        blurb: 'The crypt under the chapter house, where the sisters are laid in silence, in rows.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 3), L('dark', 3), L('crammed', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  districtFrom({
    id: 'nave',
    cityId: ARCA_CITY_ID,
    name: 'The Nave',
    nickname: 'the Cathedral',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.5, y: 0.1 },
    difficulty: 10,
    blurb:
      'The great cathedral itself, the Combine’s seat in the city. Eight hundred voices every night, a window the light through which falls on everything, and vaults under the floor deep enough for a siege.',
    locations: [
      {
        slug: 'choir',
        name: 'The Choir',
        icon: 'cinema',
        blurb:
          'Eight hundred voices and a light show, every night, for whoever holds the stalls. Anybody who works under it keeps their head.',
        reward: 'Two hours somewhere else. A crew that gets that fights differently the next day.',
        bonuses: [
          // 7 to 12 since 2026-10-14, three skills against the Panel's four at 5 to 10; was 5 to 10.
          { kind: 'officer_skill', attribute: 'composure', flat: 7, ladder: [7, 8, 9, 10, 12] },
          { kind: 'officer_skill', attribute: 'improvisation', flat: 7, ladder: [7, 8, 9, 10, 12] },
          { kind: 'officer_skill', attribute: 'empathy', flat: 7, ladder: [7, 8, 9, 10, 12] },
        ],
        labels: [L('noisy', 4), L('dark', 3), L('crammed', 2), L('eerie', 1)],
        contexts: ['indoor'],
        baseDefense: 2,
        upgradeCost: 100,
        upgrades: [
          'The projector is rebuilt and the sound comes back. It stops being a silent film.',
          'The balcony is reopened, which is another three hundred seats a night.',
          'A print run traded in from three districts. Something different every week.',
        ],
      },

      {
        slug: 'rosewindow',
        name: 'The Rose Window',
        icon: 'chapel',
        blurb:
          'The light through it falls on everything you own, and on the people you send to stand beside your allies.',
        reward:
          'Everyone on your books holds together better under things that break people, and nobody runs because the person beside them did.',
        // 10 to 20 since 2026-10-14, the Viaduct's and the Platform's combat percentages; was 2 to 12.
        bonuses: [{ kind: 'ally_fight', percent: 10, ladder: [10, 12, 14, 16, 20] }],
        labels: [L('eerie', 3), L('elevated', 3), L('cold', 2), L('open', 1)],
        contexts: ['indoor'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The roof is made good and the bell rings on the hour again.',
          'A vestry for people who want to talk without a congregation listening.',
          'Somebody is here at any hour, and the district has noticed.',
        ],
      },

      {
        slug: 'undercroft',
        name: 'The Undercroft Stores',
        icon: 'stores',
        blurb:
          'Vaults under the floor deep enough for a siege. Everything you keep, you keep more of.',
        reward: 'Everything you keep, you keep more of.',
        bonuses: [{ kind: 'storage', percent: 10, ladder: [10, 13, 15, 18, 24] }],
        labels: [L('dark', 4), L('cold', 3), L('crammed', 2), L('wet', 1)],
        contexts: ['indoor'],
        baseDefense: 4,
        upgradeCost: 220,
        upgrades: [
          'The lower vaults are pumped and shelved. Twice the room.',
          'A hoist and a tally board. Nothing is lost between the door and the shelf.',
          'The stores are yours end to end, and the ledger says so.',
        ],
      },

      {
        slug: 'plate',
        name: 'The Collection Plate',
        icon: 'market',
        blurb:
          'The cathedral’s takings, every hour of every day. Whoever holds the plate finds every improvement at home pays a little more.',
        reward: 'A cut of everything that changes hands.',
        bonuses: [{ kind: 'modification_output', percent: 10, ladder: [10, 13, 15, 18, 24] }],
        labels: [L('crammed', 4), L('noisy', 4)],
        contexts: ['urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The pitches are numbered and rented instead of fought over.',
          'A covered row along the north side, so the market keeps trading in the rain.',
          'Your own weigh house at the gate. Nothing crosses it uncounted.',
        ],
      },

      {
        slug: 'courtofarms',
        name: 'The Court of Arms',
        icon: 'armory',
        blurb:
          'The cathedral guard’s armoury, which fits whoever holds it at the guard’s own price.',
        reward: 'Cheaper units, and a bench that will fit anything you can find a part for.',
        bonuses: [{ kind: 'refit_discount', percent: 10, ladder: [10, 14, 18, 22, 30] }],
        labels: [L('crammed', 3), L('dark', 3), L('cold', 2), L('noisy', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 270,
        upgrades: [
          'The armourer’s bench is set up properly and somebody is on it every day.',
          'Pattern jigs, so a unit modification is repeatable instead of one man’s good afternoon.',
          'A proving butt out the back. Nothing leaves here that has not been fired.',
        ],
      },

      {
        slug: 'close',
        name: 'The Cathedral Close',
        icon: 'refugee_camp',
        blurb: 'The houses round the cathedral, every one of them full.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [
          { kind: 'unit_slots', flat: 50 },
          { kind: 'resource', resource: 'caps', perHour: 6 },
        ],
        labels: [L('crammed', 4), L('noisy', 3), L('cold', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      {
        slug: 'tomb',
        name: 'The Bishops’ Crypt',
        icon: 'mausoleum',
        blurb:
          'Where the bishops are laid under the high altar, each one in a lamp-lit vault with his name over the door.',
        reward:
          'The Death Cloaks are raised here. Every Mausoleum you hold makes each of them harder to kill and harder to stop, and lets you keep fifty more.',
        bonuses: [
          { kind: 'faith' },
          // People live in the tombs, and a level opens more of the vaults to live in. Small, because
          // the reason to take a Mausoleum is the Death Cloaks and not the beds.
          { kind: 'unit_slots', flat: 6 },
        ],
        labels: [L('eerie', 4), L('dark', 2), L('cold', 2), L('crammed', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The lamp is relit and the doors rehung. The families inside answer to you now.',
          'The lower vaults are opened up. There is room in the dark for a great many more.',
          'The tomb is yours in name as well: your mark is cut over the door, and the dead keep it.',
        ],
      },
    ],
  }),
  ...plots(ARCA_CITY_ID, [
    [
      'almshouses',
      { x: 0.2, y: 0.7 },
      'Charity housing in the cathedral’s shadow, built for the deserving poor and lived in by whoever got there first.',
    ],
    [
      'chantry-lane',
      { x: 0.44, y: 0.8 },
      'A narrow lane of small chapels with flats above them, one bell to every three doors.',
    ],
    [
      'lamplighters',
      { x: 0.72, y: 0.86 },
      'The streets that keep the city’s lamps and candles lit at night, and sleep by day.',
    ],
    [
      'waxworks',
      { x: 0.9, y: 0.6 },
      'The candle factories above the market, warm all year and never quiet.',
    ],
  ]),
];

/** The four plots a city gets, which carry no authored name. See `UNCLAIMED_DISTRICT_NAME`. */
function plots(
  cityId: string,
  rows: readonly [id: string, position: { x: number; y: number }, blurb: string][],
): District[] {
  return rows.map(([id, position, blurb]) =>
    districtFrom({
      id,
      cityId,
      name: undefined,
      nickname: null,
      kind: 'residential',
      allegiance: 'independent',
      position,
      blurb,
      locations: [],
    }),
  );
}

/**
 * What finishing one of the new districts is worth.
 *
 * Ashfall gives every contested district one of these and the atlas gave none, so all six could be
 * taken whole and paid nothing for it: a district you can finish and are not rewarded for is a
 * district with no reason to finish. Found by sweeping the new data against the rule
 * `city.test.ts` holds Ashfall to.
 *
 * That rule is the interesting half and it is enforced below: a unified bonus may not be a kind
 * that already appears *inside* its own district. Otherwise completing the ground pays more of
 * exactly what its best location was already paying, and the reward for finishing is
 * indistinguishable from farming one hold.
 */
export const ATLAS_UNIFIED_BONUSES: Readonly<Record<string, UnifiedBonus>> = {
  // Whoever owns the platform decides what comes off it, so every job your crews work in this city
  // pays more (maintainer, 2026-10-09). It was +15% loot capacity until then. The Halt pays
  // supplies, caps, beds and a better Broker inside; what only the whole stop can sell is the
  // freight.
  'coldwater-halt': {
    title: 'Everything Off the Train',
    bonus: { kind: 'mission_spoils', percent: 5, inCity: true },
  },
  // People who live inside a hill are hard to get out of it. A gate is where that is tested: units
  // fighting as a gate's garrison, at home or at a captured gate, hit harder and take more
  // (maintainer, 2026-10-09; it was +10% defence everywhere).
  ironmouth: { title: 'Nobody Digs You Out', bonus: { kind: 'gate_fight', percent: 5 } },
  // The yard builds heavy and keeps it running: every Heavy unit 10% stronger, damage and
  // vitality (maintainer, 2026-10-09). It was missions 12% faster, under "You Sort the Yard".
  'marshalling-yards': {
    title: 'Built in the Yards',
    bonus: { kind: 'tier_strength', tier: 'heavy', percent: 10 },
  },
  // What comes out of bond whole: every Wonder of Engineering 10% stronger, damage and vitality
  // (maintainer, 2026-10-09). It was 15% off the black market, under "The Bond Is Open".
  'bonded-row': {
    title: 'Out of Bond',
    bonus: { kind: 'tier_strength', tier: 'wonder', percent: 10 },
  },
  // The Hill's engineers build for you: every Wonder of Engineering musters 10% faster and costs
  // 10% less (maintainer, 2026-10-09). It was +18% unit stealth, under "The Hill Listens For You".
  'telemetry-hill': {
    title: 'Engineered on the Hill',
    bonus: { kind: 'tier_muster', tier: 'wonder', percent: 10 },
  },
  // Everything crosses the arches: every job, in every city, pays 10% more (maintainer,
  // 2026-10-13). It was +15% infamy gain, under "They Watched You Take the Arches".
  viaduct: {
    title: 'Everything Crosses the Arches',
    bonus: { kind: 'mission_spoils', percent: 10 },
  },
  // Every fight you win or lose from here is talked about the length of the line: +25% infamy off
  // declared fights and battle missions (maintainer, 2026-10-14). It was +14% unit offense, under
  // "The Last Platform Is Shut".
  'last-platform': {
    title: 'Talked About Down the Line',
    bonus: { kind: 'battle_infamy', percent: 25 },
  },
  /*
   * The last district in Terminus pays what every city's last district pays (maintainer,
   * 2026-10-07): a level of ANTI-COMBINE, +10% damage and vitality against the Combine, stacking
   * with the Spire's and the Nave's to +30%. It replaced "Everything Leaves Through You", twenty
   * per cent off every job in this city (written as `25` on a divisor channel, in this city only),
   * a scope nothing else paid. The Yards paid 12 on the same channel until 2026-10-09.
   */
  blockhouse: { title: 'The Blockhouse Is Taken', bonus: { kind: 'anti_combine' } },
  /*
   * Arca, every one chosen by the maintainer (2026-10-07). A district held whole counts for
   * a faction: the members between them hold every location, and every member is paid.
   */
  // A cut of every pilgrim's purse on the way out.
  candlemarket: { title: 'Every Candle Lit', bonus: { kind: 'mission_caps', percent: 15 } },
  // The clans learn from their dead. Three XP a unit slot: a bad fight of fifty slots lost is 150,
  // under what one good run pays, which is what keeps it a consolation and not a farm.
  gravefields: { title: 'Buried With Honours', bonus: { kind: 'xp_per_loss', perSlot: 3 } },
  // Bell metal on everything: every card a unit wears is three points of plate as well.
  bellfounders: { title: 'Cast in Bell Metal', bonus: { kind: 'modification_armor', flat: 3 } },
  // The presses print your payroll.
  printworks: { title: 'Every Press Running', bonus: { kind: 'payroll', percent: 10 } },
  // The Saint walks with the force he fights in.
  'saints-rest': {
    title: 'The Saint Walks With You',
    bonus: { kind: 'legend_aura', unitId: 'the_saint', stat: 'offense_vitality', amount: 2 },
  },
  // Her blades lead, and the line behind them finds the gaps.
  bloodstone: {
    title: 'Her Blades Lead',
    bonus: { kind: 'legend_aura', unitId: 'the_crimson_dancer', stat: 'penetration', amount: 5 },
  },
  // The sisters' blessing on the cheapest sheets in the game.
  cloisters: {
    title: "The Sisters' Blessing",
    bonus: { kind: 'unit_morale', flat: 5, tier: 'rabble' },
  },
  // The last district in the city, and the bonus is the one every city's last district pays: a
  // level of ANTI-COMBINE, stacking with the Blockhouse's and the Spire's.
  nave: { title: 'The Nave Is Taken', bonus: { kind: 'anti_combine' } },
};

/** Every district in the world, Ashfall's included, in city order. */
export const ALL_DISTRICTS: readonly District[] = [...CITY_DISTRICTS, ...TERMINUS, ...ARCA];

const BY_CITY: ReadonlyMap<string, readonly District[]> = new Map([
  [DEFAULT_CITY_ID, CITY_DISTRICTS],
  [TERMINUS_CITY_ID, TERMINUS],
  [ARCA_CITY_ID, ARCA],
]);

/**
 * The Combine's chapels, the rooms it runs a city from: the Chosen Chapel over Ashfall and the
 * Frontier Chapel inside the Blockhouse. The `chapel_held` feat counts these.
 */
export const COMBINE_CHAPEL_IDS: readonly string[] = ['ccs-chapel', 'blockhouse-chapel'];

/**
 * Arca's tombs, one in each contested district (2026-10-07): the whole of the city's one trait.
 * The Death Cloaks are raised on any of them and capped at fifty a tomb held (`units/catalog.ts`),
 * and the `mausoleums_held` feat counts the same list.
 */
export const ARCA_TOMB_IDS: readonly string[] = [
  'candlemarket-tomb',
  'gravefields-mausoleums',
  'bellfounders-tomb',
  'printworks-tomb',
  'saints-rest-tomb',
  'bloodstone-tomb',
  'cloisters-tomb',
  'nave-tomb',
];

/**
 * The world's lookups, and the reason they live here rather than in `districts.ts`.
 *
 * `findDistrict` and `findLocation` used to walk Ashfall's twelve districts, because Ashfall was
 * the world. Every action verb in the game resolves its target through one of them: march, move,
 * spy, raid, garrison, upgrade, fortify. While there was one playable city that was
 * correct; the day a second one opened it became a wall with the wrong sign on it, refusing a real
 * Terminus location as "no such place" (maintainer, 2026-09-24).
 *
 * They are here because this is the only module that can see every city: `atlas.ts` imports
 * `districts.ts`, so `districts.ts` cannot import back. The names did not change, and the package
 * barrel exports both modules, so nothing that imports from `@frontline/shared` had to move.
 * Ashfall's own versions are still there under {@link findAshfallDistrict} and
 * {@link findAshfallLocation}, for the handful of places that really do mean "the first city".
 */
export const EVERY_LOCATION: readonly Location[] = ALL_DISTRICTS.flatMap(
  (district) => district.locations,
);

export function findDistrict(districtId: string): District | undefined {
  return ALL_DISTRICTS.find((district) => district.id === districtId);
}

export function findLocation(locationId: string): Location | undefined {
  return EVERY_LOCATION.find((location) => location.id === locationId);
}

/**
 * What holding the whole of `districtId` is worth, or `null` for ground with nothing to hold.
 *
 * Reads both tables. Ashfall's is authored in `districts.ts` beside its map and the other cities'
 * is authored here beside theirs, which is the right place for each; what was wrong was that only
 * the first one was ever read, so eight authored Terminus bonuses were dead data and a crew that
 * took a district end to end in the second city was paid nothing for it.
 */
export function unifiedBonusFor(districtId: string): UnifiedBonus | null {
  return UNIFIED_BONUSES[districtId] ?? ATLAS_UNIFIED_BONUSES[districtId] ?? null;
}

/**
 * The same integrity guard `districts.ts` runs over Ashfall, run over everywhere else.
 *
 * Ashfall's version has caught a missing unified bonus twice. The atlas had no equivalent, so the
 * same defect in another city surfaced as a `null` on a tooltip instead of a failure to boot.
 */
for (const district of ALL_DISTRICTS) {
  const contested = district.kind === 'contested';
  if (contested && district.locations.length === 0) {
    throw new Error(`${district.id} is contested but has nothing in it to take`);
  }
  if (!contested && district.locations.length > 0) {
    throw new Error(`${district.id} is residential and cannot hold capturable locations`);
  }
  if (contested && unifiedBonusFor(district.id) === null) {
    throw new Error(`${district.id} is contested but has no unified bonus`);
  }
}

if (new Set(EVERY_LOCATION.map((location) => location.id)).size !== EVERY_LOCATION.length) {
  throw new Error('two locations share an id');
}

if (new Set(ALL_DISTRICTS.map((district) => district.id)).size !== ALL_DISTRICTS.length) {
  throw new Error('two districts share an id');
}

/** The districts of one city, or nothing for a city id the world does not have. */
export function districtsOfCity(cityId: string): readonly District[] {
  return BY_CITY.get(cityId) ?? [];
}

/**
 * Which city a district is in.
 *
 * It lived in `districts.ts` and was built from `CITY_DISTRICTS` alone, which was correct while
 * Ashfall was the world and wrong the moment it was not: every district in the atlas answered
 * `undefined`, so the standings' "my city" scope would have read a Saltmarch crew as being nowhere.
 * It belongs here because this is the only module that can see all three cities at once.
 */
const DISTRICT_CITY: ReadonlyMap<string, string> = new Map(
  ALL_DISTRICTS.map((district) => [district.id, district.cityId]),
);

export function cityOf(districtId: string): string | undefined {
  return DISTRICT_CITY.get(districtId);
}
