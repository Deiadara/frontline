import { CITY_DISTRICTS, type LocationHolder, type LocationView } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContestedScene } from './ContestedScene';

/**
 * The sign's hover card says what the sheet says.
 *
 * The hover card on the painting used to read the location kind's blurb and reward
 * unconditionally, so for a while the Psychic Ward's tooltip described a black clinic while its
 * sheet described the room in the wall. Every location carries its own words now (2026-10-14), and
 * this pins the card to them.
 */
const blacksite = CITY_DISTRICTS.find((district) => district.id === 'blacksite')!;
const combine: LocationHolder = { kind: 'government' };

function viewOf(locationId: string, blurb?: string): LocationView {
  const location = blacksite.locations.find((one) => one.id === locationId)!;
  return {
    location: { ...location, blurb: blurb ?? location.blurb },
    holder: combine,
    holderName: 'The Combine',
    holderPlayer: null,
    level: 1,
    upgradingUntil: null,
    upgrade: null,
    upgradingSince: null,
    defense: 0,
    garrisonSize: 0,
    garrison: null,
    latestSpyReport: null,
    bonuses: [],
    reward: location.reward,
    labels: [],
    unlocks: [],
    holderFaction: null,
    holderSide: 'enemy',
    noisyFromTower: false,
    switch: null,
    lamps: null,
    reactor: null,
    pamphlets: null,
    trophies: null,
    door: null,
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
  it("colours by side and wears the holder's mark (2026-10-07)", () => {
    const [first, second] = blacksite.locations;
    draw([
      viewOf(first!.id, undefined),
      {
        ...viewOf(second!.id, undefined),
        holder: { kind: 'unoccupied' },
        holderSide: 'unoccupied',
      },
    ]);
    const held = screen.getByTestId(`site-${first!.id}`).querySelector('span[data-side]');
    expect(held).toHaveAttribute('data-side', 'enemy');
    expect(held?.className).toContain('oxblood');
    expect(held?.querySelector('[data-testid="insignia-government"]')).not.toBeNull();
    const empty = screen.getByTestId(`site-${second!.id}`).querySelector('span[data-side]');
    expect(empty).toHaveAttribute('data-side', 'unoccupied');
    expect(empty?.querySelector('[data-testid^="insignia-"]')).toBeNull();
  });

  it('prints the location’s own blurb', () => {
    const own = 'Glass on the yard side, and the Combine behind it.';
    draw([viewOf('blacksite-blackward', own)]);
    fireEvent.focus(screen.getByTestId('site-blacksite-blackward'));
    expect(screen.getByRole('tooltip')).toHaveTextContent(own);
  });

  it('prints the location’s own reward, the line its sheet prints', () => {
    const armory = blacksite.locations.find((one) => one.id === 'blacksite-armory')!;
    draw([viewOf('blacksite-armory')]);
    fireEvent.focus(screen.getByTestId('site-blacksite-armory'));
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent(armory.blurb);
    expect(card).toHaveTextContent(armory.reward);
  });
});
