import type { PartialResources, Resources } from '@frontline/shared';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type ResourceKey = keyof Resources;

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

export const RESOURCE_META: Record<ResourceKey, ResourceMeta> = {
  credits: {
    label: 'Credits',
    color: 'text-warning',
    icon: glyph(
      <>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      </>,
    ),
  },
  power: {
    label: 'Power',
    color: 'text-neon-cyan',
    icon: glyph(<path d="M9 1 3 9h4l-1 6 6-9H8z" fill="currentColor" />),
  },
  data: {
    label: 'Data',
    color: 'text-steel-200',
    icon: glyph(
      <>
        <ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth="1.4" />
      </>,
    ),
  },
  alloy: {
    label: 'Alloy',
    color: 'text-steel-400',
    icon: glyph(
      <path
        d="M8 2 14 5v6L8 14 2 11V5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />,
    ),
  },
};

/** Fixed display order (typed so it stays in sync with the shared shape). */
export const RESOURCE_ORDER: readonly ResourceKey[] = ['credits', 'power', 'data', 'alloy'];

interface ResourceChipProps {
  kind: ResourceKey;
  value: number;
}

/** Compact icon + label + value chip for the HUD and readouts. */
export function ResourceChip({ kind, value }: ResourceChipProps) {
  const meta = RESOURCE_META[kind];
  return (
    <div className="flex items-center gap-2 border border-steel-700 bg-night px-3 py-1.5">
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

/** Inline "+120 alloy · +60 credits" style reward line for partial bundles. */
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
