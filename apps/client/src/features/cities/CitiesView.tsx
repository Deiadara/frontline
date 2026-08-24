import { CITY_DISTRICTS } from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { Panel } from '../../components/ui/Panel';
import { Quote } from '../../components/ui/Quote';

/**
 * The step back from the map: every city there is, which is one of them so far.
 *
 * Not a page. It used to be a door in the scenery switcher beside the city map, which made "the
 * world" and "the city you are standing in" two places a player navigates *between*, when they are
 * the same place at two zoom levels. It is a view of `/game` now: the map has a control that pulls
 * the camera out to here, and the city on this screen puts it back. Nothing about the route
 * changes, so going out and back in is not a page load and does not lose the district you had
 * selected.
 *
 * It shows what a player actually holds rather than a blank promise. A coming-soon screen that says
 * only "coming soon" is an apology; one that shows you your own city with the number of districts
 * in it, and then says there will be others, is a plan.
 */
export function CitiesView({ onEnterCity }: { onEnterCity: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Quote className="max-w-prose">
        Somebody drew a line around this place and called it a city. Nobody has ever shown us the
        other side of it.
      </Quote>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* The way back in, and it is the *city* that is the control: a player who has zoomed out
            reaches for the thing they zoomed out of, not for a button labelled with the opposite of
            what they just pressed. */}
        <button
          type="button"
          onClick={onEnterCity}
          data-testid="enter-city"
          className="rounded-md text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none"
        >
          <InfoWindow
            eyebrow="Where you are"
            title="The City"
            tone="brass"
            icon={<Icon name="city" className="h-full w-full text-surface-950" />}
            figure={
              <span className="font-stamp text-[18px] leading-none text-brass-100">
                {CITY_DISTRICTS.length} districts
              </span>
            }
          >
            <p className="font-body text-[14px] leading-relaxed text-ink-200">
              Ten districts, the places inside them, and whoever is currently standing on each.
              Every crew you will meet for now lives somewhere on this map.
            </p>
            <WindowSection label="What that gets you">
              <p className="font-body text-[13px] leading-snug text-ink-100">
                Ground here pays for itself: a held place feeds your district, and the two seats of
                Combine power are worth a name that carries.
              </p>
            </WindowSection>
            <span className="flex items-center gap-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300">
              <Icon name="city" aria-hidden className="h-4 w-4" />
              Go back in
            </span>
          </InfoWindow>
        </button>

        <Panel
          title="Not yet"
          action={
            <span className="shrink-0 rounded-sm border border-surface-600 px-2 py-1 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              Coming soon
            </span>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="font-body text-[14px] leading-relaxed text-ink-200">
              More cities are coming. When they do, this is where you will pick which one you are
              working in, and crossing between them will cost you time and a convoy, not a click.
            </p>
            <p className="font-body text-[13px] leading-snug text-ink-300">
              Nothing you build now is stranded by it. Your district, your crew and your name travel
              with you.
            </p>
          </div>
        </Panel>
      </div>

      <div>
        <Button variant="ghost" onClick={onEnterCity}>
          Back to the map
        </Button>
      </div>
    </div>
  );
}
