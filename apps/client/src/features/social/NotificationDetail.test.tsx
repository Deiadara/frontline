import { MISC_AREA_ID, type Mission } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useSession } from '../../store/session';
import { NotificationDetail } from './NotificationDetail';

/**
 * The receipt's sheet names what full stores threw away (maintainer ruling, 2026-09-28).
 *
 * "A crew is home" opens onto what came back, and since the stores became a hard ceiling that is
 * not always what landed: the part with no room is lost at the gate, and the sheet says so the
 * same way the mission report does.
 */

const MISSION: Mission = {
  id: 'r-1',
  baseId: 'base-1',
  templateId: 'foundry-raid',
  areaId: MISC_AREA_ID,
  payPercent: 0,
  xp: 240,
  force: { razors: 3 },
  vehicles: {},
  pricedMinutes: 0,
  startedAt: '2026-09-28T10:00:00.000Z',
  travelMinutes: 5,
  durationMinutes: 50,
  status: 'resolved',
  officerId: null,
  grade: null,
  overseerLed: true,
  lost: {},
  reported: true,
  outcome: 'success',
  rewards: { scrap: 40 },
  spoils: { scrap: 40 },
  wasted: { scrap: 15 },
  found: {},
  resolvedAt: '2026-09-28T11:00:00.000Z',
  recalledAt: null,
  pagePrize: null,
  pageWon: null,
};

function open(mission: Mission) {
  // Signed out, so the queries read the cache below and never reach for the network.
  useSession.setState({ signedIn: false, user: null });
  const client = new QueryClient();
  // Only the two fields the sheet and the hook read: the rest of the board is not under test.
  client.setQueryData(['missions', ''], { missions: [mission], justResolved: [] });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationDetail
          entry={{
            id: 'n-1',
            kind: 'mission_home',
            title: 'A crew is home',
            body: 'Foundry Raid',
            link: '/game/missions',
            subjectId: mission.id,
            createdAt: '2026-09-28T11:00:00.000Z',
            readAt: null,
          }}
          onClose={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the receipt of a crew coming home', () => {
  it('names what the full stores threw away', () => {
    open(MISSION);
    expect(screen.getByTestId(`mission-wasted-${MISSION.id}`).textContent).toBe(
      'The stores were full: 15 loot of what they carried went to waste at the gate (15 Scrap).',
    );
  });

  it('marks the wasted part on the resource it came out of', () => {
    open(MISSION);
    expect(screen.getByTestId('haul-wasted-scrap').textContent).toBe('15 wasted');
  });

  // Bug pass, 2026-10-02: `Icon` has no `planks`, so the Planks tile was an empty box.
  it('draws a glyph on every resource tile, planks included', () => {
    open({ ...MISSION, rewards: { planks: 40, scrap: 40 }, wasted: {} });
    for (const kind of ['planks', 'scrap']) {
      const tile = screen.getByTestId(`haul-${kind}`);
      // Something drawn: an `<svg>` with nothing inside it is what an unknown icon name renders.
      const drawn = tile.querySelector('img') ?? tile.querySelector('svg > *');
      expect(drawn, kind).not.toBeNull();
    }
  });

  it('says nothing about waste when everything fitted', () => {
    open({ ...MISSION, wasted: {} });
    expect(screen.queryByTestId(`mission-wasted-${MISSION.id}`)).toBeNull();
  });
});

/** Bug pass, 2026-10-06: "Go there" was a button inside a link, two tab stops for one action. */
describe('the way to what a receipt is about', () => {
  it('is one link, with no button inside it', () => {
    open(MISSION);
    const go = screen.getByTestId('detail-go');
    expect(go.tagName).toBe('A');
    expect(go.querySelector('button')).toBeNull();
    expect(go).toHaveTextContent('Go there');
  });
});
