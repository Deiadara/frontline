import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EVERY_LOCATION } from './atlas.js';
import { bonusesAt, upgradeCost, upgradeNote, type Location } from './locations.js';
import { PLAYER_UNITS, unitsUnlockedByLocation } from '../units/catalog.js';
import { describeRequirement, requirementMet, type UnlockContext } from '../units/unlocks.js';

/*
 * Location types came out of the game on 2026-10-14 (maintainer: "Remove just the types, keep
 * everything else the same everywhere"). Every location now carries what its kind used to lend
 * it, and these pins were taken off the old catalogue the moment before the types went: what each
 * location pays at every level, what its upgrades cost and say, its words, its contexts and its
 * defence. The one thing allowed to move was the ground labels, which were authored afresh per
 * location, so they are not in the digest.
 *
 * A digest rather than the figures, because the figures are 190 KB. A deliberate change to one
 * location changes its digest: print `figures(location)` for it, check the change is the one you
 * meant, and re-pin that line.
 */

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const LEVELS = [1, 2, 3, 4, 5];

function figures(location: Location): unknown {
  return {
    icon: location.icon,
    blurb: location.blurb,
    reward: location.reward,
    bonuses: LEVELS.map((level) => bonusesAt(location, level)),
    baseDefense: location.baseDefense,
    upgradeCost: location.upgradeCost,
    costs: LEVELS.map((level) => upgradeCost(location, level)),
    notes: LEVELS.map((level) => upgradeNote(location, level)),
    contexts: location.contexts,
    levelScale: location.levelScale ?? null,
    captureInfamy: location.captureInfamy ?? null,
  };
}

function digest(location: Location): string {
  return createHash('sha256')
    .update(canonical(figures(location)))
    .digest('hex')
    .slice(0, 16);
}

/** Taken off the catalogue with types, 2026-10-14. */
const PINNED: Readonly<Record<string, string>> = {
  'neon-docks-tideline': '52dc6683ae39e857',
  'neon-docks-pumphouse': '0e5129138c3562de',
  'neon-docks-runners': 'ce472c1154c3f745',
  'neon-docks-galley': '25e97bae9afbde2b',
  'neon-docks-barges': 'f74b6bf57c806f43',
  'neon-docks-cranegate': '5e2b555d85fc3c24',
  'neon-docks-chandler': '0e8e407b6868b12e',
  'steelbelt-press': '423d56dab46e00b2',
  // Re-pinned 2026-10-15: the ride waiver left the game and its reward line with it.
  'steelbelt-bonefield': '2a24474f2b0500ac',
  'steelbelt-pawn': '0e8e407b6868b12e',
  'steelbelt-ramp': '32ee87ecc273d977',
  'steelbelt-pumps': 'f31a90a9296e7293',
  'steelbelt-kennels': 'b50501aeaae4f28c',
  'steelbelt-canteen': '25e97bae9afbde2b',
  'chrome-row-exchange': 'e74c1ae0caf7a19c',
  'chrome-row-cathode': '0c9beff620e8f3f1',
  'chrome-row-overlook': '4c966b0f3f2f5923',
  'chrome-row-ferrous': '3c193d20e5a33565',
  'chrome-row-statue': '41f8e6b46b8890cd',
  'chrome-row-regal': '243edca99a49ec70',
  'chrome-row-anvil': '956b1fd880f8a634',
  'chrome-row-coinop': 'aee051d00191f3ad',
  'undergrid-substation': '864de2ffbcd567d5',
  'undergrid-vault9': '864de2ffbcd567d5',
  'undergrid-junction': '71dd1d71679b67e3',
  'undergrid-reagent': '98b40904b837d21d',
  'undergrid-customs': 'ce472c1154c3f745',
  'undergrid-depot': 'b119f13cd5bbbcc4',
  'undergrid-lair': '4a68bdee38cf4888',
  'annexes-faculty': '4ecf2228a3ed0303',
  'annexes-uplink': 'f556ba2ab3bd734d',
  'annexes-ward': 'c84492f0c9b6fa7b',
  'annexes-coldrow': '12de653ed50c3763',
  'annexes-orrery': '6c4a4ff79ce78775',
  'annexes-loft': 'db646dc3c9367961',
  'annexes-scaffold': '8aec3f776877df06',
  'glasshouse-fields-intake': '0e5129138c3562de',
  'glasshouse-fields-fieldgate': '52dc6683ae39e857',
  'glasshouse-fields-berm': '4c966b0f3f2f5923',
  'glasshouse-fields-haulers': '73e27a677e6c0a27',
  'glasshouse-fields-ladle': '25e97bae9afbde2b',
  'glasshouse-fields-fieldchapel': '4f67aaacc343bf06',
  'glasshouse-fields-fence': 'f74b6bf57c806f43',
  'glasshouse-fields-glasshouses': '0bd597f23b74bfba',
  'blacksite-armory': 'e37e3ddf3f240d02',
  'blacksite-outer': '1f3e989c2fc6a20e',
  'blacksite-watchtower': '0917c449b2bc64c0',
  'blacksite-pit17': '603af42ab2b4c607',
  // Re-pinned 2026-10-15, as the Breaker's Yard.
  'blacksite-motorpool': '2da9917913c2cb81',
  'blacksite-drill': 'c2e316bd655be133',
  'blacksite-blackward': '7c9e345ce0b97032',
  'blacksite-pile': '00bc8ac6604df9c4',
  'ccs-uplink': 'f556ba2ab3bd734d',
  'ccs-armory': '242ba74449784c01',
  'ccs-household': 'b85f63de8ea904fb',
  'ccs-broadcast': 'a121b014d478665c',
  'ccs-ascension': 'c84492f0c9b6fa7b',
  'ccs-scaffold': '8aec3f776877df06',
  'ccs-martyrs': 'b337689985225b1a',
  'ccs-chapel': '9febd6c6ff26373d',
  'coldwater-halt-platform': 'cfd9ffebe173a4ad',
  'coldwater-halt-market': '0bef2319c791f4a7',
  'coldwater-halt-standpipe': '41cb69f8732d8f9a',
  'coldwater-halt-kitchens': '3e7446b903eab714',
  'coldwater-halt-fuelling': 'fb68c04ab1880102',
  'coldwater-halt-tentrow': 'a4363af158c97814',
  'coldwater-halt-signal': 'c0cd9e5fbe68c51d',
  'ironmouth-halt': 'cfd9ffebe173a4ad',
  'ironmouth-shafts': 'fac2f0d488cf7413',
  'ironmouth-arches': '511b4f53931663b2',
  'ironmouth-shaftnine': '3180b1cb293f3f57',
  'ironmouth-spoil': 'fc3185e664adbc3a',
  'ironmouth-chapel': 'c55720ffe3cf5b43',
  'ironmouth-lampman': 'a18c0bfc22b11c7a',
  'marshalling-yards-hump': '4472b966dd79397d',
  'marshalling-yards-platformfour': '27c3a4f1948b30fa',
  'marshalling-yards-coalstage': '598c29ebd7f7f9b6',
  'marshalling-yards-breakers': '98e8a22798ed7c86',
  'marshalling-yards-signalbox': '33df399e5ce03670',
  'marshalling-yards-messroom': '1c96958e005680fd',
  'marshalling-yards-sheds': 'adc1a9ef0952b3b3',
  'bonded-row-halt': 'c1b697f69a75db4b',
  'bonded-row-longbond': 'e3ddad4ac83b1205',
  'bonded-row-seized': '38f8326361e25a82',
  'bonded-row-rendering': '9f9795a14366efda',
  'bonded-row-crated': '825ccdb8e1f28442',
  'bonded-row-kennels': 'a9f65921cf3a0483',
  'bonded-row-coldstore': '3b59d6c046a08541',
  'bonded-row-ring': 'c043d8150df9e245',
  'telemetry-hill-uplink': '49c59bbce1b55561',
  'telemetry-hill-repeater': 'f89a38940bec9f13',
  'telemetry-hill-quiet': '9f758568ff61197e',
  'telemetry-hill-lodge': '091c5e9b1318bbb8',
  'telemetry-hill-dome': 'b2218867095abd06',
  'telemetry-hill-array': 'b7c39657040856e7',
  'telemetry-hill-bunkroom': '9a20c705f0b7c5eb',
  'viaduct-halt': '1dd1502cae363016',
  'viaduct-battery': 'aa3201decc08feac',
  'viaduct-parapet': '15fa077909b26c3e',
  'viaduct-gantry': '05285a2c403231c4',
  'viaduct-archnineteen': '326d92de4f4f00fa',
  'viaduct-pierworks': '07efc4a52717ae79',
  'viaduct-sappers': 'c5a31e260e8afb75',
  'viaduct-camp': '9802b2a741b0c52f',
  'last-platform-platform': 'c9e0f8924ca445fc',
  'last-platform-customs': '1d42b17146936d51',
  'last-platform-holding': 'b661f71abeee01e5',
  'last-platform-transit': '52160a9e0677864d',
  'last-platform-armoury': 'c9faa376391feb8a',
  'last-platform-stationmaster': '1423c706241514d0',
  'last-platform-sidings': '0d9487e4cd0024a1',
  'last-platform-footbridge': '2d50185f998cd13d',
  'blockhouse-officershalt': '5673d29f39d6ae28',
  'blockhouse-panel': '3ec0c958d96f9192',
  'blockhouse-chapel': 'f0bc43c1c41b15de',
  'blockhouse-interlocking': '01109921aad81a3d',
  'blockhouse-records': 'e25eed721e8c51c8',
  'blockhouse-parade': '1603c17d337a4d24',
  'blockhouse-reactor': 'ebffd4bfee914b28',
  'blockhouse-towerbox': 'bfec4c86a756a239',
  'candlemarket-waxstalls': 'a7ac84138d168c6a',
  'candlemarket-hostels': '1cd79a068b08a2d0',
  'candlemarket-chandlery': 'a4b2fe8f85e3958e',
  'candlemarket-plinth': '28b0b39d16e15a13',
  'candlemarket-nightwatch': '6c0219e6c83231e0',
  'candlemarket-loft': '1a6356f77cf72368',
  'candlemarket-tomb': '9d37876fb28aae29',
  'gravefields-bonemarket': 'a0050fbeaf6cae1f',
  'gravefields-mourners': 'd93f406a7b7e353c',
  'gravefields-wakehouse': '4b7875b329a2101d',
  'gravefields-mausoleums': 'a8a292915b223026',
  'gravefields-stonecutters': 'c4085e03592e28fb',
  'gravefields-cemetery': '36112ba18294e723',
  'bellfounders-clapperworks': 'cfd9d9bbaaa52471',
  'bellfounders-castingpit': '0c01e20f715b4e63',
  'bellfounders-tollingtower': 'a3c51363f9eac730',
  'bellfounders-apprentices': '948bc3b9513a9f90',
  'bellfounders-strawsack': '7f4cc9df7b8a932b',
  'bellfounders-hammeryard': 'fad2841576ef4432',
  'bellfounders-tomb': 'ceb3690742632708',
  'printworks-greatpress': '16dad886732821a4',
  'printworks-boilerhouse': '3e2612f420c01420',
  'printworks-scriptorium': '7f6400a45d56c627',
  'printworks-pamphletwall': 'e2933738ef46db4b',
  'printworks-canteen': '7185a68abf99150e',
  'printworks-tunnels': '062bc92139ace170',
  'printworks-tomb': '85a49e790d0606a8',
  'saints-rest-dispensary': 'ad351e8713bc3494',
  'saints-rest-infirmary': 'bff28ec40877e8d3',
  'saints-rest-shrine': 'bacf9e6d25b7082d',
  'saints-rest-watchcell': 'ec29778524c125f6',
  'saints-rest-yard': 'c816eadcbb1335b2',
  'saints-rest-wellhouse': '0c6a1666a22d3487',
  'saints-rest-inn': '1c90fb2be0fb5755',
  'saints-rest-tomb': 'bea2d5d4900652a7',
  'bloodstone-bountywall': '61ef5ed15af2042a',
  'bloodstone-redlantern': '11cab64f37290639',
  'bloodstone-hiringhall': '67743b621930d2ab',
  'bloodstone-stage': '670e52a5cad923ee',
  'bloodstone-chopshop': 'c1c472b324386e1d',
  'bloodstone-trophyhall': 'dd730e66749d84e7',
  'bloodstone-tomb': 'f1657231e0243518',
  'cloisters-lab': '382b7e29ab3b797c',
  'cloisters-chapter': '9af1584a49894e4a',
  'cloisters-novitiate': '0ae9a0131c2dabeb',
  'cloisters-coldvault': 'a8da40a5bf81ede7',
  'cloisters-choirloft': '6188bec35188a212',
  'cloisters-wall': '61af3a0932eb0ebb',
  'cloisters-tomb': '1f6d33f711b550b2',
  'nave-choir': 'e96df39d5f005597',
  'nave-rosewindow': '880ee964f65b8c55',
  'nave-undercroft': 'b22233cff99465d2',
  'nave-plate': 'b5cb3ecff2dcd8fb',
  'nave-courtofarms': 'e2557e9e22d71b48',
  'nave-close': '0cd8371236578ba3',
  'nave-tomb': '24f5a100de580c83',
};

/** Every location that opened a unit with types, and what it opened (kind, door and place). */
const OPENED: Readonly<Record<string, readonly string[]>> = {
  'steelbelt-kennels': ['cyber_dogs'],
  'undergrid-lair': ['the_abomination', 'the_twins'],
  'annexes-uplink': ['the_specter'],
  'annexes-ward': ['the_twins'],
  'annexes-scaffold': ['the_colossus'],
  'glasshouse-fields-haulers': ['the_loose_end'],
  'ccs-uplink': ['the_specter'],
  'ccs-ascension': ['the_twins'],
  'ccs-scaffold': ['the_colossus'],
  'marshalling-yards-signalbox': ['snipers'],
  'marshalling-yards-messroom': ['breakers'],
  'bonded-row-kennels': ['cyber_dogs'],
  'bonded-row-ring': ['the_geppetto'],
  'telemetry-hill-repeater': ['kite_crews'],
  'telemetry-hill-dome': ['the_cartographer'],
  'viaduct-archnineteen': ['hollow_men'],
  'candlemarket-tomb': ['death_cloaks'],
  'gravefields-mausoleums': ['death_cloaks'],
  'bellfounders-tomb': ['death_cloaks'],
  'printworks-tomb': ['death_cloaks'],
  'saints-rest-tomb': ['death_cloaks'],
  'bloodstone-tomb': ['death_cloaks'],
  'cloisters-tomb': ['death_cloaks'],
  'nave-tomb': ['death_cloaks'],
};

/**
 * Who could satisfy each location clause with types: per unit, per clause, the locations of the
 * kind that still counted for kind gates (`KIND_GATES_DROPPED` folded in), plus a named place.
 */
const REACHED_BY: Readonly<Record<string, readonly (readonly string[])[]>> = {
  cyber_dogs: [['bonded-row-kennels', 'steelbelt-kennels']],
  juggernauts: [['annexes-ward', 'ccs-ascension']],
  the_specter: [['annexes-uplink', 'ccs-uplink']],
  the_abomination: [['undergrid-lair']],
  the_colossus: [['annexes-scaffold', 'ccs-scaffold']],
  the_twins: [['undergrid-lair'], ['annexes-ward', 'ccs-ascension']],
  the_loose_end: [['glasshouse-fields-haulers']],
  death_cloaks: [
    [
      'bellfounders-tomb',
      'bloodstone-tomb',
      'candlemarket-tomb',
      'cloisters-tomb',
      'gravefields-mausoleums',
      'nave-tomb',
      'printworks-tomb',
      'saints-rest-tomb',
    ],
  ],
};

describe('location types removed, figures kept', () => {
  it('covers the same locations', () => {
    expect(EVERY_LOCATION.map((location) => location.id).sort()).toEqual(
      Object.keys(PINNED).sort(),
    );
  });

  it.each(EVERY_LOCATION.map((location) => [location.id, location] as const))(
    '%s pays, costs and reads exactly as it did',
    (id, location) => {
      expect(digest(location), JSON.stringify(figures(location))).toBe(PINNED[id]);
    },
  );

  it('opens the same units at the same locations', () => {
    const opened: Record<string, string[]> = {};
    for (const location of EVERY_LOCATION) {
      const units = unitsUnlockedByLocation(location.id).map((unit) => unit.id);
      if (units.length > 0) opened[location.id] = units.sort();
    }
    // A door clause's other locations are not "opened by" them on the sheet, as before.
    expect(opened).toEqual(OPENED);
  });

  it('lets exactly the same locations satisfy every location clause', () => {
    const context = (held: string): UnlockContext => ({
      buildings: [],
      heldDoors: new Set(),
      heldPlaces: new Set([held]),
      buildableVehicles: new Set(),
      inventory: {},
      notoriety: 0,
    });
    const reached = Object.fromEntries(
      PLAYER_UNITS.flatMap((unit) => {
        const clauses = unit.requires.filter(
          (need) => need.kind === 'location' || (need.kind === 'door' && need.orLocationIds),
        );
        if (clauses.length === 0) return [];
        return [
          [
            unit.id,
            clauses.map((need) =>
              EVERY_LOCATION.filter((location) => requirementMet(need, context(location.id)))
                .map((location) => location.id)
                .sort(),
            ),
          ],
        ];
      }),
    );
    expect(reached).toEqual(REACHED_BY);
  });
});

describe('a clause that names its ground', () => {
  it('names up to three places in full, and counts the rest', () => {
    const cloaks = PLAYER_UNITS.find((unit) => unit.id === 'death_cloaks')!;
    const tombs = cloaks.requires.find((need) => need.kind === 'location')!;
    expect(describeRequirement(tombs)).toBe(
      'Hold The Chandlers’ Tomb in Candlemarket, or The Mausoleums in Gravefields, or one of 6 other places',
    );
    const hounds = PLAYER_UNITS.find((unit) => unit.id === 'cyber_dogs')!;
    expect(describeRequirement(hounds.requires.find((need) => need.kind === 'location')!)).toBe(
      'Hold The Kennels in Bonded Row, or The Doghouse in Steelbelt',
    );
  });
});
