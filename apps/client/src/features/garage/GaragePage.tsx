import {
  VEHICLE_CLASSES,
  VEHICLE_CLASS_BLURBS,
  VEHICLE_CLASS_LABELS,
  type GarageVehicle,
  type VehicleClass,
} from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBuildVehicle, useGarage } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';

/**
 * The Garage (GDD §B11, §C).
 *
 * The building grants nothing passively, so this page *is* the building: everything it is worth is
 * on it. Laid out like the units tab, one section per class, every machine in the catalogue always
 * present whether or not it can be built today. A machine that is simply missing from a locked
 * player's screen is a machine nobody works towards.
 *
 * The two numbers on each card are the ones a decision turns on and they pull in opposite
 * directions: **capacity** is how many people it moves, and it is also what the enemy earns for
 * destroying it. A War Hauler moves the army and is the biggest prize on the field.
 */
export function GaragePage() {
  const query = useGarage();
  const build = useBuildVehicle();

  const data = query.data;
  if (!data) {
    /*
     * A screen that cannot load has to say so.
     *
     * This drew "Opening the yard..." for every state that was not data, so a 500 looked exactly
     * like a slow network and looked like it for ever. `GET /api/battles` shipped that way for
     * months and nobody could describe it well enough to report it, which is why `LoadFailure`
     * exists and why there is a permanent guard in `screens.spec.ts` walking every screen behind
     * the nav. This page and the Scrapyard were both added without one.
     */
    return query.isError ? (
      <LoadFailure
        what="The yard"
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. The machines are where you left them."
      />
    ) : (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Opening the yard…
        </p>
      </div>
    );
  }

  return (
    <PageShell quote="Everything in here ran once. Most of it will again." wide>
      <InfoNote label="What a machine is for">
        A machine is worth nothing parked. It shortens the road for the people riding it, and only
        for them: two on a bike out of a column of forty is two people arriving early. Take them to
        a fight from the battle screen. If everyone riding one dies it is destroyed, and whoever
        killed them earns infamy equal to what it was carrying.
      </InfoNote>

      <Panel
        title="The yard"
        action={
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
            {data.capacity > 0 ? `${data.capacity} seats` : 'nothing built'}
          </span>
        }
      >
        <p className="px-4 py-3 font-body text-[13px] leading-relaxed text-ink-300">
          {data.garageLevel === 0
            ? 'There is no Garage yet. Build one in the district before the yard is worth walking into.'
            : `Garage at level ${data.garageLevel}. Everything below is gated on that, on the plans, and on what is in the stockpile.`}
        </p>
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {VEHICLE_CLASSES.map((kind) => (
          <ClassPanel
            key={kind}
            kind={kind}
            vehicles={data.vehicles.filter((vehicle) => vehicle.class === kind)}
            resources={data.resources}
            pending={build.isPending}
            onBuild={(id) => build.mutate({ vehicleId: id })}
          />
        ))}
      </div>

      {build.error !== null && (
        <p role="alert" className="font-body text-[13px] text-oxblood-300">
          {build.error.message}
        </p>
      )}
    </PageShell>
  );
}

function ClassPanel({
  kind,
  vehicles,
  resources,
  pending,
  onBuild,
}: {
  kind: VehicleClass;
  vehicles: readonly GarageVehicle[];
  resources: Parameters<typeof CostLine>[0]['stock'];
  pending: boolean;
  onBuild: (id: GarageVehicle['id']) => void;
}) {
  return (
    <Panel title={VEHICLE_CLASS_LABELS[kind]}>
      <p className="px-4 pt-3 font-body text-[13px] leading-relaxed text-ink-300">
        {VEHICLE_CLASS_BLURBS[kind]}
      </p>
      <ul className="flex flex-col gap-2.5 p-4">
        {vehicles.map((vehicle) => (
          <li key={vehicle.id}>
            <VehicleCard
              vehicle={vehicle}
              resources={resources}
              pending={pending}
              onBuild={() => onBuild(vehicle.id)}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * One machine.
 *
 * The picture is an interim block rather than a missing element, so the card is the same shape
 * before and after the board delivers the artwork: see `art/vehicle-<id>` on the order sheet.
 */
function VehicleCard({
  vehicle,
  resources,
  pending,
  onBuild,
}: {
  vehicle: GarageVehicle;
  resources: Parameters<typeof CostLine>[0]['stock'];
  pending: boolean;
  onBuild: () => void;
}) {
  return (
    <article
      data-testid={`vehicle-${vehicle.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-sm border p-3',
        vehicle.owned > 0
          ? 'border-bile-300/50 bg-bile-300/10'
          : vehicle.refusal === null
            ? 'border-surface-600 bg-surface-800/60'
            : 'border-surface-700 bg-surface-900/50 opacity-75',
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 font-display text-[14px] font-bold text-ink-100">{vehicle.name}</h3>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {vehicle.owned > 0 ? `${vehicle.owned} in the yard` : 'none'}
        </span>
      </header>

      <VehicleGlyph id={vehicle.id} />

      <p className="font-body text-[13px] leading-snug text-ink-200">{vehicle.description}</p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 font-display text-[12px] uppercase tracking-[0.12em] text-ink-300">
        <li>
          Carries <span className="tabular-nums text-brass-300">{vehicle.capacity}</span>
        </li>
        <li>
          <span className="tabular-nums text-brass-300">{vehicle.speedPercent}%</span> off the road
        </li>
      </ul>

      <CostLine cost={vehicle.cost} stock={resources} />
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="sm" disabled={vehicle.refusal !== null || pending} onClick={onBuild}>
          Build it
        </Button>
        {vehicle.refusal !== null && (
          <span className="font-display text-[12px] text-oxblood-300">{vehicle.refusal}</span>
        )}
      </div>
    </article>
  );
}

/**
 * The machine's picture, through the ADR 0001 §5.1 seam (§C1).
 *
 * The view names the *machine*, never a file. `icon-vehicle-<id>` is on the manifest, so the day
 * the board drops `icon-vehicle-war-hauler.webp` into `assets/` this starts painting it with no
 * TypeScript edit here. Until then it is a plate with the machine's initial on it, at a fixed
 * height, so a delivery does not reflow every row on the page.
 */
function VehicleGlyph({ id }: { id: string }) {
  const painted = deliveredUrl({ type: 'vehicle-icon', vehicleId: id });
  return (
    <span
      aria-hidden
      data-vehicle-art={id}
      className="painted relative flex h-16 w-full items-center justify-center overflow-hidden rounded-sm border border-surface-700/80 bg-surface-950/70"
    >
      {painted ? (
        <img src={painted} alt="" className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <span className="font-stamp text-[26px] uppercase text-ink-100/20">{id.slice(0, 1)}</span>
      )}
    </span>
  );
}
