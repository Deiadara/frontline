import {} from '@frontline/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { useCrewStanding } from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';
import { PerkTags } from '../../components/PerkTags';

/**
 * Who you are, and what the people around you are worth (§F1, §F2).
 *
 * The second half is the part that did not exist. A sheet of thirty-five numbers is unreadable
 * unless it says what the numbers *do*, and until now they did nothing at all, so this page is
 * built the other way round from a character sheet: it leads with the outcomes, and each outcome
 * names the attributes that moved it and the crew's rating in each. A player asking "why is my
 * research slow" gets the answer on one line, along with who they would need to hire to fix it.
 *
 * The crew sheet is best-of across the Overseer and every officer, which is why an officer's good
 * number shows up here as *yours*. That is the point of hiring one.
 *
 * ## The shape of it
 *
 * A fixed frame with the person down the left and their numbers in the middle, the same console
 * shape the Training, Research and Bar screens use. It was a scrolling document, and the twenty-two
 * outcome rows are the longest thing on it: the radar that reads them ended up stranded in a
 * column beside a list that ran off the bottom of the screen.
 */

/**
 * What each outcome touches, so twenty-two rows read as three kinds of thing.
 *
 * A `Record` over the channel union rather than a lookup with a fallback: a channel added to
 * `EFFECT_CHANNELS` and not grouped here is a **compile error**, which is the only kind of
 * exhaustiveness worth relying on. A `?? 'district'` would have shipped the next one silently in
 * the wrong bucket.
 */
/** A section of the file: a plated mark, a name, a drawn rule, and what is under it. */
function FileSection({
  icon,
  title,
  note,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // A drawn sheet rather than a heading over loose content: the file now holds one section, and
    // a bare rule with a grid under it read as the page having failed to finish loading. Same
    // frame the faction, standings and training screens use.
    <section className="ink-frame card-paper washed flex min-w-0 flex-col gap-2.5 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
          >
            <Icon name={icon} />
          </span>
          <h2 className="min-w-0 flex-1 font-stamp text-[17px] leading-tight text-ink-100">
            {title}
          </h2>
          {action}
        </div>
        <span aria-hidden className="ink-rule block w-full" />
        {note !== undefined && (
          <p className="font-body text-[12px] leading-snug text-ink-300">{note}</p>
        )}
      </header>
      {children}
    </section>
  );
}

export function OverseerProfilePage() {
  const query = useCrewStanding();

  const data = query.data;
  if (!data) {
    return (
      <ScreenLoad
        what="Your file"
        loading="Reading the file…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { overseer } = data;

  return (
    <PageShell wide fills>
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
        {/* Who. The one block on the screen that is about the person rather than the numbers. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Panel className="flex min-h-0 flex-1 flex-col border border-surface-500/70">
            {/*
             * The portrait takes what the words leave, and the words are never cut.
             *
             * Two earlier attempts got this the wrong way round. Capping the portrait at `30vh` and
             * hiding the overflow cut the bottom third off a painting of a person. Sizing it off
             * the viewport instead (`33vh` of width for `44vh` of height) showed the whole painting
             * and pushed the biography into a scroll, where it was bisected mid-sentence at the
             * panel's edge, which is the same bug wearing different clothes.
             *
             * Neither is a layout. The name, the rule, the biography and the perks are `shrink-0`,
             * so they always get the height they need; the portrait is `flex-1 min-h-0` with
             * `aspect="fill"`, so it takes exactly what is left and fits the whole image into it.
             * On a short viewport the picture gets smaller. Nothing gets cut, at any size.
             */}
            <div
              data-testid="profile-portrait"
              className="painted washed edge-lit flex min-h-0 flex-1 justify-center border-b border-surface-600/70 p-2.5"
            >
              <OverseerPortrait
                portraitId={overseer.portraitId}
                archetype={overseer.archetype}
                aspect="fill"
                showTag={false}
              />
            </div>
            <div data-testid="profile-identity" className="flex shrink-0 flex-col gap-2.5 p-3.5">
              <div>
                <h1
                  className="break-words font-stamp text-[20px] leading-tight text-ink-100"
                  data-testid="overseer-name"
                >
                  {overseer.name}
                </h1>
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                  Overseer
                </p>
              </div>
              <span aria-hidden className="ink-rule block w-full" />
              <p className="font-body text-[13px] italic leading-relaxed text-ink-200">
                {overseer.bio}
              </p>
              <PerkTags perks={overseer.perks} tone="profile" />
            </div>
          </Panel>

          {/* The one thing you can do about any of it, at the foot of the rail. */}
          <Link
            to="/game/training"
            className="door-tile mt-auto flex shrink-0 items-center justify-center gap-2 rounded-md border border-brass-500/60 px-3 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-all duration-150 hover:-translate-y-0.5 hover:border-brass-300 hover:text-brass-100"
          >
            <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
              <Icon name="training" />
            </span>
            <span className="relative z-[2]">Training</span>
          </Link>
        </div>

        <div
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto"
          data-testid="file-body"
        >
          {/*
           * Two by two, each group in its own frame (board request).
           *
           * Four groups in one row was a 34-number field read left to right, and it left the
           * bottom half of the screen empty on every viewport taller than about 800px: the sheet
           * was a strip across the top of a page with nothing under it. Two by two is the shape
           * the rest of the game uses for four related panels, it fills the space it is given, and
           * `roomy` puts each group behind its own border so the four read as four things.
           */}
          <FileSection
            icon="crew"
            title="Your own sheet"
            note="Every attribute you carry, whatever your role"
          >
            <AttributeSheet attributes={overseer.attributes} columns={2} roomy />
          </FileSection>
        </div>
      </div>
    </PageShell>
  );
}
