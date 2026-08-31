import { officerRecoverySeconds } from '@frontline/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';

/**
 * An officer's face, from the pool (§C).
 *
 * Separate from `OverseerPortrait` and not a prop on it, because the two are different objects. An
 * overseer portrait is one of four the player *chose* and is shown as a hero image; an officer's is
 * one of ninety-nine drawn from a pool by their id, at 4:5, on a roster card. Sharing a component
 * would mean a prop deciding the aspect, the fallback and the frame, which is three components
 * wearing one name.
 *
 * The fallback is the officer's initial rather than a silhouette: a screen of identical
 * silhouettes says nothing, and a letter at least tells them apart while the art is still landing.
 *
 * §D6's injured state is drawn *here* rather than at the four call sites, so a portrait added
 * tomorrow cannot forget it: an officer who is laid up looks laid up on the crew page, in the crew
 * window and on the training board without any of the three saying so.
 */
export function OfficerPortrait({
  portraitId,
  name,
  injuredUntil,
  className,
  style,
}: {
  /** From `officerPortraitId(officer.id)`. Null while a caller has not resolved one. */
  portraitId: string | null;
  /** For the fallback letter and the accessible name. */
  name: string;
  /**
   * §D4/§D6: when they are back on their feet, or null/undefined for somebody fit.
   *
   * A timestamp rather than a boolean, because the card counts down to it. Optional so a caller
   * drawing a face that can never be hurt (a recruit at the Bar) says nothing at all.
   */
  injuredUntil?: string | null;
  className?: string;
  /** For a caller that needs an aspect the utility classes cannot express. */
  style?: CSSProperties;
}) {
  const painted = portraitId === null ? null : deliveredUrl({ type: 'officer', portraitId });
  // Ticks only while this particular face is hurt, so a crew of nineteen fit officers costs no
  // re-render a second.
  const now = useTick(injuredUntil != null);
  const left = injuredUntil == null ? 0 : officerRecoverySeconds(injuredUntil, new Date(now));
  const injured = left > 0;

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-sm border border-surface-600/70 bg-surface-900',
        injured && 'border-oxblood-500/70',
        className,
      )}
      style={style}
      data-injured={injured ? 'true' : undefined}
    >
      {painted ? (
        <img
          src={painted}
          alt=""
          // The delivery frames the face in the central seventy percent, so any crop keeps it.
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            // Desaturated under the wash rather than only tinted: a red film over a full-colour
            // face reads as a lighting effect, and the point is that this person is out.
            injured && 'grayscale-[0.55]',
          )}
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center font-stamp text-[28px] text-ink-100/25"
        >
          {name.slice(0, 1)}
        </span>
      )}
      {injured ? <InjuredOverlay seconds={left} /> : null}
    </div>
  );
}

/**
 * The red film, the word, and the clock (§D6).
 *
 * Across the middle rather than in a corner, because the state is the headline: a player scanning
 * nineteen cards has to see which of their people are out without reading anything.
 *
 * Drawn as **SVG text on a viewBox** rather than as HTML type, and that is the whole reason this
 * is a separate component. The same portrait is rendered at 44px in the training rail, at 48px in
 * the reassign list and at 14rem in the crew window, and a fixed pixel size that reads well in the
 * window is wider than the rail: it would either overflow or need truncating, and cut text is the
 * one rule this interface does not bend. A viewBox scales the word and the clock to whatever width
 * the frame is, so both always fit exactly and neither is ever clipped.
 */
function InjuredOverlay({ seconds }: { seconds: number }) {
  const clock = formatRecovery(seconds);
  return (
    <>
      <span aria-hidden className="absolute inset-0 bg-oxblood-500/35" />
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-[rgb(24_20_22)]/80 py-[6%]">
        <svg
          viewBox="0 0 100 30"
          role="img"
          aria-label={`Injured, back in ${clock}`}
          className="block w-full"
        >
          <text
            x="50"
            y="12"
            textAnchor="middle"
            className="fill-oxblood-100 font-display font-bold uppercase"
            style={{ fontSize: 11, letterSpacing: 1.4 }}
          >
            Injured
          </text>
          <text
            x="50"
            y="25"
            textAnchor="middle"
            className="fill-ink-300 font-mono"
            style={{ fontSize: 10 }}
          >
            {clock}
          </text>
        </svg>
      </span>
    </>
  );
}

/**
 * A once-a-second clock, running only while it is needed.
 *
 * Local rather than server-corrected, unlike the missions page: a recovery is a day long and this
 * component has no `serverNow` to hand. A few seconds of clock skew on a 24 hour countdown is not
 * something a player can act on, and the server is the only thing that decides whether an officer
 * is actually fit when it matters (`officerIsInjured` on every read path).
 */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** `12h 04m` while it is hours away, `04:31` inside the last hour. Never wider than five glyphs. */
export function formatRecovery(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
