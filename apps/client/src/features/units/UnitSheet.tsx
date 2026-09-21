import {
  ENV_LABEL_CATALOG,
  ENV_LABEL_IDS,
  type EnvLabelId,
  type UnitSpec,
} from '@frontline/shared';

/**
 * Which characteristics a unit reacts to unusually, for the card that draws them.
 *
 * This file used to hold a whole second card as well: a narrow `InfoWindow` sheet that every
 * surface but the roster opened on a pointer. It went on 2026-09-20, when the maintainer asked
 * for one unit template everywhere ("make all the vehicle titles ... unify everywhere in the game
 * the unit templates"). There is one card now, `UnitCard`, reached through `UnitWindow`, so the
 * only thing left here is the rule that decides which labels are worth printing at all.
 *
 * Kept as its own function rather than folded into that card, because both sides of the wire need
 * it and neither owns it: the server projects the same list for a player's own units
 * (`groundAffinities` in `apps/server/src/units/roster.ts`), and this is the client's copy for the
 * sheets the server never projects, which is every Combine unit.
 */

/** A label this unit reacts to unusually, as the roster's own cards print one. */
export interface AffinityRow {
  id: EnvLabelId;
  label: string;
  /** The rate, in the roster's words: `+9% per tier`, or the immunity when there is one. */
  note: string;
  good: boolean;
}

/**
 * The labels worth printing: the ones this sheet has an opinion about.
 *
 * The same editorial rule and the same output shape as the server's `groundAffinities`
 * (`apps/server/src/units/roster.ts`), so a Combine sheet and a player's read identically. It is
 * derived here rather than fetched because there is no roster row to hang it off, and the source
 * both sides read is the one catalogue: `affinities` and `immuneTo` only, never the stat-driven
 * baseline, because every unit has an opinion about every label and thirteen rows would bury the
 * one that matters.
 */
export function unitAffinities(sheet: UnitSpec): AffinityRow[] {
  const rows: AffinityRow[] = [];
  for (const id of ENV_LABEL_IDS) {
    const immune = sheet.immuneTo?.includes(id) ?? false;
    const per = sheet.affinities?.[id] ?? 0;
    if (!immune && per === 0) continue;
    const rate = `${per > 0 ? '+' : ''}${per}% per tier`;
    rows.push({
      id,
      label: ENV_LABEL_CATALOG[id].name,
      note: per === 0 ? 'Immune' : immune ? `Immune, ${rate}` : rate,
      // The affinity decides the colour whenever there is one, as it does on the roster: a unit
      // that shrugs off the baseline and is still worse for being there has not been handed a
      // good place to stand.
      good: per === 0 ? immune : per > 0,
    });
  }
  return rows;
}
