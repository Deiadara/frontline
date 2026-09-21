import {
  BUILDING_CATALOG,
  GARAGE_TIME_DISCOUNT_PER_LEVEL,
  MAX_EFFECT_REDUCTION,
  type GarageVehicle,
  type VehicleClass,
} from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { cn } from '../../lib/cn';
import { formatDuration } from '../base/format';

/**
 * What a class is called on a card. The catalogue stores the word the rules use, not the word a
 * player reads, and the two differ for exactly one of them.
 */
const CLASS_LABELS: Record<VehicleClass, string> = {
  motorbike: 'Motorbike',
  car: 'Car',
  truck: 'Truck',
  flying: 'Aircraft',
};

/**
 * One machine, on the roster's Vehicles tab (GDD §B11, §C).
 *
 * ## The same card the units get (maintainer, 2026-09-18)
 *
 * "Make the vehicle boxes be more similar to the unit boxes." They are two tabs of one list and
 * they were two different objects: a unit sat on drawn paper with a rivet in each corner, its
 * name at 18px over a line naming its tier and its trade, its two headline figures in boxes and
 * its count stamped on the corner of the picture. A machine sat on a flat panel with a 14px name,
 * a run-on row of small caps for its numbers and its count as a sentence in the header. Switching
 * tabs read as switching pages. Every one of those is now the roster's own chrome, read off
 * `UnitCard` rather than re-invented, so the two lists stay the same object when one of them
 * changes.
 *
 * The picture stays **square**, which is the one deliberate difference: the board paints machines
 * at 1:1 standing on wet ground and units at 3:4, and cropping either to match the other is how
 * the Scrappy lost its wheels the last time.
 *
 * ## The numbers
 *
 * **Unit slots** is what it moves, in the same currency the district houses a unit in, and it is
 * also what the enemy earns for destroying it. A Cheese Wagon at thirty moves ten Ironsides at
 * three slots each, and is the biggest prize on the field. **Speed** is the stat a unit's own
 * sheet carries, on the same scale, so a player can compare a machine with the legs of the people
 * they were going to put in it. That comparison is the whole reason the machines sit on the
 * roster beside the units rather than on the Garage's own page (maintainer request, 2026-09-08).
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
        // The roster card's frame, class for class: drawn paper, rivets, the lit edge.
        'card-paper washed rivets edge-lit relative flex gap-3 rounded-sm border p-3',
        // Definite, for the reason the unit card's is: the picture beside the sheet is `h-full`
        // at its own ratio and a frame with no height gives it nothing to be full of. 15.5rem is
        // the column this card holds (a header, two figures, the description, the clock and the
        // action row) and not a measurement of the picture, which follows it: the longest blurb
        // in the catalogue (the Cheese Wagon) runs to three lines in this column, and the band
        // between the header and the action row is `flex-1`, so a shorter one leaves air under the
        // prose rather than a card of a different height.
        'h-[15.5rem]',
        // And the same ceiling while it is one to a row, so a single machine does not become a
        // 1200px band. The grid beside it is the roster's own (`VehicleCatalogue`).
        'w-full max-w-[52rem] [@media(min-width:1440px)]:max-w-none',
        vehicle.owned > 0
          ? 'border-bile-300/50'
          : vehicle.refusal === null
            ? 'border-surface-600/70'
            : 'border-surface-700 opacity-75',
      )}
    >
      {/*
       * `max-w-[42%]`, the cap the roster card carries and for the same reason: a picture that
       * follows the frame's height gets wider, and past about 45% of the card the sheet beside it
       * is being squeezed to make room for it. `visual.spec.ts` fails a portrait over that share.
       */}
      <div className="relative flex h-full max-w-[42%] shrink-0 items-center">
        <VehicleGlyph id={vehicle.id} />
        {/*
         * The count, stamped on the corner of the picture, where the roster puts it and where a
         * strategy game puts a count. §C3: committed machines leave the yard, so the pair is
         * `held / out` with the fight's share in tangerine, exactly as a unit card writes it.
         */}
        {/* `z-10`, and it is not decoration. `.painted > *` in `index.css` puts `z-index: 1` on
            every direct child of a painted box, and the glyph's frame is `relative` with no
            z-index of its own, so it raises no stacking context and the picture inside it lands
            at 1 in the *card's* context, over a sibling at `auto`. The chip was rendered, was
            41x19 at the picture's top right corner, and `elementFromPoint` at the middle of it
            answered the `<img>`. The roster's chip needs no such thing because a unit portrait
            is not a painted box. */}
        <span
          className="absolute right-1.5 top-1.5 z-10 rounded-sm border border-surface-600 bg-surface-950/85 px-2 py-0.5 font-display text-[13px] font-bold leading-none tabular-nums text-ink-100"
          data-testid={`vehicle-count-${vehicle.id}`}
          // The words the chip replaced, one hover away. `3 / 1` is the roster's idiom and it is
          // terser than `2 in the yard · 1 out`, but it does make a reader do the subtraction, so
          // the sentence is still here for anybody who wants it.
          data-tip={
            vehicle.out > 0
              ? `${vehicle.owned} in the yard, ${vehicle.out} out at a fight`
              : `${vehicle.owned} in the yard`
          }
        >
          {vehicle.owned + vehicle.out}
          {vehicle.out > 0 && (
            <span data-tip={`${vehicle.out} at a fight`}>
              <span className="text-ink-300">{' / '}</span>
              <span className="text-tangerine-300">{vehicle.out}</span>
            </span>
          )}
        </span>
      </div>

      {/* `min-w-0` so a long name wraps inside the column instead of widening it and squeezing
          the picture: a flex child's default `min-width: auto` refuses to go below its content. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* Row 1, the roster's header: the name, and under it what kind of thing it is and where
            it is built, which is the line a unit card gives its tier and its trade. */}
        <header className="min-w-0">
          <span className="block truncate font-display text-lg font-bold leading-tight tracking-[0.06em] text-ink-100">
            {vehicle.name}
          </span>
          <span className="block truncate font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            {CLASS_LABELS[vehicle.class]} · {BUILDING_CATALOG.garage.name}
            {/* The yard level it wants, as a third clause rather than glued to the building's
                name: the roster's line is `Heavy · The Gauntlet · 6 slots`, three facts with the
                same separator, and `The Garage at 4` read as part of the building's name. */}
            {vehicle.requiresGarageLevel > 1 && ` · Level ${vehicle.requiresGarageLevel}`}
          </span>
        </header>

        {/* Row 2, the sheet: the two figures in boxes, the prose, and the clock under a rule. The
            band stretches, so a two-line description and a three-line one both leave the action
            row on the same line across a row of cards. */}
        <div className="flex flex-1 flex-col border-y border-surface-600/50 py-1">
          <dl className="grid grid-cols-2 gap-2">
            <Figure
              label="Unit slots"
              value={vehicle.capacity}
              tip="What it carries, in the same unit slots the district houses a unit in. It is also what the enemy earns for destroying it."
            />
            {/* On the same 0 to 100 scale a unit's sheet carries, not a percentage off a clock.
                The two read the same way on purpose: a Road Reaver walks at 65 and the Scrappy
                rides at 65, so putting one on the other is visibly worth nothing. */}
            <Figure
              label="Speed"
              value={vehicle.speed}
              tip="On the same 0 to 100 scale a unit's own sheet carries, so a machine and the people you were going to put in it can be read against each other."
            />
          </dl>

          <p className="mt-2 font-body text-[13px] leading-snug text-ink-200">
            {vehicle.description}
          </p>

          {/* The clock, under a rule, the way the roster separates a unit's keywords from its
              matchup: a build time is a different kind of fact from the two figures above it. */}
          <div className="mt-auto flex items-center gap-1.5 border-t border-surface-700/40 pt-1.5 font-display text-[10px] uppercase tracking-[0.08em] text-ink-300">
            {/*
             * §B6: a machine goes on the bench now, so it has a clock, and the yard's own level
             * is what takes time off it. The number is served already discounted, so what the
             * card says is what the queue will charge. It was not on the card at all until the
             * yard started shortening it, which made the whole discount invisible: a player
             * raising the Garage for the second reason it exists had nothing on screen that moved.
             */}
            <span
              data-testid={`vehicle-time-${vehicle.id}`}
              data-tip={`Time on the bench, with your Garage's discount already off. Every level of the yard takes ${GARAGE_TIME_DISCOUNT_PER_LEVEL}% off, to a floor of ${100 - MAX_EFFECT_REDUCTION}% of the catalogue time.`}
              className="whitespace-nowrap border-b border-dashed border-brass-500/60"
            >
              Build time{' '}
              <span className="font-bold text-brass-300">
                {formatDuration(vehicle.buildSeconds)}
              </span>
            </span>
            {vehicle.requiresBlueprint !== null && (
              <span
                className={cn(
                  'min-w-0 truncate',
                  vehicle.hasBlueprint ? 'text-verdigris-300' : 'text-oxblood-300',
                )}
                data-testid={`vehicle-plans-${vehicle.id}`}
              >
                · {vehicle.requiresBlueprint}
              </span>
            )}
          </div>
        </div>

        {/* Row 3. The price sits **beside** the button rather than over it (maintainer,
            2026-09-18), so the two halves of one decision are on one line and the card is a row
            shorter. `flex-1 justify-end` on the price: the button is the fixed thing and the
            materials are what has room to give, which is how a five-material machine keeps its
            last line on the card instead of pushing the button down. */}
        <div className="flex shrink-0 items-center gap-3">
          <Button
            size="sm"
            className="shrink-0"
            disabled={vehicle.refusal !== null || pending}
            onClick={onBuild}
          >
            Build it
          </Button>
          {vehicle.refusal === null ? (
            <span className="flex min-w-0 flex-1 justify-end">
              <CostLine cost={vehicle.cost} stock={resources} />
            </span>
          ) : (
            /* The refusal takes the price's place rather than sitting under it. A machine that
               cannot be built has one thing to say and it is not what it would have cost. */
            <span className="min-w-0 flex-1 text-right font-display text-[12px] text-oxblood-300">
              {vehicle.refusal}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** One headline figure, in the box the roster draws its Damage and Vitality in. */
function Figure({ label, value, tip }: { label: string; value: number; tip: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-sm border border-surface-600/60 bg-surface-950/40 px-2.5 py-1.5">
      <dt className="min-w-0 flex-1">
        <HoverCard
          label={label}
          className="w-full min-w-0 shrink"
          card={
            <div className="flex flex-col gap-1.5">
              <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
                {label}
              </p>
              <p className="font-body text-[13px] leading-relaxed text-ink-100">{tip}</p>
            </div>
          }
        >
          <span className="block truncate font-display text-[11px] uppercase tracking-[0.08em] text-ink-300">
            {label}
          </span>
        </HoverCard>
      </dt>
      <dd className="shrink-0 font-display text-[19px] font-bold leading-none tabular-nums text-brass-300">
        {value}
      </dd>
    </div>
  );
}

/**
 * The machine, painted (§C1), through the ADR 0001 §5.1 seam.
 *
 * The view names the *machine*, never a file: `vehicle-<id>` is on the manifest, so a painting
 * the board drops into `assets/` starts drawing here with no TypeScript edit. A square portrait
 * once one is delivered, and a lettered plate until then. Both are the card's full height at 1:1,
 * which is what the maintainer asked for by "have the portraits work as is, with those dimensions": the
 * delivery is a square painting of a machine standing on wet ground, and the frame is the shape of
 * the painting rather than a strip cut out of the middle of it.
 */
function VehicleGlyph({ id }: { id: string }) {
  const painted = deliveredUrl({ type: 'vehicle-icon', vehicleId: id });
  // Square, at the card's height, whichever of the two it is: the interim plate holds exactly the
  // room the painting will take, so a delivery does not reflow the row it lands in. The border and
  // the lift are the roster portrait's, so the two tabs frame their pictures the same way.
  const frame =
    'painted relative flex aspect-square h-full max-h-full w-auto max-w-full shrink-0 items-center justify-center overflow-hidden rounded-sm border-2 border-surface-600/80 shadow-lifted bg-surface-950/70';

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
