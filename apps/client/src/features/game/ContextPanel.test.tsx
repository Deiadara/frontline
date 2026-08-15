import {
  CONTESTED_DISTRICTS,
  RESIDENTIAL_DISTRICTS,
  STARTER_DISTRICT_ID,
  findDistrict,
  type District,
  type DistrictSummary,
} from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ContextPanel } from './ContextPanel';

/**
 * The map's caption (GDD §A4).
 *
 * What is being pinned here is the *fog*: an unscouted district must not report how many places
 * are in it, who is holding them, or anything else a crew has not earned. That is a rule the panel
 * can only get wrong in one direction, and it is the direction that matters.
 */

const MY_BASE = 'base-1';

const home = findDistrict(STARTER_DISTRICT_ID);
const contested = CONTESTED_DISTRICTS[0];
const neighbour = RESIDENTIAL_DISTRICTS.find((district) => district.id !== STARTER_DISTRICT_ID);
if (!home || !contested || !neighbour) throw new Error('fixture error: the city map is incomplete');

function entry(district: District, over: Partial<DistrictSummary> = {}): DistrictSummary {
  return {
    district,
    scouted: true,
    travelMinutes: 20,
    holder: null,
    held: { mine: 0, total: district.places.length },
    base: null,
    isHome: false,
    ...over,
  };
}

const renderPanel = (summary: DistrictSummary | null, handlers = {}) =>
  render(
    <MemoryRouter>
      <ContextPanel
        entry={summary}
        myBaseId={MY_BASE}
        pending={false}
        onScout={vi.fn()}
        onEnter={vi.fn()}
        onRaid={vi.fn()}
        {...handlers}
      />
    </MemoryRouter>,
  );

describe('the map caption', () => {
  it('asks the player to pick somewhere when nothing is selected', () => {
    renderPanel(null);
    expect(screen.getByText(/pick somewhere on the map/i)).toBeInTheDocument();
  });

  it('names the district and how far away it is', () => {
    renderPanel(entry(contested, { travelMinutes: 37 }));
    expect(screen.getByRole('heading', { name: contested.name })).toBeInTheDocument();
    expect(screen.getByText('37 min away')).toBeInTheDocument();
  });
});

describe('fog of war (§A4)', () => {
  it('says nothing about what is inside ground nobody has scouted', () => {
    renderPanel(entry(contested, { scouted: false, held: null, holder: null }));

    expect(screen.getByRole('button', { name: /send scouts/i })).toBeInTheDocument();
    // The counts are the thing that must not leak — not merely hidden behind a label.
    expect(screen.queryByTestId('places-held')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enter the district/i })).not.toBeInTheDocument();
  });

  it('reports what is held once the crew has been', () => {
    renderPanel(entry(contested, { held: { mine: 2, total: 4 } }));
    expect(screen.getByTestId('places-held')).toHaveTextContent('2 / 4');
    expect(screen.getByRole('button', { name: /enter the district/i })).toBeInTheDocument();
  });

  it('calls a district yours only when you hold every place in it', () => {
    const whole = renderPanel(
      entry(contested, {
        held: { mine: contested.places.length, total: contested.places.length },
        holder: { kind: 'faction', baseId: MY_BASE },
      }),
    );
    expect(whole.getByText('You')).toBeInTheDocument();
    whole.unmount();

    renderPanel(entry(contested, { held: { mine: 1, total: 4 }, holder: null }));
    expect(screen.getByText(/it is split/i)).toBeInTheDocument();
  });
});

describe('home ground (§A4)', () => {
  it('offers no raid on your own district', () => {
    renderPanel(
      entry(home, {
        isHome: true,
        base: {
          id: MY_BASE,
          ownerId: 'owner-1',
          name: 'Mine',
          districtId: home.id,
          level: 3,
          isBot: false,
        },
      }),
    );
    expect(screen.getByText(/cannot be taken off you/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /plan a raid/i })).not.toBeInTheDocument();
  });

  it('offers a raid on somebody else’s, and never a capture', () => {
    const onRaid = vi.fn();
    renderPanel(
      entry(neighbour, {
        base: {
          id: 'base-2',
          ownerId: 'owner-2',
          name: 'Vex Holdings',
          districtId: neighbour.id,
          level: 4,
          isBot: true,
        },
      }),
      { onRaid },
    );

    expect(screen.getByText('Vex Holdings')).toBeInTheDocument();
    expect(screen.getByText(/never be captured/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /plan a raid/i }));
    expect(onRaid).toHaveBeenCalledWith(neighbour.id);
  });
});
