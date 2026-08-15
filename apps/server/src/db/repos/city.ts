import {
  CITY_PLACES,
  PlaceControlSchema,
  findDistrict,
  startingControl,
  type Army,
  type PlaceControl,
  type PlaceHolder,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

/**
 * Who holds the city, and who has seen it (GDD §A4).
 *
 * Control is world state — one row per place, shared by every crew — and intel is per-crew
 * knowledge. Keeping them in separate tables is the whole fog-of-war design: the truth exists
 * whether or not you have looked at it.
 */

interface ControlRow {
  place_id: string;
  holder_kind: PlaceHolder['kind'];
  holder_base_id: string | null;
  fortification: number;
  fortifying_until: string | null;
  garrison_json: string;
}

function rowToControl(row: ControlRow): PlaceControl {
  return PlaceControlSchema.parse({
    placeId: row.place_id,
    holder:
      row.holder_kind === 'faction'
        ? { kind: 'faction', baseId: row.holder_base_id }
        : { kind: row.holder_kind },
    fortification: row.fortification,
    fortifyingUntil: row.fortifying_until,
    garrison: readJson(row.garrison_json),
  });
}

export interface CityRepo {
  /**
   * Every place's control row, keyed by place id.
   *
   * Creates any row the catalogue has and the table does not, so a place added to the map appears
   * held by whoever nominally garrisons its district without a migration. That is the only sane
   * place for this: the catalogue is TypeScript, and SQL cannot read it.
   */
  controls(): Map<string, PlaceControl>;
  control(placeId: string): PlaceControl | undefined;
  /** Replaces one place's whole control row. Holder, digging and garrison move together. */
  put(control: PlaceControl): void;
  /** Just the garrison — the common write, and the one that must not disturb a fortify clock. */
  setGarrison(placeId: string, garrison: Army): void;
  /** Districts this crew has seen inside. */
  scouted(baseId: string): Set<string>;
  markScouted(baseId: string, districtId: string, at: string): void;
}

export function createCityRepo(db: AppDatabase): CityRepo {
  const allStmt = db.prepare('SELECT * FROM place_control');
  const oneStmt = db.prepare('SELECT * FROM place_control WHERE place_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO place_control
       (place_id, holder_kind, holder_base_id, fortification, fortifying_until, garrison_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (place_id) DO UPDATE SET
       holder_kind = excluded.holder_kind,
       holder_base_id = excluded.holder_base_id,
       fortification = excluded.fortification,
       fortifying_until = excluded.fortifying_until,
       garrison_json = excluded.garrison_json`,
  );
  const garrisonStmt = db.prepare('UPDATE place_control SET garrison_json = ? WHERE place_id = ?');
  const scoutedStmt = db.prepare('SELECT district_id FROM district_intel WHERE base_id = ?');
  const markStmt = db.prepare(
    `INSERT INTO district_intel (base_id, district_id, scouted_at) VALUES (?, ?, ?)
     ON CONFLICT (base_id, district_id) DO NOTHING`,
  );

  const write = (control: PlaceControl): void => {
    insertStmt.run(
      control.placeId,
      control.holder.kind,
      control.holder.kind === 'faction' ? control.holder.baseId : null,
      control.fortification,
      control.fortifyingUntil,
      JSON.stringify(control.garrison),
    );
  };

  return {
    controls() {
      const rows = allStmt.all() as ControlRow[];
      const known = new Map(rows.map((row) => [row.place_id, rowToControl(row)]));

      for (const place of CITY_PLACES) {
        if (known.has(place.id)) continue;
        const district = findDistrict(place.districtId);
        if (!district) continue;
        const fresh = startingControl(place, district);
        write(fresh);
        known.set(place.id, fresh);
      }
      return known;
    },
    control(placeId) {
      const row = oneStmt.get(placeId) as ControlRow | undefined;
      if (row) return rowToControl(row);

      const place = CITY_PLACES.find((candidate) => candidate.id === placeId);
      const district = place ? findDistrict(place.districtId) : undefined;
      if (!place || !district) return undefined;

      const fresh = startingControl(place, district);
      write(fresh);
      return fresh;
    },
    put: write,
    setGarrison(placeId, garrison) {
      garrisonStmt.run(JSON.stringify(garrison), placeId);
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
