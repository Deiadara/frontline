import {
  RESOURCE_KEYS,
  describeWaste,
  weightOf,
  type Mission,
  type PartialResources,
  type ResourceKey,
} from '@frontline/shared';

/**
 * What came home and had nowhere to go (maintainer ruling, 2026-09-28).
 *
 * The stores are a hard ceiling on mission pay too: a run lands up to them and the rest is thrown
 * away at the gate. Every sheet that says what a run brought back says this as well, or a full
 * yard reads as a stockpile that moved less than the haul for no reason. Nothing on a run that
 * fitted, or on one settled before the rule.
 */
export function WastedAtTheGate({ mission }: { mission: Mission }) {
  const wasted = mission.wasted;
  if (!wasted || Object.keys(wasted).length === 0) return null;
  return (
    <p
      className="break-words font-body text-[12px] leading-snug text-warning"
      data-testid={`mission-wasted-${mission.id}`}
    >
      The stores were full:{' '}
      <span className="tabular-nums">{Math.round(weightOf(wasted)).toLocaleString()}</span> loot of
      what they carried went to waste at the gate ({describeWaste(wasted)}).
    </p>
  );
}

/** Under one resource of a haul: how much of it the full stores threw away. Nothing when none. */
export function WastedOn({ mission, kind }: { mission: Mission; kind: ResourceKey }) {
  const wasted = Math.round(mission.wasted?.[kind] ?? 0);
  if (wasted <= 0) return null;
  return (
    <span
      className="font-display text-[10px] uppercase tracking-[0.12em] text-warning"
      data-testid={`haul-wasted-${kind}`}
    >
      <span className="tabular-nums">{wasted.toLocaleString()}</span> wasted
    </span>
  );
}

/** What of a run's pay actually went into the stores: what came home, less what had no room. */
export function landedOf(mission: Mission): PartialResources {
  const landed: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const kept = (mission.rewards[key] ?? 0) - (mission.wasted?.[key] ?? 0);
    if (kept > 0) landed[key] = kept;
  }
  return landed;
}
