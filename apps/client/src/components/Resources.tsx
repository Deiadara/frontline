import {
  RESOURCE_KEYS,
  type PartialResources,
  type ResourceKey,
  type Resources,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type { ResourceKey };

interface ResourceMeta {
  label: string;
  /** Tailwind text-color class (theme tokens only). */
  color: string;
  icon: ReactNode;
}

const glyph = (path: ReactNode) => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
    {path}
  </svg>
);

/**
 * GDD §D. Scrap and high-quality metal are deliberately different materials (§D6), so they read
 * apart at a glance: dull ferrite shards against bright milled ingots.
 */
export const RESOURCE_META: Record<ResourceKey, ResourceMeta> = {
  caps: {
    label: 'Caps',
    color: 'text-warning',
    icon: glyph(
      <>
        <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M8 2.4v1.4M8 12.2v1.4M2.4 8h1.4M12.2 8h1.4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </>,
    ),
  },
  food: {
    label: 'Food',
    color: 'text-bile-300',
    icon: glyph(
      <>
        <rect x="4" y="3.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4.4 6.2h7.2" stroke="currentColor" strokeWidth="1.2" />
      </>,
    ),
  },
  oil: {
    label: 'Oil',
    color: 'text-hextech-300',
    icon: glyph(
      <path
        d="M8 1.8c2.6 3 4.2 5.1 4.2 7a4.2 4.2 0 1 1-8.4 0c0-1.9 1.6-4 4.2-7z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />,
    ),
  },
  scrap: {
    label: 'Scrap',
    color: 'text-ferrite-300',
    icon: glyph(
      <>
        <path
          d="M2.4 9.4 6 3.2l3 3.6-1.5 2.6z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M8.2 13 11 7.6l3 2.4-1.2 3z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </>,
    ),
  },
  highQualityMetal: {
    label: 'HQ Metal',
    color: 'text-steel-100',
    icon: glyph(
      <>
        <path
          d="M3 10.6 8 8.4l5 2.2-5 2.2z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M4.4 6.6 8 5l3.6 1.6L8 8.2z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </>,
    ),
  },
};

/** Fixed display order — taken from the shared schema so a new resource cannot be dropped. */
export const RESOURCE_ORDER: readonly ResourceKey[] = RESOURCE_KEYS;

interface ResourceChipProps {
  kind: ResourceKey;
  value: number;
}

/** Compact icon + label + value chip for the HUD and readouts. */
export function ResourceChip({ kind, value }: ResourceChipProps) {
  const meta = RESOURCE_META[kind];
  return (
    <div className="flex shrink-0 items-center gap-2 border border-steel-700 bg-night px-2.5 py-1.5">
      <span className={meta.color}>{meta.icon}</span>
      <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-400">
        {meta.label}
      </span>
      <span className={cn('font-display text-sm font-semibold tabular-nums', meta.color)}>
        {Math.round(value)}
      </span>
    </div>
  );
}

interface ResourceGridProps {
  resources: Resources;
  className?: string;
}

/** Two-column readout of a full stockpile. */
export function ResourceGrid({ resources, className }: ResourceGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {RESOURCE_ORDER.map((kind) => (
        <ResourceChip key={kind} kind={kind} value={resources[kind]} />
      ))}
    </div>
  );
}

/**
 * What a purchase costs, against what is in the vault. A line the stockpile cannot cover is drawn
 * in the hostile ramp, so the player reads *which* material is short rather than only that the
 * button is dead (GDD §D3 — oil is the one that usually is).
 */
export function CostLine({ cost, stock }: { cost: PartialResources; stock: Resources }) {
  const entries = RESOURCE_ORDER.filter((kind) => (cost[kind] ?? 0) > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {entries.map((kind) => {
        const amount = cost[kind] ?? 0;
        const meta = RESOURCE_META[kind];
        const short = stock[kind] < amount;
        return (
          <span
            key={kind}
            className={cn(
              'flex items-center gap-1.5 font-display text-xs',
              short ? 'text-neon-magenta' : meta.color,
            )}
          >
            {meta.icon}
            <span className="font-semibold tabular-nums">{Math.round(amount)}</span>
            <span className="text-[10px] uppercase tracking-[0.15em] opacity-70">{meta.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Inline "+120 scrap · +60 caps" style reward line for partial bundles. */
export function RewardLine({ rewards }: { rewards: PartialResources }) {
  const entries = RESOURCE_ORDER.filter(
    (kind): kind is ResourceKey => (rewards[kind] ?? 0) > 0,
  ).map((kind) => ({ kind, amount: rewards[kind] ?? 0 }));

  if (entries.length === 0) {
    return (
      <span className="font-display text-xs tracking-[0.15em] text-steel-500">NO SALVAGE</span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {entries.map(({ kind, amount }) => {
        const meta = RESOURCE_META[kind];
        return (
          <span
            key={kind}
            className={cn('flex items-center gap-1.5 font-display text-xs', meta.color)}
          >
            {meta.icon}
            <span className="font-semibold tabular-nums">+{Math.round(amount)}</span>
            <span className="text-[10px] uppercase tracking-[0.15em] opacity-70">{meta.label}</span>
          </span>
        );
      })}
    </div>
  );
}
