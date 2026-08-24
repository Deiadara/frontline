import { CITY_DISTRICTS } from '@frontline/shared';
import { Icon } from '../../components/ui/Icon';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { Panel } from '../../components/ui/Panel';
import { Quote } from '../../components/ui/Quote';
import { InfoNote, PageShell } from '../game/PageShell';

/**
 * Cities — one of them, so far.
 *
 * A **Coming Soon** screen, and a deliberate one rather than a placeholder. The map a player spends
 * their whole game on is *a* city, and nothing in the interface has ever said so: districts, places
 * and territory are all presented as though this is the world. Naming the containing thing is what
 * turns the map from "the game" into "where you happen to be", which is the entire point of putting
 * this door in before there is a second city behind it.
 *
 * It shows what a player actually holds rather than a blank promise. A coming-soon screen that says
 * only "coming soon" is an apology; one that shows you your own city with the number of districts
 * in it, and then says there will be others, is a plan.
 */
export function CitiesPage() {
  return (
    <PageShell
      title="Cities"
      icon="city"
      quote="Somebody drew a line around this place and called it a city. Nobody has ever shown us the other side of it."
    >
      <InfoNote>
        There is one city, and it is yours to fight over. Others are being built — when they open,
        what you hold here is what you will be travelling out of.
      </InfoNote>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <InfoWindow
          eyebrow="Where you are"
          title="The City"
          tone="brass"
          icon={<Icon name="city" className="h-full w-full text-surface-950" />}
          figure={
            <span className="font-hand text-[24px] leading-none text-brass-100">
              {CITY_DISTRICTS.length} districts
            </span>
          }
        >
          <p className="font-body text-[14px] leading-relaxed text-ink-200">
            Ten districts, the places inside them, and whoever is currently standing on each. Every
            crew you will meet for now lives somewhere on this map.
          </p>
          <WindowSection label="What that gets you">
            <p className="font-body text-[13px] leading-snug text-ink-100">
              Ground here pays for itself: a held place feeds your district, and the two seats of
              Combine power are worth a name that carries.
            </p>
          </WindowSection>
        </InfoWindow>

        <Panel
          title="Not yet"
          action={
            <span className="shrink-0 rounded-sm border border-surface-600 px-2 py-1 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              Coming soon
            </span>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            <Quote>Every road out is somebody else’s road in.</Quote>
            <p className="font-body text-[14px] leading-relaxed text-ink-200">
              More cities are coming. When they do, this screen is where you will pick which one you
              are working in — and crossing between them will cost you time and a convoy, not a
              click.
            </p>
            <p className="font-body text-[13px] leading-snug text-ink-300">
              Nothing you build now is stranded by it. Your district, your crew and your name travel
              with you.
            </p>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
