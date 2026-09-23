import {
  AUTOMATION_ORDERS,
  AUTOMATION_RUNGS,
  ORDER_SEQUENCES,
  PLAYER_UNITS,
  RESOURCE_ORDER,
  OFFICER_ROLE_LABELS,
  findResearchItem,
  readyAt,
  unitSlotsAtHome,
  type Automation,
  type AutomationOrder,
  type AutomationsResponse,
  type OfficerRole,
  type ResourceKey,
} from '@frontline/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RESOURCE_META } from '../../components/Resources';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { Dropdown } from '../../components/ui/Dropdown';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { NumberField } from '../../components/ui/NumberField';
import { QuickAmount } from '../../components/ui/QuickAmount';
import { cn } from '../../lib/cn';
import { useAutomations, useMe, useSaveAutomation } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { OrdersMark } from './CensusMarks';

/**
 * The Right Hand's standing orders, on the Monitor's third page (§C2b, maintainer 2026-09-22).
 *
 * One drawn sheet per slot. A slot is a form the player fills once and switches on, and after
 * that the world clock does the work: the sheet's job is to say what the order is, whether it is
 * running, resting or stalled, and why, in the same hand as the rest of the Monitor.
 *
 * ## What the screen refuses to guess
 *
 * Everything gated is gated on `powers`, which the server answers off the crew's research. The
 * page never decides for itself that a rung is in. A control the crew has not earned is drawn
 * shut with the rung's name on it, which is the same treatment a locked door gets elsewhere and
 * the one that tells a player what to go and do.
 *
 * ## Why the form is whole
 *
 * A slot is posted as one shape, not patched field by field. The two ways of naming who goes
 * (an exact party, or a size the Right Hand fills) are exclusive, and the server refuses a slot
 * carrying both. Holding the whole form here and posting it once is what makes that refusal a
 * thing the player never sees.
 */

const ORDER_LABELS: Readonly<Record<AutomationOrder, string>> = {
  missions: 'Missions only',
  battles: 'Battles only',
  mixed: 'Missions and battles',
};

/** The rung that opens a thing, named for a shut control. */
function rungName(id: string): string {
  return findResearchItem(id)?.name ?? id;
}

/** What a slot looks like before the player has touched it. */
function blank(slot: number): Automation {
  return {
    id: '',
    baseId: '',
    slot,
    kind: 'missions',
    enabled: false,
    order: 'missions',
    step: 0,
    force: {},
    officerId: null,
    unitSlots: null,
    optimiseFor: null,
    missionId: null,
    restingSince: null,
    stalled: null,
  };
}

export function AutomationsPage() {
  const query = useAutomations();
  const data = query.data;

  if (!data) {
    return (
      <ScreenLoad
        what="The standing orders"
        loading="Reading the orders…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. Whatever the Right Hand was doing, they are still doing."
      />
    );
  }

  if (!data.powers.unlocked) return <ShutDoor />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="automations">
      <Ladder powers={data.powers} />
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {Array.from({ length: Math.max(1, data.powers.slots) }, (_, index) => {
          const held = data.slots.find((one) => one.slot === index) ?? blank(index);
          return (
            <SlotSheet
              /*
               * Keyed on the row's identity and its switch, not on the index.
               *
               * The form is seeded from the held row. Re-seeding it from every poll is what made
               * this sheet unusable: `force` and the rest arrive as fresh objects five seconds
               * apart, so an effect watching them fired on every answer and put the whole form
               * back to what the server last stored, wiping a party the player was in the middle
               * of naming and knocking "Best fit" back to "This party". A key does the same job
               * honestly: the sheet is rebuilt when the row is genuinely a different row or has
               * been switched on or off, and at no other time.
               */
              key={`${index}:${held.id}:${held.enabled ? 'on' : 'off'}`}
              slot={index}
              held={held}
              powers={data.powers}
              officers={data.officers}
              serverNow={data.serverNow}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The whole page before the third rung: a shut door, with the rung's name on it. */
function ShutDoor() {
  return (
    <section
      className="ink-frame card-paper washed grain relative mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-sm p-6 text-center shadow-panel"
      data-testid="automations-locked"
    >
      <OrdersMark className="h-12 w-12 text-brass-300/70" />
      <h3 className="font-stamp text-[18px] leading-tight text-ink-100">
        Nobody to leave orders with
      </h3>
      <p className="max-w-prose font-body text-[13px] leading-relaxed text-ink-300">
        Standing orders are the Right Hand&apos;s work.{' '}
        <strong>{rungName(AUTOMATION_RUNGS.open)}</strong>, the third rung on their track, is what
        opens this page: after it, a party goes out on your orders while you are away, and comes
        home on the world&apos;s clock whether you are watching or not.
      </p>
      <Link
        to="/game/research?track=right_hand"
        className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300 hover:underline"
      >
        Open the Right Hand&apos;s track
      </Link>
    </section>
  );
}

/**
 * The ladder, drawn as a strip of what is open and what is still to earn.
 *
 * Every step is a real rung on the Right Hand's track, named, so a player reading a shut step
 * knows the research to start rather than the concept it stands for.
 */
function Ladder({ powers }: { powers: AutomationsResponse['powers'] }) {
  const steps: { label: string; open: boolean; rung: string; tip: string }[] = [
    {
      label: 'One slot',
      open: powers.unlocked,
      rung: AUTOMATION_RUNGS.open,
      tip: 'One standing order at a time: the party you name, the officer you name, no fights.',
    },
    {
      label: 'Best fit',
      open: powers.bestFit,
      rung: AUTOMATION_RUNGS.bestFit,
      tip: 'Name a size in unit slots instead of a party. The Right Hand picks the units and the leader.',
    },
    {
      label: 'Five minute gap',
      open: powers.cooldownMs <= 5 * 60_000,
      rung: AUTOMATION_RUNGS.fastCooldown,
      tip: 'The wait between a party walking in and the next going out drops from fifteen minutes to five.',
    },
    {
      label: 'Second slot',
      open: powers.slots >= 2,
      rung: AUTOMATION_RUNGS.secondSlot,
      tip: 'A second standing order, so two parties can be out at the same time.',
    },
    {
      label: 'Chase a resource',
      open: powers.optimise,
      rung: AUTOMATION_RUNGS.optimise,
      tip: 'Pick one resource and the slot takes whichever job pays the most of it per minute.',
    },
    {
      label: 'Battles',
      open: powers.orders.includes('battles'),
      rung: AUTOMATION_RUNGS.battles,
      tip: 'Battle jobs off the board as well as plain work. Never a fight on a location.',
    },
    {
      label: 'Both kinds',
      open: powers.orders.includes('mixed'),
      rung: AUTOMATION_RUNGS.mixedOrders,
      tip: 'One order that alternates: a mission, then a fight, then a mission, for as long as it is on.',
    },
  ];
  return (
    <section
      className="ink-frame card-paper washed grain relative flex shrink-0 flex-col gap-1.5 rounded-sm px-4 py-2.5 shadow-panel"
      data-testid="automations-ladder"
    >
      <h3 className="font-stamp text-[15px] leading-none text-brass-300">
        What the Right Hand may do
      </h3>
      <span aria-hidden className="block h-1.5 w-full text-brass-300/50">
        <DrawnRule />
      </span>
      <ul className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <li
            key={step.rung}
            /*
             * `data-tip`, not `title` (maintainer, 2026-09-23). A rung's name says which research
             * opens a thing and nothing about what the thing is, and the browser's own tooltip
             * arrives a second late in the operating system's grey. This is the game's drawn
             * hover, and it carries the sentence.
             */
            data-tip={step.open ? step.tip : `${step.tip} Opens with ${rungName(step.rung)}.`}
            className={cn(
              'ink-box px-2.5 py-1 font-display text-[10px] uppercase tracking-[0.16em]',
              step.open ? 'text-brass-100' : 'text-ink-400 opacity-70',
            )}
            data-testid={`ladder-${step.rung}`}
            data-open={step.open ? 'yes' : 'no'}
          >
            {step.label}
            {!step.open && (
              <span className="ml-1.5 normal-case tracking-normal text-ink-500">
                {rungName(step.rung)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One slot: the order, who goes, and what it is doing right now.
 *
 * The state line at the top is the one thing on the sheet the world clock changes, and it is read
 * off the held row every poll: out, resting with a countdown, stalled with the reason, or off.
 */
function SlotSheet({
  slot,
  held,
  powers,
  officers,
  serverNow,
}: {
  slot: number;
  held: Automation;
  powers: AutomationsResponse['powers'];
  officers: AutomationsResponse['officers'];
  serverNow: string;
}) {
  const save = useSaveAutomation();
  const me = useMe();
  const army = me.data?.base?.army ?? {};

  /*
   * The form, seeded once from the held row.
   *
   * Nothing re-seeds it while the player is in it: the sheet is keyed on the row's identity by
   * the page above, so a new row or a press of the switch rebuilds it and a five-second poll
   * carrying the same row does not touch it.
   */
  const [order, setOrder] = useState<AutomationOrder>(held.order);
  const [byCount, setByCount] = useState<boolean>(held.unitSlots !== null);
  const [unitSlots, setUnitSlots] = useState<number>(held.unitSlots ?? 6);
  const [force, setForce] = useState<Record<string, number>>(held.force);
  const [officerId, setOfficerId] = useState<string | null>(held.officerId);
  const [optimiseFor, setOptimiseFor] = useState<ResourceKey | null>(held.optimiseFor);

  const post = (enabled: boolean) =>
    save.mutate({
      slot,
      enabled,
      order,
      force: byCount ? {} : force,
      officerId: byCount ? null : officerId,
      unitSlots: byCount ? unitSlots : null,
      optimiseFor: powers.optimise ? optimiseFor : null,
    });

  const partyNamed = byCount
    ? unitSlots > 0
    : Object.values(force).some((count) => count > 0) && officerId !== null;

  /** One unit's count in the party, with a zero taken off the sheet rather than written as 0. */
  const setUnit = (unitId: string, count: number): void =>
    setForce((was) => {
      const next = { ...was };
      if (count <= 0) delete next[unitId];
      else next[unitId] = count;
      return next;
    });

  /** Every unit slot at home: the ceiling on a size the Right Hand can be asked to fill. */
  const slotsAtHome = unitSlotsAtHome(army);
  /** A share of the slots at home, never under one, for the three quick amounts. */
  const share = (fraction: number): number => Math.max(1, Math.floor(slotsAtHome * fraction));

  return (
    <section
      className={cn(
        'ink-frame card-paper washed grain relative flex min-w-0 flex-col gap-2.5 rounded-sm p-3.5 shadow-panel',
        held.enabled && 'ink-frame-brass',
      )}
      data-testid={`automation-${slot}`}
      data-enabled={held.enabled ? 'yes' : 'no'}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-stamp text-[15px] leading-none text-brass-300">
          Standing order {slot + 1}
        </h3>
        <StateLine held={held} powers={powers} serverNow={serverNow} />
      </header>
      <span aria-hidden className="block h-1.5 w-full text-brass-300/50">
        <DrawnRule />
      </span>

      <Field label="The order">
        <Dropdown
          label={`What standing order ${String(slot + 1)} takes`}
          value={order}
          disabled={held.enabled}
          onChange={setOrder}
          options={AUTOMATION_ORDERS.map((one) => ({
            value: one,
            label: ORDER_LABELS[one],
            ...(powers.orders.includes(one)
              ? {}
              : { hint: `Opens with ${rungName(orderRung(one))}` }),
            disabled: !powers.orders.includes(one),
          }))}
          data-testid={`automation-${slot}-order`}
        />
        <p className="mt-1 font-body text-[11px] leading-snug text-ink-400">
          {ORDER_SEQUENCES[order]
            .map((kind) => (kind === 'battle' ? 'Battle' : 'Mission'))
            .join(', ')}
          , then again. Never a fight on a location.
        </p>
      </Field>

      <Field label="Who goes">
        <div className="mb-2 flex gap-2">
          <Choice
            active={!byCount}
            disabled={held.enabled}
            onPick={() => setByCount(false)}
            testId={`automation-${slot}-exact`}
          >
            This party
          </Choice>
          <Choice
            active={byCount}
            disabled={held.enabled || !powers.bestFit}
            onPick={() => setByCount(true)}
            testId={`automation-${slot}-bestfit`}
            tip={
              powers.bestFit
                ? 'Name a size in unit slots. The Right Hand fills it with the best party and the best free officer for the job, every time it sends.'
                : `Opens with ${rungName(AUTOMATION_RUNGS.bestFit)}.`
            }
          >
            Best fit {powers.bestFit ? '' : '(locked)'}
          </Choice>
        </div>
        {byCount ? (
          /*
           * A size and nothing else (maintainer, 2026-09-23). The party and the officer are the
           * Right Hand's to choose at the moment the party leaves, and the sheet shows none of it:
           * no preview, no names. The player names how many slots and trusts the chair.
           */
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-body text-[12px] text-ink-300">Unit slots to send</span>
            <NumberField
              label="How many unit slots to send"
              value={unitSlots}
              min={1}
              max={Math.max(1, slotsAtHome)}
              onChange={setUnitSlots}
              disabled={held.enabled}
              className="w-[7.5rem]"
              data-testid={`automation-${slot}-size`}
            />
            <QuickAmount
              label="1/4"
              disabled={held.enabled || slotsAtHome < 1}
              testId={`automation-${slot}-size-quarter`}
              onClick={() => setUnitSlots(share(0.25))}
            />
            <QuickAmount
              label="Half"
              disabled={held.enabled || slotsAtHome < 1}
              testId={`automation-${slot}-size-half`}
              onClick={() => setUnitSlots(share(0.5))}
            />
            <QuickAmount
              label="All"
              disabled={held.enabled || slotsAtHome < 1}
              testId={`automation-${slot}-size-all`}
              onClick={() => setUnitSlots(slotsAtHome)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/*
             * Capped to four whole rows and scrolled inside itself, so a sheet's height is bounded
             * by its form and not by the size of the roster. Without the cap a late crew's unit
             * list ran the second sheet under the fold at 900px and the clipping guard caught the
             * footer sliced mid-line. Rows are a fixed `h-9`, so the list's own scroll edge always
             * lands on a row boundary and never through a name.
             */}
            <ul className="flex max-h-[10rem] flex-col gap-1 overflow-y-auto pr-1">
              {PLAYER_UNITS.filter((unit) => (army[unit.id] ?? 0) > 0).map((unit) => {
                const count = army[unit.id] ?? 0;
                return (
                  <li
                    key={unit.id}
                    className="flex h-9 items-center gap-2 rounded-sm border border-surface-700 bg-surface-950/40 px-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-body text-[12px] text-ink-200">
                      {unit.name}
                      <span className="ml-1.5 font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
                        {count} at home
                      </span>
                    </span>
                    <QuickAmount
                      label="Half"
                      disabled={held.enabled || count < 2}
                      testId={`automation-${slot}-half-${unit.id}`}
                      onClick={() => setUnit(unit.id, Math.floor(count / 2))}
                    />
                    <QuickAmount
                      label="Max"
                      disabled={held.enabled || count < 1}
                      testId={`automation-${slot}-max-${unit.id}`}
                      onClick={() => setUnit(unit.id, count)}
                    />
                    <NumberField
                      label={`How many ${unit.name}`}
                      value={force[unit.id] ?? 0}
                      min={0}
                      max={count}
                      disabled={held.enabled}
                      onChange={(value) => setUnit(unit.id, value)}
                      data-testid={`automation-${slot}-unit-${unit.id}`}
                    />
                  </li>
                );
              })}
            </ul>
            <Dropdown
              label={`Who leads standing order ${String(slot + 1)}`}
              value={officerId ?? ''}
              disabled={held.enabled}
              placeholder="Choose the officer who leads"
              onChange={(value) => setOfficerId(value || null)}
              options={officers.map((officer) => ({
                value: officer.id,
                label: officer.name,
                // A chair is nullable on the wire: an officer on the books with no seat is still
                // somebody who can lead a party out.
                hint: roleLabel(officer.role),
              }))}
              data-testid={`automation-${slot}-officer`}
            />
          </div>
        )}
      </Field>

      {powers.optimise && (
        <Field label="Chase">
          <Dropdown
            label={`What standing order ${String(slot + 1)} chases`}
            value={optimiseFor ?? ''}
            disabled={held.enabled}
            onChange={(value) => setOptimiseFor(value === '' ? null : value)}
            options={[
              { value: '', label: 'The best job overall' },
              ...RESOURCE_ORDER.map((key) => ({
                value: key,
                label: `Most ${RESOURCE_META[key].label} per minute`,
              })),
            ]}
            data-testid={`automation-${slot}-optimise`}
          />
        </Field>
      )}

      {save.error && (
        <p role="alert" className="font-body text-[12px] text-oxblood-300">
          {save.error.message}
        </p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-[11px] leading-snug text-ink-400">
          {held.enabled
            ? 'While this is on, the mission board is the Right Hand’s.'
            : 'Switching this on hands the mission board to the Right Hand.'}
        </p>
        {held.enabled ? (
          <DrawnButton
            size="sm"
            tone="danger"
            disabled={save.isPending}
            onClick={() => post(false)}
            data-testid={`automation-${slot}-off`}
          >
            Switch off
          </DrawnButton>
        ) : (
          <DrawnButton
            size="sm"
            tone="go"
            disabled={save.isPending || !partyNamed}
            onClick={() => post(true)}
            data-testid={`automation-${slot}-on`}
          >
            Switch on
          </DrawnButton>
        )}
      </footer>
    </section>
  );
}

/** The chair an officer sits in, in the words the rest of the game uses for it. */
function roleLabel(role: string | null): string {
  return role === null ? 'No chair' : (OFFICER_ROLE_LABELS[role as OfficerRole] ?? role);
}

/** The rung an order needs, for the label on a shut option. */
function orderRung(order: AutomationOrder): string {
  return order === 'missions'
    ? AUTOMATION_RUNGS.open
    : order === 'battles'
      ? AUTOMATION_RUNGS.battles
      : AUTOMATION_RUNGS.mixedOrders;
}

/** What the slot is doing right now, in one line the poll keeps current. */
function StateLine({
  held,
  powers,
  serverNow,
}: {
  held: Automation;
  powers: AutomationsResponse['powers'];
  serverNow: string;
}) {
  if (!held.enabled) {
    return (
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">Off</span>
    );
  }
  if (held.missionId !== null) {
    return (
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-verdigris-300">
        A party is out
      </span>
    );
  }
  const ready = readyAt(held, powers.cooldownMs);
  const left = ready === null ? 0 : ready - Date.parse(serverNow);
  if (left > 0) {
    return (
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-brass-300">
        Resting, {formatRemaining(left)}
      </span>
    );
  }
  if (held.stalled) {
    return (
      <span
        className="font-display text-[10px] uppercase tracking-[0.18em] text-oxblood-300"
        title={held.stalled}
        data-testid="automation-stalled"
      >
        Waiting: {held.stalled}
      </span>
    );
  }
  return (
    <span className="font-display text-[10px] uppercase tracking-[0.18em] text-brass-100">
      Ready
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A two-way pick, drawn as a pair of inked boxes rather than radio buttons. */
function Choice({
  active,
  disabled,
  onPick,
  children,
  testId,
  tip,
}: {
  active: boolean;
  disabled: boolean;
  onPick: () => void;
  children: React.ReactNode;
  testId: string;
  /** The drawn hover, for a pick whose name does not say what it does. */
  tip?: string | undefined;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      data-tip={tip}
      aria-pressed={active}
      className={cn(
        'ink-box px-3 py-1 font-display text-[10px] uppercase tracking-[0.16em] transition-colors',
        active ? 'text-brass-100' : 'text-ink-400 hover:text-brass-300',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
