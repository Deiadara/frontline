import {
  ALL_DISTRICTS,
  withoutRetiredUnits,
  EVERY_LOCATION,
  LocationControlSchema,
  districtsOfCity,
  findDistrict,
  findLocation,
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
 * Control is world state, one row per location, shared by every crew, and intel is per-crew
 * knowledge. Keeping them in separate tables is the whole fog-of-war design: the truth exists
 * whether or not you have looked at it.
 */

interface ControlRow {
  location_id: string;
  holder_kind: LocationHolder['kind'];
  holder_base_id: string | null;
  level: number;
  upgrading_until: string | null;
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
  /** Districts this crew has seen inside. */
  scouted(baseId: string): Set<string>;
  markScouted(baseId: string, districtId: string, at: string): void;
  /**
   * Every district this crew has seen inside, forgotten. The Console's Clean slate: a crew at its
   * first second has walked nowhere, and `district_intel` does not cascade because the base row
   * is rewritten rather than deleted.
   */
  forgetScouted(baseId: string): void;
  /**
   * What this crew can see into right now: the districts its scouts have visited, or in admin
   * mode every district except the ones the Console has hidden. This is the read the city, the
   * board and the battles go through; `scouted` is the raw intel and stays that.
   *
   * `cityId` says which map the admin answer is drawn from, and a caller that knows where the crew
   * is standing should pass it: the city screen asks for its own city's districts, so a crew in
   * Terminus on a testing build sees Terminus rather than a list of Ashfall ids it has no ground
   * near. Left off, the answer is every district in the world, which is what a caller with no city
   * in hand means by "everything".
   */
  visibleDistricts(baseId: string, cityId?: string): Set<string>;
  /** The Console's exceptions: districts an admin has chosen not to see (migration 0079). */
  hiddenByAdmin(baseId: string): Set<string>;
  setAdminFog(baseId: string, districtId: string, hidden: boolean): void;
}

/** `admin` is the testing build's flag: it is what makes `visibleDistricts` mean everything. */
export function createCityRepo(db: AppDatabase, admin = false): CityRepo {
  const allStmt = db.prepare('SELECT * FROM location_control');
  const oneStmt = db.prepare('SELECT * FROM location_control WHERE location_id = ?');
  const insertStmt = db.prepare(
    // `fortification` and `fortifying_until` are still columns on this table and are no longer
    // written or read: dug-in fortification left the game (maintainer, 2026-09-26), and dropping a
    // column needs a migration number of its own. Their defaults (0, null) fill new rows.
    `INSERT INTO location_control
       (location_id, holder_kind, holder_base_id, level, upgrading_until, garrison_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (location_id) DO UPDATE SET
       holder_kind = excluded.holder_kind,
       holder_base_id = excluded.holder_base_id,
       level = excluded.level,
       upgrading_until = excluded.upgrading_until,
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
  const forgetScoutedStmt = db.prepare('DELETE FROM district_intel WHERE base_id = ?');
  const fogStmt = db.prepare('SELECT district_id FROM admin_fog WHERE base_id = ?');
  const hideStmt = db.prepare(
    'INSERT INTO admin_fog (base_id, district_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );
  const showStmt = db.prepare('DELETE FROM admin_fog WHERE base_id = ? AND district_id = ?');

  const write = (control: LocationControl): void => {
    insertStmt.run(
      control.locationId,
      control.holder.kind,
      control.holder.kind === 'crew' ? control.holder.baseId : null,
      control.level,
      control.upgradingUntil,
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
    scouted(baseId) {
      const rows = scoutedStmt.all(baseId) as { district_id: string }[];
      return new Set(rows.map((row) => row.district_id));
    },
    markScouted(baseId, districtId, at) {
      markStmt.run(baseId, districtId, at);
    },
    forgetScouted(baseId) {
      forgetScoutedStmt.run(baseId);
    },
    visibleDistricts(baseId, cityId) {
      if (!admin) return this.scouted(baseId);
      /*
       * The Console **adds** to what a crew has really scouted; it does not stand in for it.
       *
       * It replaced the crew's own marks with one city's districts, and `cityId` defaults to the
       * city being looked at. So on an admin build a crew that had genuinely scouted ground in a
       * second city became unable to declare a fight on it or move units to it: `declare.ts` and
       * `sendMove` both gate on this set, and the real mark had been thrown away. The first
       * foothold abroad could not be taken at all on the one build the Console exists in.
       *
       * It also quietly voided the Console's own workaround. `mockBattleOn` marks the attacker as
       * having scouted the target precisely because a declaration refuses unscouted ground, and
       * that mark was the thing being discarded.
       *
       * The fog knob still hides a district, genuinely scouted or not, which is what it is for:
       * the subtraction happens after the union rather than instead of it.
       */
      const hidden = this.hiddenByAdmin(baseId);
      const map = cityId === undefined ? ALL_DISTRICTS : districtsOfCity(cityId);
      const seen = new Set([...this.scouted(baseId), ...map.map((district) => district.id)]);
      for (const districtId of hidden) seen.delete(districtId);
      return seen;
    },
    hiddenByAdmin(baseId) {
      const rows = fogStmt.all(baseId) as { district_id: string }[];
      return new Set(rows.map((row) => row.district_id));
    },
    setAdminFog(baseId, districtId, hidden) {
      if (hidden) hideStmt.run(baseId, districtId);
      else showStmt.run(baseId, districtId);
    },
  };
}
