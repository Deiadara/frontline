import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { PortraitFrame } from '../../components/ui/PortraitFrame';
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
             * so they always get the height they need; the portrait is `flex-1 min-h-0`, so it
             * takes exactly what is left. On a short viewport the picture gets smaller. Nothing
             * gets cut, at any size.
             *
             * What changed on 2026-09-13 is the frame, and where the shape lives (maintainer request:
             * too much dead space, and no frame). The shape is on the frame now and the painting
             * takes all of the frame, so the drawn edge is the edge of the *picture*. It used to
             * be the edge of the panel with the picture floating in the middle of it, which at
             * 1920 meant a 332px box round a 332px painting and at 720 a 332px box round a 120px
             * one: the same code, and only the second one looked like a mistake.
             *
             * `aspect-square h-full max-w-full` is the shape, and it is a **ceiling on how wide the
             * frame may be, not a square**: `h-full` is the specified height, the ratio fills in
             * the width from it, and `max-w-full` clamps that to the rail. So the frame is as wide
             * as it is tall, or as wide as the rail, whichever is less.
             *
             * Both ends come out right from that one line. At 1920 the rail is the narrow side, so
             * the frame is 332 by 540 and the painting fills it and crops at the sides. At 1280x720
             * the leftover height is 180, so the frame is 180 square and the painting is cropped to
             * two thirds of its height from the top: the whole head, and the coat below it gone.
             *
             * The two things it is not are the two things that were tried first. Filling the panel
             * unconditionally makes the frame 332 by 180 at that viewport, and cover-cropping a
             * 2:3 painting into a box that flat is a band across the eyes. Keeping the delivery's
             * own 2:3 makes it 120 wide, which is the dead space the maintainer reported.
             *
             * `p-2.5` went with the change: a drawn frame hard against the picture is a frame, and
             * 10px of panel between the two is a mount.
             */}
            <div
              data-testid="profile-portrait"
              className="painted washed flex min-h-0 flex-1 justify-center border-b border-surface-600/70"
            >
              <PortraitFrame className="aspect-square h-full max-w-full">
                <OverseerPortrait
                  portraitId={overseer.portraitId}
                  archetype={overseer.archetype}
                  aspect="fill"
                  showTag={false}
                />
              </PortraitFrame>
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
           * Two by two, each group in its own frame (maintainer request).
           *
           * Four groups in one row was a 34-number field read left to right, and it left the
           * bottom half of the screen empty on every viewport taller than about 800px: the sheet
           * was a strip across the top of a page with nothing under it. Two by two is the shape
           * the rest of the game uses for four related panels, it fills the space it is given, and
           * `roomy` puts each group behind its own border so the four read as four things.
           *
           * ## No `FileSection` round it (maintainer request, 2026-09-14)
           *
           * It used to sit inside one titled "Your own sheet", which put four labelled boxes
           * inside a fifth labelled box: the frame said nothing the four frames did not, and the
           * note under it ("every attribute you carry") repeated the page a player had just
           * clicked their own face to reach.
           *
           * It also cost about 120px of height, and that was the real problem. The sheet wants
           * 585px and the column is 611 at 1440x900, so with the wrapper it was 96px over and
           * scrolled on the most ordinary laptop there is, cutting the last three rows off
           * Technical. Without it the whole file is on screen at that size and no bar is drawn.
           *
           * The scroller itself stays, because it is still right below about 1400x850: the sheet
           * cannot shrink to a 768px-tall window and a cut sheet is worse than a scrolled one.
           */}
          <AttributeSheet attributes={overseer.attributes} columns={2} roomy />
        </div>
      </div>
    </PageShell>
  );
}
