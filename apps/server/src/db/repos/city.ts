import {
  withoutRetiredUnits,
  EVERY_LOCATION,
  LocationControlSchema,
  findDistrict,
  findLocation,
  startingControl,
  type Army,
  type LocationControl,
  type LocationHolder,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/**
 * Who holds the city (GDD §A4).
 *
 * Control is world state, one row per location, shared by every crew and visible to every crew
 * (maintainer, 2026-09-29: "whole city visible"). What is *standing* on a location is the part a
 * crew has to pay to learn, and that lives with the spy reports (`repos/spying.ts`), not here.
 */

interface ControlRow {
  location_id: string;
  holder_kind: LocationHolder['kind'];
  holder_base_id: string | null;
  level: number;
  upgrading_until: string | null;
  /** Absent on a schema before 0144, which a migration test reads through this repo. */
  upgrade_paid_json?: string | null;
  garrison_json: string;
}

function rowToControl(row: ControlRow): LocationControl {
  return LocationControlSchema.parse({
    locationId: row.location_id,
    holder:
      row.holder_kind === 'crew'
        ? { kind: 'crew', baseId: row.holder_base_id }
        : { kind: row.holder_kind },
    level: row.level,
    upgradingUntil: row.upgrading_until,
    // Only while an upgrade is under way, so a row with nothing running reads as it always did.
    ...(row.upgrade_paid_json == null ? {} : { upgradePaid: readJson(row.upgrade_paid_json) }),
    garrison: withoutRetiredUnits(readJson(row.garrison_json)),
  });
}

export interface CityRepo {
  /**
   * Every location's control row, keyed by location id.
   *
   * Creates any row the catalogue has and the table does not, so a location added to the map appears
   * held by whoever nominally garrisons its district without a migration. That is the only sane
   * location for this: the catalogue is TypeScript, and SQL cannot read it.
   *
   * The catalogue is the **world's** now rather than Ashfall's (2026-09-24). Minting off
   * `CITY_LOCATIONS` meant no control row could ever exist for a location in a second city, and a
   * location with no control row is ground nobody can hold, fight for or garrison: the whole city
   * was unreachable through a lazy insert that had never heard of it.
   */
  controls(): Map<string, LocationControl>;
  control(locationId: string): LocationControl | undefined;
  /** Replaces one location's whole control row. Holder, level and garrison move together. */
  put(control: LocationControl): void;
  /** Just the garrison: the common write, and the one that must not disturb an upgrade clock. */
  setGarrison(locationId: string, garrison: Army): void;
}

export function createCityRepo(db: AppDatabase): CityRepo {
  const allStmt = db.prepare('SELECT * FROM location_control');
  const oneStmt = db.prepare('SELECT * FROM location_control WHERE location_id = ?');
  // Prepared on the first write, not here: `upgrade_paid_json` arrives with 0144, and a repo built
  // over an older schema to read one (the migration tests do) must not fail at construction.
  let insertStmt: Statement | undefined;
  const insertSql =
    // `fortification` and `fortifying_until` are still columns on this table and are no longer
    // written or read: dug-in fortification left the game (maintainer, 2026-09-26), and dropping a
    // column needs a migration number of its own. Their defaults (0, null) fill new rows.
    `INSERT INTO location_control
       (location_id, holder_kind, holder_base_id, level, upgrading_until, upgrade_paid_json,
        garrison_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (location_id) DO UPDATE SET
       holder_kind = excluded.holder_kind,
       holder_base_id = excluded.holder_base_id,
       level = excluded.level,
       upgrading_until = excluded.upgrading_until,
       upgrade_paid_json = excluded.upgrade_paid_json,
       garrison_json = excluded.garrison_json`;
  const garrisonStmt = db.prepare(
    'UPDATE location_control SET garrison_json = ? WHERE location_id = ?',
  );

  const write = (control: LocationControl): void => {
    (insertStmt ??= db.prepare(insertSql)).run(
      control.locationId,
      control.holder.kind,
      control.holder.kind === 'crew' ? control.holder.baseId : null,
      control.level,
      control.upgradingUntil,
      control.upgradePaid == null || control.upgradingUntil === null
        ? null
        : JSON.stringify(control.upgradePaid),
      JSON.stringify(control.garrison),
    );
  };

  return {
    controls() {
      const rows = allStmt.all() as ControlRow[];
      const known = new Map(rows.map((row) => [row.location_id, rowToControl(row)]));

      for (const location of EVERY_LOCATION) {
        if (known.has(location.id)) continue;
        const district = findDistrict(location.districtId);
        if (!district) continue;
        const fresh = startingControl(location, district);
        write(fresh);
        known.set(location.id, fresh);
      }
      return known;
    },
    control(locationId) {
      const row = oneStmt.get(locationId) as ControlRow | undefined;
      if (row) return rowToControl(row);

      const location = findLocation(locationId);
      const district = location ? findDistrict(location.districtId) : undefined;
      if (!location || !district) return undefined;

      const fresh = startingControl(location, district);
      write(fresh);
      return fresh;
    },
    put: write,
    setGarrison(locationId, garrison) {
      garrisonStmt.run(JSON.stringify(garrison), locationId);
    },
  };
}
