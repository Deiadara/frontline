import {
  CITY_LOCATIONS,
  LocationControlSchema,
  findDistrict,
  startingControl,
  type Army,
  type LocationControl,
  type LocationHolder,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

/**
 * Who holds the city, and who has seen it (GDD §A4).
 *
 * Control is world state — one row per location, shared by every crew — and intel is per-crew
 * knowledge. Keeping them in separate tables is the whole fog-of-war design: the truth exists
 * whether or not you have looked at it.
 */

interface ControlRow {
  location_id: string;
  holder_kind: LocationHolder['kind'];
  holder_base_id: string | null;
  level: number;
  upgrading_until: string | null;
  fortification: number;
  fortifying_until: string | null;
  garrison_json: string;
}

function rowToControl(row: ControlRow): LocationControl {
  return LocationControlSchema.parse({
    locationId: row.location_id,
    holder:
      row.holder_kind === 'faction'
        ? { kind: 'faction', baseId: row.holder_base_id }
        : { kind: row.holder_kind },
    level: row.level,
    upgradingUntil: row.upgrading_until,
    fortification: row.fortification,
    fortifyingUntil: row.fortifying_until,
    garrison: readJson(row.garrison_json),
  });
}

export interface CityRepo {
  /**
   * Every location's control row, keyed by location id.
   *
   * Creates any row the catalogue has and the table does not, so a location added to the map appears
   * held by whoever nominally garrisons its district without a migration. That is the only sane
   * location for this: the catalogue is TypeScript, and SQL cannot read it.
   */
  controls(): Map<string, LocationControl>;
  control(locationId: string): LocationControl | undefined;
  /** Replaces one location's whole control row. Holder, digging and garrison move together. */
  put(control: LocationControl): void;
  /** Just the garrison — the common write, and the one that must not disturb a fortify clock. */
  setGarrison(locationId: string, garrison: Army): void;
  /** Districts this crew has seen inside. */
  scouted(baseId: string): Set<string>;
  markScouted(baseId: string, districtId: string, at: string): void;
}

export function createCityRepo(db: AppDatabase): CityRepo {
  const allStmt = db.prepare('SELECT * FROM location_control');
  const oneStmt = db.prepare('SELECT * FROM location_control WHERE location_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO location_control
       (location_id, holder_kind, holder_base_id, level, upgrading_until,
        fortification, fortifying_until, garrison_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (location_id) DO UPDATE SET
       holder_kind = excluded.holder_kind,
       holder_base_id = excluded.holder_base_id,
       level = excluded.level,
       upgrading_until = excluded.upgrading_until,
       fortification = excluded.fortification,
       fortifying_until = excluded.fortifying_until,
       garrison_json = excluded.garrison_json`,
  );
  const garrisonStmt = db.prepare(
    'UPDATE location_control SET garrison_json = ? WHERE location_id = ?',
  );
  const scoutedStmt = db.prepare('SELECT district_id FROM district_intel WHERE base_id = ?');
  const markStmt = db.prepare(
    `INSERT INTO district_intel (base_id, district_id, scouted_at) VALUES (?, ?, ?)
     ON CONFLICT (base_id, district_id) DO NOTHING`,
  );

  const write = (control: LocationControl): void => {
    insertStmt.run(
      control.locationId,
      control.holder.kind,
      control.holder.kind === 'faction' ? control.holder.baseId : null,
      control.level,
      control.upgradingUntil,
      control.fortification,
      control.fortifyingUntil,
      JSON.stringify(control.garrison),
    );
  };

  return {
    controls() {
      const rows = allStmt.all() as ControlRow[];
      const known = new Map(rows.map((row) => [row.location_id, rowToControl(row)]));

      for (const location of CITY_LOCATIONS) {
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

      const location = CITY_LOCATIONS.find((candidate) => candidate.id === locationId);
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
    scouted(baseId) {
      const rows = scoutedStmt.all(baseId) as { district_id: string }[];
      return new Set(rows.map((row) => row.district_id));
    },
    markScouted(baseId, districtId, at) {
      markStmt.run(baseId, districtId, at);
    },
  };
}
