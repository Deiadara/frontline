import {
  RESOURCE_ORDER as DOMAIN_RESOURCE_ORDER,
  RESOURCE_LORE,
  type PartialResources,
  type ResourceKey,
  type Resources,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { deliveredUrl } from '../assets/delivered';
import { cn } from '../lib/cn';
import { HoverCard } from './ui/HoverCard';
import { InfoWindow, WindowSection } from './ui/InfoWindow';

export type { ResourceKey };

interface ResourceMeta {
  label: string;
  /** Tailwind text-color class (theme tokens only). */
  color: string;
  /** The matching `bg-` class, for the storage bar. Kept beside `color` so the two cannot drift. */
  fill: string;
  icon: ReactNode;
}

const glyph = (path: ReactNode) => (
  <svg viewBox="0 0 16 16" className="h-full w-full" fill="none" aria-hidden="true">
    {/* Sized by the wrapper `ResourceIcon` puts around it: see the note there. */}
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
    fill: 'bg-warning',
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
    fill: 'bg-bile-300',
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
    fill: 'bg-hextech-300',
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
    fill: 'bg-ferrite-300',
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
  planks: {
    label: 'Planks',
    color: 'text-tangerine-300',
    fill: 'bg-tangerine-300',
    /*
     * The procedural fallback, behind `assets/icon-planks.webp`.
     *
     * Every resource keeps one: `ResourceIcon` draws the painted asset when it has landed and this
     * when it has not, so a missing or failed asset degrades to a legible glyph rather than to a
     * gap. Three stacked boards with a binding strap, which is what the painted one shows.
     */
    icon: glyph(
      <>
        <rect
          x="2.2"
          y="4.2"
          width="11.6"
          height="2.6"
          rx="0.6"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <rect
          x="2.2"
          y="7.6"
          width="11.6"
          height="2.6"
          rx="0.6"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <rect
          x="2.2"
          y="11"
          width="11.6"
          height="2.6"
          rx="0.6"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M11.2 3.4v11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </>,
    ),
  },
  highQualityMetal: {
    label: 'HQ Metal',
    color: 'text-ink-100',
    fill: 'bg-ink-200',
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

/** Fixed display order: taken from the shared schema so a new resource cannot be dropped. */
/*
 * Reading order, which is not storage order: `RESOURCE_KEYS` fixes the art seeds and so has to be
 * appended to, while this is about what the numbers mean. Owned by the domain now, because the
 * market and the HUD were both deriving their own and had already drifted once.
 */
export const RESOURCE_ORDER = DOMAIN_RESOURCE_ORDER;

/**
 * One resource's mark: the delivered icon once `icon-<resource>` has landed, the line glyph until
 * then. Both draw in the same 14px box, so a readout with some resources painted and some still
 * procedural keeps its columns.
 *
 * It deliberately sets no colour. The glyph paints in `currentColor` so that {@link CostLine} can
 * turn a line the player cannot afford hostile without knowing which of the two it drew.
 */
export function ResourceIcon({
  kind,
  className = 'h-4 w-4',
}: {
  kind: ResourceKey;
  /** Size classes. Defaults to a readout-sized glyph; the HUD asks for a bigger one. */
  className?: string;
}) {
  const painted = deliveredUrl({ type: 'resource-icon', resource: kind });
  // Wrapped rather than sized in place, so a delivered `<img>` and the procedural `<svg>` fallback
  // are the same size at the same call site. Letting the icon fill its parent instead looked right
  // in the HUD and blew the mission cards' icons up to 400px, because nothing else that draws one
  // constrains its container.
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', className)}>
      {painted === null ? (
        RESOURCE_META[kind].icon
      ) : (
        <img
          src={painted}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain"
          data-testid={`resource-art-${kind}`}
        />
      )}
    </span>
  );
}

interface ResourceChipProps {
  kind: ResourceKey;
  value: number;
  /**
   * What the Apothecary will hold. Omitted where there is no ceiling to show: the readouts that
   * are not the HUD.
   */
  capacity?: number;
}

/**
 * `125000` → `125K`. The exact figure stays in the chip's label and tooltip.
 *
 * Five stockpiles, two meters and an identity share one row, and a late-game player carries
 * six-figure numbers in all five. Spelled out with separators they wrap the bar onto a second line,
 * which costs the artwork ~50px on every screen in the game. A player scanning the bar is asking
 * "roughly how much, and is it going up": a question `125K` answers as well as `125,000` and in
 * half the width. Anyone who wants the digit is one hover away.
 */
export function compactAmount(value: number): string {
  const n = Math.round(value);
  if (Math.abs(n) < 10_000) return n.toLocaleString();
  if (Math.abs(n) < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * How full the Apothecary is, 0-1. Undefined capacity reads as empty rather than as full.
 *
 * Clamped at both ends: raids and mission pay are deliberately *not* clamped to storage (see
 * `applyProduction`), so a district can legitimately sit over its own ceiling, and a bar that
 * rendered 140% would run out of its own track.
 */
export function fillFraction(value: number, capacity: number | undefined): number {
  if (capacity === undefined || capacity <= 0) return 0;
  return Math.max(0, Math.min(1, value / capacity));
}

/** At and above this share of the ceiling, the bar warns: production is about to start spilling. */
export const STORAGE_WARN_AT = 0.9;

/**
 * Icon, value, and how close the ceiling is.
 *
 * The bar underneath is the Grepolis move and it earns its two pixels: "how much do I have" is
 * only half the question a player is asking, and the other half: *am I about to waste what I am
 * producing*: is invisible in a bare number. Production stops dead at the ceiling while raid loot
 * and mission pay still land, so a full stockpile is a real, silent loss that a fill bar turns into
 * something you can see across the room.
 *
 * The chip itself stays compact and wordless. Everything else: the resource's name, the exact
 * figure, the ceiling: lives in the hover card, because five of these plus two meters and an
 * identity have to share one row over the artwork.
 */
export function ResourceChip({ kind, value, capacity }: ResourceChipProps) {
  const meta = RESOURCE_META[kind];
  const amount = Math.round(value);
  const fill = fillFraction(value, capacity);
  const nearlyFull = fill >= STORAGE_WARN_AT;
  const reading =
    capacity === undefined
      ? `${meta.label}: ${amount.toLocaleString()}`
      : `${meta.label}: ${amount.toLocaleString()} of ${Math.round(capacity).toLocaleString()}`;

  /*
   * Icon left, reading right: rather than icon-and-number over a full-width bar.
   *
   * The glyph is the thing a player finds the chip by, so it gets its own lighter tile and four
   * more pixels. Putting the fill bar *beside* the icon instead of under the whole chip is what
   * pays for them: the row is as tall as the tile, the bar sits under the number where it is
   * still read as belonging to it, and the standing bar keeps exactly the height it had. Growing
   * the top of the screen to make an icon bigger would have cost the world below it.
   */
  const chip = (
    <div
      className="resource-chip flex shrink-0 items-center gap-1 rounded-lg px-1 py-1"
      data-testid={`resource-chip-${kind}`}
    >
      {/*
        Tight padding and a slightly smaller number, and that is a fit rather than a taste.
        Six stockpiles, three buttons, two meters and an identity share one line. The sixth
        (§D5b's planks) pushed the row over its width, the identity wrapped to a second line, and
        the 50px that cost came straight out of the screen below: district cards were sliced by
        the bottom nav at 1280.
        The width comes out of the padding and the figure rather than the glyph, deliberately. The
        icons are painted masters and the reason the bar is worth looking at, and shrinking them
        would also shorten the chip: an 8px change in the bar's height moves every screen under it
        past a fold, which is its own class of bug.
      */}
      <span className="resource-well flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
        <ResourceIcon kind={kind} className="resource-art h-11 w-11" />
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span
          className={cn('font-display text-base font-bold leading-none tabular-nums', meta.color)}
        >
          {compactAmount(value)}
        </span>
        {/* Thinner and rounder than it was, and the track is a shadow in the glass rather than a
            black slot: the bar is a reading *on* the chip, not a second component inside it. */}
        {capacity !== undefined && (
          <span className="block h-1 w-full overflow-hidden rounded-full bg-black/35">
            <span
              className={cn(
                'block h-full rounded-full opacity-80 transition-[width] duration-500',
                nearlyFull ? 'bg-oxblood-300' : meta.fill,
              )}
              style={{ width: `${fill * 100}%` }}
              data-testid={`resource-fill-${kind}`}
            />
          </span>
        )}
      </span>
    </div>
  );

  // Without a ceiling there is nothing to explain, so it stays a plain labelled readout rather
  // than growing a control that opens onto one line of text.
  if (capacity === undefined) {
    return (
      <div role="img" aria-label={reading} data-tip={reading}>
        {chip}
      </div>
    );
  }

  const lore = RESOURCE_LORE[kind];

  return (
    <HoverCard
      data-testid={`resource-hover-${kind}`}
      label={reading}
      className="rounded-sm"
      size="window"
      card={
        <InfoWindow
          eyebrow="Stockpile"
          title={meta.label}
          icon={<ResourceIcon kind={kind} className="h-full w-full" />}
          figure={
            <span className="flex items-baseline gap-2">
              <span className={cn('font-display text-2xl font-bold tabular-nums', meta.color)}>
                {amount.toLocaleString()}
              </span>
              <span className="font-display text-base tabular-nums text-ink-300">
                / {Math.round(capacity).toLocaleString()}
              </span>
            </span>
          }
        >
          {/* The bar again, at a size worth reading, since the chip's is 6px tall. */}
          <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950/80">
            <span
              className={cn('block h-full rounded-sm', nearlyFull ? 'bg-oxblood-300' : meta.fill)}
              style={{ width: `${fill * 100}%` }}
            />
          </span>

          <p className="font-body text-[14px] italic leading-relaxed text-ink-200">{lore.what}</p>

          <WindowSection label="Spent on">
            <ul className="flex flex-col gap-0.5">
              {lore.spentOn.map((use) => (
                <li
                  key={use}
                  className="flex gap-2 font-body text-[13px] leading-snug text-ink-100"
                >
                  <span
                    aria-hidden
                    className={cn('mt-[7px] h-1 w-1 shrink-0 rounded-full', meta.fill)}
                  />
                  {use}
                </li>
              ))}
            </ul>
          </WindowSection>

          <WindowSection label="Comes from">
            <p className="font-body text-[13px] leading-snug text-ink-100">{lore.from}</p>
          </WindowSection>

          <p
            className={cn(
              'rounded-sm border-l-2 px-2.5 py-1.5 font-body text-[13px] leading-snug',
              nearlyFull
                ? 'border-oxblood-300 bg-oxblood-500/10 text-oxblood-300'
                : 'border-surface-600 bg-surface-900/50 text-ink-300',
            )}
          >
            {nearlyFull
              ? 'Nearly full. Anything produced above the ceiling is thrown away. Raise the Apothecary.'
              : 'The Apothecary sets the ceiling. Production stops there; raids and pay do not.'}
          </p>
        </InfoWindow>
      }
    >
      {chip}
    </HoverCard>
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
 * button is dead (GDD §D3: oil is the one that usually is).
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
              short ? 'text-oxblood-300' : meta.color,
            )}
          >
            <ResourceIcon kind={kind} />
            <span className="font-semibold tabular-nums">{Math.round(amount)}</span>
            <span className="text-[11px] uppercase tracking-[0.15em] opacity-70">{meta.label}</span>
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
    return <span className="font-display text-xs tracking-[0.15em] text-ink-300">NO SALVAGE</span>;
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
            <ResourceIcon kind={kind} />
            <span className="font-semibold tabular-nums">+{Math.round(amount)}</span>
            <span className="text-[11px] uppercase tracking-[0.15em] opacity-70">{meta.label}</span>
          </span>
        );
      })}
    </div>
  );
}
