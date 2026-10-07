import { PLAYER_UNITS, UNIT_CATALOG, findUnit, type LocationView } from '@frontline/shared';
import { useState } from 'react';
import { RewardLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown, type DropdownOption } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { PressError } from '../../components/ui/PressError';
import { cn } from '../../lib/cn';
import { usePinPamphlets, useSwapPamphlet, useThrowSwitch } from '../../lib/queries';
import { formatRemaining } from '../base/format';

/*
 * Reliquary's sheet controls (maintainer, 2026-10-06: "every chooser/switch lives INSIDE the
 * location's own sheet"). Each one reads the view the district already carries and refuses on the
 * button (greyed, reason on hover) before the server has to; what slips past is a `PressError`
 * beside the button it was pressed on, so nothing on the sheet moves.
 */

type Write = { baseId: string | undefined; districtId: string; locationId: string };

const unitName = (unitId: string) => findUnit(unitId)?.name ?? unitId;

const HEADING = 'font-display text-[11px] uppercase tracking-[0.16em] text-brass-300';
const NOTE = 'font-body text-[12px] leading-relaxed text-ink-200';

/** The Tolling Tower's switch: one button, and the cooldown as the reason it is greyed. */
export function TollingSwitch({
  state,
  now,
  ...write
}: Write & { state: NonNullable<LocationView['switch']>; now: Date }) {
  const throwSwitch = useThrowSwitch(write.baseId, write.districtId);
  const waitMs = state.changesAt === null ? 0 : Date.parse(state.changesAt) - now.getTime();
  const refusal =
    waitMs > 0 ? `Thrown recently, ${formatRemaining(waitMs)} before it turns again` : null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-sm border border-brass-500/30 bg-brass-300/5 p-2.5"
      data-testid={`switch-${write.locationId}`}
    >
      <span className={HEADING} data-testid={`switch-state-${write.locationId}`}>
        {state.on ? 'The bells are ringing' : 'The bells are silent'}
      </span>
      <p className={cn(NOTE, 'min-w-0 flex-1')}>
        {state.on
          ? 'Every location in the district is Noisy, and your units ignore Noisy everywhere.'
          : 'Thrown on, every location in the district turns Noisy for everybody but your units.'}
      </p>
      <Button
        size="sm"
        refusal={refusal}
        disabled={throwSwitch.isPending}
        data-testid={`switch-throw-${write.locationId}`}
        onClick={() => throwSwitch.mutate({ locationId: write.locationId, on: !state.on })}
      >
        {throwSwitch.isPending ? 'Throwing…' : state.on ? 'Switch off' : 'Switch on'}
      </Button>
      {throwSwitch.error && (
        <PressError onDismiss={throwSwitch.reset}>{throwSwitch.error.message}</PressError>
      )}
    </div>
  );
}

const PLAYER_UNIT_OPTIONS: DropdownOption<string>[] = PLAYER_UNITS.map((unit) => ({
  value: unit.id,
  label: unit.name,
}));

/**
 * The Pamphlet Wall's pins: one dropdown a pin, all set in one press while the wall is unlocked,
 * and one paid swap once it is full at its top level.
 */
export function PamphletPicker({
  wall,
  caps,
  now,
  ...write
}: Write & { wall: NonNullable<LocationView['pamphlets']>; caps: number; now: Date }) {
  const pin = usePinPamphlets(write.baseId, write.districtId);
  const swap = useSwapPamphlet(write.baseId, write.districtId);
  const [picks, setPicks] = useState<string[]>(() =>
    Array.from({ length: wall.capacity }, (_, index) => wall.pins[index] ?? ''),
  );
  const [from, setFrom] = useState(wall.pins[0] ?? '');
  const [to, setTo] = useState('');

  const chosen = picks.filter((unitId) => unitId !== '');
  const pinRefusal = !wall.unlocked
    ? 'The pins are set until the wall is next worked up'
    : chosen.length < wall.capacity
      ? 'Choose a unit for every pin'
      : new Set(chosen).size < chosen.length
        ? 'The same unit is pinned twice'
        : null;

  const swapWaitMs =
    wall.swapAvailableAt === null ? 0 : Date.parse(wall.swapAvailableAt) - now.getTime();
  const swapRefusal =
    wall.swapCostCaps === null
      ? null
      : swapWaitMs > 0
        ? `Swapped recently, ${formatRemaining(swapWaitMs)} before the next`
        : caps < wall.swapCostCaps
          ? `Not enough caps: ${wall.swapCostCaps.toLocaleString()} needed`
          : from === '' || to === ''
            ? 'Choose the pin to take down and the unit to put up'
            : wall.pins.includes(to)
              ? `${unitName(to)} is already on the wall`
              : null;

  return (
    <div
      className="flex flex-col gap-2 rounded-sm border border-brass-500/30 bg-brass-300/5 p-2.5"
      data-testid={`pamphlets-${write.locationId}`}
    >
      <span className={HEADING}>
        {wall.pins.length} of {wall.capacity} pinned
        {wall.unlocked ? '' : ' · locked'}
      </span>
      <p className={NOTE}>
        A pinned unit fights at -5% offense and -5% vitality against you. The pins lock once set,
        and come loose again each time the wall is worked up.
      </p>
      <div className="flex flex-wrap gap-2">
        {picks.map((value, index) => (
          <Dropdown
            key={index}
            label={`Pin ${index + 1}`}
            placeholder="Nobody"
            value={value}
            options={PLAYER_UNIT_OPTIONS}
            disabled={!wall.unlocked}
            data-testid={`pamphlet-pin-${index + 1}-${write.locationId}`}
            onChange={(unitId) =>
              setPicks((current) => current.map((one, at) => (at === index ? unitId : one)))
            }
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          refusal={pinRefusal}
          disabled={pin.isPending}
          data-testid={`pamphlet-set-${write.locationId}`}
          onClick={() => pin.mutate({ locationId: write.locationId, pins: chosen })}
        >
          {pin.isPending ? 'Pinning…' : 'Pin them'}
        </Button>
        {pin.error && <PressError onDismiss={pin.reset}>{pin.error.message}</PressError>}
      </div>
      {wall.swapCostCaps !== null && (
        <div className="flex flex-wrap items-end gap-2 border-t border-surface-700/70 pt-2">
          <Dropdown
            label="Take down"
            value={from}
            options={wall.pins.map((unitId) => ({ value: unitId, label: unitName(unitId) }))}
            data-testid={`pamphlet-from-${write.locationId}`}
            onChange={setFrom}
          />
          <Dropdown
            label="Put up"
            placeholder="Choose"
            value={to}
            options={PLAYER_UNIT_OPTIONS.filter((option) => !wall.pins.includes(option.value))}
            data-testid={`pamphlet-to-${write.locationId}`}
            onChange={setTo}
          />
          <Button
            size="sm"
            refusal={swapRefusal}
            disabled={swap.isPending}
            data-testid={`pamphlet-swap-${write.locationId}`}
            onClick={() => swap.mutate({ locationId: write.locationId, from, to })}
          >
            {swap.isPending ? 'Swapping…' : `Swap for ${wall.swapCostCaps.toLocaleString()} caps`}
          </Button>
          {swap.error && <PressError onDismiss={swap.reset}>{swap.error.message}</PressError>}
        </div>
      )}
    </div>
  );
}

/**
 * The Trophy Hall: every unit in the game behind one disclosure, a tick on each killed since the
 * hall was taken, and what the ticks pay today.
 */
export function TrophyList({
  trophies,
  locationId,
}: {
  trophies: NonNullable<LocationView['trophies']>;
  locationId: string;
}) {
  const killed = UNIT_CATALOG.filter((unit) => (trophies.counted[unit.id] ?? 0) > 0).length;
  return (
    <div
      className="flex flex-col gap-2 rounded-sm border border-brass-500/30 bg-brass-300/5 p-2.5"
      data-testid={`trophies-${locationId}`}
    >
      <span className={HEADING}>
        {killed} of {UNIT_CATALOG.length} kinds on the wall
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Pays today
        </span>
        <RewardLine rewards={trophies.perDay} />
      </div>
      <details className="group">
        <summary
          className="flex cursor-pointer list-none items-center gap-1.5 font-display text-[11px] uppercase tracking-[0.16em] text-ink-200 hover:text-brass-100"
          data-testid={`trophies-open-${locationId}`}
        >
          <Icon name="chevron-down" aria-hidden className="h-3 w-3 group-open:rotate-180" />
          Every unit in the game
        </summary>
        <ul className="mt-1.5 grid max-h-48 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto">
          {UNIT_CATALOG.map((unit) => {
            const count = trophies.counted[unit.id] ?? 0;
            return (
              <li
                key={unit.id}
                data-testid={`trophy-${unit.id}`}
                data-killed={count > 0 ? 'yes' : undefined}
                className={cn(
                  'flex items-center gap-1.5 font-body text-[12px] leading-relaxed',
                  count > 0 ? 'text-verdigris-100' : 'text-ink-300',
                )}
              >
                <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
                  {count > 0 && <Icon name="check" aria-label="killed" className="h-3 w-3" />}
                </span>
                <span className="truncate">{unit.name}</span>
                {count > 0 && <span className="tabular-nums text-ink-300">x{count}</span>}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

/** A unit door's ladder: what each level gives the unit, with the held level marked. */
export function DoorLadder({
  door,
  locationId,
}: {
  door: NonNullable<LocationView['door']>;
  locationId: string;
}) {
  return (
    <ol className="flex flex-col gap-0.5" data-testid={`door-${locationId}`}>
      {door.steps.map((step, index) => {
        const level = index + 1;
        const held = level === door.level;
        return (
          <li
            key={level}
            data-testid={`door-step-${level}-${locationId}`}
            data-held={held ? 'yes' : undefined}
            className={cn(
              'flex items-baseline gap-2 font-body text-[12px] leading-relaxed',
              held ? 'text-brass-100' : level < door.level ? 'text-ink-200' : 'text-ink-300',
            )}
          >
            <span
              className={cn(
                'shrink-0 font-display text-[10px] uppercase tracking-[0.16em]',
                held ? 'text-brass-300' : 'text-ink-300',
              )}
            >
              L{level}
              {held ? ' · now' : ''}
            </span>
            <span>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
