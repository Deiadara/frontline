import {
  CITY_DISTRICTS,
  LOCATION_CATALOG,
  type LocationHolder,
  type LocationView,
} from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContestedScene } from './ContestedScene';

/**
 * The sign's hover card says what the sheet says.
 *
 * A location may carry its own blurb (the Blacksite's eight do, written to the painting), and the
 * sheet prints that in preference to its kind's. The hover card on the painting read the kind's
 * blurb unconditionally, so for a while the Psychic Ward's tooltip described a black clinic while
 * its sheet described the room in the wall. Two descriptions of one place is the bug; this pins the
 * card to the same rule as the sheet.
 */
const blacksite = CITY_DISTRICTS.find((district) => district.id === 'blacksite-7')!;
const combine: LocationHolder = { kind: 'government' };

function viewOf(locationId: string, blurb: string | undefined): LocationView {
  const location = blacksite.locations.find((one) => one.id === locationId)!;
  return {
    location: { ...location, blurb },
    holder: combine,
    holderName: 'The Combine',
    holderPlayer: null,
    level: 1,
    upgradingUntil: null,
    upgrade: null,
    fortification: 0,
    fortifyingUntil: null,
    upgradingSince: null,
    fortifyingSince: null,
    defense: 0,
    garrisonSize: 0,
    garrison: null,
    bonuses: [],
    reward: LOCATION_CATALOG[location.kind].reward,
    labels: [],
    unlocks: [],
  };
}

function draw(views: LocationView[]) {
  return render(
    <ContestedScene
      district={blacksite}
      locations={views}
      baseId={undefined}
      gate={null}
      onPick={() => undefined}
    />,
  );
}

describe('a sign on the painting', () => {
  it('prints the location’s own blurb over its kind’s when it has one', () => {
    const own = 'Glass on the yard side, and the Directorate behind it.';
    draw([viewOf('blacksite-7-blackward', own)]);
    fireEvent.focus(screen.getByTestId('site-blacksite-7-blackward'));
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent(own);
    expect(card).not.toHaveTextContent(LOCATION_CATALOG.black_clinic.blurb);
  });

  it('falls back to the kind’s blurb for a location without one', () => {
    draw([viewOf('blacksite-7-armory', undefined)]);
    fireEvent.focus(screen.getByTestId('site-blacksite-7-armory'));
    expect(screen.getByRole('tooltip')).toHaveTextContent(LOCATION_CATALOG.armory.blurb);
  });
});
