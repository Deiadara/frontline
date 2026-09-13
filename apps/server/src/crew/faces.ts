import { freePortraits, type Commander } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * One face per officer, across the whole city (maintainer request, 2026-09-11).
 *
 * A face used to be a hash of the officer's id, kept distinct within one crew and nowhere else, so
 * two crews could be looking at the same person. It is stored on the officer now
 * (`Commander.portraitId`) and picked from what nobody in the city holds, at three moments: when
 * the Bar draws a recruit, when a recruit is signed, and once on boot for every officer written
 * before the column existed.
 */

/** Every face somebody in the city is wearing. */
export function takenFaces(repos: Repositories): Set<string> {
  const taken = new Set<string>();
  for (const officer of repos.bases.allCommanders()) {
    if (officer.portraitId) taken.add(officer.portraitId);
  }
  return taken;
}

/**
 * The faces a Bar roster would sign with today, in seat order, against the city as it stands.
 *
 * Seat order is what makes the answer stable between the card and the contract: a recruit's face
 * depends on the seats before it and the city, never on how many seats the reader's own crew has
 * opened, so a longer room agrees with a shorter one about its first seats.
 */
export function rosterFaces(
  repos: Repositories,
  recruitIds: readonly string[],
): ReadonlyMap<string, string> {
  return freePortraits(recruitIds, takenFaces(repos));
}

/**
 * Gives a face to every officer in the city who has none, crew by crew in hire order.
 *
 * Run once at boot, after the seed, so the bots' officers and every save written before the
 * column existed come up with a face that is theirs alone. Idempotent: an officer with a face is
 * left exactly as they are, so a second boot changes nothing.
 */
export function backfillPortraits(repos: Repositories): number {
  const taken = takenFaces(repos);
  let assigned = 0;
  for (const summary of repos.bases.listSummaries()) {
    const base = repos.bases.findById(summary.id);
    if (!base || base.commanders.every((officer) => officer.portraitId)) continue;
    const bare = base.commanders.filter((officer) => !officer.portraitId);
    const faces = freePortraits(
      bare.map((officer) => officer.id),
      taken,
    );
    const commanders: Commander[] = base.commanders.map((officer) =>
      officer.portraitId ? officer : { ...officer, portraitId: faces.get(officer.id) ?? null },
    );
    for (const face of faces.values()) taken.add(face);
    repos.bases.updateCommanders(base.id, commanders);
    assigned += faces.size;
  }
  return assigned;
}
