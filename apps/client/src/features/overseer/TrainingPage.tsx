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
  attributeTier,
  contributionOf,
  drillProgressAt,
  drillRemainingMs,
  type AttributeName,
  type TrainingSubject,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
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
  const spent = data.perDay - data.sessionsLeft;

  return (
    <PageShell title="An hour is an hour, spend it on something" icon="crew" wide>
      <InfoNote>
        {data.perDay} sessions a day, an hour each, {data.gainPerSession} points a session. Nobody
        drills the same thing twice running, so the day after a hard run is a day for reading.
        Unspent hours do not carry over.
      </InfoNote>

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[11px] tracking-[0.24em] text-brass-300">
          // THE DAY //
        </span>
        <div className="flex items-center gap-1.5" data-testid="training-allowance">
          {Array.from({ length: data.perDay }, (_, index) => (
            <span
              key={index}
              aria-hidden
              className={cn(
                'h-2.5 w-7 rounded-sm border',
                index < spent
                  ? 'border-surface-600 bg-surface-700'
                  : 'border-brass-300/70 bg-brass-300/40',
              )}
            />
          ))}
        </div>
        <span className="font-display text-[12px] uppercase tracking-[0.14em] tabular-nums text-ink-200">
          {data.sessionsLeft} of {data.perDay} left
        </span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Who. */}
        <Panel title="On the books">
          <ul className="flex flex-col divide-y divide-surface-700" data-testid="training-subjects">
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

        {/* What. */}
        {subject && (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="painted washed rivets edge-lit rounded-sm border border-surface-600/70 bg-surface-800/60 p-4">
              <h2 className="font-display text-base font-bold tracking-[0.06em] text-ink-100">
                {subject.name}
              </h2>
              <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
                {subject.role}
              </p>
              {subject.session ? (
                <div className="mt-3 flex flex-col gap-1.5" data-testid="training-in-flight">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                      {TRAINING_DRILLS[subject.session.attribute].title}
                    </span>
                    <span className="font-display text-sm font-semibold tabular-nums text-brass-300">
                      {formatRemaining(drillRemainingMs(subject.session, now))}
                    </span>
                  </div>
                  <span className="block h-1.5 w-full bg-surface-700">
                    <span
                      className="block h-full bg-brass-300"
                      style={{ width: `${drillProgressAt(subject.session, now) * 100}%` }}
                    />
                  </span>
                  <p className="font-body text-xs leading-relaxed text-ink-300">
                    {TRAINING_DRILLS[subject.session.attribute].detail}
                  </p>
                </div>
              ) : (
                <p className="mt-2 font-body text-xs leading-relaxed text-ink-300">
                  Free this hour. Pick something below.
                </p>
              )}
            </div>

            {start.error !== null && (
              <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
                That session did not start.
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {ATTRIBUTE_GROUPS.map((group) => (
                <section key={group} className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="border-b border-surface-600 pb-1 font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
                    {ATTRIBUTE_GROUP_LABELS[group]}
                  </h3>
                  {ATTRIBUTES_BY_GROUP[group].map((name) => (
                    <DrillButton
                      key={name}
                      name={name}
                      subject={subject}
                      sessionsLeft={data.sessionsLeft}
                      gain={data.gainPerSession}
                      pending={start.isPending}
                      onOpen={() => setOpened(name)}
                    />
                  ))}
                </section>
              ))}
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
        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-brass-300/10' : 'hover:bg-surface-800/70',
      )}
    >
      <span className="w-10 shrink-0">
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
       * `Marcus "Bulwark" Kane` no longer fits on one line in the stamped face — it is a wider
       * letterform than the condensed sans it replaced. Ellipsising it is a cut label, which is
       * what the layout gate is for and what the board's bar forbids; the row growing a line is
       * free, because this rail is a list rather than a table with an aligned column.
       *
       * The name itself is set in the pen. It is a *name*, which is the exact category of lettering
       * the typographic pass is about, and Caveat is narrower than Special Elite at the same
       * optical size, so it earns back the width in the bargain.
       */}
      <span className="min-w-0 flex-1">
        <span className="block break-words font-hand text-[18px] leading-[1.15] text-ink-100">
          {subject.name}
        </span>
        <span className="block break-words font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
          {subject.role}
        </span>
      </span>
      {subject.session && (
        <span className="shrink-0 font-display text-[11px] tabular-nums text-brass-300">
          {formatRemaining(drillRemainingMs(subject.session, now))}
        </span>
      )}
    </button>
  );
}

/**
 * One attribute, as an hour you could spend.
 *
 * The row itself is deliberately plain: a name and a number. It used to carry the drill's title
 * underneath as a second line, and thirty-five of those turned the tab into a wall of small grey
 * text with the ratings — the thing a player is actually comparing — lost inside it. The drill,
 * what the attribute does, and what the hour buys all live one hover away, and the *decision*
 * lives behind a click.
 *
 * Clicking never trains. It opens the drill, which is where the Train button is. An hour is one
 * of five a day and cannot be taken back, so a stray click on a dense grid of thirty-five targets
 * must not be able to spend one — and the dialog is also the only place with room to say what the
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

  return (
    <HoverCard
      label={`${ATTRIBUTE_LABELS[name]} — ${drill.title}`}
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
          'flex w-full items-center justify-between gap-2 rounded-sm border px-2.5 py-2 transition-colors',
          blocker === null
            ? 'border-surface-600 bg-surface-800/60 hover:border-brass-300/70 hover:bg-brass-300/10'
            : 'border-surface-700 bg-surface-900/60 opacity-60',
        )}
      >
        <span className="min-w-0 truncate font-body text-[13px] leading-tight text-ink-100">
          {ATTRIBUTE_LABELS[name]}
        </span>
        <span
          className={cn(
            'shrink-0 font-display text-[14px] font-bold tabular-nums',
            attributeTier(rating) === 'elite'
              ? 'text-hextech-100'
              : attributeTier(rating) === 'strong'
                ? 'text-brass-300'
                : 'text-ink-100',
          )}
        >
          {rating}
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
            dropped into a sentence — "It lands on what theirs does not" reads as a typo. */}
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
