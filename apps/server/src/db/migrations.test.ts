import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AttributesSchema,
  BUILDING_KINDS,
  BadgeSchema,
  DEFAULT_BADGE,
  type Building,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type AppDatabase } from './index.js';

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
   * §B9/§E: the shelf is filled from what is already bolted on, so nobody loses an add-on they
   * paid for on the day fitting became reversible.
   */
  it('§B9: seeds the add-on shelf from the modifications already fitted', () => {
    const db = legacyBase([
      { kind: 'nexus', level: 20, modifications: ['nexus_encrypted_core'] },
      { kind: 'lab', level: 20, modifications: ['lab_quantum_modeling'] },
    ]);
    runMigrations(db);

    const row = db.prepare('SELECT addons_json FROM bases').get() as { addons_json: string };
    const addons = JSON.parse(row.addons_json) as { researched: string[]; built: string[] };
    expect(addons.built.sort()).toEqual(['lab_quantum_modeling', 'nexus_encrypted_core']);
    expect(addons.researched.sort()).toEqual(['lab_quantum_modeling', 'nexus_encrypted_core']);
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
    Object.assign(base, { id: 'base-1', owner_id: 'u1', name: 'Nowhere', district_id: 'rustyard' });
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
    ).run('b1', 'base-1', 'rustyard', 'rustyard-ramp', NOW, NOW, NOW, analysis('regular'));
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
