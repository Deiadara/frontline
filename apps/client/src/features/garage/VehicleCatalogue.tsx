import { LoadFailure } from '../../components/ui/LoadFailure';
import { useBuildVehicle, useGarage } from '../../lib/queries';
import { VehicleCard } from './VehicleCard';

/**
 * The yard's catalogue, as the roster's last tab (GDD §B11, §C; board request, 2026-09-08).
 *
 * One list, every machine in the catalogue always present whether or not it can be built today,
 * in the order the Garage lets them out (the catalogue's own order, which `vehicles.test.ts`
 * pins). No class sections: the class is a rule about the numbers, and a player choosing a
 * machine reads seats and speed off the card rather than a heading. A machine that is simply
 * missing from a locked player's screen is a machine nobody works towards.
 *
 * Its own query rather than a field on the roster's, because the yard is a different record with
 * a different write: a machine is paid for and in the yard on the same request, with no bench
 * and no settle, and `useBuildVehicle` writes the answer straight back onto this key.
 */
export function VehicleCatalogue() {
  const query = useGarage();
  const build = useBuildVehicle();

  const data = query.data;
  if (!data) {
    // The same rule every screen behind the nav follows: a 500 has to look different from a slow
    // network, and `screens.spec.ts` walks the Garage's own page to hold it to that.
    return query.isError ? (
      <LoadFailure
        what="The yard"
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. The machines are where you left them."
      />
    ) : (
      <p className="py-8 text-center font-display text-xs uppercase tracking-[0.2em] text-ink-300">
        Opening the yard…
      </p>
    );
  }

  return (
    <>
      {/* The roster's own grid, two to a row where a unit card goes two to a row, so the tabs
          switch between lists of the same shape rather than between two pages. */}
      <ul
        className="grid gap-4 [@media(min-width:1440px)]:grid-cols-2"
        data-testid="vehicle-catalogue"
      >
        {data.vehicles.map((vehicle) => (
          <li key={vehicle.id}>
            <VehicleCard
              vehicle={vehicle}
              resources={data.resources}
              pending={build.isPending}
              onBuild={() => build.mutate({ vehicleId: vehicle.id })}
            />
          </li>
        ))}
      </ul>

      {build.error !== null && (
        <p role="alert" className="font-body text-[13px] text-oxblood-300">
          {build.error.message}
        </p>
      )}
    </>
  );
}
