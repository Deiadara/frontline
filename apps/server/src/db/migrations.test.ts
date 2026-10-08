import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTRIBUTE_NAMES,
  ArmySchema,
  AttributesSchema,
  BaseSchema,
  BUILDING_KINDS,
  BadgeSchema,
  DEFAULT_BADGE,
  RESEARCH_ITEMS,
  ResearchStateSchema,
  SideAnalysisSchema,
  startingEconomy,
  startingProgression,
  startingResearch,
  unitSlotsUsed,
  type Building,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';
import { createBasesRepo } from './repos/bases.js';
import { createMissionsRepo } from './repos/missions.js';
import { createSiegeRepo } from './repos/sieges.js';
import { createCityRepo } from './repos/city.js';
import { createSleeperRepo } from './repos/sleepers.js';
import { createSpyingRepo } from './repos/spying.js';
import { createBarRepo } from './repos/bar.js';
import { createFeatsRepo } from './repos/feats.js';
import { createMovesRepo } from './repos/moves.js';
import { createSocialRepo } from './repos/social.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Every migration up to but not including `stopBefore`: the schema a legacy save was written by. */
function migrateUpTo(db: AppDatabase, stopBefore: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (file >= stopBefore) break;
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
  }
}

const DROP_COMMONS = '0014_drop_commons.sql';

/** One fixed timestamp for every row these tests write. */
const NOW = '2026-08-16T12:00:00.000Z';

/**
 * The Commons removal, checked the only way that means anything: against a row written *before* it.
 *
 * The catalogue no longer has the kind, so no fixture built from `BUILDING_CATALOG` can produce one
 * and nothing in the rest of the suite can reach this state at all. It is reached by writing the
 * JSON a pre-removal district would have had, which is exactly what is sitting in anyone's database
 * right now.
 */
describe('0014: dropping the Commons from saved districts', () => {
  const legacyBase = (buildings: unknown[], queue: unknown[] = []) => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, DROP_COMMONS);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'legacy', 'x', '2026-01-01T00:00:00.000Z');
    const columns = (db.prepare('SELECT * FROM bases LIMIT 0').columns() as { name: string }[]).map(
      (c) => c.name,
    );
    const values: Record<string, string | number> = {};
    for (const name of columns) {
      values[name] = name.endsWith('_json')
        ? '[]'
        : name === 'level' || name.startsWith('is_')
          ? 0
          : name === 'owner_id'
            ? 'u1'
            : 'x';
    }
    values.buildings_json = JSON.stringify(buildings);
    values.build_queue_json = JSON.stringify(queue);
    db.prepare(
      `INSERT INTO bases (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...columns.map((name) => values[name]));
    return db;
  };

  const buildingsAfter = (db: AppDatabase): Building[] => {
    runMigrations(db);
    const row = db.prepare('SELECT buildings_json FROM bases').get() as { buildings_json: string };
    return JSON.parse(row.buildings_json) as Building[];
  };

  it('removes the Commons and leaves every other structure alone', () => {
    const db = legacyBase([
      { kind: 'nexus', level: 3, modifications: [] },
      { kind: 'commons', level: 7, modifications: ['commons_notice_board'] },
      { kind: 'quarters', level: 2, modifications: [] },
    ]);

    const after = buildingsAfter(db);
    expect(after.map((b) => b.kind)).toEqual(['nexus', 'quarters']);
    // Not just the kind: the surviving rows keep their levels, so the rebuild is a filter and not
    // a re-creation from defaults.
    expect(after.map((b) => b.level)).toEqual([3, 2]);
  });

  it('leaves a district that never built one exactly as it was', () => {
    const before = [
      { kind: 'nexus', level: 1, modifications: [] },
      { kind: 'lab', level: 4, modifications: ['lab_quantum_modeling'] },
    ];
    expect(buildingsAfter(legacyBase(before))).toEqual(before);
  });

  /** A district whose *only* structure was the Commons must end up with an empty list, not null. */
  it('empties the list rather than nulling it', () => {
    const db = legacyBase([{ kind: 'commons', level: 1, modifications: [] }]);
    expect(buildingsAfter(db)).toEqual([]);
  });

  it('drops a queued Commons, which would otherwise complete back into the list', () => {
    const db = legacyBase(
      [{ kind: 'nexus', level: 1, modifications: [] }],
      [
        { kind: 'commons', level: 1, doneAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'lab', level: 1, doneAt: '2026-01-01T00:00:00.000Z' },
      ],
    );
    runMigrations(db);
    const row = db.prepare('SELECT build_queue_json FROM bases').get() as {
      build_queue_json: string;
    };
    expect((JSON.parse(row.build_queue_json) as { kind: string }[]).map((e) => e.kind)).toEqual([
      'lab',
    ]);
  });

  /**
   * §A2: the Cistern is gone, and a save that has one still has to open.
   *
   * 0014 used to rename the Cistern's fifth modification; 0056 removes the structure it was bolted
   * to outright, so the rename now has nothing to land on and this is the assertion that survives
   * it. Both halves are checked because both are ways an account fails to load:
   * `BuildingKindSchema` is an enum over the live catalogue, so one Cistern row anywhere in
   * `buildings_json` or `build_queue_json` is a district that cannot be parsed.
   */
  it('§A2: takes a saved Cistern out of the district and out of the queue', () => {
    const db = legacyBase(
      [
        { kind: 'nexus', level: 4, modifications: [] },
        { kind: 'cistern', level: 9, modifications: ['cistern_clean_line_to_the_commons'] },
      ],
      [
        { kind: 'cistern', level: 10, doneAt: '2026-01-01T00:00:00.000Z' },
        { kind: 'lab', level: 1, doneAt: '2026-01-01T00:00:00.000Z' },
      ],
    );
    runMigrations(db);

    expect(buildingsAfter(db).map((building) => building.kind)).toEqual(['nexus']);
    const row = db.prepare('SELECT build_queue_json FROM bases').get() as {
      build_queue_json: string;
    };
    expect((JSON.parse(row.build_queue_json) as { kind: string }[]).map((e) => e.kind)).toEqual([
      'lab',
    ]);
  });

  /**
   * §B9/§E: 0056 filled the shelf from what was already bolted on, and 0097 empties it again.
   *
   * The two are not in conflict: 0056 was written when fitting became reversible and a card had to
   * have somewhere to go when it came out of a bracket. There is no shelf at all as of 2026-09-16
   * (building and fitting are one press), so the end state of the chain is an empty `built` list
   * and the *fitted* cards untouched, which is what a crew actually paid for.
   */
  it('§B9: leaves the shelf empty and every fitted card where it was', () => {
    const db = legacyBase([
      { kind: 'nexus', level: 20, modifications: ['nexus_encrypted_core'] },
      { kind: 'lab', level: 20, modifications: ['lab_quantum_modeling'] },
    ]);
    runMigrations(db);

    const row = db.prepare('SELECT addons_json FROM bases').get() as { addons_json: string };
    const addons = JSON.parse(row.addons_json) as { researched: string[]; built: string[] };
    expect(addons.built, 'the shelf is gone, so nothing may be sitting on it').toEqual([]);
    // The Lab projects are a different fact and are not a shelf: they stay.
    expect(addons.researched.sort()).toEqual(['lab_quantum_modeling', 'nexus_encrypted_core']);
    // ...and what was bolted on is still bolted on.
    expect(
      buildingsAfter(db)
        .flatMap((building) => building.modifications ?? [])
        .sort(),
    ).toEqual(['lab_quantum_modeling', 'nexus_encrypted_core']);
  });

  /** ...and a district that never fitted one gets an empty shelf rather than a null column. */
  it('§B9: gives a district with no modifications an empty shelf', () => {
    const db = legacyBase([{ kind: 'nexus', level: 1, modifications: [] }]);
    runMigrations(db);
    const row = db.prepare('SELECT addons_json FROM bases').get() as { addons_json: string };
    expect(JSON.parse(row.addons_json)).toEqual({ researched: [], built: [] });
  });

  /** Nothing that survives may name a structure the game no longer has. */
  it('leaves no building the catalogue cannot resolve', () => {
    const db = legacyBase([
      { kind: 'commons', level: 5, modifications: [] },
      { kind: 'garage', level: 1, modifications: [] },
    ]);
    for (const building of buildingsAfter(db)) {
      expect(BUILDING_KINDS as readonly string[]).toContain(building.kind);
    }
  });
});

/**
 * The attribute rename, checked against sheets written before it.
 *
 * Nine attributes changed name, one was retired and two were added. A stored sheet is JSON keyed by
 * attribute name, so nothing rejects the old keys on write and nothing rejects them on read: the
 * failure is `AttributesSchema` complaining that the *new* keys are missing, which reads as a bug in
 * the schema rather than as old data. No fixture built from the current model can produce this
 * state, so it is written by hand, exactly as it sits in anybody's database right now.
 */
describe('0015: renaming the attribute sheet', () => {
  const OLD_SHEET = {
    strength: 20,
    endurance: 21,
    agility: 22,
    speed: 23,
    reflexes: 24,
    toughness: 25,
    marksmanship: 26,
    stealth: 27,
    tactics: 30,
    analysis: 31,
    imagination: 32,
    cunning: 33,
    composure: 34,
    vigilance: 35,
    scholarship: 36,
    appraisal: 37,
    leadership: 40,
    charisma: 41,
    communication: 42,
    intimidation: 43,
    negotiation: 44,
    deception: 45,
    empathy: 46,
    mentoring: 47,
    engineering: 50,
    hacking: 51,
    fabrication: 52,
    medicine: 53,
    cybernetics: 54,
    salvage: 55,
    demolition: 56,
    navigation: 57,
    chemistry: 58,
    logistics: 59,
  };

  const legacyOverseer = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0015_attribute_rename.sql');
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'legacy', 'x', NOW);
    db.prepare(
      `INSERT INTO overseers (id, user_id, preset_id, name, archetype, portrait_id, bio, attributes_json, traits_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'o1',
      'u1',
      'enforcer',
      'Kane',
      'enforcer',
      'overseer-1',
      'bio',
      JSON.stringify(OLD_SHEET),
      '[]',
      NOW,
    );
    return db;
  };

  const sheetAfter = (db: AppDatabase): Record<string, number> => {
    runMigrations(db);
    const row = db.prepare('SELECT attributes_json FROM overseers').get() as {
      attributes_json: string;
    };
    return JSON.parse(row.attributes_json) as Record<string, number>;
  };

  it('carries every renamed rating across without changing it', () => {
    const sheet = sheetAfter(legacyOverseer());
    expect(sheet.stamina).toBe(OLD_SHEET.endurance);
    expect(sheet.dexterity).toBe(OLD_SHEET.agility);
    expect(sheet.organization).toBe(OLD_SHEET.tactics);
    expect(sheet.logic).toBe(OLD_SHEET.cunning);
    expect(sheet.intuition).toBe(OLD_SHEET.scholarship);
    expect(sheet.resolve).toBe(OLD_SHEET.vigilance);
    expect(sheet.improvisation).toBe(OLD_SHEET.imagination);
    expect(sheet.strategy).toBe(OLD_SHEET.appraisal);
    expect(sheet.diplomacy).toBe(OLD_SHEET.mentoring);
  });

  it('leaves none of the old names behind', () => {
    const sheet = sheetAfter(legacyOverseer());
    for (const gone of [
      'endurance',
      'agility',
      'tactics',
      'cunning',
      'scholarship',
      'vigilance',
      'imagination',
      'appraisal',
      'mentoring',
      'marksmanship',
    ]) {
      expect(sheet, gone).not.toHaveProperty(gone);
    }
  });

  /** A sheet the current schema cannot parse is a character the game cannot load. */
  it('leaves a sheet the current model accepts', () => {
    expect(() => AttributesSchema.parse(sheetAfter(legacyOverseer()))).not.toThrow();
  });

  it('gives the two new attributes a rating nobody was rolled for, rather than a zero', () => {
    const sheet = sheetAfter(legacyOverseer());
    // Zero is a statement about a person. These were never rolled, so they start at the floor.
    expect(sheet.authority).toBeGreaterThan(0);
    expect(sheet.cryptography).toBeGreaterThan(0);
  });

  it('migrates an officer nested inside a crew, not just the overseer', () => {
    const db = legacyOverseer();
    db.prepare('UPDATE bases SET commanders_json = ? WHERE 1=0').run('[]');
    db.prepare(
      `INSERT INTO bases (id, owner_id, name, district_id, level, resources_json, buildings_json, created_at, commanders_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'b1',
      'u1',
      'Crew',
      'neon-docks',
      1,
      '{}',
      '[]',
      NOW,
      JSON.stringify([{ id: 'c1', name: 'Rask', attributes: OLD_SHEET }]),
    );

    runMigrations(db);
    const row = db.prepare('SELECT commanders_json FROM bases WHERE id = ?').get('b1') as {
      commanders_json: string;
    };
    const [officer] = JSON.parse(row.commanders_json) as { attributes: Record<string, number> }[];
    expect(officer?.attributes.stamina).toBe(OLD_SHEET.endurance);
    expect(officer?.attributes).not.toHaveProperty('marksmanship');
    expect(officer?.attributes.cryptography).toBeGreaterThan(0);
  });
});

/**
 * The migration chain itself, rather than any one migration's effect.
 *
 * These are the properties the runner quietly depends on. It sorts filenames and keys
 * `schema_migrations` on the full name, so a chain that satisfies all of this applies each file
 * exactly once, in one order, on a cold database and on a live one alike.
 */
describe('the migration chain', () => {
  const DIR = path.join(fileURLToPath(new URL('.', import.meta.url)), 'migrations');
  const files = readdirSync(DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  it('has a chain to check, so none of this is vacuous', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * Two migrations sharing a number is a live hazard, and there is exactly one pair.
   *
   * `0003_attribute_model.sql` and `0003_economy.sql` both exist, and today they are harmless: the
   * runner sorts on the *whole* filename, so their order is fixed, and the tracking table keys on
   * the whole name, so each applies once. What is not safe is a **third** one. A new `0003_aaa.sql`
   * would sort ahead of both on a cold database and be applied after both on a live one, which is
   * two different schemas from one chain, and the kind of thing that is found in production.
   *
   * The pair is grandfathered by name rather than renamed: `schema_migrations` keys on the filename,
   * so renaming an applied migration makes every existing database run it a second time.
   */
  it('gives every new migration a number of its own', () => {
    const GRANDFATHERED = ['0003_attribute_model.sql', '0003_economy.sql'];
    const byNumber = new Map<string, string[]>();
    for (const file of files) {
      const number = file.slice(0, 4);
      byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    }
    const shared = [...byNumber.values()]
      .filter((group) => group.length > 1)
      .filter((group) => group.join() !== GRANDFATHERED.join());
    expect(
      shared,
      'two migrations with one number apply in a different order on a fresh database',
    ).toEqual([]);
  });

  it('names every migration `NNNN_something.sql`', () => {
    expect(files.filter((file) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(file))).toEqual([]);
  });

  it('applies the whole chain to a cold database, and re-running changes nothing', () => {
    const db = openDatabase(':memory:');
    try {
      const first = runMigrations(db);
      expect(first).toHaveLength(files.length);
      expect(runMigrations(db), 'a second run must apply nothing').toEqual([]);
    } finally {
      db.close();
    }
  });

  /** Two independent cold runs must land on the same schema, or the chain is order-dependent. */
  it('reaches one schema however many times it is run', () => {
    const shapeOf = (db: ReturnType<typeof openDatabase>): string =>
      (
        db
          .prepare(
            "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name",
          )
          .all() as { name: string; sql: string | null }[]
      )
        .map((row) => `${row.name}:${(row.sql ?? '').replace(/\s+/g, ' ')}`)
        .join('\n');

    const one = openDatabase(':memory:');
    const two = openDatabase(':memory:');
    try {
      runMigrations(one);
      runMigrations(two);
      runMigrations(two);
      expect(shapeOf(one)).toBe(shapeOf(two));
    } finally {
      one.close();
      two.close();
    }
  });
});

/**
 * Every migration from 0081 on, against a database that has something in every table.
 *
 * The chain tests above prove a *cold* database reaches one schema, and each per-migration case
 * proves one migration against the rows it is about. Neither is the state a live save is in, and
 * that gap is where this run's migrations are risky: 0085 rewrites three JSON columns in place,
 * 0087 drops and rebuilds a table two others point at, and 0082 drops three tables outright. Every
 * one of those passes on an empty store whether or not it got the interesting part right.
 *
 * So the store is filled first: one row in every table the schema has at 0081, seeded through the
 * live foreign keys rather than around them, and then {@link THROUGH} is applied in order. The
 * completeness assertion is what keeps this honest as tables are added: a new table with nothing in
 * it fails here by name rather than quietly narrowing what the chain was measured against.
 */
describe('every migration from 0081 on, on a database with rows in every table', () => {
  const FIRST = '0081_mission_priced_minutes.sql';
  const THROUGH = [
    '0081_mission_priced_minutes.sql',
    '0082_bar_auctions.sql',
    '0083_pending_level_up.sql',
    '0084_sound_volume.sql',
    '0085_retire_flatbed_war_hauler.sql',
    '0086_vendor_auctions.sql',
    '0087_district_raid_target.sql',
    '0088_mission_leader_and_losses.sql',
    '0089_calling_things_off.sql',
    '0090_mission_finds.sql',
    '0091_two_names_on_a_fight.sql',
    '0092_feats.sql',
    '0093_scout_walk_out.sql',
    '0094_unit_modifications.sql',
    '0095_overseer_pool.sql',
    '0096_overseer_faces.sql',
    '0097_one_press_modifications.sql',
    '0098_black_market_lots.sql',
    '0099_black_market_cities.sql',
    '0100_overseer_holds.sql',
    '0101_retire_structure_damage.sql',
    '0102_sleeper_cells.sql',
    '0103_battle_woke_sleepers.sql',
    '0104_directive_xero.sql',
    '0105_intimidated.sql',
    '0106_intimidated_again.sql',
    '0107_second_chair.sql',
    '0108_master_of_whispers.sql',
    '0109_spying.sql',
    '0110_gate_and_moves.sql',
    '0111_level_floor.sql',
    '0112_tutorial_seen.sql',
    '0113_automations.sql',
    '0114_mixed_order.sql',
    '0115_battle_tier.sql',
    '0116_bio_punctuation.sql',
    '0117_drop_dead_columns.sql',
    '0118_missions_active_index.sql',
    '0119_garrison_regrowth.sql',
    '0120_district_ids_match_names.sql',
    '0121_session_version.sql',
    '0122_movement_by_rail.sql',
    '0123_mission_grade.sql',
    '0124_mission_wasted.sql',
    '0125_market_claims.sql',
    '0126_bar_rooms.sql',
    '0127_spy_accuracy_withheld.sql',
    '0128_bar_room_top_rank.sql',
    '0129_feats_count_what_happened.sql',
    '0130_scouting_removed.sql',
    '0131_whispers_rework.sql',
    '0132_offers_per_city.sql',
    '0133_invitation_letters.sql',
    '0134_mailbox_cap.sql',
    '0135_consigliere_removed.sql',
    '0136_mission_xp_paid.sql',
    '0137_mission_infamy_and_refund.sql',
    '0138_spy_snapshot_and_away_gate.sql',
    '0139_blocked_senders.sql',
    '0140_deployed_peaks.sql',
    '0141_faction_seats.sql',
    '0142_chair_rework.sql',
    '0143_muster_rename.sql',
    '0144_upgrade_paid.sql',
    '0145_stackhouse.sql',
    '0146_gate_paid.sql',
    '0147_mission_carry.sql',
    '0148_strength_judged.sql',
    '0149_held_bids.sql',
    '0150_stackhouse_charged_stake.sql',
    '0151_letter_sends.sql',
    '0152_faction_log.sql',
    '0153_ground_state.sql',
    '0154_daily_grants.sql',
    '0155_gate_raised_by.sql',
  ];
  /**
   * Dropped along with the mechanics under them, so they are not there to be counted: the Bar's
   * old tables by 0082, and scouting's and the Console's fog by 0130.
   */
  const RETIRED = new Set([
    'bar_negotiations',
    'bar_standoffs',
    'bar_slots',
    'scouting_runs',
    'district_intel',
    'admin_fog',
  ]);

  /**
   * What each table needs beyond what {@link insert} can guess.
   *
   * Foreign keys, because a generic filler cannot know which parent row to point at, and the
   * columns behind a CHECK, because `''` is not one of four archetypes. Everything else is left to
   * the filler, so a column added to one of these tables tomorrow does not have to be listed here.
   */
  const SEED: Record<string, Record<string, unknown>> = {
    users: { id: 'u-seed', username: 'seeded', password_hash: 'x', created_at: NOW },
    overseers: {
      id: 'o-seed',
      user_id: 'u-seed',
      preset_id: 'enforcer',
      name: 'Seed',
      archetype: 'enforcer',
      portrait_id: 'overseer-1',
      bio: 'bio',
      attributes_json: '{}',
      created_at: NOW,
    },
    // Written the way a live row is, because this one is read back through `rowToBase`: the
    // column defaults are the shape a *migration* leaves behind rather than the shape a district
    // is saved in, and `BaseSchema` is the thing that has to accept it at the end of the chain.
    bases: {
      id: 'b-seed',
      owner_id: 'u-seed',
      name: 'Seed Crew',
      district_id: 'steelbelt',
      created_at: NOW,
      resources_json: JSON.stringify({
        caps: 100,
        supplies: 50,
        oil: 50,
        scrap: 50,
        planks: 50,
        highQualityMetal: 5,
      }),
      economy_json: JSON.stringify(startingEconomy(NOW)),
      progression_json: JSON.stringify(startingProgression()),
      research_json: JSON.stringify(startingResearch()),
      buildings_json: '[]',
      // 0085's third column: a fleet naming a machine the Garage no longer builds.
      fleet_json: '{"flatbed":2,"scrap_car":1}',
    },
    factions: { id: 'f-seed', name: 'The Seeded', founded_at: NOW },
    faction_members: { user_id: 'u-seed', faction_id: 'f-seed', rank: 'leader', joined_at: NOW },
    faction_invites: {
      id: 'i-seed',
      faction_id: 'f-seed',
      invited_user_id: 'u-seed',
      invited_by_user_id: 'u-seed',
      sent_at: NOW,
    },
    messages: {
      id: 'm-seed',
      thread_id: 't-seed',
      sender_user_id: 'u-seed',
      sender_name: 'seeded',
      recipient_user_id: 'u-seed',
      audience: 'player',
      addressed_to: 'seeded',
      subject: 'Docks',
      body: 'Tonight',
      sent_at: NOW,
    },
    notifications: {
      id: 'n-seed',
      user_id: 'u-seed',
      kind: 'battle_report',
      title: 'A fight was won',
      link: '/game/battles',
      created_at: NOW,
    },
    notification_settings: { user_id: 'u-seed' },
    bar_hires: {
      id: 'h-seed',
      day: '2026-08-16',
      user_id: 'u-seed',
      recruit_id: 'bar-2026-08-16-0-0',
      hired_at: NOW,
    },
    bar_negotiations: {
      user_id: 'u-seed',
      day: '2026-08-16',
      recruit_id: 'bar-2026-08-16-0-0',
      patience: 3,
      standing: 0,
      mood: 'wary',
      updated_at: NOW,
    },
    bar_standoffs: { user_id: 'u-seed', recruit_id: 'bar-2026-08-16-0-0', until: NOW },
    // A fight over a roof, which is the shape 0087 has to rewrite, with both its children attached.
    scheduled_battles: {
      id: 'fight-seed',
      attacker_base_id: 'b-seed',
      target_kind: 'building',
      district_id: 'ashen-terraces',
      building_id: 'their-scrapyard',
      defender_json: '{"kind":"unoccupied"}',
      scheduled_for: NOW,
      declared_at: NOW,
      seed: 'seed-1',
    },
    battle_deployments: {
      battle_id: 'fight-seed',
      base_id: 'b-seed',
      side: 'defender',
      updated_at: NOW,
      // 0085's second column.
      vehicles_json: '{"war_hauler":1,"scrap_car":2}',
    },
    troop_movements: {
      id: 'mv-seed',
      base_id: 'b-seed',
      battle_id: 'fight-seed',
      side: 'attacker',
      from_district_id: 'kettle-row',
      to_district_id: 'ashen-terraces',
      departed_at: NOW,
      arrives_at: NOW,
    },
    // 0102: a cell waiting on ground the crew does not hold.
    sleeper_cells: {
      id: 'cell-seed',
      base_id: 'b-seed',
      location_id: 'steelbelt-press',
      army_json: '{"sleepers":4}',
      phase: 'waiting',
      departed_at: NOW,
      arrives_at: NOW,
      travel_ms: 900000,
    },
    battles: {
      id: 'log-seed',
      attacker_base_id: 'b-seed',
      target_district_id: 'ashen-terraces',
      winner: 'attacker',
      log_json: '[]',
      rewards_json: '{}',
      created_at: NOW,
    },
    location_control: {
      location_id: 'steelbelt-ramp',
      holder_kind: 'crew',
      holder_base_id: 'b-seed',
    },
    // 0085's first column, and 0081's own: a run on the road with a retired machine under it.
    missions: {
      id: 'run-seed',
      base_id: 'b-seed',
      template_id: 'scrap_run',
      started_at: NOW,
      travel_minutes: 12,
      duration_minutes: 30,
      success_chance: 0.6,
      seed: 7,
      status: 'active',
      vehicles_json: '{"flatbed":1,"scrap_car":1}',
    },
    market_offers: {
      id: 'offer-seed',
      seller_base_id: 'b-seed',
      seller_name: 'Seed Crew',
      give_json: '{}',
      want_json: '{}',
      status: 'open',
      created_at: NOW,
    },
    market_supply_runs: { base_id: 'b-seed', day: '2026-08-16', updated_at: NOW },
    black_market_stash: { base_id: 'b-seed', good_id: 'stim_syringe', count: 1 },
    black_market_takings: {
      id: 'take-seed',
      base_id: 'b-seed',
      day: '2026-08-16',
      slot_index: 0,
      good_id: 'stim_syringe',
      infamy_spent: 10,
      taken_at: NOW,
    },
    black_market_slots: { day: '2026-08-16', slot_index: 0 },
    bar_slots: { day: '2026-08-16', slot: 0 },
    vendor_sales: { day: '2026-08-16', line_id: '2026-08-16-0-servo', updated_at: NOW },
    district_intel: { base_id: 'b-seed', district_id: 'ashen-terraces', scouted_at: NOW },
    admin_fog: { base_id: 'b-seed', district_id: 'ashen-terraces' },
    scouting_runs: {
      id: 'scout-seed',
      base_id: 'b-seed',
      district_id: 'kettle-row',
      officer_id: 'off-1',
      departed_at: NOW,
      returns_at: NOW,
    },
    captured_gates: { district_id: 'ashen-terraces' },
    district_gates: { district_id: 'ashen-terraces' },
    game_events: { id: 1, kind: 'seeded', at: NOW },
  };

  /** Every table the schema has at 0081, minus the runner's own bookkeeping. */
  function tablesOf(db: AppDatabase): string[] {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    )
      .map((row) => row.name)
      .filter((name) => name !== 'schema_migrations');
  }

  /**
   * A store with a row in every table, seeded through the live foreign keys.
   *
   * Order is found rather than declared: a table whose parent has not been written yet throws, so
   * it is deferred and tried again on the next pass. That is what lets `users` and `overseers`,
   * which point at each other, be seeded at all without a hand-kept order to maintain.
   */
  function seeded(): { db: AppDatabase; tables: string[] } {
    const db = openDatabase(':memory:');
    migrateUpTo(db, FIRST);
    const tables = tablesOf(db);

    let waiting = tables;
    while (waiting.length > 0) {
      const failed: string[] = [];
      for (const table of waiting) {
        try {
          insert(db, table, SEED[table] ?? {});
        } catch {
          failed.push(table);
        }
      }
      expect(failed.length, `nothing could be seeded into: ${failed.join(', ')}`).toBeLessThan(
        waiting.length,
      );
      waiting = failed;
    }

    for (const table of tables) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(n, `${table} was not seeded, so the chain is not measured against it`).toBe(1);
    }
    return { db, tables };
  }

  it('applies every file in order, once, and stops', () => {
    const { db } = seeded();
    expect(runMigrations(db)).toEqual(THROUGH);
    expect(runMigrations(db), 'a second run must apply nothing').toEqual([]);
  });

  it('leaves a row in every table that still exists afterwards', () => {
    const { db, tables } = seeded();
    runMigrations(db);

    const survivors = tables.filter((table) => !RETIRED.has(table));
    for (const table of survivors) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      // `battle_deployments` and `troop_movements` are the ones this is really about: 0087 drops
      // the table they point at, and an implicit DELETE would empty them without a word.
      expect(n, `${table} lost its row somewhere from 0081 on`).toBe(1);
    }
    // ...and the ones that go are gone, rather than sitting there empty.
    for (const table of RETIRED) {
      expect(tablesOf(db), `${table} outlived the mechanic under it`).not.toContain(table);
    }
  });

  it('reads back through the repositories a live request would use', () => {
    const { db } = seeded();
    runMigrations(db);

    // 0087: the roof fight is a raid on the district now, and the repo parses it.
    expect(createSiegeRepo(db).find('fight-seed')?.target).toEqual({
      kind: 'district',
      districtId: 'ashen-terraces',
    });
    expect(createSiegeRepo(db).deployments('fight-seed')).toHaveLength(1);

    // 0081: a run already on the road prices off its own row's clock, which is what 0 means.
    expect(createMissionsRepo(db).findById('run-seed')?.mission.pricedMinutes).toBe(0);
    /*
     * 0088: the same row, read through the three columns it never had.
     *
     * A run written before leaders existed was led by an officer or by nobody, it killed nobody,
     * and it was reported. The defaults have to say exactly that, or every historical row comes
     * back as an unled wipeout with no report.
     */
    const migrated = createMissionsRepo(db).findById('run-seed')?.mission;
    expect(migrated?.overseerLed).toBe(false);
    expect(migrated?.lost).toEqual({});
    expect(migrated?.reported).toBe(true);
    // ...and the district still opens, which is the thing every one of these can take away.
    expect(createBasesRepo(db).findById('b-seed')?.id).toBe('b-seed');
  });

  /**
   * 0085, read off the columns rather than through a repository.
   *
   * `rowToBase`, `rowToDeployment` and `rowToStored` all drop an id the catalogue no longer has on
   * the way out, so a repository read is green whether or not the migration ran: the reader's
   * salvage is the floor under this migration, not a test of it. What 0085 is for is leaving the
   * *stored* rows clean, so that is what is asserted.
   */
  it('takes the retired machines out of all three stored fleets', () => {
    const { db } = seeded();
    runMigrations(db);

    const json = (sql: string, id: string): unknown =>
      JSON.parse((db.prepare(sql).get(id) as { j: string }).j);
    expect(json('SELECT fleet_json AS j FROM bases WHERE id = ?', 'b-seed')).toEqual({
      scrap_car: 1,
    });
    expect(
      json('SELECT vehicles_json AS j FROM battle_deployments WHERE battle_id = ?', 'fight-seed'),
    ).toEqual({ scrap_car: 2 });
    expect(json('SELECT vehicles_json AS j FROM missions WHERE id = ?', 'run-seed')).toEqual({
      scrap_car: 1,
    });
  });

  it('gives the two new columns their defaults on rows that predate them', () => {
    const { db } = seeded();
    runMigrations(db);

    // 0083: a district nothing has announced a level for.
    expect(createBasesRepo(db).pendingLevelUp('b-seed')).toBeUndefined();
    // 0084: sixty, which is what a new account gets.
    expect(db.prepare('SELECT sound_volume AS v FROM users WHERE id = ?').get('u-seed')).toEqual({
      v: 60,
    });
  });
});

/**
 * 0049: the tag becomes a badge, and an officer becomes a chief.
 *
 * The migration this is really guarding is the one it does **not** do. `factions` is the parent of
 * `faction_members` and `faction_invites`, both ON DELETE CASCADE, so rebuilding it the usual way
 * (create new, copy, DROP TABLE old, rename) empties both children on the DROP: every membership
 * and every open invitation in the game, silently, from a migration that reads like a rename. The
 * assertions below are what a rebuild would fail.
 */
describe('0049: faction badges and ranks', () => {
  const BADGES = '0049_faction_badges_and_ranks.sql';
  const NOW = '2026-08-01T00:00:00.000Z';

  const legacyFaction = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, BADGES);
    const user = db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    );
    user.run('u1', 'leader', 'x', NOW);
    user.run('u2', 'officer', 'x', NOW);
    user.run('u3', 'outsider', 'x', NOW);

    db.prepare(
      'INSERT INTO factions (id, name, tag, blurb, founded_at) VALUES (?, ?, ?, ?, ?)',
    ).run('f1', 'The Ninth Circle', 'NINTH', 'Five streets.', NOW);
    const member = db.prepare(
      'INSERT INTO faction_members (user_id, faction_id, rank, joined_at) VALUES (?, ?, ?, ?)',
    );
    member.run('u1', 'f1', 'leader', NOW);
    member.run('u2', 'f1', 'officer', NOW);
    db.prepare(
      `INSERT INTO faction_invites (id, faction_id, invited_user_id, invited_by_user_id, sent_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('i1', 'f1', 'u3', 'u1', NOW);
    db.prepare(
      `INSERT INTO messages
         (id, thread_id, sender_user_id, sender_name, sender_tag, recipient_user_id,
          audience, addressed_to, subject, body, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('m1', 't1', 'u1', 'leader', 'NINTH', 'u2', 'player', 'officer', 'Docks', 'Tonight', NOW);
    return db;
  };

  it('keeps every membership and every open invitation', () => {
    const db = legacyFaction();
    runMigrations(db, MIGRATIONS_DIR);

    const members = db
      .prepare('SELECT user_id, rank FROM faction_members ORDER BY user_id')
      .all() as { user_id: string; rank: string }[];
    expect(members).toHaveLength(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM faction_invites').get()).toEqual({ n: 1 });
  });

  it('turns an officer into a chief and leaves a leader alone', () => {
    const db = legacyFaction();
    runMigrations(db, MIGRATIONS_DIR);

    const ranks = Object.fromEntries(
      (
        db.prepare('SELECT user_id, rank FROM faction_members').all() as {
          user_id: string;
          rank: string;
        }[]
      ).map((row) => [row.user_id, row.rank]),
    );
    expect(ranks).toEqual({ u1: 'leader', u2: 'chief' });
  });

  it('gives the faction a badge the game can draw, and drops the tag', () => {
    const db = legacyFaction();
    runMigrations(db, MIGRATIONS_DIR);

    const row = db.prepare('SELECT * FROM factions WHERE id = ?').get('f1') as {
      badge: string;
      tag?: string;
    };
    expect(row.tag).toBeUndefined();
    expect(BadgeSchema.parse(JSON.parse(row.badge))).toEqual(DEFAULT_BADGE);
  });

  /** A five-letter abbreviation is not a faction name, so it is joined back to one. */
  it('rewrites a message’s sender tag as the faction’s name', () => {
    const db = legacyFaction();
    runMigrations(db, MIGRATIONS_DIR);

    const row = db.prepare('SELECT sender_faction, invite_id FROM messages WHERE id = ?').get('m1');
    expect(row).toEqual({ sender_faction: 'The Ninth Circle', invite_id: null });
  });
});

/**
 * 0054: a report written before `regular` became `heavy`.
 *
 * The bug this closes was out of all proportion to its cause. One stored analysis from an old fight
 * carried a tier name the enum no longer has, `BattleAnalysisSchema.parse` rejected it,
 * `resolvedFor` threw, and `GET /battles` answered 500, so the battles screen was unreachable for
 * that account for good, showing "Reading the board..." because the page drew an error the same way
 * it drew a load.
 */
describe('0054: battle reports written under the old tier names', () => {
  const TIERS = '0054_battle_report_tiers.sql';
  const NOW = '2026-08-01T00:00:00.000Z';

  const analysis = (tier: string) =>
    JSON.stringify({
      outcome: 'attacker',
      rounds: 1,
      attacker: { units: [{ unitId: 'anodics', name: 'Anodics', tier: 'rabble' }] },
      defender: { units: [{ unitId: 'wardens', name: 'Wardens', tier }] },
    });

  const legacyBattle = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, TIERS);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'veteran', 'x', NOW);
    const columns = (db.prepare('SELECT * FROM bases LIMIT 0').columns() as { name: string }[]).map(
      (column) => column.name,
    );
    const base: Record<string, string | number> = {};
    for (const name of columns) {
      base[name] = name.endsWith('_json') ? '{}' : name.endsWith('_at') ? NOW : 0;
    }
    Object.assign(base, {
      id: 'base-1',
      owner_id: 'u1',
      name: 'Nowhere',
      district_id: 'steelbelt',
    });
    db.prepare(
      `INSERT INTO bases (${columns.join(', ')})
       VALUES (${columns.map((name) => `@${name}`).join(', ')})`,
    ).run(base);

    // A resolved fight over a location, which is the only shape the table's CHECKs accept with a
    // `location_id` set. Everything but `analysis_json` is scaffolding.
    db.prepare(
      `INSERT INTO scheduled_battles
         (id, attacker_base_id, target_kind, district_id, location_id, defender_json,
          scheduled_for, declared_at, resolved_at, seed, analysis_json)
       VALUES (?, ?, 'location', ?, ?, '{}', ?, ?, ?, 'seed', ?)`,
    ).run('b1', 'base-1', 'steelbelt', 'steelbelt-ramp', NOW, NOW, NOW, analysis('regular'));
    return db;
  };

  it('rewrites the retired tier so the report parses again', () => {
    const db = legacyBattle();
    runMigrations(db, MIGRATIONS_DIR);

    const row = db
      .prepare('SELECT analysis_json FROM scheduled_battles WHERE id = ?')
      .get('b1') as {
      analysis_json: string;
    };
    expect(row.analysis_json).not.toContain('"tier":"regular"');
    expect(row.analysis_json).toContain('"tier":"heavy"');
    // The other side's tier is untouched: this is a rename, not a rewrite of every report.
    expect(row.analysis_json).toContain('"tier":"rabble"');
  });
});

/**
 * 0075: Signals, Craft and Encyclopedia.
 *
 * Two renames and one replacement, and the difference between those two things is the whole test.
 * A rename carries its rating: somebody rated 51 at Hacking is rated 51 at Signals, because it is
 * the same trade under a wider name. A replacement does not: Demolition is retired outright and
 * Encyclopedia takes the slot, so carrying the number across would hand every demolitions expert in
 * the game a scholar's sheet.
 *
 * Written against a sheet as it sat the day before this migration, by hand, exactly as it is in
 * anybody's database right now. The officer half matters as much as the overseer half and is easy
 * to forget: a crew's officers carry the same sheet nested inside an array, and `json_remove`
 * cannot reach into one without knowing its index.
 */
/**
 * Inserts a row naming only the columns the table has at this point in the migration history.
 *
 * The schema a legacy save was written by is not the schema today: `overseers` carried
 * `traits_json` when 0015 was written and does not now, so a hand-written column list in a test
 * pinned to one migration goes stale the first time a later one drops a column. Everything not
 * named here takes its own default.
 */
function insert(db: AppDatabase, table: string, values: Record<string, unknown>): void {
  interface ColumnInfo {
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
  }
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  const row: Record<string, unknown> = { ...values };
  for (const column of info) {
    if (column.name in row) continue;
    // A column this test says nothing about still has to satisfy the schema. Anything nullable or
    // defaulted is left alone; the rest get an empty value of the right shape, so the fixture does
    // not have to track every column a later migration adds to a table it only cares about one of.
    if (column.notnull === 0 || column.dflt_value !== null) continue;
    row[column.name] = column.type.toUpperCase().includes('INT')
      ? 0
      : column.name.endsWith('_json')
        ? '{}'
        : '';
  }
  const named = info.map((column) => column.name).filter((column) => column in row);
  db.prepare(
    `INSERT INTO ${table} (${named.join(', ')}) VALUES (${named.map(() => '?').join(', ')})`,
  ).run(...named.map((column) => row[column]));
}

describe('0075: signals, craft and encyclopedia', () => {
  const THEN = '0075_attribute_signals_craft_encyclopedia.sql';

  /** The current sheet with the three old technical names back in place of the new ones. */
  const oldSheet = (): Record<string, number> => {
    const sheet: Record<string, number> = {};
    let next = 20;
    for (const name of ATTRIBUTE_NAMES) {
      const legacy =
        name === 'signals'
          ? 'hacking'
          : name === 'craft'
            ? 'fabrication'
            : name === 'encyclopedia'
              ? 'demolition'
              : name;
      sheet[legacy] = next;
      next += 1;
    }
    return sheet;
  };

  const legacy = (): { db: AppDatabase; before: Record<string, number> } => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    const before = oldSheet();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u75', 'legacy75', 'x', NOW);
    insert(db, 'overseers', {
      id: 'o75',
      user_id: 'u75',
      preset_id: 'enforcer',
      name: 'Legacy',
      archetype: 'enforcer',
      portrait_id: 'overseer-1',
      bio: 'bio',
      attributes_json: JSON.stringify(before),
      traits_json: '[]',
      created_at: NOW,
    });
    return { db, before };
  };

  const overseerSheet = (db: AppDatabase): Record<string, number> => {
    const row = db.prepare('SELECT attributes_json FROM overseers').get() as {
      attributes_json: string;
    };
    return JSON.parse(row.attributes_json) as Record<string, number>;
  };

  it('carries a renamed rating across without changing it', () => {
    const { db, before } = legacy();
    runMigrations(db);
    const sheet = overseerSheet(db);
    expect(sheet.signals).toBe(before.hacking);
    expect(sheet.craft).toBe(before.fabrication);
  });

  it('does not carry a retired rating into the attribute that replaced it', () => {
    const { db, before } = legacy();
    runMigrations(db);
    const sheet = overseerSheet(db);
    // The whole point of the distinction: this is a different skill, not the same one renamed.
    expect(sheet.encyclopedia).not.toBe(before.demolition);
    expect(sheet.encyclopedia).toBe(12);
  });

  it('leaves none of the three old names behind', () => {
    const { db } = legacy();
    runMigrations(db);
    const sheet = overseerSheet(db);
    for (const gone of ['hacking', 'fabrication', 'demolition']) {
      expect(sheet, gone).not.toHaveProperty(gone);
    }
  });

  it('produces a sheet the current schema accepts', () => {
    const { db } = legacy();
    runMigrations(db);
    expect(() => AttributesSchema.parse(overseerSheet(db))).not.toThrow();
  });

  it('does the same to an officer, whose sheet is nested inside an array', () => {
    const { db, before } = legacy();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u76', 'crew75', 'x', NOW);
    insert(db, 'bases', {
      id: 'b75',
      owner_id: 'u76',
      name: 'Legacy Crew',
      district_id: 'steelbelt',
      created_at: NOW,
      commanders_json: JSON.stringify([
        { id: 'c1', role: 'master_of_whispers', attributes: before },
      ]),
    });

    runMigrations(db);
    const row = db.prepare('SELECT commanders_json FROM bases WHERE id = ?').get('b75') as {
      commanders_json: string;
    };
    const officer = (
      JSON.parse(row.commanders_json) as { attributes: Record<string, number> }[]
    )[0];
    expect(officer, 'the officer was dropped by the rebuild').toBeDefined();
    expect(officer!.attributes.signals).toBe(before.hacking);
    expect(officer!.attributes.craft).toBe(before.fabrication);
    expect(officer!.attributes.encyclopedia).toBe(12);
    expect(officer!.attributes).not.toHaveProperty('demolition');
    expect(() => AttributesSchema.parse(officer!.attributes)).not.toThrow();
  });
});

/**
 * 0077, checked against rows nothing else in the suite can produce.
 *
 * `ResearchProjectSchema` is the technology rung and nothing else, so a stored `active` of one of
 * the three retired kinds cannot be built from any current type: the only way to reach the state is
 * to write the JSON a pre-removal district had, which is exactly what is in anyone's database. And
 * `BaseSchema.parse` runs on every read (`repos/bases.ts` `rowToBase`), so getting this wrong is
 * not a lost project, it is a district that never opens again.
 */
describe('0077: the retired desk projects', () => {
  const THEN = '0077_research_desk_retired.sql';

  const deskProject = (kind: string) => ({
    id: `r-${kind}`,
    project:
      kind === 'investigation'
        ? { kind, role: 'master_of_whispers', leadOfficerId: 'off-1', crossReference: true }
        : kind === 'training'
          ? { kind, attribute: 'logic' }
          : { kind, modificationId: 'lab_quantum_modeling' },
    startedAt: NOW,
    durationMinutes: 45,
  });

  const rung = {
    id: 'r-tech',
    project: { kind: 'technology', techId: 'tech_drill_yard' },
    startedAt: NOW,
    durationMinutes: 120,
  };

  /** One district per row of research JSON, all written by the schema that predates 0077. */
  const legacy = (rows: Record<string, unknown>[]): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    rows.forEach((research, index) => {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(`u77-${index}`, `legacy77-${index}`, 'x', NOW);
      insert(db, 'bases', {
        id: `b77-${index}`,
        owner_id: `u77-${index}`,
        name: `Legacy ${index}`,
        district_id: 'steelbelt',
        created_at: NOW,
        research_json: JSON.stringify(research),
      });
    });
    return db;
  };

  const researchOf = (db: AppDatabase, index: number): Record<string, unknown> => {
    const row = db.prepare('SELECT research_json FROM bases WHERE id = ?').get(`b77-${index}`) as {
      research_json: string;
    };
    return JSON.parse(row.research_json) as Record<string, unknown>;
  };

  const ROWS = [
    { active: deskProject('investigation'), facts: [{ kind: 'pairing', attributes: ['speed'] }] },
    { active: deskProject('training'), facts: [], technologies: ['tech_drill_yard'] },
    { active: deskProject('modification'), facts: [] },
    { active: rung, facts: [], technologies: ['tech_field_dressing'] },
    { active: null, facts: [] },
    // Already migrated: no `facts` key, nothing on the bench.
    { active: null, technologies: ['tech_sorted_salvage'] },
  ];

  it('clears a desk project off the bench and leaves a rung alone', () => {
    const db = legacy(ROWS);
    runMigrations(db);

    for (const index of [0, 1, 2]) {
      expect(researchOf(db, index).active, `row ${index}`).toBeNull();
    }
    expect(researchOf(db, 3).active).toEqual(rung);
    expect(researchOf(db, 4).active).toBeNull();
    expect(researchOf(db, 5).active).toBeNull();
  });

  it('keeps everything the row was not about', () => {
    const db = legacy(ROWS);
    runMigrations(db);
    expect(researchOf(db, 1).technologies).toEqual(['tech_drill_yard']);
    expect(researchOf(db, 3).technologies).toEqual(['tech_field_dressing']);
    expect(researchOf(db, 5).technologies).toEqual(['tech_sorted_salvage']);
  });

  it('strips the retired facts key from every row that still has one', () => {
    const db = legacy(ROWS);
    runMigrations(db);
    for (let index = 0; index < ROWS.length; index += 1) {
      expect(researchOf(db, index), `row ${index}`).not.toHaveProperty('facts');
    }
  });

  it('produces research every current district can be parsed with', () => {
    const db = legacy(ROWS);
    runMigrations(db);
    for (let index = 0; index < ROWS.length; index += 1) {
      expect(() => ResearchStateSchema.parse(researchOf(db, index)), `row ${index}`).not.toThrow();
    }
  });

  /** Migrations already applied are never re-run, so idempotence is about a second application. */
  it('is byte-identical when applied twice', () => {
    const db = legacy(ROWS);
    runMigrations(db);
    const once = db.prepare('SELECT id, research_json FROM bases ORDER BY id').all();

    db.exec(readFileSync(path.join(MIGRATIONS_DIR, THEN), 'utf8'));
    expect(db.prepare('SELECT id, research_json FROM bases ORDER BY id').all()).toEqual(once);
  });
});

/**
 * 0087: one raid on a district, where thirteen fights on thirteen roofs used to be.
 *
 * Two things have to survive the rewrite and neither is obvious from reading the SQL.
 *
 *   * **The row has to come back as a `district` target.** `scheduled_battles` is rebuilt (sqlite
 *     cannot alter a CHECK), so the test is written against a row inserted under the *old* schema
 *     and read back through the repo, which is the only thing that proves the two halves agree.
 *   * **The rebuild has to be legal with children attached.** `troop_movements` and
 *     `battle_deployments` reference this table, and with `foreign_keys = ON` a DROP does an
 *     implicit DELETE that trips them. `PRAGMA foreign_keys = OFF` inside a migration does nothing
 *     (it is a no-op inside a transaction, which is what `runMigrations` wraps each file in), which
 *     is why the migration uses `defer_foreign_keys` instead. So both child tables are given a row
 *     here: without one the migration passes whether or not it got that right.
 */
describe('0087: a building target becomes a district raid', () => {
  const RAID = '0087_district_raid_target.sql';
  const DISTRICT = 'ashen-terraces';

  const legacyRaid = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, RAID);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'legacy', 'x', NOW);
    const columns = (db.prepare('SELECT * FROM bases LIMIT 0').columns() as { name: string }[]).map(
      (c) => c.name,
    );
    const values: Record<string, string | number> = {};
    for (const name of columns) {
      values[name] = name.endsWith('_json')
        ? '[]'
        : name === 'level' || name.startsWith('is_')
          ? 0
          : name === 'owner_id'
            ? 'u1'
            : 'b1';
    }
    values.id = 'b1';
    db.prepare(
      `INSERT INTO bases (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    ).run(...columns.map((name) => values[name]));

    // Two calls the old build could write: a fight on one roof, and a fight at the gate beside it.
    db.prepare(
      `INSERT INTO scheduled_battles
         (id, attacker_base_id, target_kind, district_id, location_id, building_id,
          defender_json, scheduled_for, declared_at, resolved_at, seed, hold_after_capture)
       VALUES (?, ?, 'building', ?, NULL, ?, ?, ?, ?, NULL, ?, 0)`,
    ).run(
      'fight-1',
      'b1',
      DISTRICT,
      'their-scrapyard',
      '{"kind":"unoccupied"}',
      NOW,
      NOW,
      'seed-1',
    );
    db.prepare(
      `INSERT INTO scheduled_battles
         (id, attacker_base_id, target_kind, district_id, location_id, building_id,
          defender_json, scheduled_for, declared_at, resolved_at, seed, hold_after_capture)
       VALUES (?, ?, 'gate', ?, NULL, NULL, ?, ?, ?, NULL, ?, 0)`,
    ).run('fight-2', 'b1', DISTRICT, '{"kind":"unoccupied"}', NOW, NOW, 'seed-2');

    // The two tables that point at it, each with a row, so the rebuild is actually under load.
    db.prepare(
      `INSERT INTO battle_deployments (battle_id, base_id, side, army_json, perimeter_json,
         updated_at, vehicles_json) VALUES (?, ?, 'attacker', '{}', '{}', ?, '{}')`,
    ).run('fight-1', 'b1', NOW);
    db.prepare(
      `INSERT INTO troop_movements (id, base_id, battle_id, side, from_district_id,
         to_district_id, army_json, perimeter_json, departed_at, arrives_at)
       VALUES (?, ?, ?, 'attacker', ?, ?, '{}', '{}', ?, ?)`,
    ).run('m1', 'b1', 'fight-1', 'kettle-row', DISTRICT, NOW, NOW);
    return db;
  };

  it('rewrites the roof fight into a raid on the same district, and leaves the gate alone', () => {
    const db = legacyRaid();
    runMigrations(db);

    const repo = createSiegeRepo(db);
    expect(repo.find('fight-1')?.target).toEqual({ kind: 'district', districtId: DISTRICT });
    expect(repo.find('fight-2')?.target).toEqual({ kind: 'gate', districtId: DISTRICT });
  });

  it('keeps the rows that point at the rebuilt table', () => {
    const db = legacyRaid();
    runMigrations(db);

    const repo = createSiegeRepo(db);
    expect(repo.deployments('fight-1')).toHaveLength(1);
    const movements = db.prepare('SELECT battle_id FROM troop_movements').all() as {
      battle_id: string;
    }[];
    expect(movements.map((row) => row.battle_id)).toEqual(['fight-1']);
    // And the deferred check really did run at the commit rather than being switched off for good:
    // a movement pointing at no battle must still be refused.
    expect(() =>
      db
        .prepare(
          `INSERT INTO troop_movements (id, base_id, battle_id, side, from_district_id,
             to_district_id, army_json, perimeter_json, departed_at, arrives_at)
           VALUES ('m2', 'b1', 'nothing', 'attacker', 'kettle-row', ?, '{}', '{}', ?, ?)`,
        )
        .run(DISTRICT, NOW, NOW),
    ).toThrow();
  });

  /** A resolved fight is history and still has to parse: `resolvedFor` reads it back. */
  it('rewrites finished fights too, so the battle board still reads them', () => {
    const db = legacyRaid();
    db.prepare('UPDATE scheduled_battles SET resolved_at = ? WHERE id = ?').run(NOW, 'fight-1');
    runMigrations(db);

    const row = db
      .prepare('SELECT target_kind FROM scheduled_battles WHERE id = ?')
      .get('fight-1') as { target_kind: string };
    expect(row.target_kind).toBe('district');
    expect(createSiegeRepo(db).find('fight-1')?.resolvedAt).toBe(NOW);
  });
});

/**
 * 0104: Directive Zero became Directive Xero, and the unit id went with the name.
 *
 * The id is not cosmetic in a save. `ArmySchema` is `z.record(UnitIdSchema, ...)` over the *live*
 * catalogue, so a garrison still holding `directive_zero` does not read back with a bad field, it
 * refuses to parse: the control row will not load at all. That is the fault line
 * `0038_retired_units.sql` was written for, and this is the same fault line with a rename on it
 * rather than a removal.
 *
 * Two more places name him and each fails differently. A scoped tally is stored under
 * `<measure>:<scope>`, so a crew that had already fought him keeps its counter under a key no feat
 * reads any more. And `crew_feats` is a claim, written once and never updated, so a claim left
 * under the old id lets the renamed feat be collected a second time.
 */
describe('0104: Directive Xero', () => {
  const THEN = '0104_directive_xero.sql';

  const legacy = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u104', 'legacy104', 'x', NOW);
    insert(db, 'bases', { id: 'b104', owner_id: 'u104', name: 'Legacy', created_at: NOW });
    insert(db, 'location_control', {
      location_id: 'ccs-chapel',
      holder_kind: 'government',
      base_id: null,
      // The Chapel as a live save has it: him, and the rank and file he stands with.
      garrison_json: JSON.stringify({ directive_zero: 1, greycoat: 12 }),
      level: 1,
    });
    insert(db, 'crew_tallies', {
      base_id: 'b104',
      tally: 'combine_leaders_slain:directive_zero',
      value: 1,
    });
    insert(db, 'crew_feats', {
      base_id: 'b104',
      feat_id: 'directive_zero_slain',
      claimed_at: NOW,
    });
    // A cell planted on some ground, holding him. Unreachable in the shipped game, and that is the
    // point: it is the one army column whose reader has no salvage pass, so it is the one that
    // still throws rather than quietly losing a stack. See `sleeperArmy` below.
    insert(db, 'sleeper_cells', {
      id: 'cell-104',
      base_id: 'b104',
      location_id: 'steelbelt-ramp',
      army_json: JSON.stringify({ directive_zero: 3 }),
      phase: 'waiting',
      departed_at: NOW,
      arrives_at: NOW,
      travel_ms: 0,
    });
    return db;
  };

  const garrison = (db: AppDatabase): Record<string, number> =>
    JSON.parse(
      (
        db
          .prepare('SELECT garrison_json FROM location_control WHERE location_id = ?')
          .get('ccs-chapel') as { garrison_json: string }
      ).garrison_json,
    ) as Record<string, number>;

  const sleeperArmy = (db: AppDatabase): Record<string, number> =>
    createSleeperRepo(db).forBase('b104')[0]!.army;

  it('is a precondition that the old id is genuinely unreadable now', () => {
    // Without this the cases below could all be passing on a schema that never cared.
    expect(() => ArmySchema.parse({ directive_zero: 1 })).toThrow();
    expect(ArmySchema.parse({ directive_xero: 1 })).toEqual({ directive_xero: 1 });
  });

  /**
   * What the garrison column actually does when it is left alone, which is not what it looks like.
   *
   * `ArmySchema` refuses the key, but `db/repos/city.ts` runs `withoutRetiredUnits` over the
   * garrison before the schema sees it, so nothing throws and nothing is logged: the Chapel simply
   * reads back without him. `combineLeaderAlive` looks for his id in the garrison of his own plot,
   * so the ground at the top of the city goes from the wall the whole map climbs towards to rank
   * and file, on a save that reports no error anywhere. Pinned because a silent loss is the one
   * that survives a test suite.
   */
  it('is a precondition that leaving the garrison alone loses him without a sound', () => {
    const db = legacy();
    expect(createCityRepo(db).control('ccs-chapel')?.garrison).toEqual({ greycoat: 12 });
    db.close();
  });

  it('renames him in a garrison and leaves everybody standing with him alone', () => {
    const db = legacy();
    runMigrations(db);
    expect(garrison(db)).toEqual({ directive_xero: 1, greycoat: 12 });
    // ...and the row reads back through the schema that refused the old key, with him in it.
    expect(() => ArmySchema.parse(garrison(db))).not.toThrow();
    expect(createCityRepo(db).control('ccs-chapel')?.garrison).toEqual({
      directive_xero: 1,
      greycoat: 12,
    });
    db.close();
  });

  /**
   * The army column that had no floor under it when this was written.
   *
   * `db/repos/sleepers.ts` handed the column straight to `SleeperCellSchema`, so a stale id there
   * was a throw on every read of that crew's cells, and `due` stopped every crew's cells with it.
   * It drops a retired id now, like every other stored army (bug pass, 2026-09-29), which makes an
   * unswept cell the garrison's case above: he is lost without a sound. He cannot be in one today,
   * because a Combine sheet is met and never held; this is swept for the same reason the other
   * five are.
   */
  it('renames him in a sleeper cell, where leaving him would lose him without a sound', () => {
    const db = legacy();
    expect(sleeperArmy(db), 'the precondition: unswept, this read drops him').toEqual({});
    runMigrations(db);
    expect(sleeperArmy(db)).toEqual({ directive_xero: 3 });
    db.close();
  });

  it('carries the counter and the claim across, so neither is paid twice nor lost', () => {
    const db = legacy();
    runMigrations(db);
    const tallies = db.prepare('SELECT tally, value FROM crew_tallies').all() as {
      tally: string;
      value: number;
    }[];
    expect(tallies).toEqual([{ tally: 'combine_leaders_slain:directive_xero', value: 1 }]);
    const claims = db.prepare('SELECT feat_id FROM crew_feats').all() as { feat_id: string }[];
    expect(claims).toEqual([{ feat_id: 'directive_xero_slain' }]);
    db.close();
  });

  it('is a no-op on a save that never met him, and on one already carried across', () => {
    const fresh = openDatabase(':memory:');
    runMigrations(fresh);
    expect(() => runMigrations(fresh)).not.toThrow();
    fresh.close();

    const db = legacy();
    runMigrations(db);
    const once = garrison(db);
    const onceAsleep = sleeperArmy(db);
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, THEN), 'utf8'));
    expect(garrison(db), 'running it twice moved something').toEqual(once);
    expect(sleeperArmy(db), 'running it twice moved something').toEqual(onceAsleep);
    db.close();
  });
});

/**
 * 0105: "cowed" became "intimidated" on a stored battle report.
 *
 * §D3's figure is a field on each side of the analysis, and the analysis is written once at the
 * settle and read back for ever after: a report is a record of a fight that already happened, so
 * nothing recomputes it. `SideAnalysisSchema.intimidated` carries `.default(0)`, so a report left
 * under the old key does not fail to parse. It reads back as **zero units intimidated**, silently,
 * on the one screen whose job is to explain a fight that looked broken.
 *
 * Measured through the repository rather than off the column, because the column is not the
 * question: what a player sees is what `SiegeRepo.resolvedFor` hands the route after
 * `BattleAnalysisSchema` has judged it, and the whole failure mode here is a parse that succeeds
 * with the wrong number in it.
 */
/*
 * Shared by the 0105 and 0106 blocks below: they are the same sweep, and 0106 exists only
 * because 0105 shipped against the wrong column and is already recorded as applied on any
 * database that ran it. One fixture, so the two cannot drift into testing different reports.
 */
/** A report as the settler wrote it the day before the rename, with §D3 on both sides. */
const legacyAnalysis = (attackerCowed: number, defenderCowed: number) => ({
  battleId: 'fight-105',
  locationName: 'The Chosen Chapel',
  winner: 'defender',
  rounds: 6,
  decidedOnPower: false,
  settledBy: 'standing',
  attacker: {
    name: 'The Ninth Circle',
    committed: 20,
    lost: 14,
    survived: 6,
    fled: 6,
    perimeter: 0,
    perimeterCaught: 0,
    perimeterLost: 0,
    cowed: attackerCowed,
    infamy: 120,
    units: [
      {
        unitId: 'razors',
        name: 'Razors',
        tier: 'rabble',
        unique: false,
        started: 20,
        lost: 14,
        fled: 6,
        caught: 0,
        survived: 6,
        damage: 900,
        damageShare: 1,
        brokeAtRound: 5,
        state: 'Routed',
      },
    ],
  },
  defender: {
    name: 'The Combine',
    committed: 12,
    lost: 3,
    survived: 9,
    fled: 0,
    perimeter: 0,
    perimeterCaught: 0,
    perimeterLost: 0,
    cowed: defenderCowed,
    infamy: 40,
    units: [
      {
        unitId: 'greycoat',
        name: 'Greycoats',
        tier: 'heavy',
        unique: false,
        started: 12,
        lost: 3,
        fled: 0,
        caught: 0,
        survived: 9,
        damage: 1400,
        damageShare: 1,
        brokeAtRound: null,
        state: 'Steady',
      },
    ],
  },
  log: ['The line held.'],
  findings: [],
  trap: null,
  legends: [],
  headline: 'The Combine held the Chosen Chapel.',
  spoils: {},
  target: 'location',
  weather: 'normal',
  ground: [],
});

describe('0105: a report written when the figure was called cowed', () => {
  const THEN = '0105_intimidated.sql';
  const SETTLED = '2026-09-19T09:00:00.000Z';

  const legacy = (attackerCowed = 7, defenderCowed = 2): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u105', 'legacy105', 'x', SETTLED);
    insert(db, 'bases', { id: 'b105', owner_id: 'u105', name: 'Legacy', created_at: SETTLED });
    db.prepare(
      `INSERT INTO scheduled_battles
         (id, attacker_base_id, target_kind, district_id, location_id, defender_json,
          scheduled_for, declared_at, resolved_at, seed, analysis_json)
       VALUES (?, ?, 'location', ?, ?, '{"kind":"government"}', ?, ?, ?, 'seed', ?)`,
    ).run(
      'fight-105',
      'b105',
      'steelbelt',
      'steelbelt-ramp',
      SETTLED,
      SETTLED,
      SETTLED,
      JSON.stringify(legacyAnalysis(attackerCowed, defenderCowed)),
    );
    return db;
  };

  const readBack = (db: AppDatabase) => {
    const rows = createSiegeRepo(db).resolvedFor('b105', 10);
    expect(rows, 'the report did not survive the read at all').toHaveLength(1);
    return rows[0]!.analysis;
  };

  it('is a precondition that the old key reads back as nobody intimidated', () => {
    // Without this the test below could be passing on a schema that never defaulted the field,
    // which would have made this a loud failure rather than a silent zero.
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    db.close();
    expect(SideAnalysisSchema.parse({ ...legacyAnalysis(7, 2).attacker }).intimidated).toBe(0);
  });

  it('carries both sides’ figure across, read back through the repository', () => {
    const db = legacy(7, 2);
    runMigrations(db);
    const analysis = readBack(db);
    expect(analysis.attacker.intimidated).toBe(7);
    expect(analysis.defender.intimidated).toBe(2);
    db.close();
  });

  it('leaves the old key behind rather than storing both', () => {
    const db = legacy();
    runMigrations(db);
    const row = db
      .prepare('SELECT analysis_json FROM scheduled_battles WHERE id = ?')
      .get('fight-105') as { analysis_json: string };
    expect(row.analysis_json).not.toContain('"cowed"');
    db.close();
  });

  /** A zero is a figure too: a fight where nobody flinched must not read back as unmigrated. */
  it('carries a zero across as well as a number', () => {
    const db = legacy(0, 0);
    runMigrations(db);
    const row = db
      .prepare('SELECT analysis_json FROM scheduled_battles WHERE id = ?')
      .get('fight-105') as { analysis_json: string };
    expect(row.analysis_json).not.toContain('"cowed"');
    expect(readBack(db).attacker.intimidated).toBe(0);
    db.close();
  });

  it('is a no-op on a save with no fights, and on one already carried across', () => {
    const fresh = openDatabase(':memory:');
    runMigrations(fresh);
    expect(() => runMigrations(fresh)).not.toThrow();
    fresh.close();

    const db = legacy(7, 2);
    runMigrations(db);
    const once = readBack(db);
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, THEN), 'utf8'));
    expect(readBack(db), 'running it twice moved something').toEqual(once);
    db.close();
  });
});

/**
 * 0106: the same sweep again, because 0105 shipped wrong and is already recorded as applied.
 *
 * Correcting a migration in place does nothing to a database that already ran the broken one: the
 * runner keys on the file name, so the name is in `schema_migrations` and the corrected body is
 * never executed. Measured on the working save on 2026-09-20: seven resolved reports, five still
 * carrying `cowed`, none carrying `intimidated`, with `0105_intimidated.sql` recorded as applied.
 *
 * So this is the case the corrected 0105 cannot reach, and the only one that matters in practice.
 */
describe('0106: the save that already ran the broken sweep', () => {
  const SETTLED = '2026-09-19T09:00:00.000Z';

  /**
   * A database in the exact state the bug left one in: the report still says `cowed`, and 0105 is
   * already ticked off, so nothing but a new file will ever touch it.
   */
  const alreadyTicked = (): AppDatabase => {
    const db = openDatabase(':memory:');
    // Stop *before* 0105, then tick it off by hand without running it. That is exactly what the
    // broken version left behind: the name recorded, the rows untouched.
    migrateUpTo(db, '0105_intimidated.sql');
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run('0105_intimidated.sql');
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u106', 'legacy106', 'x', NOW);
    insert(db, 'bases', { id: 'b106', owner_id: 'u106', name: 'Legacy', created_at: NOW });
    insert(db, 'scheduled_battles', {
      id: 'sb106',
      attacker_base_id: 'b106',
      district_id: 'ccs',
      target_kind: 'gate',
      scheduled_for: SETTLED,
      resolved_at: SETTLED,
      analysis_json: JSON.stringify(legacyAnalysis(7, 2)),
    });
    return db;
  };

  const stored = (db: AppDatabase): string =>
    (
      db.prepare('SELECT analysis_json FROM scheduled_battles WHERE id = ?').get('sb106') as {
        analysis_json: string;
      }
    ).analysis_json;

  it('is a precondition that 0105 is ticked off and the report still says cowed', () => {
    const db = alreadyTicked();
    const ticked = db
      .prepare('SELECT name FROM schema_migrations WHERE name = ?')
      .get('0105_intimidated.sql');
    expect(ticked, 'the fixture does not reproduce the bug it is about').toBeDefined();
    expect(stored(db)).toContain('"cowed"');
    db.close();
  });

  it('runs anyway and carries both sides across', () => {
    const db = alreadyTicked();
    runMigrations(db);
    const json = stored(db);
    expect(json, 'the old key survived').not.toContain('"cowed"');
    const analysis = JSON.parse(json) as {
      attacker: { intimidated: number };
      defender: { intimidated: number };
    };
    expect(analysis.attacker.intimidated).toBe(7);
    expect(analysis.defender.intimidated).toBe(2);
    db.close();
  });
});

/**
 * 0107: the Professor's retired fourth rung leaves no ghost in a save.
 *
 * "Working Papers" became "Second Chair" (maintainer, 2026-09-21) and a rung's id comes off its
 * name, so `working_papers` is an id the catalogue no longer has. Nothing throws over it: the
 * research column is an array of bare strings and `researchEffects` skips what it cannot find.
 * What goes wrong is a number. `feats/snapshot.ts` reads `research_done` as the raw array length,
 * so a crew that finished the old rung is counted one programme ahead of what it holds for ever,
 * while the Lab's own progress bar, which matches against the catalogue, reads one lower. The
 * migration deletes the id rather than renaming it: a crew that paid for a research discount did
 * not pay for a training bench.
 */
describe('0107, the retired Professor rung', () => {
  const THEN = '0106_intimidated_again.sql';

  const legacy = (rows: readonly string[][]): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    rows.forEach((technologies, index) => {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(`u107-${index}`, `legacy107-${index}`, 'x', NOW);
      insert(db, 'bases', {
        id: `b107-${index}`,
        owner_id: `u107-${index}`,
        name: `Legacy ${index}`,
        district_id: 'steelbelt',
        created_at: NOW,
        research_json: JSON.stringify({ active: null, technologies }),
      });
    });
    return db;
  };

  const known = (db: AppDatabase, index: number): string[] => {
    const row = db.prepare('SELECT research_json FROM bases WHERE id = ?').get(`b107-${index}`) as {
      research_json: string;
    };
    return (JSON.parse(row.research_json) as { technologies: string[] }).technologies;
  };

  const ROWS = [
    ['tech_reading_lists', 'tech_working_papers', 'tech_seminar'],
    ['tech_reading_lists', 'tech_seminar'],
    [],
    ['tech_working_papers'],
  ];

  it('drops the retired id and leaves every other rung where it was', () => {
    const db = legacy(ROWS);
    // The id carries the `tech_` prefix `idOf` puts on every rung. Asserted here as well as used
    // above, because a migration that filtered the bare name would be a silent no-op on every
    // save in existence and every other line of this test would still pass.
    expect(RESEARCH_ITEMS.map((item) => item.id)).not.toContain('tech_working_papers');
    expect(RESEARCH_ITEMS.map((item) => item.id)).toContain('tech_second_chair');
    expect(known(db, 0), 'the fixture does not carry the retired rung').toContain(
      'tech_working_papers',
    );
    runMigrations(db);

    // Dropped, and the survivors keep their order: a rung list is read in track order elsewhere.
    expect(known(db, 0)).toEqual(['tech_reading_lists', 'tech_seminar']);
    expect(known(db, 3)).toEqual([]);
    // A save that never finished it is untouched, empty array included.
    expect(known(db, 1)).toEqual(['tech_reading_lists', 'tech_seminar']);
    expect(known(db, 2)).toEqual([]);
    db.close();
  });

  it('changes nothing on a second run', () => {
    const db = legacy(ROWS);
    runMigrations(db);
    const after = ROWS.map((_row, index) => known(db, index));
    runMigrations(db);
    expect(ROWS.map((_row, index) => known(db, index))).toEqual(after);
    db.close();
  });
});

/**
 * 0111: a level below one, which is a row the game cannot read.
 *
 * The Console's Clean slate wrote `bases.level = 0` until 2026-09-22. `BaseSchema` puts a floor of
 * one under the column, and the world clock reads every base once a second, so a single such row
 * turned every tick into a ZodError and took the server down for everybody on the table. The fix
 * has two halves and this is the half that repairs saves already holding one: the writer was
 * corrected in `routes/admin.ts` at the same time, which does nothing for a database that already
 * has the row in it.
 *
 * Checked against the two neighbours as well. A location's level and a captured gate's carry the
 * same floor in their schemas, and a sweep that cleaned only the table the crash was reported
 * from would leave the other two to surface the identical failure later, from a different reader.
 */
describe('0111: a level below one', () => {
  const THEN = '0111_level_floor.sql';

  /** One save per table holding a zero, and one good row beside each to catch an over-broad sweep. */
  const legacy = (): AppDatabase => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, THEN);
    // One base per account since 0074, so the two saves need an owner each.
    for (const suffix of ['zero', 'grown']) {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(`u111-${suffix}`, `legacy111-${suffix}`, 'x', NOW);
    }
    insert(db, 'bases', {
      id: 'b111-zero',
      owner_id: 'u111-zero',
      name: 'Cleared',
      district_id: 'steelbelt',
      created_at: NOW,
      level: 0,
    });
    insert(db, 'bases', {
      id: 'b111-grown',
      owner_id: 'u111-grown',
      name: 'Grown',
      district_id: 'steelbelt',
      created_at: NOW,
      level: 7,
    });
    insert(db, 'location_control', {
      location_id: 'steelbelt-press',
      holder_kind: 'government',
      holder_base_id: null,
      level: 0,
    });
    insert(db, 'location_control', {
      location_id: 'steelbelt-ramp',
      holder_kind: 'government',
      holder_base_id: null,
      level: 4,
    });
    insert(db, 'captured_gates', { district_id: 'steelbelt', level: 0 });
    insert(db, 'captured_gates', { district_id: 'kessler', level: 3 });
    return db;
  };

  const levels = (db: AppDatabase): Record<string, number> => ({
    zeroBase: (
      db.prepare('SELECT level FROM bases WHERE id = ?').get('b111-zero') as { level: number }
    ).level,
    grownBase: (
      db.prepare('SELECT level FROM bases WHERE id = ?').get('b111-grown') as { level: number }
    ).level,
    zeroLocation: (
      db
        .prepare('SELECT level FROM location_control WHERE location_id = ?')
        .get('steelbelt-press') as {
        level: number;
      }
    ).level,
    heldLocation: (
      db
        .prepare('SELECT level FROM location_control WHERE location_id = ?')
        .get('steelbelt-ramp') as {
        level: number;
      }
    ).level,
    zeroGate: (
      db.prepare('SELECT level FROM captured_gates WHERE district_id = ?').get('steelbelt') as {
        level: number;
      }
    ).level,
    heldGate: (
      db.prepare('SELECT level FROM captured_gates WHERE district_id = ?').get('kessler') as {
        level: number;
      }
    ).level,
  });

  it('is the floor the readers actually enforce', () => {
    // The reason the migration exists, asserted rather than assumed. A schema that quietly stopped
    // refusing zero would make every other line here agree with a migration nothing needs.
    expect(BaseSchema.shape.level.safeParse(0).success).toBe(false);
    expect(BaseSchema.shape.level.safeParse(1).success).toBe(true);
  });

  it('raises every level below one and leaves the rest alone', () => {
    const db = legacy();
    // The positive control: the fixture really is in the broken state before the sweep runs.
    expect(levels(db).zeroBase).toBe(0);
    expect(levels(db).zeroLocation).toBe(0);
    expect(levels(db).zeroGate).toBe(0);

    runMigrations(db);

    expect(levels(db)).toEqual({
      zeroBase: 1,
      grownBase: 7,
      zeroLocation: 1,
      heldLocation: 4,
      zeroGate: 1,
      heldGate: 3,
    });
    db.close();
  });

  it('changes nothing on a second run', () => {
    const db = legacy();
    runMigrations(db);
    const after = levels(db);
    runMigrations(db);
    expect(levels(db)).toEqual(after);
    db.close();
  });
});

/**
 * 0120: the ids became the names the tags show, and a save written before it holds old ones.
 *
 * The catalogue is code and moved with the rename in the same change. This is the half that is
 * data: a row saying a crew lives in `rustyard` names a district the atlas no longer has, and
 * every read of it comes back undefined. Nothing throws, which is the problem: the crew stands
 * nowhere, the ground it holds matches no location, and the fight it called is over a place with
 * no name.
 *
 * Written against the schema as it stood before 0120 and then migrated, which is the only way to
 * reach this state: no fixture built from the catalogue can produce an id the catalogue does not
 * have.
 */
describe('0120: district and location ids follow the names on the tags', () => {
  const AT = '0120_district_ids_match_names.sql';

  function legacy(): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u1', 'somebody', 'hash', NOW);
    /*
     * Column by column off the live table, the way `legacyBattle` above does it.
     *
     * Not through the repo: the repo writes what the catalogue says, and the catalogue has already
     * moved, so it cannot produce the old id this is about. Everything but `district_id` is
     * scaffolding.
     */
    const columns = (db.prepare('SELECT * FROM bases LIMIT 0').columns() as { name: string }[]).map(
      (column) => column.name,
    );
    const base: Record<string, string | number> = {};
    for (const name of columns) {
      base[name] = name.endsWith('_json') ? '{}' : name.endsWith('_at') ? NOW : 0;
    }
    Object.assign(base, { id: 'base-1', owner_id: 'u1', name: 'Nowhere', district_id: 'rustyard' });
    db.prepare(
      `INSERT INTO bases (${columns.join(', ')})
       VALUES (${columns.map((name) => `@${name}`).join(', ')})`,
    ).run(base);
    db.prepare(
      `INSERT INTO location_control
         (location_id, holder_kind, holder_base_id, fortification, garrison_json, level)
       VALUES (?, 'crew', ?, 0, '{}', 1)`,
    ).run('combine-spire-chapel', 'base-1');
    db.prepare('INSERT INTO crew_tallies (base_id, tally, value) VALUES (?, ?, ?)').run(
      'base-1',
      'missions_in_area:tm-coldwater',
      7,
    );
    db.prepare('INSERT INTO crew_feats (base_id, feat_id, claimed_at) VALUES (?, ?, ?)').run(
      'base-1',
      'area_tm_coldwater_2',
      NOW,
    );
    db.prepare(
      `INSERT INTO unit_moves (id, base_id, from_json, to_json, army_json, vehicles_json, departed_at, returns_at, travel_minutes)
       VALUES (?, ?, ?, ?, '{}', '{}', ?, ?, 10)`,
    ).run(
      'move-1',
      'base-1',
      JSON.stringify({ kind: 'district', districtId: 'tm-blockhouse' }),
      JSON.stringify({ kind: 'location', locationId: 'blacksite-7-vault' }),
      NOW,
      NOW,
    );
    return db;
  }

  const read = (db: AppDatabase) => ({
    district: (db.prepare('SELECT district_id AS d FROM bases').get() as { d: string }).d,
    held: (db.prepare('SELECT location_id AS l FROM location_control').get() as { l: string }).l,
    from: (db.prepare('SELECT from_json AS j FROM unit_moves').get() as { j: string }).j,
    to: (db.prepare('SELECT to_json AS j FROM unit_moves').get() as { j: string }).j,
    tally: (db.prepare('SELECT tally AS t FROM crew_tallies').get() as { t: string }).t,
    claimed: (db.prepare('SELECT feat_id AS f FROM crew_feats').get() as { f: string }).f,
  });

  it('moves every stored id onto the name the tag shows', () => {
    const db = legacy();
    // The positive control: the fixture really is holding the old ids before the sweep runs.
    expect(read(db).district).toBe('rustyard');
    expect(read(db).held).toBe('combine-spire-chapel');

    runMigrations(db);

    const after = read(db);
    expect(after.district).toBe('steelbelt');
    // A location keeps its district's id as its prefix and its own suffix untouched.
    expect(after.held).toBe('ccs-chapel');
    expect(JSON.parse(after.from)).toEqual({ kind: 'district', districtId: 'blockhouse' });
    expect(JSON.parse(after.to)).toEqual({ kind: 'location', locationId: 'blacksite-vault' });
    /*
     * The two keys that are made of an id rather than holding one.
     *
     * A scoped tally is `<measure>:<id>` and an area feat's id is `area_<id with underscores>`,
     * both built from the district and both written into rows as strings. Left behind, a crew's
     * work in the Halt would be counted under a scope the board no longer asks for, and four
     * claimed rungs per district would come back unclaimed.
     */
    expect(after.tally).toBe('missions_in_area:coldwater-halt');
    expect(after.claimed).toBe('area_coldwater_halt_2');
    db.close();
  });

  it('changes nothing on a second run', () => {
    const db = legacy();
    runMigrations(db);
    const after = read(db);
    runMigrations(db);
    expect(read(db)).toEqual(after);
    db.close();
  });
});

describe('0127: the accuracy on a spy report the reader had not earned', () => {
  const AT = '0127_spy_accuracy_withheld.sql';

  it('clears it without the rung and on a failed report, and keeps it where it was printed', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u127', 'spymaster', 'x', NOW);
    insert(db, 'bases', {
      id: 'b127',
      owner_id: 'u127',
      name: 'Watchers',
      district_id: 'steelbelt',
      created_at: NOW,
    });
    const report = (id: string, row: { failed: number; shown: number }) =>
      insert(db, 'spy_reports', {
        id,
        base_id: 'b127',
        target_json: '{"kind":"location","locationId":"steelbelt-press"}',
        district_id: 'steelbelt',
        district_name: 'The Rustyard',
        place_name: 'The Press',
        holder_json: '{"kind":"government","name":"The Combine","player":null,"faction":null}',
        tier: 'loose_ears',
        caps_paid: 100,
        written_at: NOW,
        failed: row.failed,
        exposed_json: row.failed ? '{}' : '{"razors":6}',
        accuracy: row.failed ? 0.2 : 0.6,
        unseen: 4,
        accuracy_shown: row.shown,
      });
    report('hidden', { failed: 0, shown: 0 });
    report('printed', { failed: 0, shown: 1 });
    report('failed', { failed: 1, shown: 1 });

    runMigrations(db);
    const rows = db.prepare('SELECT id, accuracy, unseen FROM spy_reports ORDER BY id').all() as {
      id: string;
      accuracy: number | null;
      unseen: number | null;
    }[];
    expect(rows).toEqual([
      { id: 'failed', accuracy: null, unseen: null },
      { id: 'hidden', accuracy: null, unseen: 4 },
      { id: 'printed', accuracy: 0.6, unseen: 4 },
    ]);
    db.close();
  });
});

describe('0130: scouting leaves the game', () => {
  const AT = '0130_scouting_removed.sql';

  function before(): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u130', 'looker', 'x', NOW);
    insert(db, 'bases', {
      id: 'b130',
      owner_id: 'u130',
      name: 'Lookers',
      district_id: 'kettle-row',
      created_at: NOW,
      research_json: JSON.stringify({
        active: { project: { kind: 'technology', techId: 'tech_scouting' }, finishesAt: NOW },
        technologies: ['tech_scouting', 'tech_paid_informants'],
      }),
    });
    return db;
  }

  it('drops the three tables and nothing else', () => {
    const db = before();
    runMigrations(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name);
    for (const gone of ['scouting_runs', 'district_intel', 'admin_fog']) {
      expect(tables, gone).not.toContain(gone);
    }
    expect(tables).toContain('spy_runs');
    db.close();
  });

  it('moves the first Whispers rung onto its new id, finished or on the bench', () => {
    const db = before();
    runMigrations(db);
    const { research_json } = db
      .prepare('SELECT research_json FROM bases WHERE id = ?')
      .get('b130') as { research_json: string };
    expect(research_json).not.toContain('tech_scouting');
    const research = JSON.parse(research_json) as {
      active: { project: { techId: string } };
      technologies: string[];
    };
    // 0130 put it on Loose Talk and 0131 moved it on again, to Written Reports: a crew that
    // finished Scouting holds rung 1 under the id the catalogue has today.
    expect(research.technologies).toEqual(['tech_written_reports', 'tech_paid_informants']);
    expect(research.active.project.techId).toBe('tech_written_reports');
    expect(RESEARCH_ITEMS.some((item) => item.id === 'tech_written_reports')).toBe(true);
    db.close();
  });

  it('clears the retired bell kind, and unmutes it without losing the other switches', () => {
    const db = before();
    const bell = (id: string, kind: string) =>
      insert(db, 'notifications', {
        id,
        user_id: 'u130',
        kind,
        title: 't',
        link: '/game',
        created_at: NOW,
      });
    bell('n-scout', 'scout_home');
    bell('n-spy', 'spy_report');
    const muted = (userId: string, json: string) => {
      if (userId !== 'u130') {
        db.prepare(
          'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
        ).run(userId, userId, 'x', NOW);
      }
      insert(db, 'notification_settings', { user_id: userId, muted_json: json });
    };
    muted('u130', '["scout_home","spy_report"]');
    muted('u-last', '["market_won","scout_home"]');
    muted('u-only', '["scout_home"]');
    muted('u-none', '["market_won"]');

    runMigrations(db);
    const kinds = (db.prepare('SELECT kind FROM notifications').all() as { kind: string }[]).map(
      (row) => row.kind,
    );
    expect(kinds).toEqual(['spy_report']);
    const settings = Object.fromEntries(
      (
        db.prepare('SELECT user_id, muted_json FROM notification_settings').all() as {
          user_id: string;
          muted_json: string;
        }[]
      ).map((row) => [row.user_id, JSON.parse(row.muted_json) as string[]]),
    );
    expect(settings).toEqual({
      u130: ['spy_report'],
      'u-last': ['market_won'],
      'u-only': [],
      'u-none': ['market_won'],
    });
    db.close();
  });

  it('retires the scouting feats and starts the spy jobs ladder at the reports already written', () => {
    const db = before();
    for (const featId of ['scouted_1', 'scouting_3', 'spying_1']) {
      insert(db, 'crew_feats', { base_id: 'b130', feat_id: featId, claimed_at: NOW });
    }
    insert(db, 'crew_tallies', { base_id: 'b130', tally: 'scouting_runs', value: 40 });
    insert(db, 'crew_tallies', { base_id: 'b130', tally: 'spy_reports', value: 1 });
    for (const [id, failed] of [
      ['r1', 0],
      ['r2', 1],
    ] as const) {
      insert(db, 'spy_reports', {
        id,
        base_id: 'b130',
        target_json: '{"kind":"gate","districtId":"ccs"}',
        district_id: 'ccs',
        district_name: 'The Spire',
        place_name: 'The gate',
        holder_json: '{"kind":"government","name":"The Combine","player":null,"faction":null}',
        tier: 'loose_ears',
        caps_paid: 100,
        written_at: NOW,
        failed,
        exposed_json: '{}',
        accuracy: 0.5,
      });
    }

    runMigrations(db);
    const claimed = (
      db.prepare('SELECT feat_id FROM crew_feats ORDER BY feat_id').all() as { feat_id: string }[]
    ).map((row) => row.feat_id);
    expect(claimed).toEqual(['spying_1']);
    const tallies = Object.fromEntries(
      (
        db.prepare('SELECT tally, value FROM crew_tallies WHERE base_id = ?').all('b130') as {
          tally: string;
          value: number;
        }[]
      ).map((row) => [row.tally, row.value]),
    );
    // Both reports, the failed one too: the ladder counts jobs home, not what they learnt.
    expect(tallies).toEqual({ spy_reports: 1, spy_jobs_returned: 2 });
    db.close();
  });
});

describe("0131: the Master of Whispers' track off the maintainer's ledger", () => {
  const AT = '0131_whispers_rework.sql';

  function before(research: { active: string | null; technologies: string[] }): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u131', 'whisperer', 'x', NOW);
    insert(db, 'bases', {
      id: 'b131',
      owner_id: 'u131',
      name: 'Listeners',
      district_id: 'kettle-row',
      created_at: NOW,
      research_json: JSON.stringify({
        active:
          research.active === null
            ? null
            : { project: { kind: 'technology', techId: research.active }, finishesAt: NOW },
        technologies: research.technologies,
      }),
    });
    return db;
  }

  function researchOf(db: AppDatabase): { active: string | null; technologies: string[] } {
    const { research_json } = db
      .prepare('SELECT research_json FROM bases WHERE id = ?')
      .get('b131') as { research_json: string };
    const parsed = JSON.parse(research_json) as {
      active: { project: { techId: string } } | null;
      technologies: string[];
    };
    return { active: parsed.active?.project.techId ?? null, technologies: parsed.technologies };
  }

  it('keeps every crew on the step it reached, rungs 8 and 9 swapped without a collision', () => {
    const db = before({
      active: 'tech_the_whole_wire',
      technologies: [
        'tech_loose_talk',
        'tech_paid_informants',
        'tech_sleeper_lists',
        'tech_turned_runners',
        'tech_compartmentation',
      ],
    });
    runMigrations(db);
    expect(researchOf(db)).toEqual({
      active: 'tech_the_whole_wire',
      technologies: [
        'tech_written_reports',
        'tech_paid_informants',
        'tech_sleeper_lists',
        'tech_shared_knowledge',
        'tech_turned_runners',
      ],
    });
    for (const id of researchOf(db).technologies) {
      expect(RESEARCH_ITEMS.find((item) => item.id === id)?.track, id).toBe('master_of_whispers');
    }
    // Step for step: rung 8 is still rung 8 and rung 9 still rung 9.
    const step = (id: string) => RESEARCH_ITEMS.find((item) => item.id === id)?.step;
    expect(step('tech_shared_knowledge')).toBe(8);
    expect(step('tech_turned_runners')).toBe(9);
    db.close();
  });

  it('moves old rung 8 alone to Shared Knowledge, finished or on the bench', () => {
    const finished = before({ active: null, technologies: ['tech_turned_runners'] });
    runMigrations(finished);
    expect(researchOf(finished).technologies).toEqual(['tech_shared_knowledge']);
    finished.close();

    const benched = before({ active: 'tech_turned_runners', technologies: [] });
    runMigrations(benched);
    expect(researchOf(benched).active).toBe('tech_shared_knowledge');
    benched.close();

    const nine = before({ active: 'tech_compartmentation', technologies: [] });
    runMigrations(nine);
    expect(researchOf(nine).active).toBe('tech_turned_runners');
    nine.close();
  });

  it('keeps an old report as it was written, units named, and takes a courier report with no tier', () => {
    const db = before({ active: null, technologies: [] });
    const row = {
      base_id: 'b131',
      target_json: '{"kind":"location","locationId":"steelbelt-press"}',
      district_id: 'steelbelt',
      district_name: 'The Rustyard',
      place_name: 'The Press',
      holder_json: '{"kind":"government","name":"The Combine","player":null,"faction":null}',
      caps_paid: 100,
      written_at: NOW,
      failed: 0,
      exposed_json: '{"razors":6}',
      accuracy: null,
    };
    insert(db, 'spy_reports', { ...row, id: 'old', tier: 'loose_ears' });
    runMigrations(db);

    const old = db.prepare('SELECT * FROM spy_reports WHERE id = ?').get('old') as Record<
      string,
      unknown
    >;
    expect(old).toMatchObject({
      tier: 'loose_ears',
      units_shown: 1,
      exposed_slots: null,
      total_slots: null,
      found_out: 0,
    });
    // Read back, the units are the count: an old report says as much as it ever did.
    const read = createSpyingRepo(db).reportsFor('b131', 5)[0]!;
    expect(read.unitsShown).toBe(true);
    expect(read.exposedSlots).toBe(unitSlotsUsed({ razors: 6 }));
    insert(db, 'spy_reports', { ...row, id: 'courier', tier: null, caps_paid: 0 });
    expect(
      (db.prepare('SELECT tier FROM spy_reports WHERE id = ?').get('courier') as { tier: unknown })
        .tier,
    ).toBeNull();
    db.close();
  });
});

/**
 * The two of today's migrations that rewrite or reinterpret rows already written, against those
 * rows (bug pass, 2026-09-29). The filled-store chain above proves each applies; it does not look
 * at what a room frozen before 0128 or a crew's counter from before 0129 reads as afterwards.
 */
describe('0128 and 0129 on rows written before them', () => {
  function crewBefore(stopBefore: string): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, stopBefore);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u12x', 'breaker', 'x', NOW);
    insert(db, 'bases', {
      id: 'b12x',
      owner_id: 'u12x',
      name: 'Breakers',
      district_id: 'kettle-row',
      created_at: NOW,
    });
    return db;
  }

  it('0128: a room frozen before it caps the door off its strongest crew, as it was stocked', () => {
    const db = crewBefore('0128_bar_room_top_rank.sql');
    insert(db, 'bar_rooms', {
      day: '2026-09-28',
      city_id: 'ashfall',
      lowest_level: 20,
      lowest_notoriety: 13,
      highest_level: 80,
      highest_notoriety: 3,
      average_level: 40,
      average_notoriety: 9,
    });
    runMigrations(db);
    expect(createBarRepo(db).room('2026-09-28', 'ashfall')?.highestRank).toBe(3);
    db.close();
  });

  it('0129: every gate a crew broke is still counted, and a column already out never rode', () => {
    const db = crewBefore('0129_feats_count_what_happened.sql');
    insert(db, 'crew_tallies', { base_id: 'b12x', tally: 'gates_captured', value: 4 });
    insert(db, 'crew_tallies', { base_id: 'b12x', tally: 'rail_journeys', value: 2 });
    insert(db, 'unit_moves', {
      id: 'm12x',
      base_id: 'b12x',
      from_json: '{"kind":"district"}',
      to_json: '{"kind":"gate"}',
      army_json: '{"razors":2}',
      vehicles_json: '{}',
      departed_at: NOW,
      returns_at: NOW,
      travel_minutes: 10,
    });
    runMigrations(db);
    expect(createFeatsRepo(db).tallies('b12x')).toEqual({ gates_breached: 4, rail_journeys: 2 });
    expect(createMovesRepo(db).find('m12x')?.byRail).toBe(false);
    db.close();
  });
});

describe('0132: an offer belongs to a city', () => {
  const AT = '0132_offers_per_city.sql';

  function offer(db: AppDatabase, id: string, seller: string, extra: Record<string, unknown> = {}) {
    insert(db, 'market_offers', {
      id,
      seller_base_id: seller,
      seller_name: seller,
      give_json: '{"resources":{"oil":1},"items":{}}',
      want_json: '{"resources":{"scrap":1},"items":{}}',
      status: 'open',
      created_at: NOW,
      ...extra,
    });
  }

  it("pins an open listing to its poster's home city, and a counter to its listing's", () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u132', 'trader', 'x', NOW);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u132b', 'other', 'x', NOW);
    insert(db, 'bases', {
      id: 'ash',
      owner_id: 'u132',
      name: 'Ash',
      district_id: 'kettle-row',
      created_at: NOW,
    });
    insert(db, 'bases', {
      id: 'term',
      owner_id: 'u132b',
      name: 'Term',
      district_id: 'coldwater-halt',
      created_at: NOW,
    });
    offer(db, 'o-term', 'term');
    offer(db, 'o-ash', 'ash');
    // An Ashfall crew's counter to the Terminus listing goes up on the Terminus board.
    offer(db, 'o-counter', 'ash', { counter_to: 'o-term', directed_at: 'term' });
    offer(db, 'o-closed', 'term', { status: 'accepted' });

    runMigrations(db);
    const cities = Object.fromEntries(
      (
        db.prepare('SELECT id, city_id FROM market_offers').all() as {
          id: string;
          city_id: string;
        }[]
      ).map((row) => [row.id, row.city_id]),
    );
    expect(cities).toEqual({
      'o-term': 'terminus',
      'o-ash': 'ashfall',
      'o-counter': 'terminus',
      // History: read only to name a claim's source, so the default is left.
      'o-closed': 'ashfall',
    });
    db.close();
  });
});

describe('0134: every mailbox kept to its newest hundred', () => {
  const AT = '0134_mailbox_cap.sql';

  function letter(
    db: AppDatabase,
    id: string,
    to: string,
    minute: number,
    extra: Record<string, unknown> = {},
  ): void {
    insert(db, 'messages', {
      id,
      thread_id: `t-${id}`,
      sender_user_id: 'writer',
      sender_name: 'writer',
      recipient_user_id: to,
      audience: 'player',
      addressed_to: to,
      subject: id,
      body: '.',
      sent_at: new Date(Date.parse(NOW) + minute * 60_000).toISOString(),
      ...extra,
    });
  }

  it('drops the oldest letters, read or not, and every deleted one', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    for (const id of ['writer', 'reader']) {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, id, 'x', NOW);
    }
    // 102 letters, the oldest read, the newest thrown away: 101 visible, so the oldest visible one
    // goes along with the deleted one.
    for (let n = 0; n < 102; n += 1) {
      letter(db, `in-${String(n)}`, 'reader', n, {
        read_at: n === 0 ? NOW : null,
        deleted: n === 101 ? 1 : 0,
      });
    }
    // The writer's own copy of the oldest letter, which the fold writes to, and 101 more sends.
    letter(db, 'sent-0', 'writer', 0, { thread_id: 't-in-0', is_sent_copy: 1 });
    for (let n = 1; n <= 101; n += 1) {
      letter(db, `sent-${String(n)}`, 'writer', 200 + n, { is_sent_copy: 1 });
    }

    runMigrations(db);
    const ids = (userId: string, sentCopy: number) =>
      (
        db
          .prepare('SELECT id FROM messages WHERE recipient_user_id = ? AND is_sent_copy = ?')
          .all(userId, sentCopy) as { id: string }[]
      ).map((row) => row.id);

    const inbox = ids('reader', 0);
    expect(inbox).toHaveLength(100);
    expect(inbox).not.toContain('in-0');
    expect(inbox).not.toContain('in-101');

    const sent = ids('writer', 1);
    expect(sent).toHaveLength(100);
    // The two oldest sends go, and with them the copy that carried the fold.
    expect(sent).not.toContain('sent-0');
    expect(sent).not.toContain('sent-1');
    db.close();
  });

  it('carries a pruned copy into the sender’s count while the sent copy stays', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    for (const id of ['writer', 'reader']) {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, id, 'x', NOW);
    }
    letter(db, 'old', 'reader', 0, { read_at: NOW });
    letter(db, 'old-copy', 'writer', 0, { thread_id: 't-old', is_sent_copy: 1 });
    for (let n = 1; n <= 100; n += 1) letter(db, `new-${String(n)}`, 'reader', n);

    runMigrations(db);
    expect(
      db
        .prepare('SELECT pruned_recipients, pruned_read FROM messages WHERE id = ?')
        .get('old-copy'),
    ).toEqual({ pruned_recipients: 1, pruned_read: 1 });
    expect(createSocialRepo(db).sent('writer', 100)[0]).toMatchObject({
      recipients: 1,
      readBy: 1,
    });
    db.close();
  });
});

describe('0135: the Consigliere leaves the game', () => {
  const AT = '0135_consigliere_removed.sql';

  function before(
    commanders: { id: string; role: string | null }[],
    research: { active: string | null; technologies: string[] },
  ): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run('u135', 'adviser', 'x', NOW);
    insert(db, 'bases', {
      id: 'b135',
      owner_id: 'u135',
      name: 'Advisers',
      district_id: 'kettle-row',
      created_at: NOW,
      commanders_json: JSON.stringify(commanders.map((one) => ({ ...one, name: one.id }))),
      research_json: JSON.stringify({
        active:
          research.active === null
            ? null
            : { project: { kind: 'technology', techId: research.active }, finishesAt: NOW },
        technologies: research.technologies,
      }),
    });
    return db;
  }

  function saved(db: AppDatabase): {
    roles: Record<string, string | null>;
    active: string | null;
    technologies: string[];
  } {
    const row = db
      .prepare('SELECT commanders_json, research_json FROM bases WHERE id = ?')
      .get('b135') as { commanders_json: string; research_json: string };
    const officers = JSON.parse(row.commanders_json) as { id: string; role: string | null }[];
    const research = JSON.parse(row.research_json) as {
      active: { project: { techId: string } } | null;
      technologies: string[];
    };
    return {
      roles: Object.fromEntries(officers.map((one) => [one.id, one.role])),
      active: research.active?.project.techId ?? null,
      technologies: research.technologies,
    };
  }

  it('benches a seated Consigliere and drops the track, leaving everybody else alone', () => {
    const db = before(
      [
        { id: 'adviser', role: 'consigliere' },
        { id: 'wire', role: 'master_of_whispers' },
        { id: 'spare', role: null },
      ],
      {
        active: 'tech_insulation',
        technologies: ['tech_written_reports', 'tech_the_quiet_word', 'tech_nothing_in_writing'],
      },
    );
    runMigrations(db);
    expect(saved(db)).toEqual({
      roles: { adviser: null, wire: 'master_of_whispers', spare: null },
      active: null,
      technologies: ['tech_written_reports'],
    });
    db.close();
  });

  it('leaves a crew that never had one byte-identical, and an active project on another track', () => {
    const db = before([{ id: 'wire', role: 'master_of_whispers' }], {
      active: 'tech_the_whole_wire',
      technologies: ['tech_written_reports'],
    });
    const raw = () => db.prepare('SELECT commanders_json, research_json FROM bases').get();
    const untouched = raw();
    runMigrations(db);
    expect(raw()).toEqual(untouched);
    db.close();
  });

  it('gives a spy job somewhere to freeze its score, and leaves older jobs on null', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const columns = (db.prepare('PRAGMA table_info(spy_runs)').all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).toEqual(expect.arrayContaining(['chair_points', 'intel_percent']));
    db.close();
  });
});

describe('0143: making units is mustering', () => {
  const AT = '0143_muster_rename.sql';

  function before(): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    insert(db, 'users', { id: 'u143', username: 'mustering', password_hash: 'x', created_at: NOW });
    insert(db, 'overseers', {
      id: 'o143',
      user_id: 'u143',
      preset_id: 'enforcer',
      name: 'Sergeant',
      archetype: 'enforcer',
      portrait_id: 'overseer-1',
      bio: 'bio',
      attributes_json: '{}',
      perks_json: JSON.stringify(['training_officer', 'hard_trainer']),
      created_at: NOW,
    });
    insert(db, 'bases', {
      id: 'b143',
      owner_id: 'u143',
      name: 'Musterers',
      district_id: 'kettle-row',
      created_at: NOW,
      training_queue_json: JSON.stringify([{ id: 'q1', unitId: 'razors', count: 2 }]),
      commanders_json: JSON.stringify([
        { id: 'c1', name: 'Drill', role: null, perks: ['training_officer'] },
        { id: 'c2', name: 'Other', role: null, perks: ['hard_trainer'] },
      ]),
    });
    for (const [id, kind] of [
      ['n1', 'unit_trained'],
      ['n2', 'training_done'],
    ] as const) {
      insert(db, 'notifications', {
        id,
        user_id: 'u143',
        kind,
        title: 'title',
        link: '/game/units',
        created_at: NOW,
      });
    }
    insert(db, 'notification_settings', {
      user_id: 'u143',
      muted_json: JSON.stringify(['unit_trained', 'training_done']),
    });
    for (const tally of ['units_trained', 'missions_done']) {
      insert(db, 'crew_tallies', { base_id: 'b143', tally, value: 40 });
    }
    for (const featId of ['trained_1', 'trained_10', 'runs_1']) {
      insert(db, 'crew_feats', { base_id: 'b143', feat_id: featId, claimed_at: NOW });
    }
    return db;
  }

  const column = (db: AppDatabase, sql: string): unknown[] =>
    (db.prepare(sql).all() as Record<string, unknown>[]).map((row) => Object.values(row)[0]);

  it('moves every stored unit-queue name to muster and leaves officer training alone', () => {
    const db = before();
    runMigrations(db);
    // The bench moves column with every order on it.
    expect(column(db, 'SELECT muster_queue_json FROM bases')).toEqual([
      JSON.stringify([{ id: 'q1', unitId: 'razors', count: 2 }]),
    ]);
    expect(column(db, 'SELECT kind FROM notifications ORDER BY id')).toEqual([
      'unit_mustered',
      'training_done',
    ]);
    expect(column(db, 'SELECT muted_json FROM notification_settings')).toEqual([
      JSON.stringify(['unit_mustered', 'training_done']),
    ]);
    expect(column(db, 'SELECT tally FROM crew_tallies ORDER BY tally')).toEqual([
      'missions_done',
      'units_mustered',
    ]);
    expect(column(db, 'SELECT feat_id FROM crew_feats ORDER BY feat_id')).toEqual([
      'mustered_1',
      'mustered_10',
      'runs_1',
    ]);
    expect(column(db, 'SELECT perks_json FROM overseers')).toEqual([
      JSON.stringify(['muster_master', 'hard_trainer']),
    ]);
    const officers = JSON.parse(column(db, 'SELECT commanders_json FROM bases')[0] as string) as {
      perks: string[];
    }[];
    expect(officers.map((officer) => officer.perks)).toEqual([['muster_master'], ['hard_trainer']]);
    db.close();
  });

  it('leaves a save with no old names in it byte-identical, bar the column name', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    insert(db, 'users', { id: 'u143', username: 'quiet', password_hash: 'x', created_at: NOW });
    insert(db, 'bases', {
      id: 'b143',
      owner_id: 'u143',
      name: 'Quiet',
      district_id: 'kettle-row',
      created_at: NOW,
      commanders_json: JSON.stringify([{ id: 'c1', name: 'Drill', role: null, perks: [] }]),
    });
    // The whole row, with the bench read under whichever name the column has at the time.
    const raw = () => {
      const {
        training_queue_json: before,
        muster_queue_json: after,
        ...rest
      } = db.prepare('SELECT * FROM bases').get() as Record<string, unknown>;
      return { ...rest, queue: before ?? after };
    };
    const untouched = raw();
    runMigrations(db);
    expect(raw()).toEqual(untouched);
    db.close();
  });
});

describe('0142: the chair rework', () => {
  const AT = '0142_chair_rework.sql';

  function before(commanders: unknown[], research: unknown): AppDatabase {
    const db = openDatabase(':memory:');
    migrateUpTo(db, AT);
    insert(db, 'users', { id: 'u142', username: 'chairs', password_hash: 'x', created_at: NOW });
    insert(db, 'bases', {
      id: 'b142',
      owner_id: 'u142',
      name: 'Chairs',
      district_id: 'kettle-row',
      created_at: NOW,
      commanders_json: JSON.stringify(commanders),
      research_json: JSON.stringify(research),
    });
    return db;
  }

  const row = (db: AppDatabase) =>
    db.prepare('SELECT commanders_json, research_json FROM bases WHERE id = ?').get('b142') as {
      commanders_json: string;
      research_json: string;
    };

  it('renames five chairs, benches four, and drops the rungs that left', () => {
    const db = before(
      [
        { id: 'a', name: 'A', role: 'head_of_research', perks: [] },
        { id: 'b', name: 'B', role: 'chief_medic', perks: [] },
        { id: 'c', name: 'C', role: 'trader', perks: [] },
        { id: 'd', name: 'D', role: 'security_officer', perks: [] },
      ],
      {
        technologies: ['tech_field_triage', 'tech_batch_runs', 'tech_drill_yard', 'tech_vetting'],
        active: { id: 'r', project: { kind: 'technology', techId: 'tech_clean_room' } },
      },
    );
    runMigrations(db);
    const after = row(db);
    const officers = JSON.parse(after.commanders_json) as { role: string | null }[];
    expect(officers.map((one) => one.role)).toEqual(['researcher', null, 'trader', 'veteran']);
    const research = JSON.parse(after.research_json) as { technologies: string[]; active: unknown };
    // The moved rungs kept their ids, so a save keeps them.
    expect(research.technologies).toEqual(['tech_batch_runs', 'tech_drill_yard']);
    expect(research.active).toBeNull();
  });

  it('leaves a save with none of it byte-identical, a moved project included', () => {
    const commanders = [{ id: 'a', name: 'A', role: 'trader', perks: [] }];
    const research = {
      technologies: ['tech_batch_runs'],
      active: { id: 'r', project: { kind: 'technology', techId: 'tech_reimagining' } },
    };
    const db = before(commanders, research);
    const untouched = row(db);
    runMigrations(db);
    expect(row(db)).toEqual(untouched);
  });
});
