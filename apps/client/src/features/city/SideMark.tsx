import type { FactionMark, LocationHolderKind } from '@frontline/shared';
import { Icon } from '../../components/ui/Icon';
import { Insignia, hasInsignia } from '../../components/ui/Insignia';
import { FactionBadge } from '../faction/FactionBadge';
import { cn } from '../../lib/cn';

/** Whose side a held place is on, as the map tags colour it (maintainer, 2026-10-07). */
export type Side = 'mine' | 'ally' | 'enemy' | 'unoccupied';

/**
 * The plate colours by side: green for the reader's own crew and their faction, red for anybody
 * else, grey for nobody. It was one colour a party (`HOLDER_SIGN`), five of them; the faction
 * ruling collapses that to the one question a tag answers now, which is whether the ground is
 * yours. The party is told apart by the mark beside the name instead.
 */
export const SIDE_SIGN: Record<Side, string> = {
  mine: 'border-verdigris-300/70 bg-surface-950/85 text-verdigris-100',
  ally: 'border-verdigris-300/70 bg-surface-950/85 text-verdigris-100',
  enemy: 'border-oxblood-500/70 bg-surface-950/85 text-oxblood-300',
  unoccupied: 'border-surface-500/70 bg-surface-950/85 text-ink-200',
};

/**
 * The mark a tag wears beside its name: the holder's faction emblem when they sit at a table, the
 * crew glyph for a crew at none, the looters' or the Combine's own glyph. Nothing on unheld ground.
 *
 * Drawn in the line's own ink (`tone={false}`) rather than the party's: the plate is already red
 * or green for the side, and a yellow pawn on a red plate reads as two parties.
 */
export function SideMark({
  side,
  faction,
  holder,
  className,
}: {
  side: Side;
  faction: FactionMark | null;
  /** The holder's kind, for the glyph when there is no emblem to draw. */
  holder: LocationHolderKind | null;
  /** Size classes for the mark; the badge is sized to the same height in pixels. */
  className?: string;
}) {
  if (side === 'unoccupied') return null;
  if (faction !== null) {
    return (
      <span
        data-testid="side-mark-faction"
        title={faction.name}
        className={cn('inline-flex shrink-0 items-center', className)}
      >
        {/* 100 x 120 field: a 12px wide badge is 14.4px tall, the height of the glyphs beside it. */}
        <FactionBadge badge={faction.badge} size={12} title={faction.name} />
      </span>
    );
  }
  if (holder !== null && hasInsignia(holder)) {
    return <Insignia holder={holder} tone={false} className={className ?? ''} />;
  }
  return (
    <span data-testid="side-mark-crew" className={cn('inline-flex shrink-0', className)}>
      <Icon name="crew" aria-hidden className="h-full w-full" />
    </span>
  );
}
