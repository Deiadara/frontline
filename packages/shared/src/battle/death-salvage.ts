import { RESOURCE_KEYS, RESOURCE_LABELS, type PartialResources } from '../resources.js';

/**
 * The Cold Sidings (maintainer, 2026-10-14): what a crew's dead are worth after a fight, at the
 * per-body figures its ground pays (`deathSalvagePerBody`). Each resource is summed over the dead
 * and rounded down once, so 1.8 HQ metal a body over three bodies is 5, not 3.
 */
export function deathSalvageFor(deadBodies: number, perBody: PartialResources): PartialResources {
  if (deadBodies <= 0) return {};
  const out: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const total = Math.floor(deadBodies * (perBody[key] ?? 0) + 1e-9);
    if (total > 0) out[key] = total;
  }
  return out;
}

/** "25 Scrap and 5 HQ metal", for the report's line. */
export function describeSalvage(paid: PartialResources): string {
  return RESOURCE_KEYS.filter((key) => (paid[key] ?? 0) > 0)
    .map((key) => `${paid[key]} ${RESOURCE_LABELS[key]}`)
    .join(' and ');
}
