import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { BottomNav, DESTINATIONS } from './BottomNav';
import { useSession } from '../../store/session';

/**
 * §I1b: research is a place you walk to again.
 *
 * The door came off under §B8, when research was a desk you only opened from the Lab's own window.
 * It carries §D's blueprints now, which is a thing a player checks on the way past rather than a
 * decision they make while standing in the district, so it is back in the row. The Lab's button
 * still goes to the same route (`StructureDialog`).
 */
describe('§I1b: the scenery switcher', () => {
  it('carries a research door, level-gated like the rest', () => {
    const research = DESTINATIONS.find((destination) => destination.label === 'Research');
    expect(research).toBeDefined();
    expect(research?.to).toBe('/game/research');
    expect(research?.area).toBe('research');
    expect(research?.icon).toBe('research');
  });

  it('still carries the places research is not', () => {
    const to = DESTINATIONS.map((destination) => destination.to);
    expect(to).toContain('/game/base');
    expect(to).toContain('/game/units');
    expect(to).toContain('/game/scrapyard');
  });

  /** §D4's old home. The Satchel keeps a link to it; the walk of doors does not get a second one. */
  it('carries no blueprints door of its own', () => {
    const to = DESTINATIONS.map((destination) => destination.to);
    expect(to).not.toContain('/game/research/blueprints');
    expect(to).not.toContain('/game/inventory/blueprints');
  });

  /**
   * The Workshop's door became the Scrapyard's (maintainer request, 2026-09-10): one shop for refits,
   * modifications and traps, and no second path to it.
   */
  it('carries the scrapyard door and no workshop door', () => {
    const to = DESTINATIONS.map((destination) => destination.to);
    expect(to).toContain('/game/scrapyard');
    expect(to).not.toContain('/game/workshop');
  });
});

/**
 * The feats door, in the corner of the bar (maintainer request, 2026-09-13).
 *
 * Rendered rather than asserted about as data, because the two things that can go wrong with it
 * are both in the markup: it is not in `DESTINATIONS` (it is pinned, like Settings, rather than
 * standing in the walk of doors), and its red mark has to behave exactly like the standing bar's,
 * which means drawing **nothing at all** at zero rather than an empty dot.
 */
const fetchMock = vi.fn();

const reply = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function drawBar(me: unknown) {
  fetchMock.mockImplementation((path: string) => {
    const url = String(path);
    if (url.endsWith('/me')) return reply(me);
    // The build under test has no bench, which is what `useAdmin` turns into a missing Console.
    if (url.endsWith('/admin')) return reply({ error: { code: 'NOT_FOUND', message: 'no' } }, 404);
    throw new Error(`unstubbed request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game']}>
        <BottomNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByTestId('nav-feats');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the feats door', () => {
  it('is pinned rather than standing in the walk of doors', () => {
    expect(DESTINATIONS.map((destination) => destination.to)).not.toContain('/game/feats');
  });

  it('opens the feats screen', async () => {
    const door = await drawBar(F.me);
    expect(door).toHaveAttribute('href', '/game/feats');
    expect(door).toHaveTextContent('Feats');
  });

  it('carries the red mark when feats are waiting, and says the figure out loud', async () => {
    const door = await drawBar(F.featsMe);
    expect(await screen.findByTestId('nav-feats-badge')).toHaveTextContent(
      String(F.featsBoard.ready),
    );
    expect(door).toHaveTextContent(`${F.featsBoard.ready} waiting`);
  });

  it('draws nothing at all when none are waiting', async () => {
    await drawBar({
      ...F.featsMe,
      unread: { ...F.featsMe.unread, featsReady: 0 },
    });
    expect(screen.queryByTestId('nav-feats-badge')).toBeNull();
  });

  it('does not sit on top of the fight mark: both are drawn, and at different insets', async () => {
    await drawBar(F.featsMe);
    const feats = (await screen.findByTestId('nav-feats')).parentElement;
    const fights = await screen.findByTestId('nav-fights');
    expect(feats?.className).toContain('left-4');
    expect(fights.className).toContain('left-[94px]');
  });
});
