import {
  CITY_DISTRICTS,
  GOVERNMENT,
  STARTER_DISTRICT_ID,
  STARTING_RESOURCES,
  isSeatOfGovernmentPower,
  startingEconomy,
  startingAssignees,
  startingProgression,
  startingResearch,
  type Base,
  type District,
} from '@frontline/shared';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel } from './ContextPanel';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

const raidSite = CITY_DISTRICTS.find((d) => d.kind === 'raid');
if (!raidSite) throw new Error('expected a raid district in the city');

const myBase: Base = {
  id: 'base-1',
  ownerId: 'owner-1',
  name: 'Deepwater Hold',
  districtId: STARTER_DISTRICT_ID,
  level: 3,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy('2026-08-13T09:30:00.000Z'),
  progression: startingProgression(),
  research: startingResearch(),
  assignees: startingAssignees(),
  buildings: [],
  commanders: [],
  createdAt: '2026-08-13T09:30:00.000Z',
};

const renderPanel = (selected: District | null) =>
  render(
    <MemoryRouter>
      <ContextPanel
        selected={selected}
        myBase={myBase}
        bases={[]}
        onAttack={() => undefined}
        isAttacking={false}
      />
    </MemoryRouter>,
  );

describe('ContextPanel district art', () => {
  it('shows no image while the district still paints procedurally', () => {
    expect(renderPanel(raidSite).container.querySelector('img')).toBeNull();
  });

  it('shows the delivered district illustration, addressed by district rather than by path', () => {
    deliveredUrl.mockReturnValue('/assets/district-rustyard.webp');
    const { container } = renderPanel(raidSite);
    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'district', districtId: raidSite.id });
    expect(container.querySelector('img')).toHaveAttribute('src', '/assets/district-rustyard.webp');
  });

  it('asks for no art at all with nothing selected', () => {
    renderPanel(null);
    expect(deliveredUrl).not.toHaveBeenCalled();
  });
});

describe('ContextPanel names who holds the ground (§A3)', () => {
  const combineOutpost = CITY_DISTRICTS.find(
    (d) => d.faction === 'government' && !isSeatOfGovernmentPower(d),
  );
  const seatOfPower = CITY_DISTRICTS.find(isSeatOfGovernmentPower);
  const independentSite = CITY_DISTRICTS.find(
    (d) => d.kind === 'raid' && d.faction !== 'government',
  );
  if (!combineOutpost || !seatOfPower || !independentSite) {
    throw new Error('fixture error: the city map is missing a faction case');
  }

  it('marks a Combine holding and says who holds it', () => {
    const { getByText } = renderPanel(combineOutpost);
    expect(getByText(GOVERNMENT.adjective)).toBeInTheDocument();
    expect(getByText(new RegExp(`Held by ${GOVERNMENT.name}`))).toBeInTheDocument();
  });

  it('reads a seat of power as a claim on the state, not a raid', () => {
    const { getByText } = renderPanel(seatOfPower);
    expect(getByText('Seat of Power')).toBeInTheDocument();
    expect(getByText(/claim on the state/)).toBeInTheDocument();
  });

  it('does not call independent ground the government', () => {
    const { queryByText } = renderPanel(independentSite);
    expect(queryByText(GOVERNMENT.adjective)).toBeNull();
    expect(queryByText(new RegExp(`Held by ${GOVERNMENT.name}`))).toBeNull();
  });

  it('says nothing about factions on the base the player holds', () => {
    const home = CITY_DISTRICTS.find((d) => d.id === STARTER_DISTRICT_ID);
    if (!home) throw new Error('fixture error: no starter district');
    const { queryByText } = renderPanel(home);
    expect(queryByText(new RegExp(`Held by ${GOVERNMENT.name}`))).toBeNull();
  });
});
