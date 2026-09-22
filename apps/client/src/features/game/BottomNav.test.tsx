import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommander } from '@frontline/shared';
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

  /** §D4's old home, from before the Inventory page was retired: no door points into it. */
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

/**
 * §I3: which doors are shut, and what each shut one says (maintainer, 2026-09-19).
 *
 * Rendered rather than asserted about as data, because the bug this is here to catch lives in the
 * markup and not in the catalogue. The nav and the route guard are two separate readings of the
 * same facts (`lib/unlocks.ts`), and the failure they can have is a door drawn open in the bar
 * onto a screen that draws a locked sign, or the reverse: a padlock over a screen a player can
 * reach by typing the URL. Both look fine in the catalogue.
 *
 * The four doors of the opening loop are asserted **shut-proof** rather than merely open. A door
 * added to `GATED_AREAS` by mistake would gate one of them, and nothing else in the suite would
 * notice: the game would simply start smaller than it is meant to.
 */
describe('§I3: the doors, and what shuts them', () => {
  /** A crew with the given facts. Starts from `lateGame`, which has a full district. */
  const crewWith = (base: Partial<NonNullable<typeof F.lateGame.base>>) => ({
    ...F.lateGame,
    base: { ...F.lateGame.base!, ...base },
  });

  /**
   * Draw the bar and wait until it has actually decided its gates.
   *
   * The wait is the whole point and it is not boilerplate. Before `/me` lands the bar draws every
   * door open on purpose, so an assertion made on the first frame reads "open" for every door in
   * the row: the first version of these tests passed the all-open case on a build where every
   * single gate was shut, because it measured the loading frame. `data-gates` is what separates
   * "this door is open" from "nobody has answered yet".
   */
  async function drawSettledBar(me: unknown) {
    cleanup();
    await drawBar(me);
    await waitFor(() => {
      expect(screen.getByRole('navigation').dataset['gates']).toBe('ready');
    });
  }

  /**
   * Whether a door is drawn shut.
   *
   * The padlock, since 2026-09-22: the caption under the icon ("Lv 15", "Hire one") is gone at
   * the maintainer's request, on the grounds that pressing a shut door already says why. So the
   * lock over the glyph is the whole of the signal, and it is what these tests read. Found
   * inside the door rather than by area id, so a door whose gate changes kind still measures.
   */
  const shut = (label: string): boolean => {
    const door = screen.getByTestId(`nav-${label.toLowerCase().replace(/\s+/g, '-')}`);
    return door.querySelector('[data-testid^="nav-locked-"]') !== null;
  };

  const lockOver = (area: string) => screen.queryByTestId(`nav-locked-${area}`);

  it('leaves the opening loop open on a brand-new crew', async () => {
    await drawSettledBar(
      crewWith({
        level: 1,
        buildings: [],
        commanders: [],
        research: { active: null, technologies: [] },
        economy: { ...F.lateGame.base!.economy, notoriety: 0 },
      }),
    );
    for (const label of ['City', 'District', 'Units', 'Missions']) {
      expect(shut(label), `${label} was gated`).toBe(false);
    }
    // ...and the doors that are meant to be shut on this crew are, so the case above is a
    // measurement of the loop rather than of a bar that gates nothing at all.
    expect(shut('Market')).toBe(true);
    expect(lockOver('market')).not.toBeNull();
  });

  it('shuts the level doors on a level-1 crew', async () => {
    await drawSettledBar(crewWith({ level: 1 }));
    expect(shut('Training')).toBe(true);
    expect(shut('The Bar')).toBe(true);
    expect(shut('Crew')).toBe(true);
    expect(shut('Faction')).toBe(true);
    expect(shut('Market')).toBe(true);
  });

  it('opens each level door at its own level and not one before it', async () => {
    await drawSettledBar(crewWith({ level: 5 }));
    // Three and five are behind this crew; ten and fifteen are not.
    expect(shut('Training')).toBe(false);
    expect(shut('The Bar')).toBe(false);
    expect(shut('Crew')).toBe(false);
    expect(shut('Faction')).toBe(true);
    expect(shut('Market')).toBe(true);
  });

  /**
   * The Scrapyard, whose gate is the structure itself.
   *
   * Both halves are at level 40 with the same district, so a level reading of this door would
   * open it in both and the assertion would pass while measuring nothing. The only thing that
   * differs is whether a scrapyard is standing.
   */
  it('shuts the Scrapyard until one is standing, whatever the level', async () => {
    const yard = { id: 'b-yard', kind: 'scrapyard' as const, level: 1, modifications: [] };
    const without = F.lateGame.base!.buildings.filter((b) => b.kind !== 'scrapyard');
    await drawSettledBar(crewWith({ level: 40, buildings: without }));
    expect(shut('Scrapyard')).toBe(true);
    expect(lockOver('scrapyard')).not.toBeNull();

    await drawSettledBar(crewWith({ level: 40, buildings: [...without, yard] }));
    expect(shut('Scrapyard')).toBe(false);
    expect(lockOver('scrapyard')).toBeNull();
  });

  /**
   * The Archive, whose gate is a person rather than a number.
   *
   * The benched case is the one worth having: an officer on the books with `role: null` is signed
   * and paid and doing no job, and the Lab already refuses to work for them
   * (`no_head_of_research`). A door that counted them would open a screen that cannot be used.
   */
  it('shuts the Archive until somebody is sitting in the chair', async () => {
    const person = createCommander(
      'c-archivist',
      'Vela Roshan',
      'head_of_research',
      { logic: 44, signals: 31, stealth: 20 },
      [],
      300,
    );
    await drawSettledBar(crewWith({ level: 40, commanders: [{ ...person, role: null }] }));
    expect(shut('Research')).toBe(true);

    await drawSettledBar(
      crewWith({ level: 40, commanders: [{ ...person, role: 'head_of_research' }] }),
    );
    expect(shut('Research')).toBe(false);
  });
});
