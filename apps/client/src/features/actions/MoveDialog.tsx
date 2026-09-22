import {
  VEHICLES,
  armySize,
  findUnit,
  samePlace,
  vehicleNoun,
  type Army,
  type Fleet,
  type MoveDestination,
  type MovePlace,
  type UnitsResponse,
} from '@frontline/shared';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown, type DropdownOption } from '../../components/ui/Dropdown';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { ApiRequestError } from '../../lib/api';
import { useMoveQuote, useMoveUnits } from '../../lib/queries';
import { formatDuration } from '../base/format';

/**
 * Moving units between the crew's places (maintainer ruling, 2026-09-22).
 *
 * The mission send dialog's shape, without the odds and the kind: where from, where to, who, what
 * they ride in, and how long. "Where from" is the places this crew has people standing, "where
 * to" is everywhere a column could land: the district, the gate, ground the crew holds, and
 * ground the faction holds. The clock is quoted off the server as the picker changes, because it
 * folds the column's speed, the machines and the crew's road bonuses, and a figure worked out
 * here would be a second copy of that arithmetic.
 */

type PlaceKey = string;

const keyOf = (place: MovePlace): PlaceKey =>
  place.kind === 'location' ? `location:${place.locationId}` : place.kind;

export function MoveDialog({
  roster,
  unitId,
  onClose,
}: {
  roster: UnitsResponse;
  /** The row the button was pressed on: preselected, the rest of the source offered beside it. */
  unitId: string;
  onClose: () => void;
}) {
  const destinations = roster.moveDestinations;
  const byKey = useMemo(
    () => new Map(destinations.map((entry) => [keyOf(entry.place), entry])),
    [destinations],
  );

  /** Where this crew has anybody standing: the district, the gate, and its held or posted ground. */
  const sources = useMemo(() => {
    const out: { key: PlaceKey; entry: MoveDestination; standing: Army }[] = [];
    for (const entry of destinations) {
      const standing = standingAt(roster, entry.place);
      if (armySize(standing) > 0) out.push({ key: keyOf(entry.place), entry, standing });
    }
    return out;
  }, [destinations, roster]);

  const firstSource =
    sources.find((source) => (source.standing[unitId] ?? 0) > 0) ?? sources[0] ?? null;
  const [fromKey, setFromKey] = useState<PlaceKey>(firstSource?.key ?? 'district');
  const [toKey, setToKey] = useState<PlaceKey>(fromKey === 'gate' ? 'district' : 'gate');
  const [force, setForce] = useState<Army>(() =>
    firstSource && (firstSource.standing[unitId] ?? 0) > 0 ? { [unitId]: 1 } : {},
  );
  const [riding, setRiding] = useState<Fleet>({});

  const from = byKey.get(fromKey)?.place ?? { kind: 'district' };
  const to = byKey.get(toKey)?.place ?? { kind: 'gate' };
  const standing = standingAt(roster, from);
  const fromDistrict = from.kind === 'district';
  const fleet = fromDistrict ? roster.fleet : {};
  const sending: Army = Object.fromEntries(
    Object.entries(force).filter(([id, count]) => count > 0 && (standing[id] ?? 0) >= count),
  );
  const vehicles: Fleet = fromDistrict
    ? Object.fromEntries(Object.entries(riding).filter(([, count]) => (count ?? 0) > 0))
    : {};
  const chosen = armySize(sending);
  const legal = chosen > 0 && !samePlace(from, to);

  const quote = useMoveQuote(legal ? { from, to, army: sending, vehicles } : null);
  const move = useMoveUnits();

  const options = (exclude: PlaceKey | null): DropdownOption<PlaceKey>[] =>
    destinations
      .filter((entry) => keyOf(entry.place) !== exclude)
      .map((entry) => ({
        value: keyOf(entry.place),
        label: entry.label,
        ...(entry.districtName
          ? {
              hint: `${entry.districtName}${entry.holderName ? ` · ${entry.holderName}'s` : ''}`,
            }
          : {}),
        group: entry.group === 'yours' ? 'Yours' : 'The faction',
      }));

  const units = Object.entries(standing)
    .filter(([, count]) => count > 0)
    .flatMap(([id, count]) => {
      const unit = findUnit(id);
      return unit ? [{ unit, count }] : [];
    });

  return (
    <Modal onClose={onClose} labelledBy="move-dialog-title" data-testid="move-dialog">
      <div className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4">
        <h2
          id="move-dialog-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
        >
          Move units
        </h2>
        <p className="font-body text-xs leading-relaxed text-ink-300">
          Between your district, your gate, ground you hold and ground the faction holds. Ground
          nobody holds is yours when they arrive. They can be turned round in the first tenth of the
          walk.
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Dropdown
            label="From"
            value={fromKey}
            options={sources.map(({ key, entry, standing: there }) => ({
              value: key,
              label: entry.label,
              hint: `${armySize(there)} standing${entry.districtName ? ` · ${entry.districtName}` : ''}`,
              group: entry.group === 'yours' ? 'Yours' : 'The faction',
            }))}
            onChange={(next) => {
              setFromKey(next);
              setForce({});
              setRiding({});
              if (next === toKey) setToKey(next === 'district' ? 'gate' : 'district');
            }}
            data-testid="move-from"
          />
          <Dropdown
            label="To"
            value={toKey}
            options={options(fromKey)}
            onChange={setToKey}
            data-testid="move-to"
          />
        </div>

        {units.length === 0 ? (
          <p className="font-body text-xs leading-relaxed text-ink-300">
            Nobody is standing there.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="move-units">
            {units.map(({ unit, count }) => (
              <li
                key={unit.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-surface-700 px-2.5 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                    {unit.name}
                  </span>
                  <span className="block font-body text-[11px] text-ink-300">
                    Speed {unit.stats.speed} · {unit.unitSlots} unit slots each
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <NumberField
                    label={`How many ${unit.name}`}
                    min={0}
                    max={count}
                    value={force[unit.id] ?? 0}
                    onChange={(next) =>
                      setForce((held) => ({ ...held, [unit.id]: Math.min(count, next) }))
                    }
                    data-testid={`move-count-${unit.id}`}
                  />
                  <span className="font-display text-[11px] tabular-nums text-ink-300">
                    / {count}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {fromDistrict && Object.values(fleet).some((count) => (count ?? 0) > 0) && (
          <div className="flex flex-col gap-1.5" data-testid="move-vehicles">
            <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
              Vehicles
            </span>
            <ul className="flex flex-col gap-1">
              {VEHICLES.filter((spec) => (fleet[spec.id] ?? 0) > 0).map((spec) => (
                <li
                  key={spec.id}
                  className="flex items-center justify-between gap-2 rounded-sm border border-surface-600/70 px-2.5 py-1.5"
                >
                  <span className="min-w-0 font-display text-[12px] text-ink-200">
                    {spec.name}
                    <span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-400">
                      {spec.capacity} unit slots
                    </span>
                  </span>
                  <NumberField
                    label={`How many ${vehicleNoun(spec.name)}`}
                    value={riding[spec.id] ?? 0}
                    min={0}
                    max={fleet[spec.id] ?? 0}
                    onChange={(value) => setRiding((held) => ({ ...held, [spec.id]: value }))}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <dl className="flex flex-col divide-y divide-surface-700 border-t border-surface-700 pt-1">
          <Line label="Sending" value={String(chosen)} />
          <Line
            label="On the road"
            value={
              !legal
                ? 'Pick somebody and somewhere'
                : quote.data
                  ? formatDuration(quote.data.minutes * 60)
                  : 'Working it out…'
            }
            testId="move-time"
          />
        </dl>

        {move.error !== null && (
          <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
            {move.error instanceof ApiRequestError ? move.error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-700 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!legal || move.isPending}
          onClick={() => move.mutate({ from, to, army: sending, vehicles }, { onSuccess: onClose })}
          data-testid="move-confirm"
        >
          {move.isPending ? 'Sending…' : 'Send them'}
        </Button>
      </footer>
    </Modal>
  );
}

/** What the crew has standing at a place, off the roster read. */
function standingAt(roster: UnitsResponse, place: MovePlace): Army {
  if (place.kind === 'district') return roster.army;
  if (place.kind === 'gate') return roster.gateArmy;
  return roster.standingAt[place.locationId] ?? {};
}

function Line({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="font-display text-[13px] tabular-nums text-ink-100" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
