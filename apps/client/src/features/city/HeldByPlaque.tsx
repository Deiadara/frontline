import type { DistrictDetailResponse } from '@frontline/shared';
import type { CSSProperties } from 'react';
import { PLAQUE_PLATE, PlaqueCorners } from '../../components/DistrictPlaque';
import { DrawnGlyph } from '../../components/ui/DrawnMarks';
import { Insignia, hasInsignia } from '../../components/ui/Insignia';
import { cn } from '../../lib/cn';
import { FactionBadge } from '../faction/FactionBadge';

/**
 * Who holds this district whole, on a plate in the painting's bottom-left corner (maintainer,
 * 2026-09-30): "when you're in the district that someone holds completely, add an icon on the
 * bottom left that has their badge and name and a 'Held by'."
 *
 * The badge is the holder's own mark: the Combine's winged cross and the looters' skull
 * (`Insignia`), a crew's faction badge, or, for a crew at no table, the crew mark in the plate's
 * brass. Nothing is drawn on ground held in pieces or by nobody, which is what `holder` being null
 * means (`districtHolder`).
 *
 * Not a control and not a pointer target: it sits on the painting among the signs, and a plate
 * that ate the pointer would be a sign nobody could press if the two ever met.
 */
export function HeldByPlaque({
  data,
  className,
  style,
}: {
  data: Pick<DistrictDetailResponse, 'holder' | 'holderFaction' | 'locations'>;
  /** Where it hangs: the painting decides, so the caller places it. */
  className?: string;
  style?: CSSProperties;
}) {
  const holder = data.holder;
  const name = data.locations[0]?.holderName;
  if (!holder || name === undefined) return null;
  return (
    <div
      className={cn(PLAQUE_PLATE, 'pointer-events-none !items-start', className)}
      style={style}
      data-testid="held-by"
      data-holder={holder.kind}
    >
      <PlaqueCorners />
      <span className="font-display text-[9px] font-bold uppercase leading-none tracking-[0.22em] text-brass-300 text-on-art">
        Held by
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center"
          data-testid={`held-by-mark-${
            hasInsignia(holder.kind) ? holder.kind : data.holderFaction ? 'faction' : 'crew'
          }`}
        >
          {hasInsignia(holder.kind) ? (
            <Insignia holder={holder.kind} className="h-6 w-6" />
          ) : data.holderFaction ? (
            <FactionBadge badge={data.holderFaction.badge} size={24} />
          ) : (
            <DrawnGlyph name="crew" className="h-5 w-5 text-brass-300" />
          )}
        </span>
        <span
          className="max-w-[14rem] break-words font-stamp text-[15px] leading-tight text-brass-100 text-on-art"
          data-testid="held-by-name"
        >
          {name}
        </span>
      </span>
    </div>
  );
}
