import { findPlayerUnlock, type GatedArea } from '@frontline/shared';
import { Icon } from './Icon';
import { InfoWindow, WindowSection } from './InfoWindow';

/**
 * The sign on a door that has not opened yet (§I3).
 *
 * The board's rule, and it is the right one: **a locked door says what unlocks it rather than
 * vanishing.** A screen that is simply absent teaches a player that the game is smaller than it is,
 * and then reappears one day with no explanation. A screen that is visible and shut teaches them
 * what they are levelling *towards*, which is the only reason to have gates at this depth at all.
 *
 * So this is a whole screen rather than a toast: the name of the place, what is behind it, and the
 * one number that opens it, in the same painted window the game explains everything else in.
 */
export function LockedDoor({ area, level }: { area: GatedArea; level: number }) {
  const unlock = findPlayerUnlock(area);
  // Unreachable while `GATED_AREAS` and the catalogue are built from the same table, and still
  // handled: a blank screen is the worst possible answer to "why can I not get in".
  const name = unlock?.name ?? 'This door';
  const opensAt = unlock?.level ?? 0;

  return (
    // The chrome floats over the top and bottom of this box, so the sign is inset by the measured
    // height of both: the same two custom properties `PageShell` reads. Without them the window is
    // centred on the *viewport* and its heading disappears behind the HUD, which is precisely the
    // failure a locked door must not have: the one thing it exists to say is its own name.
    //
    // `items-start`, not `items-center`: a scroll container that centres its child clips the top of
    // anything taller than the box, and there is no scrolling back up to it.
    <div
      className="flex h-full w-full items-start justify-center overflow-y-auto px-4"
      style={{
        paddingTop: 'calc(var(--hud-h, 96px) + 24px)',
        paddingBottom: 'calc(var(--nav-h, 104px) + 24px)',
      }}
    >
      <div className="w-full max-w-md">
        <InfoWindow
          eyebrow="Not yet"
          title={name}
          tone="oxblood"
          icon={<Icon name="lock" className="h-full w-full text-surface-950" />}
          figure={
            <span className="font-stamp text-[18px] leading-none text-oxblood-100">
              Opens at level {opensAt}
            </span>
          }
        >
          <p className="font-body text-[14px] leading-relaxed text-ink-200">
            {unlock?.description ?? 'Somebody will let you in eventually.'}
          </p>
          <WindowSection label="Where you stand">
            <p className="font-body text-[13px] leading-snug text-ink-100">
              You are level <span className="tabular-nums text-brass-300">{level}</span>.{' '}
              {level >= opensAt
                ? 'The door should be open. Reload the page.'
                : `${opensAt - level} more and this is yours.`}
            </p>
          </WindowSection>
          <p className="font-body text-[13px] leading-snug text-ink-300">
            Levels come off missions, fights, finished builds, finished research, a batch off the
            bench and anybody you sign at the Bar. Nothing here needs waiting out on purpose.
          </p>
        </InfoWindow>
      </div>
    </div>
  );
}
