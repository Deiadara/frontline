import type { ItemId } from '../items/catalog.js';

/**
 * The parts the Black Market's contraband crates hand over, which the Runner never carries
 * (maintainer, 2026-10-02): the crates are sold as goods that never reach his barrow, and it used
 * to stock all five. Its own module so the barrow can read it without importing the Black Market,
 * which imports the barrow's neighbours; `blackmarket.test.ts` holds it to the crates' grants.
 */
export const CONTRABAND_PARTS: ReadonlySet<ItemId> = new Set<ItemId>([
  'neural_shunt',
  'targeting_core',
  'rotor_hub',
  'coolant_cell',
  'ceramic_plate',
]);
