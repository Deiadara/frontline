import { findVehicle, type GarageVehicle } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VehicleCard } from './VehicleCard';

/** The Scrappy as `projectGarage` serves it, with one of the three away from the yard. */
function bikeWithOneOut(): GarageVehicle {
  const spec = findVehicle('motorcycle');
  if (!spec) throw new Error('fixture error: no Scrappy in the catalogue');
  return {
    id: spec.id,
    name: spec.name,
    class: spec.class,
    description: spec.description,
    owned: 2,
    out: 1,
    cost: spec.cost,
    buildSeconds: spec.buildSeconds,
    capacity: spec.capacity,
    speed: spec.speed,
    speedPercent: spec.speed,
    requiresGarageLevel: spec.requiresGarageLevel,
    requiresBlueprint: null,
    hasBlueprint: true,
    refusal: null,
  };
}

describe('the count on a machine', () => {
  /*
   * `out` is `vehiclesAbroad`: machines committed to a fight, loaded onto a job, and driving home
   * on a move. The hover said "out at a fight" for all three (bug pass, 2026-09-29), so a crew
   * whose Scrappy was on a scrap run was told it was at a battle it had never been sent to.
   */
  it('says where an away machine may be, not only at a fight', () => {
    render(
      <VehicleCard
        vehicle={bikeWithOneOut()}
        resources={{ caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 }}
        pending={false}
        onBuild={() => {}}
      />,
    );
    const chip = screen.getByTestId('vehicle-count-motorcycle');
    expect(chip.textContent).toBe('3 / 1');
    expect(chip.getAttribute('data-tip')).toBe(
      '2 in the yard, 1 out: at a fight, on a job or on the road',
    );
  });
});
