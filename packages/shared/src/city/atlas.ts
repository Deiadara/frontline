import {
  CITY_DISTRICTS,
  UNIFIED_BONUSES,
  districtFrom,
  type District,
  type UnifiedBonus,
} from './districts.js';
import type { Location } from './locations.js';
import { DEFAULT_CITY_ID } from './cities.js';

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
      ['platform', 'Coldwater Platform', 'rail_station'],
      ['market', 'The Halt Market', 'market'],
      ['standpipe', 'The Standpipe', 'water_works'],
      ['kitchens', 'Trackside Kitchens', 'soup_kitchen'],
      ['fuelling', 'The Fuelling Point', 'gas_station'],
      ['tentrow', 'Tent Row', 'refugee_camp'],
      ['signal', 'The Distant Signal', 'watchtower'],
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
      ['halt', 'Ironmouth Halt', 'rail_station'],
      ['shafts', 'The Ventilation Shafts', 'sewer_junction'],
      ['arches', 'The Bricked Arches', 'smugglers_tunnel'],
      ['shaftnine', 'Shaft Nine', 'chemical_plant'],
      ['spoil', 'The Spoil Heap', 'scrap_press'],
      ['chapel', 'The Tunnel Chapel', 'chapel'],
      ['lampman', 'Lampman’s Row', 'pawn_shop'],
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
      ['hump', 'The Hump', 'rail_yard'],
      // Was the Turntable, a construction site. The working heart of the railway could not be the
      // one part of it without a platform (maintainer, 2026-09-24).
      ['platformfour', 'Platform Four', 'rail_station'],
      ['coalstage', 'The Coaling Stage', 'gas_station'],
      ['breakers', 'The Wagon Breakers', 'scrap_press'],
      ['signalbox', 'Box Nine', 'watchtower'],
      ['messroom', 'The Mess Room', 'tavern'],
      ['sheds', 'The Running Sheds', 'foundry'],
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
      ['halt', 'Bond Street Halt', 'rail_station'],
      ['longbond', 'The Long Bond', 'downtown_market'],
      ['seized', 'The Seized Goods Office', 'pawn_shop'],
      ['rendering', 'The Rendering Shed', 'bone_market'],
      ['crated', 'The Crated Yard', 'construction_site'],
      ['kennels', 'The Kennels', 'doghouse'],
      ['coldstore', 'The Cold Store', 'black_clinic'],
      ['ring', 'The Crate Ring', 'fight_pit'],
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
      ['uplink', 'The Uplink Farm', 'satellite_uplink'],
      ['repeater', 'The Repeater Mast', 'broadcast_tower'],
      ['quiet', 'The Quiet Room', 'university'],
      ['pirate', 'Somebody’s Transmitter', 'pirate_radio'],
      ['dome', 'The Old Dome', 'planetarium'],
      ['array', 'The Ground Array', 'power_station'],
      ['bunkroom', 'The Technicians’ Bunkroom', 'refugee_camp'],
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
      ['halt', 'Viaduct Halt', 'rail_station'],
      ['battery', 'The Arch Battery', 'barricade'],
      ['parapet', 'The Parapet', 'high_ground'],
      ['gantry', 'The Gantry Walk', 'tram_depot'],
      ['archnineteen', 'Arch Nineteen', 'mad_scientist_lair'],
      ['pierworks', 'The Pier Works', 'foundry'],
      ['sappers', 'The Sappers’ Store', 'armory'],
      ['undercroft', 'The Undercroft', 'gene_clinic'],
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
      ['platform', 'Platform One', 'rail_station'],
      ['customs', 'The Customs Hall', 'downtown_market'],
      ['holding', 'The Holding Pens', 'barricade'],
      ['transit', 'The Transit Clinic', 'hospital'],
      ['armoury', 'The Platform Armoury', 'armory'],
      ['stationmaster', 'The Stationmaster’s Office', 'revolutionist_statue'],
      ['sidings', 'The Cold Sidings', 'war_machine_graveyard'],
      ['footbridge', 'The Iron Footbridge', 'smugglers_tunnel'],
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
      ['officershalt', 'The Officers’ Halt', 'rail_station'],
      ['panel', 'The Panel', 'broadcast_station'],
      ['chapel', 'The Frontier Chapel', 'combine_chapel'],
      ['interlocking', 'The Interlocking', 'power_station'],
      ['records', 'The Records Office', 'university'],
      ['parade', 'The Parade Ground', 'gym'],
      ['reactor', 'The Reactor Shed', 'nuclear_plant'],
      ['towerbox', 'The Tower Box', 'watchtower'],
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
      [
        'waxstalls',
        'The Wax Stalls',
        'market',
        'Awnings, arguments, and more candles than the cathedral could burn in a year. Everything a pilgrim buys on the way in is bought here.',
        [{ kind: 'resource', resource: 'caps', perHour: 40 }],
      ],
      [
        'hostels',
        'Pilgrim Hostels',
        'refugee_camp',
        'Doorways, undercrofts and the floors of shut shops, and thousands of people sleeping in them who came for a blessing and stayed for want of a way home.',
        [{ kind: 'unit_slots', flat: 50 }],
      ],
      [
        'chandlery',
        'The Chandlery',
        'chemical_plant',
        'Tallow vats, solvent tanks and a chimney the whole market smells of. The wax comes from here, and so does everything the wax is cut with.',
        [{ kind: 'resource', resource: 'oil', perHour: 20 }],
      ],
      [
        'plinth',
        "Martyr's Plinth",
        'revolutionary_statue',
        'A saint nobody remembers the name of, draped in crimson by whoever holds the market that week. Every road through the stalls ends under it.',
        [{ kind: 'unit_morale', flat: 10, tier: 'rabble' }],
      ],
      [
        'nightwatch',
        'The Night Watch',
        'watchtower',
        'A bell tower with the bell sold and a cabin built in its place, a working pair of glasses, and a line of sight over every approach to the market.',
      ],
      [
        'loft',
        'Bulb-String Loft',
        'pirate_radio',
        'A transmitter in a loft above the stalls, run off the same wire as the bulbs. Whoever keeps it hears the whole market talking, and the market talks to everyone.',
        [
          { kind: 'officer_skill', attribute: 'communication', flat: 5 },
          { kind: 'officer_skill', attribute: 'signals', flat: 5 },
        ],
      ],
      [
        'tomb',
        'The Chandlers’ Tomb',
        'mausoleum',
        'The guild tomb of the candle-makers, under the market, with a lamp in it that the guild still pays to keep lit.',
      ],
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
      [
        'bonemarket',
        'The Bone Market',
        'bone_market',
        'Where the city sells what is left of people and machines, at the cemetery gate so nothing has to be carried far. Brisk, unsentimental, and open all night.',
      ],
      [
        'mourners',
        "Mourners' Row",
        'pawn_shop',
        'The grave-goods counters along the lower terrace. Whatever the dead were buried with that was worth anything ends up here within the week, and the best of it is metal.',
        [{ kind: 'resource', resource: 'highQualityMetal', perHour: 2 }],
      ],
      [
        'wakehouse',
        'The Wake House',
        'tavern',
        'Where every clan drinks after a burial, and there is a burial every day. A room where people say what they mean, and somebody listens.',
        [
          { kind: 'officer_skill', attribute: 'empathy', flat: 5 },
          { kind: 'officer_skill', attribute: 'resolve', flat: 5 },
        ],
      ],
      [
        'mausoleums',
        'The Mausoleums',
        'mausoleum',
        'The great family tombs along the top terrace, each one a house now, with a lamp in the door and a clan name over it that was a saint’s once.',
      ],
      [
        'stonecutters',
        "Stonecutters' Shed",
        'scrap_press',
        'Where headstones and coffins are made, and where the old ones are broken down into something useful when nobody is left to object.',
      ],
      [
        'cemetery',
        'The Cemetery',
        'graveyard',
        'The paupers’ ground below the terraces, and the only part of the fields the city still buries in. Holding it says something the city does not forget.',
        [{ kind: 'infamy_gain', percent: 5 }],
      ],
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
      [
        'clapperworks',
        'The Clapper Works',
        'scrap_press',
        'Where cracked bells and their frames are broken down for anything worth keeping, which is most of a bell.',
      ],
      [
        'castingpit',
        'The Casting Pit',
        'foundry',
        'The great bell pit, pouring armour plate instead of bronze. Bell metal, once it has been liquid, goes onto whoever can wear it.',
        [
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            tier: 'heavy',
            flat: 3,
            ladder: [3, 4, 5, 6, 7],
          },
        ],
      ],
      [
        'tollingtower',
        'The Tolling Tower',
        'broadcast_tower',
        'The last bell the foundry cast, hung with loudspeakers. When it rings, every street in the quarter hears it, and the people who live under it stopped hearing it years ago.',
        [{ kind: 'noise_switch' }],
      ],
      [
        'apprentices',
        'The Apprentice Rows',
        'refugee_camp',
        'Bunk rooms over the workshops, full of apprentices nobody pays, every one of them waiting to be given something to do.',
        [{ kind: 'unit_slots', flat: 50 }],
      ],
      [
        'strawsack',
        'The Straw Sack',
        'workshop',
        'A sack-maker’s loft above the forge, turning out straw bags by the hundred. Whoever carries for you carries more.',
        [{ kind: 'carrier_loot_flat', flat: 5, ladder: [5, 6, 7, 8, 10] }],
      ],
      [
        'hammeryard',
        'The Hammer Yard',
        'workshop',
        'A yard of hammers, from the kind a man swings to the kind a crane drops. Everything you field that hits hard hits harder.',
        [
          {
            kind: 'unit_stat_flat',
            stat: 'offense',
            damageType: 'blunt',
            flat: 10,
            ladder: [10, 15, 20, 25, 30],
          },
        ],
      ],
      [
        'tomb',
        'The Founders’ Tomb',
        'mausoleum',
        'The guild tomb under the casting floor, its door a bell cut in half, warm from the furnaces above it.',
      ],
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
      [
        'greatpress',
        'The Great Press',
        'scrap_press',
        'A rotary press the size of a chapel. Whatever breaks on it is stripped for the next one.',
      ],
      [
        'boilerhouse',
        'The Boiler House',
        'power_station',
        'The steam plant that turns every press in the quarter, and lights whoever holds it.',
      ],
      [
        'scriptorium',
        'The Scriptorium',
        'university',
        'The old copying hall, now the Combine’s archive of everything ever printed. A page of something useful turns up in it every day, for whoever is reading.',
        [
          { kind: 'daily_page' },
          { kind: 'officer_skill', attribute: 'encyclopedia', flat: 5, ladder: [5, 6, 7, 8, 10] },
          { kind: 'officer_skill', attribute: 'logistics', flat: 5, ladder: [5, 6, 7, 8, 10] },
        ],
      ],
      [
        'pamphletwall',
        'The Pamphlet Wall',
        'broadcast_tower',
        'A wall of posters a street long. Whoever holds it chooses who the quarter reads about, and what it reads is not kind.',
        [{ kind: 'pamphlets', pins: 1 }],
      ],
      [
        'canteen',
        'The Typesetters’ Canteen',
        'soup_kitchen',
        'Three shifts fed from one kitchen, and bunks above it for the ones too tired to go home.',
        [
          { kind: 'resource', resource: 'supplies', perHour: 14 },
          { kind: 'unit_slots', flat: 15 },
        ],
      ],
      [
        'tunnels',
        'The Distribution Tunnels',
        'smugglers_tunnel',
        'The paper tunnels that carry the morning sermon to every church in the quarter. A crew that knows them is back from anywhere in it sooner.',
        [{ kind: 'mission_speed', percent: 11, inDistrict: true, ladder: [11, 18, 25, 33, 43] }],
      ],
      [
        'tomb',
        'The Printers’ Vault',
        'mausoleum',
        'A vault under the presses where the guild buried its own, between the type cases.',
      ],
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
      [
        'dispensary',
        'The Sisters’ Dispensary',
        'black_clinic',
        'Tinctures and stimulants dispensed through a grille, no questions asked. Some days there is one going spare.',
        [{ kind: 'daily_stim', percent: 30, ladder: [30, 47, 65, 82, 100] }],
      ],
      [
        'infirmary',
        'The Infirmary Cloister',
        'hospital',
        'The monks’ sick ward, still the best-run in the city. More of yours come back from a fight than should.',
        [{ kind: 'casualty_recovery', percent: 2, ladder: [2, 4, 6, 8, 10] }],
      ],
      [
        'shrine',
        'The Saint’s Shrine',
        'shrine',
        'The relic everybody climbs the hill to see, under a Combine banner. The Saint answers to whoever keeps it, and keeps it better the more is poured into it.',
        [{ kind: 'unit_door', unitId: 'the_saint' }],
      ],
      [
        'watchcell',
        'The Watch Cell',
        'watchtower',
        'A hermit’s cell on the highest rock, where the condemned are sent to wait. The ones who come down are not the ones who went up.',
        [{ kind: 'unit_door', unitId: 'the_condemned' }],
      ],
      [
        'yard',
        'The Exercise Yard',
        'gym',
        'The cloister garth, where the novices drill at dawn. Whoever holds it drills faster, and at the top of it, more.',
        [
          { kind: 'training_time', percent: 5, ladder: [5, 10, 15, 20, 25] },
          { kind: 'training_sessions', flat: 1, ladder: [0, 0, 0, 0, 1] },
        ],
      ],
      [
        'wellhouse',
        'The Wellhouse',
        'water_works',
        'The deep well under the hill, the cleanest water in Arca.',
      ],
      [
        'inn',
        'The Saint’s Inn',
        'tavern',
        'The guesthouse at the foot of the steps, a bed for every pilgrim and twice as many when the whole hill is one house.',
        [
          { kind: 'unit_slots', flat: 20, ladder: [20, 40, 60, 80, 100] },
          { kind: 'unit_slots', flat: 20, ladder: [20, 40, 60, 80, 100], whenDistrictWhole: true },
        ],
      ],
      [
        'tomb',
        'The Pilgrims’ Tomb',
        'mausoleum',
        'The tomb at the foot of the hill where the pilgrims who did not make it up are kept.',
      ],
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
      [
        'bountywall',
        'The Bounty Wall',
        'bounty_wall',
        'Every contract in the city is posted here first, and the best of them are posted in gold.',
        [
          {
            kind: 'golden_jobs',
            chancePercent: 20,
            rewardPercent: 10,
            ladder: [20, 40, 60, 80, 100],
          },
        ],
      ],
      [
        'redlantern',
        'The Red Lantern',
        'tavern',
        'The hall every crew in the city ends up in, and where the next job gets talked into. The house takes its cut of every one.',
        [{ kind: 'resource', resource: 'caps', perHour: 60 }],
      ],
      [
        'hiringhall',
        'The Hiring Hall',
        'refugee_camp',
        'Sellswords between contracts, sleeping where they drink. Rabble come cheap to whoever runs the hall.',
        [{ kind: 'muster_cost', percent: 4, tier: 'rabble', ladder: [4, 8, 12, 16, 20] }],
      ],
      [
        'stage',
        'The Crimson Stage',
        'stage',
        'A red-lit stage over the main pit, where she dances before she fights. Her home in the city, and whoever keeps it keeps her.',
        [{ kind: 'unit_door', unitId: 'the_crimson_dancer' }],
      ],
      [
        'chopshop',
        'The Chop Shop',
        'war_machine_graveyard',
        'Stolen machines broken down and rebuilt by morning. Something useful comes off the bench every day.',
        [{ kind: 'daily_component', count: 1, ladder: [1, 1, 1, 2, 2] }],
      ],
      [
        'trophyhall',
        'The Trophy Hall',
        'trophy_hall',
        'Every crew’s trophies on the walls, and a keeper who writes down whose. Holding it says you are the strongest in the room, and pays like it.',
        [{ kind: 'trophies' }],
      ],
      [
        'tomb',
        'The Sellswords’ Tomb',
        'mausoleum',
        'Where the quarter buries the ones who took the wrong contract, under the names of the crews they died for.',
      ],
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
      [
        'lab',
        'The Reliquary Lab',
        'laboratory',
        'Saints’ bones under glass and a centrifuge beside them. The Juggernauts are grown here, and grown better the deeper the work goes.',
        [{ kind: 'unit_door', unitId: 'juggernauts' }],
      ],
      [
        'chapter',
        'The Chapter of Silence',
        'chapel',
        'A room where nobody has spoken in forty years. Nothing said in it leaves it, and nothing a spy wants is said anywhere else.',
        [{ kind: 'spy_defence', percent: 20, ladder: [20, 30, 40, 50, 60] }],
      ],
      [
        'novitiate',
        'The Novitiate',
        'gym',
        'Where the novices are drilled before dawn, every day, until the body stops arguing.',
        [{ kind: 'officer_group', group: 'physical', flat: 3, ladder: [3, 4, 5, 6, 7] }],
      ],
      [
        'coldvault',
        'The Cold Vault',
        'nuclear_plant',
        'The reactor under the convent that runs the labs, and runs everything else of yours a little better.',
        [
          { kind: 'resource_yield', resource: 'oil', percent: 2, ladder: [2, 3, 4, 5, 6] },
          {
            kind: 'resource_yield',
            resource: 'highQualityMetal',
            percent: 2,
            ladder: [2, 3, 4, 5, 6],
          },
        ],
      ],
      [
        'choirloft',
        'The Choir Loft',
        'planetarium',
        'A domed loft with an instrument in it that is not an organ. Crews that work under it learn faster.',
        [{ kind: 'mission_xp', percent: 2, ladder: [2, 3, 4, 5, 6] }],
      ],
      [
        'wall',
        'The Cloister Wall',
        'high_ground',
        'Four storeys of white wall with no doors on the outside. Whoever holds it holds every wall better.',
        [
          {
            kind: 'unit_stat_flat',
            stat: 'range',
            rule: 'guard',
            flat: 10,
            ladder: [10, 13, 15, 18, 20],
          },
          {
            kind: 'unit_stat_flat',
            stat: 'armor',
            rule: 'guard',
            flat: 10,
            ladder: [10, 13, 15, 18, 20],
          },
        ],
      ],
      [
        'tomb',
        'The Sisters’ Crypt',
        'mausoleum',
        'The crypt under the chapter house, where the sisters are laid in silence, in rows.',
      ],
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
      [
        'choir',
        'The Choir',
        'cinema',
        'Eight hundred voices and a light show, every night, for whoever holds the stalls. Anybody who works under it keeps their head.',
        [
          { kind: 'officer_skill', attribute: 'composure', flat: 5, ladder: [5, 6, 7, 8, 10] },
          { kind: 'officer_skill', attribute: 'improvisation', flat: 5, ladder: [5, 6, 7, 8, 10] },
          { kind: 'officer_skill', attribute: 'empathy', flat: 5, ladder: [5, 6, 7, 8, 10] },
        ],
      ],
      [
        'rosewindow',
        'The Rose Window',
        'chapel',
        'The light through it falls on everything you own, and on the people you send to stand beside your allies.',
        [{ kind: 'ally_fight', percent: 2, ladder: [2, 4, 6, 8, 10] }],
      ],
      [
        'undercroft',
        'The Undercroft Stores',
        'stores',
        'Vaults under the floor deep enough for a siege. Everything you keep, you keep more of.',
        [{ kind: 'storage', percent: 10, ladder: [10, 13, 15, 18, 20] }],
      ],
      [
        'plate',
        'The Collection Plate',
        'market',
        'The cathedral’s takings, every hour of every day. Whoever holds the plate finds every improvement at home pays a little more.',
        [{ kind: 'modification_output', percent: 10, ladder: [10, 13, 15, 18, 20] }],
      ],
      [
        'courtofarms',
        'The Court of Arms',
        'armory',
        'The cathedral guard’s armoury, which fits whoever holds it at the guard’s own price.',
        [{ kind: 'refit_discount', percent: 10, ladder: [10, 14, 18, 22, 25] }],
      ],
      [
        'close',
        'The Cathedral Close',
        'refugee_camp',
        'The houses round the cathedral, every one of them full.',
      ],
      [
        'tomb',
        'The Bishops’ Crypt',
        'mausoleum',
        'Where the bishops are laid under the high altar, each one in a lamp-lit vault with his name over the door.',
      ],
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
  // Whoever owns the platform decides what comes off it, so every crew you send anywhere comes
  // back carrying more. The Halt pays supplies and beds inside; what only the whole stop can sell
  // is the freight.
  'coldwater-halt': {
    title: 'Everything Off the Train',
    bonus: { kind: 'loot_capacity', percent: 15 },
  },
  // People who live inside a hill are hard to get out of it. Deliberately not more stealth: the
  // shafts already pay that, and a crew that has taken a hill should be harder to shift
  // everywhere, not sneakier in one place.
  ironmouth: { title: 'Nobody Digs You Out', bonus: { kind: 'defense_percent', percent: 10 } },
  // Sort the yard and you decide what leaves. The Yards already pay parts and travel inside, so
  // the whole pays in the one thing a junction is actually for: getting there sooner.
  'marshalling-yards': {
    title: 'You Sort the Yard',
    bonus: { kind: 'mission_speed', percent: 12 },
  },
  // Not another discount on the ordinary market, which the Long Bond inside already pays: what
  // the whole district buys is the other counter.
  'bonded-row': {
    title: 'The Bond Is Open',
    bonus: { kind: 'black_market_discount', percent: 15 },
  },
  // Every dish on the Hill pointed where you point it. It pays research inside already; the whole
  // district buys what listening to the Combine's own traffic is really worth.
  'telemetry-hill': {
    title: 'The Hill Listens For You',
    bonus: { kind: 'unit_stealth', percent: 18 },
  },
  // Taking the viaduct is the most visible thing anybody can do in this city, and the whole world
  // prices you differently afterwards: the infamy counts everywhere.
  viaduct: {
    title: 'They Watched You Take the Arches',
    bonus: { kind: 'infamy_gain', percent: 15 },
  },
  // The last platform, and the checkpoints on it. It pays discounts, marks and vitality inside, so
  // the whole is worth what holding a garrison actually buys: the people on it hit harder.
  'last-platform': {
    title: 'The Last Platform Is Shut',
    bonus: { kind: 'unit_offense', percent: 14 },
  },
  /*
   * The last district in Terminus pays what every city's last district pays (maintainer,
   * 2026-10-07): a level of ANTI-COMBINE, +10% damage and vitality against the Combine, stacking
   * with the Spire's and the Nave's to +30%. It replaced "Everything Leaves Through You", twenty
   * per cent off every job in this city (written as `25` on a divisor channel, in this city only),
   * which the Yards go on paying a smaller share of inside.
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
