import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_EFFECTS,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_LABELS,
  importanceOf,
  MAX_ATTRIBUTE,
  OVERSEER_SUBJECT,
  CHANNEL_LABELS,
  TRAINING_DRILLS,
  contributionOf,
  drillCancelWindowMs,
  drillProgressAt,
  drillRemainingMs,
  trainingGainFor,
  type AttributeGroup,
  type AttributeName,
  type TrainingSession,
  type TrainingSubject,
} from '@frontline/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { RATING_FILL, RATING_TEXT, ratingBand, ratingPercent } from '../../lib/rating';
import { useCancelDrill, useStartTraining, useTraining } from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { PageShell, ScreenLoadSheet } from '../game/PageShell';
import { DrillSigil } from './DrillSigil';
import { OfficerPortrait } from './OfficerPortrait';
import { OverseerPortrait } from './OverseerPortrait';
import { IMPORTANCE_EDGE } from '../../lib/importance';

/**
 * The Training tab (§F2).
 *
 * Five hours a day, spread over whoever you like, and the one rule that makes it a decision rather
 * than an allocation: nobody drills the same thing twice running. So the screen is built around
 * *choosing*, not around spending. Pick a person on the left, and the whole attribute sheet opens
 * on the right with what each hour would actually be, what it would buy, and which one is closed
 * to them today because they did it last time.
 *
 * Every attribute names its drill and its effect, because a player choosing between Cryptography
 * and Logic is choosing between two sentences about their crew, and "+2 Cryptography" is not one
 * of them.
 */

/** Where the sheet is cut, and how many rows that leaves under the cut. */
interface Fold {
  /** Height that ends on a row boundary; `undefined` while every row fits. */
  readonly height: number | undefined;
  /** Rows below the cut, which the line under the sheet has to own up to. */
  readonly hidden: number;
}

const WHOLE: Fold = { height: undefined, hidden: 0 };

/**
 * Cut the sheet on a row boundary, and count what that leaves below.
 *
 * The sheet is a fixed region with a floor under it, and on a short viewport thirty-three rows do
 * not fit: eleven Technical rows want 455px and a 900-tall laptop has 399 for them. It was a
 * scrolling region already, so nothing was unreachable, but the cut landed wherever the frame
 * happened to end, which sliced the last visible row through the middle of its digits and gave a
 * player no sign at all that there was more under it. That reads as a rendering fault, which is
 * the failure the maintainer reported.
 *
 * Same move as the overseer roster on the character select screen, and for the same reason: end on
 * a boundary, so an overflowing sheet simply shows fewer whole rows, and say how many were dropped.
 *
 * All four columns start at the same y and use the same row pitch, so a boundary taken from one is
 * a boundary in all of them. Below `xl` the grid is two columns and the second grid row starts
 * under the tallest of the first, which is past every boundary this can choose while the first row
 * is still overflowing.
 */
function measureFold(sheet: HTMLElement, hint: HTMLElement | null): Fold {
  const rows = [...sheet.querySelectorAll<HTMLElement>('[data-testid^="drill-"]')];
  if (rows.length === 0) return WHOLE;

  const frame = sheet.parentElement;
  if (!frame) return WHOLE;

  // Content coordinates rather than viewport ones: the sheet may already be scrolled when a
  // resize brings this back round.
  const top = sheet.getBoundingClientRect().top - sheet.scrollTop;
  const bottoms = rows.map((row) => row.getBoundingClientRect().bottom - top);

  /*
   * Whether there is a fold at all is judged against the *whole* frame, and only then is the
   * line's own height taken off what is left.
   *
   * Measuring both against `room - hint` makes the line self-sustaining: at 1600x900 the sheet
   * fits by two pixels, the line appears for one frame on some other transition, and from then on
   * the twenty-one pixels it occupies are exactly what keeps the last row under the cut.
   */
  const room = frame.clientHeight;
  /*
   * How deep the drills actually go, not how tall the columns are drawn.
   *
   * This read the tallest column's box until 2026-09-21, which was the same number while the
   * columns hugged their rows and stopped being it the moment they were set to fill the sheet:
   * a stretched column is exactly as tall as the room it is in, so `tallest <= room` was true on
   * every screen, no fold was ever found, and the browser went back to slicing the last row in
   * half. The deepest row's bottom edge is the figure that was always meant, and it is right
   * either way.
   */
  const deepest = Math.max(...bottoms);
  if (deepest <= room + 0.5) return WHOLE;

  // The line is drawn inside the frame, so it spends the space it advertises.
  const available = room - (hint?.offsetHeight ?? 0);

  const boundaries = [...new Set(bottoms)].sort((a, b) => a - b);
  // A row taller than the frame has nowhere to go but scroll; never collapse to nothing.
  const height = boundaries.filter((bottom) => bottom <= available + 0.5).at(-1) ?? available;
  return { height, hidden: bottoms.filter((bottom) => bottom > height + 0.5).length };
}

export function TrainingPage() {
  const query = useTraining();
  const start = useStartTraining();
  const cancel = useCancelDrill();
  // A number, because the drill clock is arithmetic on epoch milliseconds and `useServerClock`
  // hands back a Date.
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt).getTime();
  const [chosen, setChosen] = useState<string>(OVERSEER_SUBJECT);
  /** The drill a player has opened, if any. Clicking a row opens it; it never trains. */
  const [opened, setOpened] = useState<AttributeName | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [fold, setFold] = useState<Fold>(WHOLE);

  const data = query.data;
  // The sheet is not in the tree until the gym answers, and an effect that ran before it was
  // there registered no observer and then never came back: the fold measured nothing at all.
  const ready = data !== undefined;

  // Re-runs when the line under the sheet appears or disappears, because that changes the room
  // left for rows. Re-measuring on the sheet as well as the frame catches the font swap and a
  // change of subject, both of which move the rows without resizing anything else.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const frame = sheet?.parentElement;
    if (!sheet || !frame) return undefined;

    const measure = () => {
      const next = measureFold(sheet, hintRef.current);
      setFold((previous) =>
        previous.height === next.height && previous.hidden === next.hidden ? previous : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [fold.hidden, chosen, ready]);

  if (!data) {
    return (
      <ScreenLoadSheet
        what="The gym"
        loading="Finding the gym…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const subject = data.subjects.find((one) => one.id === chosen) ?? data.subjects[0];
  // One bench until the Professor's Second Chair (`TRAINING_BENCHES`): a full floor dims every
  // drill on every sheet, the way an empty allowance does.
  const onTheFloor = data.subjects.filter((one) => one.session !== null).length;
  const floorFull = onTheFloor >= data.benches;

  return (
    <PageShell quote="A little practice saves a great deal of blood." wide fills>
      {/* The crew screen's line (maintainer, 2026-09-21), carrying the one number this screen
          has that the rail and the sheet do not: how many may be on the floor at once. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3" data-testid="training-floor-line">
        <span className="font-display text-[12px] uppercase tracking-[0.18em] text-ink-300">
          <span className="tabular-nums text-ink-200">{onTheFloor}</span> of{' '}
          <span className="tabular-nums text-ink-200">{data.benches}</span>{' '}
          {data.benches === 1 ? 'bench' : 'benches'} in use
        </span>
        <span aria-hidden className="ink-rule block min-w-0 flex-1" />
      </div>
      {/*
       * One frame, two columns, and one thing in it that moves.
       *
       * The page used to stack: a note, then the day, then the sheet, all inside a unit that
       * scrolled. That put a hundred and ten pixels of standing chrome above the only thing
       * anybody comes here to read, and it meant picking the fourth officer scrolled the sheet
       * you were comparing them against off the top of the screen.
       *
       * So the frame is fixed and the roster rail is the only region that scrolls. The rail's
       * two standing blocks, the day and the note, sit under it rather than above the sheet:
       * both are things you read once, and the bottom-left corner is where a screen puts what it
       * does not want you looking at.
       *
       * `items-stretch` and two `min-h-0` columns are what keep the two sides aligned top and
       * bottom at every height. Without `min-h-0` a flex child refuses to shrink below its
       * content and the whole frame grows a scrollbar again, which is the failure this is for.
       */}
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Who, and the two standing notes under them. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/*
           * `min-h-0` and *no* `flex-1`: the panel is as tall as the crew in it, and shrinks (and
           * scrolls) only when the crew is taller than the rail. Growing it to fill instead put a
           * framed sheet of empty tin under two officers, which is the same wasted space this
           * layout was meant to remove, moved from the top of the screen to the left of it.
           */}
          {/*
           * The roster runs from the top of the rail down to the day, whatever the crew's size.
           *
           * A panel that hugged two officers left the rail reading as three small cards floating
           * in a column. A section with a floor is a *place* the crew lives in: it says how many
           * more would fit before it starts scrolling, and it gives the two blocks under it
           * something to sit against.
           */}
          {/* No heading on it either (maintainer, 2026-09-17). "On the books" named a rail that is
              already a column of faces with names under them, and the word for that list is the
              list. The sheet is the feats board's: inked frame, dark paper, wash and grain. */}
          <Panel tone="paper" className="min-h-0 flex-1">
            {/* The one scrolling region on the screen. A crew of fifteen officers has to be
                reachable without the sheet beside them moving a pixel.

                Padded on every side so the scrollbar is drawn inside the frame: brass on ink over
                a drawn border reads as a tear down the edge of the sheet. */}
            <ul
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
              data-testid="training-subjects"
            >
              {data.subjects.map((one) => (
                <li key={one.id}>
                  <SubjectRow
                    subject={one}
                    selected={one.id === subject?.id}
                    now={now}
                    onSelect={() => setChosen(one.id)}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          {/* The day, as hours chalked on the wall by the door, at the foot of the rail.
              No heading on it: five brass strokes and `3 / 5` are already the sentence, and the
              words over them were a line of chrome saying what the drawing said. The paragraph
              explaining the rules went with them: it was read once and then sat there for good.
              No `mt-auto` either, because the roster above is `flex-1` and grows into whatever
              this does not use. */}
          <div
            className="ink-frame card-paper washed flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
            data-testid="training-day"
          >
            <div className="flex items-end gap-1.5" data-testid="training-allowance">
              {/* Spent from the **right**, which is the way every meter a player has ever seen
                  empties: a bar drains towards its start, and the lit run on the left is what is
                  left. Lighting the tail instead read as "three sessions have arrived" rather than
                  "three are gone".

                  Drawn as chalk strokes rather than as five grey rectangles: they are hours on a
                  wall, and a spent one is struck through the way a spent one is. */}
              {Array.from({ length: data.perDay }, (_, index) => {
                const left = index < data.sessionsLeft;
                return (
                  <span key={index} aria-hidden className="relative block h-5 w-2.5">
                    <span
                      className={cn(
                        'absolute inset-x-0 bottom-0 block h-5 rounded-[2px] transition-all duration-200',
                        left
                          ? 'bg-brass-300 shadow-brass'
                          : 'bg-surface-700 ring-1 ring-inset ring-surface-600',
                      )}
                    />
                    {!left && (
                      <span className="absolute left-1/2 top-1/2 block h-[2px] w-4 -translate-x-1/2 -translate-y-1/2 -rotate-[38deg] rounded-full bg-ink-500/80" />
                    )}
                  </span>
                );
              })}
            </div>
            <span className="ml-auto font-display text-[12px] uppercase tracking-[0.12em] tabular-nums text-ink-200">
              {data.sessionsLeft} / {data.perDay}
            </span>
          </div>
        </div>

        {/* What. */}
        {subject && (
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {/*
             * At the bench: who is up, and what they are doing with the hour.
             *
             * The portrait is here as well as on the rail because this block is the answer to
             * "whose sheet am I looking at", and thirty-three rows below it is a long way for a
             * name at the top to carry on its own.
             */}
            {/*
             * The banner is fixed furniture, so every pixel it takes is a pixel off the sheet.
             *
             * It gave up its own progress bar and the drill's sentence on 2026-09-21, when the
             * floor strip arrived at the foot of the sheet. Both were duplicates by then: the bar
             * is down there for this person and for everyone else at once, and the sentence is in
             * the drill's own dialog, which is where a player who wants to know what the hour is
             * for goes anyway. What the banner keeps is what nothing else says, which is who is
             * selected, what they are on, and the way to call it off.
             *
             * That is not tidiness. At 1024x768 the sheet had been squeezed down to a single
             * sliced drill row with thirty-five under the fold, which is the failure the fold was
             * built to prevent rather than a use of it.
             */}
            <div className="ink-frame ink-frame-brass card-paper washed relative flex shrink-0 items-center gap-3 overflow-hidden px-3 py-2 shadow-panel">
              {/*
               * And gone altogether on a short screen.
               *
               * A height query rather than a width one, because height is what this costs: the
               * portrait is the tallest thing in the banner, and at 1280x720 the banner was 95px
               * of standing chrome above a sheet with two drill rows left in it. The rail on the
               * left already draws this person's face, ringed in brass because they are the one
               * selected, and the strip at the foot of the sheet draws it again while they are on
               * an hour. On a tall screen it stays: the room is there, and a face at the top of
               * the sheet is the answer to "whose numbers are these".
               */}
              <span className="w-12 shrink-0 [@media(max-height:820px)]:hidden sm:w-14">
                {/* The Overseer wears the portrait they chose; an officer wears one off the
                    pool, at that pool's own 4:5 rather than the overseer frame's 3:4. */}
                {subject.officerRole === null ? (
                  <OverseerPortrait
                    portraitId={subject.portraitId ?? ''}
                    archetype="enforcer"
                    showTag={false}
                  />
                ) : (
                  <OfficerPortrait
                    portraitId={subject.portraitId}
                    name={subject.name}
                    injuredUntil={subject.injuredUntil}
                    className="aspect-[4/5] w-full"
                  />
                )}
              </span>

              {/*
               * One wrapping line rather than a stack (2026-09-21).
               *
               * The banner was a card: name, role, a rule, the drill, a bar under it and the
               * drill's sentence under that. The bar and the sentence went when the floor strip
               * arrived, which left three stacked lines carrying about a dozen words, and the
               * sheet under them paying seventy pixels for the arrangement. A title bar says the
               * same thing in one line and the ruled gap between the name and the drill is doing
               * the work the stack was: it separates whose sheet this is from what they are on.
               */}
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="break-words font-stamp text-lg leading-tight text-ink-100">
                  {subject.name}
                </h2>
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
                  {subject.role}
                </p>
                {/* Ruled between the two, never under them: the drawn line takes the slack and
                    stops where the next word starts. */}
                <span aria-hidden className="ink-rule block min-w-4 flex-1" />

                {subject.session ? (
                  <div
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                    data-testid="training-in-flight"
                  >
                    <span className="min-w-0 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-ink-100">
                      {TRAINING_DRILLS[subject.session.attribute].title}
                    </span>
                    <span className="shrink-0 font-display text-base font-bold tabular-nums text-brass-300">
                      {formatRemaining(drillRemainingMs(subject.session, now))}
                    </span>
                    {/* Its own line when it is there at all: the cancel carries a sentence about
                        how long is left to decide, and that does not belong beside a countdown
                        saying something different. */}
                    <span className="w-full">
                      <DrillCancel
                        session={subject.session}
                        now={now}
                        pending={cancel.isPending}
                        onCancel={(sessionId) => cancel.mutate({ sessionId })}
                        error={cancel.error?.message ?? null}
                      />
                    </span>
                  </div>
                ) : (
                  <p className="font-body text-[13px] italic leading-relaxed text-ink-300">
                    Free this hour. Pick something off the sheet.
                  </p>
                )}
              </div>
            </div>

            {start.error !== null && (
              <p
                role="alert"
                className="shrink-0 font-body text-xs leading-relaxed text-oxblood-300"
              >
                That session did not start.
              </p>
            )}

            {/*
             * The sheet takes whatever height is left, and gives up whole rows rather than half
             * of one when a viewport cannot hold thirty-three of them.
             *
             * Eleven Technical rows want 455px; a 900-tall laptop leaves 399 for them and a
             * 720-tall one 219, so a cut is unavoidable below about 1600x900 and the only
             * question is whether it is an honest one. `measureFold` puts it on a row boundary
             * and the line underneath says how many rows are under it: cut content is the one
             * thing the maintainer's bar rules out outright, and a sliced row with no sign that
             * scrolling recovers it is cut content whatever the overflow rule says.
             */}
            {/*
             * The floor: the four groups and everyone standing on them, in one frame.
             *
             * The four columns used to float as four separate framed cards on the page ground,
             * which read as four documents rather than as one sheet with four columns ruled down
             * it. Putting them inside a single inked frame is what the maintainer asked for
             * ("the 4 categories inside a bigger template"), and it buys the thing under them a
             * place to live: a strip along the foot of the same sheet saying who is on the floor
             * right now, so the answer is not one officer at a time off the rail on the left.
             *
             * The columns inside it lose their own paper and their own shadow. Paper on paper and
             * a shadow inside a frame both say "this is a separate object", and they are not:
             * they are columns. What they keep is the coloured hairline, which is the code.
             */}
            <section
              className="ink-frame card-paper washed relative flex min-h-0 flex-1 flex-col gap-1.5 p-1.5 shadow-panel"
              data-testid="training-floor"
            >
              <div className="relative flex min-h-0 flex-1 flex-col" data-testid="training-sheet">
                <div
                  ref={sheetRef}
                  // Four columns only from `xl`. Tried at `lg` on 2026-09-21 to buy the sheet height back at
                  // 1024x768, and the column headings do not fit: a 165px column clips "Technical"
                  // under its own sigil, and cut text is the one thing ruled out outright.
                  className="grid min-h-0 flex-1 items-stretch gap-2 overflow-y-auto md:grid-cols-2 xl:grid-cols-4"
                  style={fold.height === undefined ? undefined : { maxHeight: fold.height }}
                >
                  {ATTRIBUTE_GROUPS.map((group) => (
                    <GroupSheet
                      key={group}
                      group={group}
                      subject={subject}
                      sessionsLeft={data.sessionsLeft}
                      floorFull={floorFull}
                      pending={start.isPending}
                      onOpen={setOpened}
                    />
                  ))}
                </div>
                {fold.hidden > 0 && (
                  <p
                    ref={hintRef}
                    // Padding, not margin: `measureFold` budgets for this line by `offsetHeight`.
                    className="shrink-0 pt-1.5 text-center font-display text-[10px] uppercase tracking-[0.2em] text-brass-300"
                    data-testid="training-fold"
                  >
                    ▼ Scroll for {fold.hidden} more {fold.hidden === 1 ? 'drill' : 'drills'}
                  </p>
                )}
              </div>
              <Underway subjects={data.subjects} now={now} />
            </section>
          </div>
        )}
      </div>

      {opened !== null && subject && (
        <DrillDialog
          name={opened}
          subject={subject}
          seconds={data.sessionSeconds}
          blocker={drillBlocker(opened, subject, data.sessionsLeft, floorFull)}
          pending={start.isPending}
          onTrain={() => {
            start.mutate(
              { subjectId: subject.id, attribute: opened },
              { onSuccess: () => setOpened(null) },
            );
          }}
          onClose={() => setOpened(null)}
        />
      )}
    </PageShell>
  );
}

/**
 * The floor: everyone who is on an hour right now, along the foot of the sheet.
 *
 * Before this the only way to see a drill running was to click the person on the rail, so a crew
 * with five hours out had five clicks between a player and the answer to "what is my crew doing".
 * The banner at the top of the sheet still carries the chosen subject's hour in full, with the
 * drill's own words and the cancel: this strip is the *other* question, which is everybody at once.
 *
 * Bounded by construction, so it never scrolls and never needs to (maintainer, 2026-09-21: "no
 * need for a scrolable page though"). The floor has `benches` places, one until the Professor's
 * Second Chair and two after, so at most two of these exist however many officers are on the
 * books. It is also kept deliberately short, because every pixel it takes is a drill row
 * off the sheet above it: one line per person, and the drill's name on the hover rather than in
 * the row.
 *
 * Idle officers are not here. A list of everybody with "idle" against most of them is the roster
 * on the left with a worse layout; what belongs at the foot of the sheet is the work.
 */
function Underway({ subjects, now }: { subjects: readonly TrainingSubject[]; now: number }) {
  const working = subjects.filter(
    (one): one is TrainingSubject & { session: TrainingSession } => one.session !== null,
  );

  return (
    <div className="shrink-0" data-testid="training-underway">
      {/* A ruled line with the heading set into it rather than drawn over it. The rule takes the
          slack between the two words, so nothing hand-drawn ever crosses a letter. */}
      <div className="flex items-center gap-2 px-0.5 pb-1">
        <h3 className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.22em] text-brass-300">
          On the floor
        </h3>
        <span aria-hidden className="ink-rule block min-w-4 flex-1" />
        <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.18em] tabular-nums text-ink-400">
          {working.length === 0 ? 'nobody' : `${working.length} working`}
        </span>
      </div>

      {working.length === 0 ? (
        <p className="px-0.5 font-body text-[12px] italic leading-snug text-ink-400">
          The floor is empty. Pick a drill off the sheet and somebody will be on it within the hour.
        </p>
      ) : (
        // A grid rather than a wrapping flex row: with one person on the floor, `flex-1` stretched
        // the single chip across the whole sheet and left a hand's width of nothing between the
        // name and the bar. Columns keep a lone chip the size a chip is.
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {working.map((one) => (
            <li key={one.id} className="min-w-0">
              <UnderwayRow subject={one} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One person on the floor: who, how far in, and how long is left.
 *
 * What the drill actually is sits on the hover. Putting it in the row meant either two lines per
 * person, which costs the sheet above a row of drills, or a title cut off mid-word, which is the
 * one thing this project's bar rules out outright: "Cipher hou" is worse than no title at all.
 * The name wraps rather than truncating for the same reason.
 */
function UnderwayRow({
  subject,
  now,
}: {
  subject: TrainingSubject & { session: TrainingSession };
  now: number;
}) {
  const drill = TRAINING_DRILLS[subject.session.attribute];
  return (
    <div
      className="flex items-center gap-2 rounded-sm border border-surface-600/60 bg-surface-900/50 px-1.5 py-1"
      data-testid={`training-underway-${subject.id}`}
      data-tip={`${subject.name}: ${drill.title}`}
    >
      <span className="w-5 shrink-0">
        {subject.officerRole === null ? (
          <OverseerPortrait
            portraitId={subject.portraitId ?? ''}
            archetype="enforcer"
            showTag={false}
          />
        ) : (
          <OfficerPortrait
            portraitId={subject.portraitId}
            name={subject.name}
            injuredUntil={subject.injuredUntil}
            className="aspect-[4/5] w-full"
          />
        )}
      </span>
      <span className="min-w-0 break-words font-display text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-ink-100">
        {subject.name}
      </span>
      {/* The bar takes the slack rather than the name doing it: a short name left a hand's width
          of nothing in the middle of the chip, and a longer bar is the half of this row that is
          worth more space. */}
      <span className="paint-track ml-auto block h-1.5 min-w-12 flex-1 rounded-sm">
        <span
          className="paint-fill block h-full bg-brass-300"
          style={{ width: `${drillProgressAt(subject.session, now) * 100}%` }}
        />
      </span>
      <span className="shrink-0 font-display text-[10px] tabular-nums text-brass-300">
        {formatRemaining(drillRemainingMs(subject.session, now))}
      </span>
    </div>
  );
}

function SubjectRow({
  subject,
  selected,
  now,
  onSelect,
}: {
  subject: TrainingSubject;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`training-subject-${subject.id}`}
      className={cn(
        // A box per person, the shape the feats index uses for the same job: the chosen one is
        // ringed in brass and the rest sit in a quiet edge, so the rail separates row from row
        // without a hairline between them. The tint stays low behind a portrait, which a solid
        // fill would fight.
        'relative flex w-full items-center gap-3 rounded-sm border px-2 py-2 text-left transition-colors duration-150',
        selected
          ? 'border-brass-300 bg-brass-500/15'
          : 'border-surface-600/60 bg-surface-900/40 hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span className="w-11 shrink-0">
        {subject.officerRole !== null ? (
          <OfficerPortrait
            portraitId={subject.portraitId}
            name={subject.name}
            injuredUntil={subject.injuredUntil}
            className="aspect-[4/5] w-full"
          />
        ) : (
          <OverseerPortrait
            portraitId={subject.portraitId ?? ''}
            archetype="enforcer"
            showTag={false}
          />
        )}
      </span>
      {/*
       * Wrapping, not truncating.
       *
       * A person's name is the one label on this rail that a player has to be able to read, and
       * `Marcus "Bulwark" Kane` does not fit on one line in the stamped face. It is a wider
       * letterform than the condensed sans around it. Ellipsising it is a cut label, which is
       * what the layout gate is for and what the maintainer's bar forbids; the row growing a line is
       * free, because this rail is a list rather than a table with an aligned column.
       *
       * The name is set in the stamped face because it is a *name*, the exact category of
       * lettering that face exists for. It pays for that in width, and `break-words` covers it.
       */}
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[13px] leading-[1.15] text-ink-100">
          {subject.name}
        </span>
        <span className="block break-words font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
          {subject.role}
        </span>
      </span>
      {/* What they are doing with the hour, on the rail, so picking somebody to train does not
          mean clicking through four people to find the one who is free. */}
      {subject.session ? (
        <span className="flex w-12 shrink-0 flex-col items-end gap-1">
          <span className="font-display text-[11px] tabular-nums text-brass-300">
            {formatRemaining(drillRemainingMs(subject.session, now))}
          </span>
          <span className="paint-track block h-1.5 w-full rounded-sm">
            <span
              className="paint-fill block h-full bg-brass-300"
              style={{ width: `${drillProgressAt(subject.session, now) * 100}%` }}
            />
          </span>
        </span>
      ) : (
        <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.12em] text-verdigris-300">
          Idle
        </span>
      )}
    </button>
  );
}

/**
 * The four groups, and the four colours they are read by.
 *
 * A colour per column is what turns "which of these four is the technical one" from a reading task
 * into a glance, and it is the same trick the roster's rarity frames pull. The four are deliberately
 * far apart on the wheel rather than four shades of brass: two columns a step apart would be worse
 * than no colour at all, because the eye would try to read a gradient into them.
 */
const GROUP_STYLE: Readonly<Record<AttributeGroup, { edge: string; ink: string }>> = {
  physical: { edge: 'border-oxblood-500/50', ink: 'text-oxblood-300' },
  mental: { edge: 'border-iris-300/50', ink: 'text-iris-100' },
  social: { edge: 'border-brass-500/50', ink: 'text-brass-300' },
  technical: { edge: 'border-verdigris-300/50', ink: 'text-verdigris-100' },
};

/**
 * One group of the sheet, as a page torn out of a training log.
 *
 * The header carries the group's mark and what the person averages across it, which is the figure
 * a player is actually after when they glance at a column: not "what is their Logic" but "are they
 * a thinker". Twelve numbers do not answer that and one does.
 */
function GroupSheet({
  group,
  subject,
  sessionsLeft,
  floorFull,
  pending,
  onOpen,
}: {
  group: AttributeGroup;
  subject: TrainingSubject;
  sessionsLeft: number;
  floorFull: boolean;
  pending: boolean;
  onOpen: (name: AttributeName) => void;
}) {
  const style = GROUP_STYLE[group];
  const names = ATTRIBUTES_BY_GROUP[group];
  const average = Math.round(
    names.reduce((total, name) => total + subject.attributes[name], 0) / Math.max(1, names.length),
  );

  return (
    <section
      className={cn(
        // Not `ink-frame`: these four carry the attribute groups' colour code on their border
        // (`GROUP_STYLE.edge`), and a drawn frame paints over a border colour. The code is the
        // point of the cards, so they keep the hairline.
        //
        // No `card-paper` and no `shadow-panel` either, since 2026-09-21: they sit inside the
        // floor's own sheet now, and paper on paper with a drop shadow between them reads as four
        // documents lying on a desk rather than as four columns ruled down one page. What is left
        // is a column tinted a shade off its ground, ruled in its own colour.
        'washed edge-lit flex min-w-0 flex-col rounded-sm border bg-surface-800/45',
        style.edge,
      )}
      data-testid={`group-${group}`}
    >
      <header className="flex items-center gap-2 px-2.5 pb-1.5 pt-2">
        {/* Stamped, not screwed on: see `DrillSigil`. It sits in its own column beside the
            title and never over it, which is the maintainer's standing rule about the drawn
            marks (2026-09-21: "no hand drawn is going over text"). */}
        <DrillSigil group={group} className={cn('h-8 w-8 shrink-0', style.ink)} />
        <h3
          className={cn(
            'min-w-0 flex-1 truncate font-display text-[12px] font-bold uppercase tracking-[0.18em]',
            style.ink,
          )}
        >
          {ATTRIBUTE_GROUP_LABELS[group]}
        </h3>
        {/* The one number for the column: what they average across it. On the same scale as the
            rows under it, so it reads against them rather than needing a unit. The word that would
            explain it does not fit beside an icon and a title, so it is on the hover instead. */}
        <span
          className="shrink-0 font-display text-[13px] font-bold tabular-nums text-ink-200"
          data-tip={`${ATTRIBUTE_GROUP_LABELS[group]}: ${average} on average across ${names.length}`}
        >
          {average}
        </span>
      </header>
      <span aria-hidden className="ink-rule mx-2.5 block" />
      <div className="flex flex-col gap-[3px] p-1.5 pt-2">
        {names.map((name) => (
          <DrillButton
            key={name}
            name={name}
            subject={subject}
            sessionsLeft={sessionsLeft}
            floorFull={floorFull}
            pending={pending}
            onOpen={() => onOpen(name)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One attribute, as an hour you could spend.
 *
 * The words stay minimal: a name and a number. It used to carry the drill's title underneath as a
 * second line, and thirty-three of those turned the tab into a wall of small grey text with the
 * ratings, the thing a player is actually comparing, lost inside it. The drill, what the attribute
 * does, and what the hour buys all live one hover away, and the *decision* lives behind a click.
 *
 * What the row has that it did not is a **gauge**: a painted stroke along its bottom edge, as long
 * as the rating is out of a hundred. Thirty-three rows of `label ...... number` is a spreadsheet,
 * and the number at the end of each is the only thing carrying the shape of the sheet; the eye has
 * to read all thirty-three to find out whether this is a thinker or a bruiser. Thirty-three
 * strokes of different lengths answer that before a single number is read, and cost no width, no
 * height and no words.
 *
 * Clicking never trains. It opens the drill, which is where the Train button is. An hour is one
 * of five a day and cannot be taken back, so a stray click on a dense grid of thirty-three targets
 * must not be able to spend one, and the dialog is also the only place with room to say what the
 * hour is actually for.
 */
function DrillButton({
  name,
  subject,
  sessionsLeft,
  floorFull,
  pending,
  onOpen,
}: {
  name: AttributeName;
  subject: TrainingSubject;
  sessionsLeft: number;
  floorFull: boolean;
  pending: boolean;
  onOpen: () => void;
}) {
  const rating = subject.attributes[name];
  // Against this rating, never the crew-wide figure: see the note on `DrillDialog`.
  const gain = trainingGainFor(rating);
  const drill = TRAINING_DRILLS[name];
  const effect = ATTRIBUTE_EFFECTS[name];
  const blocker = drillBlocker(name, subject, sessionsLeft, floorFull);
  const filled = ratingPercent((rating / MAX_ATTRIBUTE) * 100);
  // The bar and the figure read the *rating*, not the column they are in. A group colour told a
  // player which of four lists they were looking at, which the icon and the frame already say, and
  // spent the one channel that could have told them whether the number was any good.
  const band = ratingBand(rating);
  // The one row worth marking rather than merely dimming: what they drilled last time is the only
  // blocker a player can plan around, and it is a fact about *this* person on *this* day.
  const rested = subject.lastAttribute === name;
  // `null` for the Overseer, who is in no chair: no skill is more or less useful to them.
  const importance = subject.officerRole === null ? null : importanceOf(subject.officerRole, name);

  return (
    <HoverCard
      label={`${ATTRIBUTE_LABELS[name]}: ${drill.title}`}
      card={
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
            {ATTRIBUTE_LABELS[name]}
          </p>
          <p className="font-body text-[13px] leading-relaxed text-ink-100">{effect.summary}</p>
          <p className="border-t border-surface-600/60 pt-1.5 font-display text-[12px] uppercase tracking-[0.1em] text-ink-200">
            {drill.title}
          </p>
          <p className="font-body text-[12px] leading-relaxed text-ink-300">{drill.detail}</p>
          <p className="font-display text-[12px] uppercase tracking-[0.08em] text-ink-300">
            {blocker ??
              `An hour buys ${gain} ${gain === 1 ? 'point' : 'points'}. Click to open it.`}
          </p>
        </div>
      }
      className="w-full"
      onActivate={onOpen}
      disabled={pending}
      data-testid={`drill-${name}`}
    >
      <span
        data-importance={importance ?? undefined}
        className={cn(
          'relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-sm border pb-[6px] pl-2 pr-1.5 pt-1',
          'transition-all duration-150',
          blocker === null
            ? 'border-surface-600 bg-surface-800/60 hover:-translate-y-px hover:border-brass-300/70 hover:bg-brass-300/10'
            : 'border-surface-700 bg-surface-900/60 opacity-55',
          // The same gold, silver and blue the crew sheet draws, on the screen where a player is
          // actually *deciding* what to drill. Knowing which skills the chair rewards is the whole
          // input to that decision, and it was only shown on the screen where nothing is chosen.
          importance !== null && cn('pl-2.5', IMPORTANCE_EDGE[importance]),
        )}
      >
        <span className="min-w-0 truncate font-body text-[13px] leading-tight text-ink-100">
          {ATTRIBUTE_LABELS[name]}
        </span>
        {/* A dot on the one they did last time, so "why is that row dead" is answerable without
            hovering it. Drawn rather than written: the row has no width to spare for a word. */}
        {rested && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass-300/80 shadow-brass"
          />
        )}
        {/* `leading-none`: the figure's default line box was 21px on a 14px face, and it set the
            row's height. Six pixels off each of eleven rows is what lets a whole column fit at
            1440x900 rather than folding its last two (maintainer, 2026-09-21: "there are gaps in
            the main part where the attributes are"). */}
        <span
          className={cn(
            'shrink-0 font-display text-[14px] font-bold leading-none tabular-nums',
            RATING_TEXT[band],
          )}
        >
          {rating}
        </span>
        {/* The gauge. Along the bottom edge of the row rather than beside the label, because it is
            a reading *of* the row and every pixel beside the label belongs to the label. */}
        {/* `!absolute`, and it has to be said out loud: `.paint-track` sets `position: relative`
            itself, which beats the plain utility and leaves this in the row's flex flow, shrunk to
            its own content. It rendered as a 3px nick at the right of every row and looked like a
            chevron somebody had left in. Same failure as `.painted > *` on the plaque's corners. */}
        <span aria-hidden className="paint-track !absolute inset-x-0 bottom-0 block h-[5px]">
          <span
            className={cn(
              'paint-fill block h-full',
              blocker === null ? RATING_FILL[band] : 'bg-ink-500',
              // A rating of nothing still gets a visible nick of pigment, so an empty gauge reads
              // as "none of this" rather than as a row whose bar failed to draw.
              'min-w-[3px]',
            )}
            style={{ width: `${filled}%` }}
          />
        </span>
      </span>
    </HoverCard>
  );
}

/** Why this hour cannot be spent on this attribute for this person, or `null`. */
/**
 * The X on a running drill (maintainer request, 2026-09-12): inside the first tenth of the hour it can
 * be taken off the board, and the day's session comes back whole. A component rather than inline
 * because the session is narrowed from `subject.session` and a closure over it loses that.
 */
function DrillCancel({
  session,
  now,
  pending,
  onCancel,
  error,
}: {
  session: TrainingSession;
  /** Epoch milliseconds, as the page keeps its clock. */
  now: number;
  pending: boolean;
  onCancel: (sessionId: string) => void;
  error: string | null;
}) {
  return (
    <>
      <CancelMark
        windowMs={drillCancelWindowMs(session, new Date(now).toISOString())}
        label={`Call off ${TRAINING_DRILLS[session.attribute].title}`}
        pending={pending}
        onCancel={() => onCancel(session.id)}
        data-testid="cancel-drill"
      />
      {error !== null && (
        <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
          {error}
        </p>
      )}
    </>
  );
}

function drillBlocker(
  name: AttributeName,
  subject: TrainingSubject,
  sessionsLeft: number,
  floorFull: boolean,
): string | null {
  if (sessionsLeft <= 0) return 'Nothing left today';
  if (subject.session) return 'Already in a session';
  // The server's own words (`trainingBlocker`), after the per-person check for the same reason.
  if (floorFull) return 'The floor is taken';
  if (subject.lastAttribute === name) return 'Did that last time';
  if (subject.attributes[name] >= MAX_ATTRIBUTE) return 'Nothing left to learn';
  return null;
}

/**
 * The drill, opened.
 *
 * Everything the hover card says, with room to breathe, and the one control that spends the hour.
 * The button carries what it costs and what it gives, because "Train" on its own is a word and
 * "One hour, +2 Cryptography" is a decision.
 *
 * What it gives is `trainingGainFor(rating)`, not `TrainingResponse.gainPerSession`. That field is
 * the flat `TRAINING_GAIN`, sent with no attribute in scope, and the back half of a skill is worth
 * half as much: `applyGain` is the only place a session's value is decided and it decides it
 * against the sheet in front of it (`crew/training.ts`). Printing the crew-wide figure promised
 * +2 on every skill at 50 or over, on a button that spends one of five hours a day and cannot be
 * taken back, and then moved the rating by one with nothing on the screen saying why.
 */
function DrillDialog({
  name,
  subject,
  seconds,
  blocker,
  pending,
  onTrain,
  onClose,
}: {
  name: AttributeName;
  subject: TrainingSubject;
  seconds: number;
  blocker: string | null;
  pending: boolean;
  onTrain: () => void;
  onClose: () => void;
}) {
  const drill = TRAINING_DRILLS[name];
  const effect = ATTRIBUTE_EFFECTS[name];
  const rating = subject.attributes[name];
  const gain = trainingGainFor(rating);

  return (
    <Modal onClose={onClose} labelledBy="drill-dialog-title" className="border-brass-300/30">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-surface-600/60 px-5 py-4">
        <div className="min-w-0">
          <p className="font-display text-[12px] uppercase tracking-[0.2em] text-brass-300">
            {subject.name} · {subject.role}
          </p>
          <h2
            id="drill-dialog-title"
            className="mt-1 font-display text-lg font-bold tracking-[0.1em] text-ink-100"
          >
            {drill.title}
          </h2>
        </div>
        <span className="shrink-0 rounded-sm border border-surface-600 px-2.5 py-1 font-display text-base font-bold tabular-nums text-ink-100">
          {rating}
          <span className="text-brass-300"> +{gain}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5">
        <p className="font-body text-[14px] italic leading-relaxed text-ink-200">{drill.detail}</p>
        <div className="rivets relative rounded-sm border-l-2 border-brass-500/60 bg-surface-700/40 px-3.5 py-3">
          <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
            What {ATTRIBUTE_LABELS[name]} does
          </p>
          <p className="mt-1 font-body text-[14px] leading-relaxed text-brass-100">
            {effect.summary}
          </p>
        </div>
        {/* The channel label is a noun phrase, not a clause, so it is set as a field rather than
            dropped into a sentence: "It lands on what theirs does not" reads as a typo. */}
        <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-surface-700 pt-3">
          <dt className="font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
            Feeds
          </dt>
          <dd className="font-display text-[12px] uppercase tracking-[0.08em] text-ink-100">
            {CHANNEL_LABELS[effect.channel].label}
          </dd>
          <dd className="ml-auto font-display text-[13px] font-bold tabular-nums text-brass-300">
            +{contributionOf(rating)}
            {CHANNEL_LABELS[effect.channel].unit === 'percent' ? '%' : ''}
            <span className="ml-1 font-normal text-ink-300">from this rating</span>
          </dd>
        </dl>
        {blocker !== null && (
          <p role="alert" className="font-body text-[13px] leading-relaxed text-oxblood-300">
            {blocker}.
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-700 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Not today
        </Button>
        <Button size="sm" disabled={blocker !== null || pending} onClick={onTrain}>
          {pending ? 'Working…' : `${formatDuration(seconds)} · +${gain} ${ATTRIBUTE_LABELS[name]}`}
        </Button>
      </footer>
    </Modal>
  );
}
