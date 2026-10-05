import {
  STACKHOUSE_CLOSES_MINUTES,
  stackhousePayout,
  type BattleSide,
  type StackhouseBet,
  type StackhouseFight,
  type StackhouseResponse,
  type StackhouseResult,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnFace } from '../../components/ui/DrawnMarks';
import { ErrorNote } from '../../components/ui/ErrorNote';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useMe, usePlaceStackhouseBet, useStackhouse } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';

/**
 * The Stackhouse (maintainer, 2026-10-05): the back room's book on fights.
 *
 * The right half of the Black Market. A crew bets caps on who wins a fight it, or somebody at its
 * faction's table, is in. A win pays twice the stake. One bet rides at a time, it cannot be taken
 * back, and betting on a fight closes an hour before it starts. Nobody else sees the bet.
 *
 * In the room's two colours, soot and tangerine, like everything behind the door.
 */
export function StackhousePanel({ className }: { className?: string }) {
  const query = useStackhouse();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const [open, setOpen] = useState<string | null>(null);
  const data = query.data;
  const fight = data?.fights.find((one) => one.battleId === open);

  return (
    <Panel
      tone="soot"
      title="The Stackhouse"
      className={className}
      action={
        <span
          className="shrink-0 rounded-sm border border-tangerine-300/70 px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-tangerine-100"
          data-tip="A winning bet pays twice the stake. One bet at a time, and it cannot be taken back."
        >
          Pays double
        </span>
      }
      data-testid="stackhouse"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {!data ? (
          <p className="font-body text-[13px] italic text-ink-300">Finding a seat at the table…</p>
        ) : !data.unlocked ? (
          <Locked />
        ) : (
          <>
            {data.activeBet !== null && <Riding bet={data.activeBet} now={now} />}
            {data.lastResult !== null && <LastResult result={data.lastResult} />}
            {data.activeBet === null && (
              <FightList fights={data.fights} now={now} onOpen={setOpen} />
            )}
          </>
        )}
      </div>
      {data && fight !== undefined && (
        <BetWindow fight={fight} book={data} now={now} onClose={() => setOpen(null)} />
      )}
    </Panel>
  );
}

function Locked() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-tangerine-700/70 p-6 text-center"
      data-testid="stackhouse-locked"
    >
      <Icon name="lock" className="h-8 w-8 text-tangerine-300/80" />
      <p className="max-w-[26rem] font-body text-[13px] leading-relaxed text-ink-200">
        The door at the back stays shut. Your Fixer has to research{' '}
        <span className="font-semibold text-tangerine-100">Put Your Money Where Your Mouth Is</span>{' '}
        before the house takes your caps.
      </p>
    </div>
  );
}

function Riding({ bet, now }: { bet: StackhouseBet; now: Date }) {
  return (
    <div
      className="rusted relative flex flex-col gap-1.5 rounded-sm border border-tangerine-300/70 bg-soot-900/90 p-3"
      data-testid="stackhouse-riding"
    >
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-tangerine-300">
        Your bet is riding
      </span>
      <p className="font-body text-[13px] leading-snug text-ink-100">
        <span className="font-semibold tabular-nums text-tangerine-100">
          {bet.stake.toLocaleString()} caps
        </span>{' '}
        on <span className="font-semibold text-tangerine-100">{bet.backing}</span> at {bet.place}.
        Pays {stackhousePayout(bet.stake).toLocaleString()} if they win.
      </p>
      <p className="font-body text-[12px] text-ink-300">
        The fight starts in {formatRemaining(Date.parse(bet.startsAt) - now.getTime())}. Your next
        bet waits until it is over.
      </p>
    </div>
  );
}

const RESULT_WORDS: Record<StackhouseResult['outcome'], (result: StackhouseResult) => string> = {
  won: (result) =>
    `${result.backing} took it at ${result.place}. Your ${result.stake.toLocaleString()} came back as ${result.payout.toLocaleString()}.`,
  lost: (result) =>
    `${result.backing} lost at ${result.place}. The house kept your ${result.stake.toLocaleString()}.`,
  refunded: (result) =>
    `The fight at ${result.place} never ran. Your ${result.stake.toLocaleString()} came back.`,
};

function LastResult({ result }: { result: StackhouseResult }) {
  return (
    <p
      className={cn(
        'rounded-sm border px-3 py-2 font-body text-[12px] leading-snug',
        result.outcome === 'won'
          ? 'border-verdigris-300/60 text-verdigris-100'
          : result.outcome === 'lost'
            ? 'border-oxblood-300/60 text-oxblood-100'
            : 'border-tangerine-700/70 text-ink-200',
      )}
      data-testid="stackhouse-last"
    >
      <span className="font-display text-[10px] font-bold uppercase tracking-[0.16em]">
        Last bet:{' '}
      </span>
      {RESULT_WORDS[result.outcome](result)}
    </p>
  );
}

function FightList({
  fights,
  now,
  onOpen,
}: {
  fights: readonly StackhouseFight[];
  now: Date;
  onOpen: (battleId: string) => void;
}) {
  if (fights.length === 0) {
    return (
      <p
        className="rounded-sm border border-dashed border-tangerine-700/70 p-4 font-body text-[13px] leading-relaxed text-ink-300"
        data-testid="stackhouse-empty"
      >
        Nothing on the book. When you or your faction call a fight, or one is called on you, it is
        here until {STACKHOUSE_CLOSES_MINUTES} minutes before it starts.
      </p>
    );
  }
  return (
    <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto" data-testid="stackhouse-fights">
      {fights.map((fight) => (
        <li key={fight.battleId}>
          <button
            type="button"
            onClick={() => onOpen(fight.battleId)}
            className="rusted group relative flex w-full flex-col gap-1 rounded-sm border border-tangerine-700/70 bg-soot-900/90 px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-px hover:border-tangerine-300/80"
            data-testid={`stackhouse-fight-${fight.battleId}`}
          >
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-stamp text-[15px] leading-tight text-tangerine-100">
                {fight.place}
              </span>
              <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.12em] text-ink-300">
                closes in{' '}
                <span className="tabular-nums text-tangerine-300">
                  {formatRemaining(Date.parse(fight.closesAt) - now.getTime())}
                </span>
              </span>
            </span>
            <span className="font-body text-[12px] leading-snug text-ink-200">
              <SideName side={fight.attacker} /> <span className="text-ink-400">against</span>{' '}
              <SideName side={fight.defender} />
              <span className="text-ink-400"> · {fight.districtName}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SideName({ side }: { side: StackhouseFight['attacker'] }) {
  return (
    <span className={side.yours ? 'font-semibold text-tangerine-100' : 'text-ink-100'}>
      {side.name}
      {side.yours && <span className="text-tangerine-300"> (yours)</span>}
    </span>
  );
}

/**
 * One fight's bet: who, how much, and a second press to lock it in.
 *
 * The essentials only: the two sides, when it starts, what the stake pays. The "are you sure" is a
 * step inside the window rather than a second dialog, in the room's own colours: the stake is gone
 * the moment it is down and cannot be taken back.
 */
function BetWindow({
  fight,
  book,
  now,
  onClose,
}: {
  fight: StackhouseFight;
  book: StackhouseResponse;
  now: Date;
  onClose: () => void;
}) {
  const caps = useMe().data?.base?.resources.caps ?? 0;
  const place = usePlaceStackhouseBet();
  const [side, setSide] = useState<BattleSide | null>(null);
  const most = Math.max(1, Math.min(book.maxStake, caps));
  const [stake, setStake] = useState(Math.min(1_000, most));
  const [sure, setSure] = useState(false);
  const backing = side === null ? null : fight[side].name;
  const short = caps < 1;

  return (
    <Modal
      onClose={onClose}
      labelledBy="stackhouse-title"
      size="default"
      data-testid="stackhouse-window"
      className="border-tangerine-500/40"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-tangerine-700/60 px-5 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-tangerine-500/60 bg-tangerine-700/30"
        >
          <Icon name="caps" className="h-5 w-5 text-tangerine-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
            The Stackhouse
          </span>
          <h2
            id="stackhouse-title"
            className="min-w-0 break-words font-stamp text-[18px] leading-tight text-tangerine-100"
          >
            {fight.place}
          </h2>
        </span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Walk away
        </Button>
      </header>

      <div className="flex flex-col gap-4 bg-soot-900/60 p-5">
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          {fight.districtName}. Starts in{' '}
          <span className="tabular-nums text-tangerine-100">
            {formatRemaining(Date.parse(fight.startsAt) - now.getTime())}
          </span>
          ; betting closes in{' '}
          <span className="tabular-nums text-tangerine-100">
            {formatRemaining(Date.parse(fight.closesAt) - now.getTime())}
          </span>
          .
        </p>

        {sure && side !== null && backing !== null ? (
          <div className="flex flex-col gap-3" data-testid="stackhouse-sure">
            <p className="font-body text-[14px] leading-relaxed text-ink-100">
              Put{' '}
              <span className="font-semibold tabular-nums text-tangerine-100">
                {stake.toLocaleString()} caps
              </span>{' '}
              on <span className="font-semibold text-tangerine-100">{backing}</span>?
            </p>
            {place.error !== null && <ErrorNote>{place.error.message}</ErrorNote>}
            <div className="flex flex-wrap gap-2">
              <DrawnButton
                tone="danger"
                disabled={place.isPending}
                onClick={() =>
                  place.mutate(
                    { battleId: fight.battleId, side, stake },
                    { onSuccess: () => onClose() },
                  )
                }
                data-testid="stackhouse-lock-in"
              >
                {place.isPending ? 'Laying it down…' : 'Lock it in'}
              </DrawnButton>
              <Button variant="ghost" onClick={() => setSure(false)} data-testid="stackhouse-back">
                Back
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-tangerine-300">
                Who wins
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(['attacker', 'defender'] as const).map((one) => (
                  <SidePick
                    key={one}
                    label={one === 'attacker' ? 'Attacking' : 'Defending'}
                    name={fight[one].name}
                    yours={fight[one].yours}
                    chosen={side === one}
                    onPick={() => setSide(one)}
                    testId={`stackhouse-side-${one}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <NumberField
                label="Stake in caps"
                value={stake}
                min={1}
                max={most}
                step={100}
                onChange={setStake}
                disabled={short}
                data-testid="stackhouse-stake"
              />
              <p className="pb-1 font-body text-[12px] text-ink-300">
                Pays{' '}
                <span className="tabular-nums text-tangerine-100">
                  {stackhousePayout(stake).toLocaleString()}
                </span>{' '}
                if {backing ?? 'your side'} wins. Up to {book.maxStake.toLocaleString()}.
              </p>
            </div>
            {short && <ErrorNote>You have no caps to put down.</ErrorNote>}
            <DrawnButton
              disabled={side === null || short}
              onClick={() => setSure(true)}
              className="self-start"
              data-testid="stackhouse-place"
            >
              {side === null ? 'Pick a side' : 'Place the bet'}
            </DrawnButton>
          </>
        )}
      </div>
    </Modal>
  );
}

function SidePick({
  label,
  name,
  yours,
  chosen,
  onPick,
  testId,
}: {
  label: string;
  name: string;
  yours: boolean;
  chosen: boolean;
  onPick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={chosen}
      className={cn(
        'group/pick relative flex min-w-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-all duration-150',
        'hover:-translate-y-px active:translate-y-px',
        chosen ? 'text-tangerine-100' : 'text-ink-200 hover:text-tangerine-100',
      )}
      data-testid={testId}
    >
      <DrawnFace
        face={cn(
          'transition-all duration-150',
          chosen
            ? 'fill-tangerine-300/45'
            : 'fill-soot-900/80 group-hover/pick:fill-tangerine-300/15',
        )}
      />
      <span className="relative font-display text-[10px] font-bold uppercase tracking-[0.18em] text-tangerine-300">
        {label}
        {yours && ' · yours'}
      </span>
      <span className="relative min-w-0 break-words font-stamp text-[15px] leading-tight">
        {name}
      </span>
    </button>
  );
}
