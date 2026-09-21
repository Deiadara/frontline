import {
  VEHICLES,
  findUnit,
  fleetCapacity,
  meetsNotoriety,
  mergeFleets,
  notorietyTier,
  notorietyToField,
  lootCapacityOf,
  ridingUnitSlots,
  travelMinutes,
  type Army,
  type BattleView,
  type Fleet,
  type UnitLoadouts,
  type UnitOption,
  type UnitsResponse,
  type VehicleId,
  vehicleNoun,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { ApiRequestError } from '../../lib/api';
import { NumberField } from '../../components/ui/NumberField';
import { cn } from '../../lib/cn';
import { useTakeVehicles, useUnits } from '../../lib/queries';
import { UnitCard } from '../units/UnitCard';
import { walksAlways } from '../units/rules';
import { heldToLine, readColumn } from './column';
import { OnThisGround } from './EffectiveCard';
import { formatDuration } from '../base/format';

/**
 * Moving people to a fight that has not happened yet (GDD §A4).
 *
 * One column, and which one is the button's question rather than this dialog's: **the line** is the
 * battle army, **the ring** is the cordon outside it. They used to be two steppers on one row,
 * which put the whole decision in front of a player who had pressed a button that already said
 * where they were going, and gave every unit two identical fields to tell apart.
 *
 * Everything here is a **delta**, so the same dialog sends people and pulls them back. A negative
 * number is a withdrawal, and a withdrawal past a ring the other side has already set costs people,
 * which is why the numbers already on the ground are shown rather than assumed to be zero.
 *
 * ## The seats are the ceiling (§C3, maintainer request 2026-09-15)
 *
 * The machines are picked in this window now, under the units, and what they seat caps what goes:
 * *"once you choose vehicles you're limited up to that much"*. So a crew that wants forty unit
 * slots somewhere and owns one Scar takes eight slots' worth, comes home, and takes the rest on a
 * second run.
 *
 * Three rules hold the ceiling honest, and each of them is a shared function rather than a second
 * arithmetic that agrees by inspection:
 *
 * - **A seat is priced in unit slots** ({@link ridingUnitSlots}), the same cost a unit draws
 *   against the district's beds, and the same function the server settles the fight with. A
 *   Colossus is not one soldier anywhere else in the game and it is not one in a truck.
 * - **Seats are {@link fleetCapacity}** over the machines this crew has committed to this fight.
 * - **A sheet that will not ride needs no seat.** `no_ride` (`units/rules.ts`, `walksAlways`) keeps
 *   a unit off every machine, so it is off this number in both directions: it never eats a seat
 *   and the ceiling never stops it going. Unless this crew holds the waiver: `any_ride` lifts the
 *   rule, and the server spends the seat either way (`ridingUnitSlots(muster, effects.anyRide)`),
 *   so the window reads `UnitsResponse.anyRide` rather than the catalogue alone.
 *
 * **Nothing loaded is no ceiling.** An empty yard is the walk every column was before the Garage,
 * and `columnSpeed` still costs it honestly, so a crew with no machines sends what it always could.
 */

/** Which of the two places outside the district this dialog moves people to. */
export type DeployMode = 'line' | 'ring';

interface ModeCopy {
  /** What this window is, over the name of the fight. */
  eyebrow: string;
  /**
   * What this window is for, above the rows. Absent where the rows say it themselves.
   *
   * The line had one and it went (maintainer request, 2026-09-15): "a positive number sends units
   * out, a negative one calls them home" is a sentence about the number field, printed above a
   * grid of number fields that each carry their own label and their own live count. The ring keeps
   * its own, because the ring is a rule a player cannot read off the controls: that it never
   * fights, and that withdrawing past one costs units.
   */
  intro?: string;
  /** How the row says where a unit already is. */
  where: string;
  confirm: string;
  /** What the field is called, for anyone who cannot see the row it sits in. */
  field: (unitName: string) => string;
  testId: (unitId: string) => string;
}

const COPY: Record<DeployMode, ModeCopy> = {
  line: {
    eyebrow: 'The line',
    where: 'in the line',
    confirm: 'Move them',
    field: (unitName) => `${unitName} into the line`,
    testId: (unitId) => `line-${unitId}`,
  },
  ring: {
    eyebrow: 'The ring',
    intro:
      'The ring is the cordon thrown around the fight. It never takes part, it only stops the losing side walking away afterwards, so every unit on it is a unit not helping you win. A withdrawal past a ring the other side has already set costs unit slots. Positive sends them out, negative calls them home.',
    where: 'on the ring',
    confirm: 'Station them',
    field: (unitName) => `${unitName} onto the ring`,
    testId: (unitId) => `ring-${unitId}`,
  },
};

interface DeployDialogProps {
  view: BattleView;
  army: Army;
  /** §C3: the crew's brackets. The armour line takes speed off a sheet, so the road reads them. */
  loadouts: UnitLoadouts;
  /** §A4: what the crew's holdings and perks add to the bag, so the loot figure is the real one. */
  bagPercent: number;
  /** §C3: where the column starts, so the window can quote the road. Null puts no clock on it. */
  homeDistrictId: string | null;
  /** §D7: the crew's rank, which is what decides who will take a contract. */
  notoriety: number;
  mode: DeployMode;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (changes: Record<string, number>, perimeterChanges: Record<string, number>) => void;
}

export function DeployDialog({
  view,
  army,
  loadouts,
  bagPercent,
  homeDistrictId,
  notoriety,
  mode,
  pending,
  error,
  onClose,
  onConfirm,
}: DeployDialogProps) {
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const copy = COPY[mode];

  /*
   * The roster, for the card a name opens.
   *
   * `BattleView` carries counts and nothing else: the stats, marks and portrait a player wants
   * before committing anybody live on `UnitOption`, which only `/units` returns. It is a warm
   * cache by the time anybody reaches a fight (`usePrefetchScreens` reads it at login), and where
   * it is not, the name is drawn without a card rather than the dialog waiting on it.
   */
  const roster = useUnits();
  const options = new Map((roster.data?.units ?? []).map((option) => [option.id, option]));
  /*
   * §C3: whether this crew's machines seat anything at all (`any_ride`).
   *
   * Off the roster because that is where the other switch of its kind already rides
   * (`carriersFight`), and read here rather than at each of the four call sites below so the
   * window has one answer. `?? false` is the catalogue's reading, which is what a crew without
   * the waiver gets and what a payload from an older build says.
   */
  const anyRide = roster.data?.anyRide ?? false;

  /*
   * §C3: loading a machine is its own write, and an absolute one (`TakeVehiclesRequestSchema`).
   *
   * It does not travel with the deltas below: `DeployRequestSchema` carries units and nothing else,
   * so the confirm at the bottom of this window cannot take the yard with it. Pressing a counter
   * commits it there and then, which is what the panel behind this window has always done, and it
   * keeps one answer to "what is loaded" rather than a copy in here that has to be reconciled.
   */
  const takeVehicles = useTakeVehicles();

  const alreadyThere = (mode === 'line' ? view.muster?.army : view.muster?.perimeter) ?? {};
  const onGround = view.muster?.army ?? {};
  const onRing = view.muster?.perimeter ?? {};
  /** §C3: whether anything is being driven to this fight at all. */
  const riding = Object.values(view.vehicles).some((count) => (count ?? 0) > 0);

  /*
   * §C3: what this column will actually travel at, and how long that takes.
   *
   * This is the one window where a column exists: the deltas the player has typed *are* the force
   * about to walk out of the gate, which is exactly what `battle/movement.ts` puts on the road. So
   * it quotes the pace through `columnSpeed` and the clock through `travelMinutes`, both the
   * server's own functions, rather than a percentage that described the machines instead of the
   * people. Only what is being *sent* counts: a negative delta is somebody coming home.
   *
   * An upper bound, and it says so: the crew's travel reduction is not on this payload and only
   * ever shortens a road.
   */
  const sending: Army = Object.fromEntries(Object.entries(deltas).filter(([, delta]) => delta > 0));
  const column = readColumn(view.vehicles, sending, loadouts, anyRide);
  const road =
    homeDistrictId === null
      ? null
      : travelMinutes(homeDistrictId, view.battle.target.districtId, { speed: column.speed });

  // Every unit the crew can put anywhere: at home, already in the line, or already on the ring.
  // Both places, in both modes: a unit standing on the ring is one this crew owns and can pull
  // back into the line, so hiding it from the line's dialog would hide the move.
  const ids = [
    ...new Set([...Object.keys(army), ...Object.keys(onGround), ...Object.keys(onRing)]),
  ];
  const rows = ids
    .flatMap((unitId) => {
      const unit = findUnit(unitId);
      return unit ? [unit] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const moved = Object.values(deltas).reduce((total, delta) => total + Math.abs(delta), 0);

  /*
   * §C3: the seats, and what this batch is asking them to carry.
   *
   * `view.vehicles` is what this crew has already committed to this fight and `view.yard` is what
   * is still parked, exactly as the panel behind this window reads them: a machine that has been
   * loaded has left the yard, so the two always add up to the fleet the crew owns.
   */
  const loadedFleet = view.vehicles;
  const ownedFleet = mergeFleets(view.yard, view.vehicles);
  const seats = fleetCapacity(loadedFleet);
  const aboard = ridingUnitSlots(sending, anyRide);
  /** Nothing loaded is the walk, and the walk has no ceiling. See the note at the top. */
  const capped = seats > 0;
  const overloaded = capped && aboard > seats;

  /*
   * §A4: what this column could carry off, in loot slots.
   *
   * A raid's haul is capped by exactly this (`plunder`, off `lootCapacityOf`), and the one screen
   * where the force is chosen never said so: the city's own raid picker prints it and the mission
   * board prints it, and the deploy window, which is where a declared raid is actually loaded, did
   * not. Read off the fitted sheet with the crew's bag channel on it, the same figure the settler
   * spends, so the number here and the number that decides the haul cannot drift apart.
   */
  const lootSlots = Math.round(lootCapacityOf(sending, bagPercent, loadouts));

  return (
    <Modal
      onClose={onClose}
      labelledBy="deploy-title"
      size="full"
      className="border-brass-500/30"
      data-testid={mode === 'line' ? 'deploy-dialog' : 'perimeter-dialog'}
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4">
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
          {copy.eyebrow}
        </span>
        <h2
          id="deploy-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
        >
          {view.targetName}
        </h2>
        {copy.intro !== undefined && (
          <p className="font-body text-xs leading-relaxed text-ink-300">{copy.intro}</p>
        )}
      </div>

      {/* `min-h-0` under the `overflow-y-auto`, or the units and the machines below them push the
          panel past the frame instead of scrolling inside it. */}
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5" data-testid="deploy-rows">
        {rows.length === 0 ? (
          <p className="font-body text-xs leading-relaxed text-ink-300">
            You have nobody to send. Train units at the Gauntlet first.
          </p>
        ) : (
          /* Two to a row from `md` up, one below it. The breakpoint is the viewport rather than
             the panel, and the panel is the frame less two margins, so at 1280 each column is
             about 550px: a name, two quick buttons and a stepper, with nothing wrapping. A phone
             gets the single column this window has always had. */
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="deploy-grid">
            {rows.map((unit) => {
              const atHome = army[unit.id] ?? 0;
              const gate = notorietyToField(unit.id);
              const locked = !meetsNotoriety(notoriety, gate);
              const min = -(alreadyThere[unit.id] ?? 0);
              const value = deltas[unit.id] ?? 0;
              /*
               * What the seats leave for this one.
               *
               * The other units' claim is `aboard` less this row's own, so raising a row never
               * counts itself twice, and a sheet that will not ride is never measured against the
               * seats at all. Withdrawals are untouched: `min` is what is already on the ground,
               * and bringing people home needs no seat.
               */
              const rides = !walksAlways(unit.id, anyRide);
              const claimed = rides ? aboard - Math.max(0, value) * unit.unitSlots : aboard;
              const ceiling =
                capped && rides
                  ? Math.min(atHome, Math.max(0, Math.floor((seats - claimed) / unit.unitSlots)))
                  : atHome;
              const half = Math.min(halfOf(atHome), ceiling);
              const set = (next: number) =>
                setDeltas((current) => ({ ...current, [unit.id]: clamp(next, min, ceiling) }));
              return (
                <div
                  key={unit.id}
                  data-testid={`deploy-${unit.id}`}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 border p-2',
                    locked ? 'border-oxblood-500/40 bg-oxblood-300/5' : 'border-surface-700',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <UnitName unit={unit.name} option={options.get(unit.id)} roster={roster.data} />
                    <span className="block font-body text-[11px] text-ink-300">
                      {locked
                        ? `Will not sign for a crew under ${notorietyTier(gate)}`
                        : `${atHome} at home · ${alreadyThere[unit.id] ?? 0} ${copy.where}`}
                      {/* §C3: this one is not getting on the truck. Only worth saying once there is
                          a truck: with nothing loaded every unit walks and the note is noise. */}
                      {!locked && riding && walksAlways(unit.id, anyRide) && (
                        <span className="text-oxblood-300" data-testid={`walks-${unit.id}`}>
                          {' · '}walks
                        </span>
                      )}
                      {/* Why the stepper stopped short of the yard, said on the row it stopped.
                          The running total in the footer is the other half of that answer. */}
                      {!locked && ceiling < atHome && (
                        <span className="text-brass-300" data-testid={`seated-${unit.id}`}>
                          {' · '}seats {ceiling}
                        </span>
                      )}
                    </span>
                    {/*
                      §A4: what this unit is worth *on the ground of this fight*.

                      Beside the name rather than on it, because the name already opens the roster
                      card and the two answer different questions: the roster card is the sheet, and
                      this is the sheet after the characteristics of the place have had their say.
                      Deciding who to send is the one moment both are worth reading.
                    */}
                    <OnThisGround
                      unitId={unit.id}
                      view={view}
                      label={`${unit.name} on this ground`}
                      className="mt-0.5"
                    >
                      <span
                        className="font-display text-[10px] uppercase tracking-[0.14em] text-brass-300 underline decoration-dotted underline-offset-2"
                        data-testid={`on-ground-${unit.id}`}
                      >
                        On this ground
                      </span>
                    </OnThisGround>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/* Half and all, because the stepper is one unit a press and a crew that has
                        forty Razors at home is not going to press it forty times. Half rounds down
                        and never lands on nothing: with anybody at home at all, half of them is at
                        least one. Both stop at the seats rather than at the yard, and say so. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={locked || half < 1}
                      onClick={() => set(half)}
                      data-testid={`deploy-half-${unit.id}`}
                      data-tip={
                        half < halfOf(atHome)
                          ? `Half of what is at home is ${halfOf(atHome)}, and the seats hold ${half}`
                          : `Half of what is at home: ${half}`
                      }
                    >
                      Half
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={locked || ceiling < 1}
                      onClick={() => set(ceiling)}
                      data-testid={`deploy-max-${unit.id}`}
                      data-tip={
                        ceiling < atHome
                          ? `${atHome} at home, and the seats hold ${ceiling}`
                          : `Everybody at home: ${atHome}`
                      }
                    >
                      Max
                    </Button>
                    <NumberField
                      label={copy.field(unit.name)}
                      min={min}
                      max={ceiling}
                      value={value}
                      disabled={locked}
                      onChange={set}
                      data-testid={copy.testId(unit.id)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <VehicleRows
          loaded={loadedFleet}
          owned={ownedFleet}
          seats={seats}
          aboard={aboard}
          shut={!view.deploymentOpen}
          pending={takeVehicles.isPending}
          onTake={(id, count) =>
            takeVehicles.mutate({
              battleId: view.battle.id,
              vehicles: Object.fromEntries(
                Object.entries({ ...loadedFleet, [id]: count }).filter(([, held]) => held > 0),
              ),
            })
          }
        />

        {/*
         * §C3: picked the people first and the machines second (maintainer, 2026-09-19).
         *
         * The confirm has been disabled on `overloaded` since the seats became the ceiling, and
         * the seats readout turns oxblood, but neither of those is a sentence: a player who
         * loaded a bike under a column already picked got a dead button and a red number and no
         * statement of what to do about it. Said here, and deliberately *only* said: the window
         * does not put anybody back on its own, which is the maintainer's rule for this and for
         * the mission board's own picker.
         */}
        {overloaded && (
          <p
            role="alert"
            className="font-body text-xs leading-relaxed text-oxblood-300"
            data-testid="deploy-overloaded"
          >
            They do not all fit. <span className="tabular-nums">{aboard}</span> unit slots picked
            and <span className="tabular-nums">{seats}</span> seats loaded: take somebody off, or
            put another machine on.
          </p>
        )}

        {takeVehicles.error !== null && (
          <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
            {takeVehicles.error.message}
          </p>
        )}

        {error !== null && error !== undefined && (
          <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-surface-700 px-5 py-4">
        <span className="flex min-w-0 flex-col gap-0.5 font-body text-[11px] leading-snug text-ink-300">
          {/* The load, and it stays in front of the player while they work the steppers above:
              the ceiling is only fair if the number it is measured against is on screen. */}
          <span
            className={cn(overloaded ? 'text-oxblood-300' : 'text-brass-300')}
            data-testid="deploy-seats"
          >
            {/* Unit slots (maintainer request, 2026-09-15): one word for the
                housing budget everywhere it is printed, or the same figure reads as two things. */}
            {capped
              ? `${aboard} of ${seats} unit slots loaded`
              : aboard > 0 && `${aboard} unit slots, all of them on foot`}
          </span>
          {/* What they could carry home, live against the steppers above. Only on the line: a ring
              stands outside the fight and never touches the stockpile. */}
          {mode === 'line' && lootSlots > 0 && (
            <span data-testid="deploy-loot" data-tip="What this column could carry off a raid">
              {lootSlots} loot slots
            </span>
          )}
          {/* The column, as it stands. Empty until somebody is picked: a pace quoted over nobody is
              a number with no force behind it. */}
          <span className="min-w-0" data-testid="deploy-column">
            {column.speed > 0 && (
              <>
                {heldToLine(column)}
                {road !== null && <> · {formatDuration(road * 60)} on the road at most</>}
              </>
            )}
          </span>
        </span>
        <span className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={moved === 0 || pending || overloaded}
            onClick={() => onConfirm(mode === 'line' ? deltas : {}, mode === 'line' ? {} : deltas)}
            data-testid="deploy-confirm"
          >
            {pending ? 'Working…' : copy.confirm}
          </Button>
        </span>
      </footer>
    </Modal>
  );
}

/** Half of what is at home, rounded down, and never nothing while anybody is there to send. */
function halfOf(atHome: number): number {
  return atHome > 0 ? Math.max(1, Math.floor(atHome / 2)) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The unit's name, and the whole roster card behind it.
 *
 * Deciding who to send is the one moment a player needs a unit's sheet most, and until now this
 * dialog was a list of names with two number fields against each: nothing on the screen said which
 * of them shoot through cover or which of them die to it. The card is the roster's own card, the
 * component rather than a redrawing of it, so the two cannot say different things.
 *
 * Without a roster in the cache the name is plain text. A trigger that opens an empty card is worse
 * than no trigger, and this window's own job does not depend on the read.
 */
function UnitName({
  unit,
  option,
  roster,
}: {
  unit: string;
  option: UnitOption | undefined;
  roster: UnitsResponse | undefined;
}) {
  const name = (
    <span className="block truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
      {unit}
    </span>
  );
  if (!option || !roster) return name;
  return (
    <HoverCard
      label={unit}
      size="card"
      className="w-full min-w-0"
      card={
        <UnitCard
          unit={option}
          garrisoned={roster.garrisoned[option.id] ?? 0}
          abroad={roster.abroad[option.id] ?? 0}
          carriersFight={roster.carriersFight ?? false}
        />
      }
    >
      {name}
    </HoverCard>
  );
}

/**
 * §C3: the machines, under the units and scrolled to.
 *
 * A row of counters over what the yard and this fight hold between them, because the question is
 * "how many of these am I taking" rather than "which one". A machine that has been loaded has left
 * the yard, exactly as a deployed unit has left the roster, so `taking` and `held` always add up to
 * what the crew owns.
 *
 * The **minus** is the half that is easy to leave out. Seats already spoken for cannot be given
 * back under the people sitting in them: dropping a machine whose capacity is carrying somebody
 * would put the batch over its own ceiling and leave the player hunting for which stepper above to
 * wind down. So the control refuses instead, and says what it is holding.
 */
function VehicleRows({
  loaded,
  owned,
  seats,
  aboard,
  shut,
  pending,
  onTake,
}: {
  /** What this crew has committed to this fight. */
  loaded: Fleet;
  /** That plus whatever is still parked at home. */
  owned: Fleet;
  seats: number;
  /** Unit slots already picked upstairs. */
  aboard: number;
  /** The mark has passed: nothing moves either way. */
  shut: boolean;
  pending: boolean;
  onTake: (id: VehicleId, count: number) => void;
}) {
  const lines = VEHICLES.filter((spec) => (owned[spec.id] ?? 0) > 0);
  return (
    <section className="flex flex-col gap-2" data-testid="deploy-vehicles">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-surface-700 pb-1">
        <h3 className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
          Machines
        </h3>
        {/* The seats this section has bought. What is sitting in them is the running figure in
            the footer, which stays on screen while the steppers above are worked. */}
        <p className="font-body text-[11px] text-ink-300">
          {seats === 0 ? 'Nothing loaded. Everybody above walks.' : `Seats for ${seats} unit slots`}
        </p>
      </header>
      {lines.length === 0 ? (
        <p className="font-body text-xs leading-relaxed text-ink-300">
          Nothing in the yard. Build something in the Garage and a column stops walking.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {lines.map((spec) => {
            const taking = loaded[spec.id] ?? 0;
            const held = owned[spec.id] ?? 0;
            const spare = seats - spec.capacity >= aboard;
            return (
              <li
                key={spec.id}
                data-testid={`deploy-take-${spec.id}`}
                className="flex flex-wrap items-center justify-between gap-3 border border-surface-700 p-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                    {spec.name}
                  </span>
                  <span className="block font-body text-[11px] text-ink-300">
                    {spec.capacity} unit slots · speed {spec.speed} · {held - taking} in the yard
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={shut || pending || taking === 0 || !spare}
                    onClick={() => onTake(spec.id, taking - 1)}
                    data-testid={`deploy-take-less-${spec.id}`}
                    data-tip={
                      taking > 0 && !spare
                        ? 'Those seats are carrying somebody. Send fewer units first'
                        : `One fewer ${vehicleNoun(spec.name)}`
                    }
                  >
                    −
                  </Button>
                  <span className="w-12 text-center font-display text-[12px] tabular-nums text-brass-300">
                    {taking}/{held}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={shut || pending || taking >= held}
                    onClick={() => onTake(spec.id, taking + 1)}
                    data-testid={`deploy-take-more-${spec.id}`}
                    data-tip={`One more ${vehicleNoun(spec.name)}: ${spec.capacity} more unit slots`}
                  >
                    +
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
