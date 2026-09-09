import type { GarageVehicle } from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

/**
 * One machine, on the roster's Vehicles tab (GDD §B11, §C).
 *
 * The two numbers on the card are the ones a decision turns on and they pull in opposite
 * directions: **capacity** is how many people it moves, and it is also what the enemy earns for
 * destroying it. A Cheese Wagon moves most of a crew and is the biggest prize on the field.
 * **Speed** is the stat a unit's own sheet carries, on the same scale, so a player can compare a
 * machine with the legs of the people they were going to put in it. That comparison is the whole
 * reason the machines sit on the roster beside the units rather than on the Garage's own page
 * (board request, 2026-09-08).
 */
export function VehicleCard({
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
        // The units tab's shape (board request): picture on the left at the card's own height,
        // the sheet beside it. It was picture *over* sheet, which put a 615px-wide crop of a
        // square painting across the top of every row and pushed the Build control below the fold.
        //
        // A fixed height is what makes the picture resolvable in CSS: with a definite height the
        // portrait can be `h-full` at its own 1:1 and let the width follow, so the frame is exactly
        // the shape of the painting and nothing is cropped. 13rem is about half the units card,
        // which is the size the board asked for: these are machines in a list, not the twelve-row
        // stat sheets a unit gets.
        'flex h-[13rem] gap-3 rounded-sm border p-3',
        vehicle.owned > 0
          ? 'border-bile-300/50 bg-bile-300/10'
          : vehicle.refusal === null
            ? 'border-surface-600 bg-surface-800/60'
            : 'border-surface-700 bg-surface-900/50 opacity-75',
      )}
    >
      <VehicleGlyph id={vehicle.id} />

      {/* `min-w-0` so a long name wraps inside the column instead of widening it and squeezing
          the picture: a flex child's default `min-width: auto` refuses to go below its content. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 font-display text-[14px] font-bold text-ink-100">
            {vehicle.name}
          </h3>
          <span
            className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300"
            data-testid={`vehicle-count-${vehicle.id}`}
          >
            {/* §C3: committed machines leave the yard, so "none" beside an empty yard has to say
                where they went or the Garage looks like it lost them. */}
            {vehicle.owned > 0 || vehicle.out > 0
              ? [
                  vehicle.owned > 0 ? `${vehicle.owned} in the yard` : null,
                  vehicle.out > 0 ? `${vehicle.out} out` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'none'}
          </span>
        </header>

        <p className="font-body text-[13px] leading-snug text-ink-200">{vehicle.description}</p>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-display text-[12px] uppercase tracking-[0.12em] text-ink-300">
          <li>
            Carries <span className="tabular-nums text-brass-300">{vehicle.capacity}</span>
          </li>
          {/* §C3: a speed on the same 0 to 100 scale a unit's sheet carries, not a percentage off
              a clock. The two read the same way on purpose: a Road Reaver walks at 65 and the
              Scrappy rides at 65, so putting one on the other is visibly worth nothing. */}
          <li>
            Speed <span className="tabular-nums text-brass-300">{vehicle.speed}</span>
          </li>
        </ul>

        {/* Pushed to the bottom of the column, so the cost and the control line up across a row of
            cards whatever length the descriptions above them run to. */}
        <div className="mt-auto flex flex-col gap-2">
          <CostLine cost={vehicle.cost} stock={resources} />
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="sm" disabled={vehicle.refusal !== null || pending} onClick={onBuild}>
              Build it
            </Button>
            {vehicle.refusal !== null && (
              <span className="font-display text-[12px] text-oxblood-300">{vehicle.refusal}</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The machine, painted (§C1), through the ADR 0001 §5.1 seam.
 *
 * The view names the *machine*, never a file: `vehicle-<id>` is on the manifest, so a painting
 * the board drops into `assets/` starts drawing here with no TypeScript edit. A square portrait
 * once one is delivered, and a lettered plate until then. Both are the card's full height at 1:1,
 * which is what the board asked for by "have the portraits work as is, with those dimensions": the
 * delivery is a square painting of a machine standing on wet ground, and the frame is the shape of
 * the painting rather than a strip cut out of the middle of it.
 */
function VehicleGlyph({ id }: { id: string }) {
  const painted = deliveredUrl({ type: 'vehicle-icon', vehicleId: id });
  // Square, at the card's height, whichever of the two it is: the interim plate holds exactly the
  // room the painting will take, so a delivery does not reflow the row it lands in.
  const frame =
    'painted relative flex aspect-square h-full shrink-0 items-center justify-center overflow-hidden rounded-sm border border-surface-700/80 bg-surface-950/70';

  if (!painted) {
    return (
      <span aria-hidden data-vehicle-art={id} className={frame}>
        <span className="font-stamp text-[40px] uppercase text-ink-100/20">{id.slice(0, 1)}</span>
      </span>
    );
  }
  return (
    <span aria-hidden data-vehicle-art={id} className={frame}>
      {/*
       * `object-contain`, not `object-cover`: the board paints these at 1:1 with the machine
       * centred and room over and under it, and the frame is 1:1 too, so there is nothing to crop
       * and cropping would only cut the ground out from under it. The previous band did exactly
       * that, and lost the wheels.
       *
       * `!absolute`: the frame is `painted`, and `.painted > *` pins every direct child to
       * `position: relative` at the same specificity as a plain `absolute`, so the custom rule
       * wins on emission order. The picture happens to land in the same place today because
       * `h-full w-full` fills the square either way, which is luck rather than layout: `inset-0`
       * is doing nothing until the flag makes it. See `index.css`.
       */}
      <img src={painted} alt="" className="!absolute inset-0 h-full w-full object-contain" />
    </span>
  );
}
