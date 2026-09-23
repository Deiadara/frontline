import { PerkTags } from '../../components/PerkTags';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { InkButton } from '../../components/ui/InkButton';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { useCrewStanding } from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';
import { PictureFrame } from './PictureFrame';

/**
 * Who you are (§F1, §F2), drawn as the file somebody keeps on you.
 *
 * Redrawn on 2026-09-23 at the maintainer's request: more of the game's own hand in it, more of a
 * card, and the same paper the feats ledger and the yard are written on, **on the shape the page
 * already had**. The panels are paper, the groups of numbers sit on paper cards under hand-ruled
 * headings, and the painting hangs in a drawn picture frame (`PictureFrame`). Where things are
 * did not move: the person down the left, the picture big and the words under it, the numbers on
 * the right, and the door to the training floor at the foot of the numbers.
 *
 * ## The shape of it
 *
 * The console shape the Training, Research and Bar screens use: a fixed frame, nothing scrolls
 * the page. The painting is shown whole (maintainer, 2026-09-23: "use all of it so it's not cut
 * at all"): the frame is the delivery's own 2:3, and it takes whatever height the words under it
 * leave, so a short viewport gets a smaller painting rather than a cropped one or a scrolling
 * rail. The record on the right fits without a scrollbar from 1440x900 up; below that the
 * thirty-five rows do not fit in the column and it scrolls on its own, which is the one place a
 * bar is still drawn.
 *
 * The crew sheet is best-of across the Overseer and every officer, which is why an officer's good
 * number shows up on *your* file. What the crew is buying with those numbers is its own screen,
 * reached from the crew page.
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
  const archetype = overseer.archetype.charAt(0).toUpperCase() + overseer.archetype.slice(1);

  return (
    <PageShell wide fills>
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/*
         * The person's card, on the left: one paper sheet in the ink frame the feats ledger wears.
         * The picture first, the words under it. The words are `shrink-0` and get the height they
         * need; the picture is `flex-1 min-h-0` and takes what is left, so nothing on the card is
         * ever cut and the card never scrolls.
         */}
        <aside className="flex min-h-0 min-w-0 flex-col" data-testid="profile-rail">
          <section
            className="ink-frame card-paper washed grain relative flex min-h-0 flex-1 flex-col gap-3 rounded-sm p-4 shadow-panel"
            data-testid="profile-portrait"
          >
            <div className="flex min-h-0 flex-1 items-start justify-center">
              {/*
               * The whole painting, framed. The picture box is the delivery's own 2:3, so
               * `object-cover` inside it crops nothing; the frame wraps the box and takes its
               * height from the card, so a short viewport gets a smaller painting rather than a
               * cropped one.
               */}
              <PictureFrame className="max-w-full">
                <span className="block aspect-[2/3] h-full max-w-full">
                  <OverseerPortrait
                    portraitId={overseer.portraitId}
                    archetype={overseer.archetype}
                    aspect="fill"
                    showTag={false}
                  />
                </span>
              </PictureFrame>
            </div>

            <div data-testid="profile-identity" className="flex shrink-0 flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <h1
                  className="break-words font-stamp text-[24px] leading-tight text-ink-100"
                  data-testid="overseer-name"
                >
                  {overseer.name}
                </h1>
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.22em] text-brass-300">
                  Overseer · {archetype}
                </p>
              </div>
              <span aria-hidden className="block h-1.5 w-full text-brass-300/60">
                <DrawnRule />
              </span>
              {/* The biography on a lighter slip of the same paper, the way a note is pinned to a
                  file rather than typed onto it, and the signature in the hand-inked chips. */}
              <p className="card-paper-lit rounded-sm border border-brass-500/25 px-3 py-2.5 font-body text-[13px] italic leading-relaxed text-ink-200">
                {overseer.bio}
              </p>
              <PerkTags perks={overseer.perks} tone="profile" />
            </div>
          </section>
        </aside>

        {/*
         * The record, on the right. `fills` hands the page a fixed frame and this column names
         * itself the scroller for the one case it has to be (see the note at the top); `min-h-0`
         * so a flex child does not grow to its content and leave nothing to scroll.
         */}
        <div
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-0.5"
          data-testid="file-body"
        >
          {/*
           * The numbers, two by two, each group on a paper card of its own under a hand-ruled
           * heading (`paper`). The sheet grows to the column (`flex: 1 0 auto`: it fills what the
           * door leaves and never shrinks below its rows, so where it does not fit the column
           * scrolls instead of clipping). Where the screen is tall enough to hold them (1080) its
           * two rows share that height equally, so the four cards are as big as the screen allows
           * (maintainer, 2026-09-23); on a 900-tall screen equal rows cost the 40px that keep the
           * bar off the column, so the rows keep their own heights there.
           */}
          <div className="flex shrink-0 flex-grow flex-col [&>div]:flex-1 [@media(min-height:1000px)]:[&>div]:grid-rows-[repeat(2,minmax(min-content,1fr))]">
            <AttributeSheet attributes={overseer.attributes} columns={2} roomy paper />
          </div>

          {/*
           * The one thing you can do about any of it, at the foot of the column: the same
           * two-column grid as the sheet, so the door sits under the Social card with the card's
           * left edge, the same 12px under it that separates the two rows of cards, and its
           * bottom edge on the bottom edge of the person's card beside it (maintainer, 2026-09-23).
           */}
          <div className="grid shrink-0 gap-x-5 sm:grid-cols-2">
            <InkButton
              to="/game/training"
              icon="training"
              className="self-stretch"
              data-testid="profile-training-door"
            >
              The training floor
            </InkButton>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
