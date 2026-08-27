import {
  ATTRIBUTES_BY_GROUP,
  ATTRIBUTE_EFFECTS,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_LABELS,
  MAX_ATTRIBUTE,
  OVERSEER_SUBJECT,
  CHANNEL_LABELS,
  TRAINING_DRILLS,
  contributionOf,
  drillProgressAt,
  drillRemainingMs,
  type AttributeGroup,
  type AttributeName,
  type TrainingSubject,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { RATING_FILL, RATING_TEXT, ratingBand, ratingPercent } from '../../lib/rating';
import { useStartTraining, useTraining } from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { InfoNote, PageShell } from '../game/PageShell';
import { OverseerPortrait } from './OverseerPortrait';

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
export function TrainingPage() {
  const query = useTraining();
  const start = useStartTraining();
  // A number, because the drill clock is arithmetic on epoch milliseconds and `useServerClock`
  // hands back a Date.
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt).getTime();
  const [chosen, setChosen] = useState<string>(OVERSEER_SUBJECT);
  /** The drill a player has opened, if any. Clicking a row opens it; it never trains. */
  const [opened, setOpened] = useState<AttributeName | null>(null);

  const data = query.data;
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Finding the gym…
        </p>
      </div>
    );
  }

  const subject = data.subjects.find((one) => one.id === chosen) ?? data.subjects[0];

  return (
    <PageShell quote="An hour is an hour. Spend it on something." wide fills>
      {/*
       * One frame, two columns, and one thing in it that moves.
       *
       * The page used to stack: a note, then the day, then the sheet, all inside a body that
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
          <Panel title="On the books" className="min-h-0 flex-1 border border-surface-500/70">
            {/* The one scrolling region on the screen. A crew of fifteen officers has to be
                reachable without the sheet beside them moving a pixel. */}
            <ul
              className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
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

          {/* The day, as hours chalked on the wall by the door.
              No `mt-auto`: the roster above grows into the free space now, so a margin that also
              claimed it left the panel hugging its two officers with a gap under it. One of the
              two has to absorb the slack, and it is the section the crew lives in. */}
          <div
            className="card-paper washed rivets edge-lit flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-surface-600/70 px-3 py-2.5"
            data-testid="training-day"
          >
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
              The day
            </span>
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

          {/* The rule of the room, at the bottom of the rail: read once, then never again. */}
          <div className="shrink-0">
            <InfoNote label="How a day works">
              {data.perDay} sessions a day, an hour each, {data.gainPerSession} points a session.
              Nobody drills the same thing twice running, so the day after a hard run is a day for
              reading. Unspent hours do not carry over.
            </InfoNote>
          </div>
        </div>

        {/* What. */}
        {subject && (
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {/*
             * At the bench: who is up, and what they are doing with the hour.
             *
             * The portrait is here as well as on the rail because this block is the answer to
             * "whose sheet am I looking at", and thirty-three rows below it is a long way for a
             * name at the top to carry on its own.
             */}
            {/* The banner is fixed furniture, so every pixel it takes is a pixel off the sheet.
                A 3:4 portrait at `w-16` is 85px tall and the block sits at about a hundred, which
                is what lets an eleven-row column clear a 900-tall laptop without scrolling. */}
            <div className="card-paper washed rivets edge-lit relative flex shrink-0 items-start gap-3.5 overflow-hidden rounded-sm border border-brass-500/40 p-3 shadow-panel">
              <span className="w-14 shrink-0 sm:w-16">
                {subject.portraitId === null ? (
                  <span className="flex aspect-[3/4] w-full items-center justify-center rounded-sm border border-surface-600 bg-surface-900 font-stamp text-2xl text-ink-300">
                    {subject.name.slice(0, 1)}
                  </span>
                ) : (
                  <OverseerPortrait
                    portraitId={subject.portraitId}
                    archetype="enforcer"
                    showTag={false}
                  />
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <h2 className="break-words font-stamp text-lg leading-tight text-ink-100">
                    {subject.name}
                  </h2>
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
                    {subject.role}
                  </p>
                </div>
                <span aria-hidden className="ink-rule block w-full" />

                {subject.session ? (
                  <div className="flex flex-col gap-1.5" data-testid="training-in-flight">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-ink-100">
                        {TRAINING_DRILLS[subject.session.attribute].title}
                      </span>
                      <span className="shrink-0 font-display text-base font-bold tabular-nums text-brass-300">
                        {formatRemaining(drillRemainingMs(subject.session, now))}
                      </span>
                    </div>
                    <span className="paint-track block h-2.5 w-full rounded-sm">
                      <span
                        className="paint-fill block h-full bg-brass-300"
                        style={{ width: `${drillProgressAt(subject.session, now) * 100}%` }}
                      />
                    </span>
                    <p className="font-body text-[13px] italic leading-relaxed text-ink-300">
                      {TRAINING_DRILLS[subject.session.attribute].detail}
                    </p>
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
             * The sheet takes whatever height is left, and only scrolls if a viewport genuinely
             * cannot hold thirty-three rows.
             *
             * From 1440x900 up it never does, which is the point: the rows and the banner above
             * them are sized so the tallest column, the eleven technical ones, clears a 900-tall
             * laptop with the page fixed. It is not a scrolling region by design; it is a fixed
             * one with a floor under it, because below that height the
             * alternative at a legible row height is a cut sheet, and cut content is the one thing
             * the board's bar rules out outright.
             */}
            <div className="relative min-h-0 flex-1">
              <div
                className="grid h-full items-start gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-4"
                data-testid="training-sheet"
              >
                {ATTRIBUTE_GROUPS.map((group) => (
                  <GroupSheet
                    key={group}
                    group={group}
                    subject={subject}
                    sessionsLeft={data.sessionsLeft}
                    gain={data.gainPerSession}
                    pending={start.isPending}
                    onOpen={setOpened}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {opened !== null && subject && (
        <DrillDialog
          name={opened}
          subject={subject}
          gain={data.gainPerSession}
          seconds={data.sessionSeconds}
          blocker={drillBlocker(opened, subject, data.sessionsLeft)}
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
        // A lit left edge on the chosen one rather than a wash across the whole row: the rail is
        // read down its edge, and a tint behind a portrait fights the portrait.
        'relative flex w-full items-center gap-3 border-l-[3px] py-2.5 pl-2.5 pr-3 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span className="w-11 shrink-0">
        {subject.portraitId === null ? (
          <span className="flex aspect-[3/4] w-full items-center justify-center rounded-sm border border-surface-600 bg-surface-900 font-display text-sm font-bold text-ink-300">
            {subject.name.slice(0, 1)}
          </span>
        ) : (
          <OverseerPortrait portraitId={subject.portraitId} archetype="enforcer" showTag={false} />
        )}
      </span>
      {/*
       * Wrapping, not truncating.
       *
       * A person's name is the one label on this rail that a player has to be able to read, and
       * `Marcus "Bulwark" Kane` does not fit on one line in the stamped face. It is a wider
       * letterform than the condensed sans around it. Ellipsising it is a cut label, which is
       * what the layout gate is for and what the board's bar forbids; the row growing a line is
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
          Free
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
const GROUP_STYLE: Readonly<Record<AttributeGroup, { icon: IconName; edge: string; ink: string }>> =
  {
    physical: { icon: 'physical', edge: 'border-oxblood-500/50', ink: 'text-oxblood-300' },
    mental: { icon: 'mental', edge: 'border-iris-300/50', ink: 'text-iris-100' },
    social: { icon: 'social', edge: 'border-brass-500/50', ink: 'text-brass-300' },
    technical: { icon: 'technical', edge: 'border-verdigris-300/50', ink: 'text-verdigris-100' },
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
  gain,
  pending,
  onOpen,
}: {
  group: AttributeGroup;
  subject: TrainingSubject;
  sessionsLeft: number;
  gain: number;
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
        'card-paper washed edge-lit flex min-w-0 flex-col rounded-sm border shadow-panel',
        style.edge,
      )}
      data-testid={`group-${group}`}
    >
      <header className="flex items-center gap-2 px-2.5 pb-1.5 pt-2">
        <span
          aria-hidden
          className={cn(
            'icon-plate flex h-7 w-7 shrink-0 items-center justify-center rounded-sm',
            style.ink,
            '[&_svg]:h-[18px] [&_svg]:w-[18px]',
          )}
        >
          <Icon name={style.icon} />
        </span>
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
            gain={gain}
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
  gain,
  pending,
  onOpen,
}: {
  name: AttributeName;
  subject: TrainingSubject;
  sessionsLeft: number;
  gain: number;
  pending: boolean;
  onOpen: () => void;
}) {
  const rating = subject.attributes[name];
  const drill = TRAINING_DRILLS[name];
  const effect = ATTRIBUTE_EFFECTS[name];
  const blocker = drillBlocker(name, subject, sessionsLeft);
  const filled = ratingPercent((rating / MAX_ATTRIBUTE) * 100);
  // The bar and the figure read the *rating*, not the column they are in. A group colour told a
  // player which of four lists they were looking at, which the icon and the frame already say, and
  // spent the one channel that could have told them whether the number was any good.
  const band = ratingBand(rating);
  // The one row worth marking rather than merely dimming: what they drilled last time is the only
  // blocker a player can plan around, and it is a fact about *this* person on *this* day.
  const rested = subject.lastAttribute === name;

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
            {blocker ?? `An hour buys ${gain} points. Click to open it.`}
          </p>
        </div>
      }
      className="w-full"
      onActivate={onOpen}
      disabled={pending}
      data-testid={`drill-${name}`}
    >
      <span
        className={cn(
          'relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-sm border pb-[6px] pl-2 pr-1.5 pt-1',
          'transition-all duration-150',
          blocker === null
            ? 'border-surface-600 bg-surface-800/60 hover:-translate-y-px hover:border-brass-300/70 hover:bg-brass-300/10'
            : 'border-surface-700 bg-surface-900/60 opacity-55',
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
        <span
          className={cn(
            'shrink-0 font-display text-[14px] font-bold tabular-nums',
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
function drillBlocker(
  name: AttributeName,
  subject: TrainingSubject,
  sessionsLeft: number,
): string | null {
  if (sessionsLeft <= 0) return 'Nothing left today';
  if (subject.session) return 'Already in a session';
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
 */
function DrillDialog({
  name,
  subject,
  gain,
  seconds,
  blocker,
  pending,
  onTrain,
  onClose,
}: {
  name: AttributeName;
  subject: TrainingSubject;
  gain: number;
  seconds: number;
  blocker: string | null;
  pending: boolean;
  onTrain: () => void;
  onClose: () => void;
}) {
  const drill = TRAINING_DRILLS[name];
  const effect = ATTRIBUTE_EFFECTS[name];
  const rating = subject.attributes[name];

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
