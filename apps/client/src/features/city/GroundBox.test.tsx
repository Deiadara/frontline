import {
  findDistrict,
  garrisonOf,
  isContested,
  startingHolder,
  type ContestedDistrict,
  type District,
  type LocationHolder,
} from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GroundBox } from './GroundBox';
import { districtHoldLine } from './holder';

/**
 * The Garrison row on the district's ground box (maintainer, 2026-09-29).
 *
 * It printed the catalogue's garrison off the district's allegiance whatever had happened, so the
 * Docks held end to end by a crew still promised the regime's Civic Levy. The authored sentence
 * stays only while every location is still with its authored holder.
 */
function contested(id: string): ContestedDistrict {
  const district = findDistrict(id);
  if (!district || !isContested(district)) throw new Error(`fixture error: ${id} is not contested`);
  return district;
}

const docks = contested('neon-docks');
const chromeRow = contested('chrome-row');
/** The Combine's authored sentence for the Docks. Never null: the Docks are the Combine's. */
const docksGarrison = garrisonOf(docks)!;

const NAMES: Record<LocationHolder['kind'], string> = {
  government: 'The Combine',
  looters: 'Looters',
  unoccupied: 'Nobody',
  crew: 'A crew',
};

/** Every location with its authored holder, then `change` applied by index. */
function viewsOf(
  district: District,
  change: Record<number, { baseId: string; name: string }> = {},
) {
  return district.locations.map((location, index) => {
    const taken = change[index];
    const holder: LocationHolder = taken
      ? { kind: 'crew', baseId: taken.baseId }
      : startingHolder(location, district);
    return { location, holder, holderName: taken?.name ?? NAMES[holder.kind] };
  });
}

const all = (district: District, crew: { baseId: string; name: string }) =>
  Object.fromEntries(district.locations.map((_, index) => [index, crew]));

const ASHEN = { baseId: 'ashen', name: 'The Ashen Sons' };
const YARD = { baseId: 'yard', name: 'The Yard' };

describe('who holds the district, on the Garrison row', () => {
  it('promises the authored garrison on Combine ground while nothing has changed hands', () => {
    expect(docks.locations.length).toBeGreaterThan(2);
    expect(districtHoldLine(docks, viewsOf(docks))).toBe(`Expect ${docksGarrison}.`);
  });

  /*
   * Open ground has no authored sentence (maintainer, 2026-09-30): it used to promise "whoever
   * holds the ground and has decided to keep it", which the holder plates already said better.
   */
  it('counts the holders on untouched open ground instead of promising anybody', () => {
    const views = viewsOf(chromeRow);
    const total = views.length;
    const looters = views.filter((view) => view.holder.kind === 'looters').length;
    const empty = total - looters;
    expect(looters, 'fixture error: nobody squats on Chrome Row').toBeGreaterThan(0);
    const line = districtHoldLine(chromeRow, views);
    expect(line).toBe(
      `The looters hold ${looters} of ${total} locations. ${empty} ${empty === 1 ? 'stands' : 'stand'} empty.`,
    );
    expect(line).not.toMatch(/whoever holds the ground/);
  });

  it('names the crew that holds it whole', () => {
    expect(districtHoldLine(docks, viewsOf(docks, all(docks, ASHEN)))).toBe(
      'Held by The Ashen Sons.',
    );
  });

  it('counts what the regime still holds once a crew has taken some of it', () => {
    const total = docks.locations.length;
    expect(districtHoldLine(docks, viewsOf(docks, { 0: ASHEN }))).toBe(
      `The Combine holds ${total - 1} of ${total} locations. The Ashen Sons holds 1 of ${total} locations.`,
    );
    expect(districtHoldLine(docks, viewsOf(docks, { 0: ASHEN, 1: YARD, 2: YARD }))).toBe(
      `The Combine holds ${total - 3} of ${total} locations. 2 crews hold 3 of ${total} locations.`,
    );
  });

  it('counts the looters and the empty ground on open ground a crew has walked onto', () => {
    const views = viewsOf(chromeRow);
    const total = views.length;
    const looters = views.filter((view) => view.holder.kind === 'looters').length;
    const empty = views.findIndex((view) => view.holder.kind === 'unoccupied');
    expect(empty, 'fixture error: Chrome Row has no open ground').toBeGreaterThanOrEqual(0);
    const left = total - looters - 1;
    expect(districtHoldLine(chromeRow, viewsOf(chromeRow, { [empty]: YARD }))).toBe(
      `The looters hold ${looters} of ${total} locations. The Yard holds 1 of ${total} locations. ` +
        `${left} ${left === 1 ? 'stands' : 'stand'} empty.`,
    );
  });

  it('prints it on the box, in place of the regime a raider will not meet', () => {
    render(
      <GroundBox
        district={docks}
        locations={viewsOf(docks, all(docks, ASHEN))}
        combineLeader={null}
        unified={null}
        at={new Date('2026-09-29T12:00:00.000Z')}
      />,
    );
    expect(screen.getByTestId('district-holders')).toHaveTextContent('Held by The Ashen Sons.');
    expect(screen.queryByText(new RegExp(docksGarrison))).toBeNull();
  });
});
