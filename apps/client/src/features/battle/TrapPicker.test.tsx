import {
  TUTORIAL_STEPS,
  STARTING_RESOURCES,
  TRAP_CATALOG,
  battlefieldFor,
  findTrap,
  trapEffectLine,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type BattleSide,
  type BattleView,
  type BattlesResponse,
  type MeResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattlePage } from './BattlePage';
import { useSession } from '../../store/session';

/**
 * §I4: the Trap panel on a fight this crew is defending.
 *
 * Three things this screen decides on its own and nothing else checks: that an attacker never sees
 * the panel at all, that a trap the crew holds none of cannot be set, and that the request the
 * button sends names the battle and the trap rather than a location, which is what the route stopped
 * taking. Everything else on the panel is a sentence the server already worded.
 */

const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

const HELD = TRAP_CATALOG[0]!;
const EMPTY = TRAP_CATALOG[1]!;
const EMPTY_BLOCKER = 'None in the bag. The Scrapyard cuts them';

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: 'sector-7',
  level: 4,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  buildings: [],
  buildQueue: [],
  army: { razors: 8 },
  musterQueue: [],
  training: startingTraining(NOW),
  inventory: {},
  fittedUpgrades: [],
  unitLoadouts: {},
  fleet: {},
  commanders: [],
  createdAt: NOW,
};

const me: MeResponse = {
  admin: false,
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW,
    displayName: null,
    icon: 'shield',
    timezone: 'Europe/Athens',
    soundVolume: 60,
    // Seen, so the opening tutorial does not draw over a test about something else.
    tutorialSeen: [...TUTORIAL_STEPS],
  },
  overseer: null,
  base,
};

/** The board as the server builds it: an empty `traps` for anybody who is not defending. */
function viewFor(side: BattleSide, trapId: string | null): BattleView {
  return {
    battle: {
      id: 'press',
      target: { kind: 'location', districtId: 'steelbelt', locationId: 'steelbelt-press' },
      attackerBaseId: side === 'attacker' ? base.id : 'them',
      defender: { kind: 'crew', baseId: side === 'defender' ? base.id : 'them' },
      scheduledFor: MARK,
      holdAfterCapture: true,
      wokeSleepers: false,
      declaredAt: NOW,
      resolvedAt: null,
    },
    targetName: 'Kessler Press',
    districtName: 'Steelbelt',
    battlefield: battlefieldFor({
      locationName: 'Kessler Press',
      kind: 'scrap_press',
      at: new Date(MARK),
      weather: 'normal',
    }),
    role: side,
    side,
    deploymentOpen: true,
    withdrawalOpen: true,
    muster: { army: { razors: 8 }, perimeter: {}, size: 8 },
    enemySize: 10,
    enemyIntel: 'A rough count.',
    opponentName: 'Them',
    boosts: [],
    boostIds: [],
    boostSlots: 1,
    officerId: null,
    vehicles: {},
    yard: {},
    leaders: [],
    traps:
      side === 'defender'
        ? TRAP_CATALOG.map((spec) => ({
            trapId: spec.id,
            name: spec.name,
            description: spec.description,
            effect: trapEffectLine(spec),
            held: spec.id === HELD.id ? 2 : 0,
            available: spec.id === HELD.id,
            blocker: spec.id === HELD.id ? '' : EMPTY_BLOCKER,
          }))
        : [],
    trapId,
  };
}

const boardWith = (view: BattleView): BattlesResponse => ({
  coming: [view],
  reports: [],
  spyReports: [],
  slots: [],
  infamy: 40,
  callPrices: { locations: {}, districts: {} },
  gates: [],
  structures: [],
  serverNow: NOW,
});

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The last unit posted to `/battles/trap`, so the request itself can be asserted. */
let posted: unknown = null;

function serve(board: BattlesResponse): void {
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/battles/trap')) {
      posted = JSON.parse((init?.body ?? '{}') as string) as unknown;
      return reply({ battles: board, base });
    }
    if (path.endsWith('/battles')) return reply(board);
    if (path.endsWith('/actions')) return reply({ movements: [], serverNow: NOW });
    if (path.endsWith('/me')) return reply(me);
    throw new Error(`unstubbed request: ${path}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  posted = null;
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * Picking from the painted `Dropdown`, which is a button and a portalled listbox rather than a
 * `<select>`: opened by clicking the trigger, chosen by clicking the option with that label.
 */
async function pick(testId: string, label: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(testId));
  const option = (await screen.findAllByRole('option')).find(
    (node) => node.textContent?.startsWith(label) === true,
  );
  if (!option) throw new Error(`no option labelled ${label}`);
  fireEvent.click(option);
}

function draw(): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game/battles/press']}>
        <Routes>
          <Route path="/game/battles/:battleId" element={<BattlePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('§I4: the Trap panel', () => {
  it('is not on the screen at all for an attacker', async () => {
    serve(boardWith(viewFor('attacker', null)));
    draw();
    // The Boosts panel is the anchor: it proves the detail pane rendered, so an absent Trap panel
    // is a decision rather than a screen that never loaded.
    await screen.findByTestId('name-buys');
    expect(screen.queryByTestId('trap-picker')).toBeNull();
  });

  it('shows a defender the whole catalogue and what is already buried', async () => {
    serve(boardWith(viewFor('defender', HELD.id)));
    draw();

    const panel = within(await screen.findByTestId('trap-picker'));
    expect(panel.getByTestId('trap-set')).toHaveTextContent(HELD.name);

    // Every trap in the catalogue is offered, held or not, and the ones with none in the bag are
    // offered *dead*: a trap a player never sees is a trap they never go to the yard for.
    fireEvent.click(panel.getByTestId('trap-option-picker'));
    const options = await screen.findAllByRole('option');
    expect(options.map((node) => node.textContent)).toEqual(
      TRAP_CATALOG.map(
        (spec) =>
          `${spec.name}${spec.id === HELD.id ? '2 in the bag' : EMPTY_BLOCKER} · ${trapEffectLine(spec)}`,
      ),
    );
    expect(options.filter((node) => node.getAttribute('aria-disabled') === 'true')).toHaveLength(
      TRAP_CATALOG.length - 1,
    );
  });

  /**
   * What a trap does, on the screen it is chosen on (bug pass, 2026-09-29). The picker printed the
   * flavour line alone, so Razor Wire's "nobody dies of it" was the only effect a player could read.
   */
  it('prints what the buried trap and the one being looked at each do to the attack', async () => {
    serve(boardWith(viewFor('defender', HELD.id)));
    draw();

    const panel = within(await screen.findByTestId('trap-picker'));
    expect(panel.getByTestId('trap-set-effect')).toHaveTextContent(trapEffectLine(HELD));

    await pick('trap-option-picker', HELD.name);
    expect(await screen.findByTestId('trap-choice-effect')).toHaveTextContent(trapEffectLine(HELD));
    // ...and a trap the crew holds none of still says what it does, on its row in the list.
    const wire = findTrap('trap_razor_wire')!;
    fireEvent.click(panel.getByTestId('trap-option-picker'));
    const row = (await screen.findAllByRole('option')).find((node) =>
      node.textContent?.startsWith(wire.name),
    );
    expect(row).toHaveTextContent(
      'Kills nobody. The attack loses 15 speed and 2 morale for its first 2 rounds',
    );
  });

  it('posts the battle and the trap when one is buried', async () => {
    serve(boardWith(viewFor('defender', null)));
    draw();

    await screen.findByTestId('trap-picker');
    await pick('trap-option-picker', HELD.name);
    fireEvent.click(screen.getByTestId('set-trap'));

    // The route stopped taking a `locationId`, so the shape of the body is the contract.
    await waitFor(() => expect(posted).toEqual({ battleId: 'press', trapId: HELD.id }));
  });

  it('sends null to dig one back up', async () => {
    serve(boardWith(viewFor('defender', HELD.id)));
    draw();

    const panel = within(await screen.findByTestId('trap-picker'));
    fireEvent.click(panel.getByTestId('trap-clear'));
    await waitFor(() => expect(posted).toEqual({ battleId: 'press', trapId: null }));
  });

  it('will not bury one the crew is not carrying, and says why', async () => {
    serve(boardWith(viewFor('defender', null)));
    draw();

    const panel = within(await screen.findByTestId('trap-picker'));

    // The reason is on the option itself, in the server's own words rather than this screen's.
    await pick('trap-option-picker', EMPTY.name);
    const dead = (await screen.findAllByRole('option')).find((node) =>
      node.textContent?.startsWith(EMPTY.name),
    )!;
    expect(dead).toHaveTextContent(EMPTY_BLOCKER);
    expect(dead.getAttribute('aria-disabled')).toBe('true');

    // Clicking it changes nothing: the button never comes alive and nothing is sent.
    await waitFor(() => expect(panel.getByTestId('set-trap')).toBeDisabled());
    expect(posted).toBeNull();
  });

  it('is dead once they are on the ground', async () => {
    const view = { ...viewFor('defender', HELD.id), deploymentOpen: false };
    serve(boardWith(view));
    draw();

    const panel = within(await screen.findByTestId('trap-picker'));
    expect(panel.getByTestId('trap-option-picker')).toBeDisabled();
    expect(panel.getByTestId('trap-clear')).toBeDisabled();
  });
});

/**
 * Bug pass, 2026-10-06: one failed background poll swapped the whole board for the failure screen,
 * which unmounted the open fight and everything chosen on it, until the next poll put it back.
 */
describe('a failed poll under an open fight', () => {
  it('keeps the board, and the fight, on screen', async () => {
    const board = boardWith(viewFor('defender', HELD.id));
    serve(board);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/game/battles/press']}>
          <Routes>
            <Route path="/game/battles/:battleId" element={<BattlePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('trap-picker');

    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/battles')
        ? Promise.resolve(new Response('bad gateway', { status: 502 }))
        : reply(me),
    );
    await client.refetchQueries({ queryKey: ['battles'] });
    await waitFor(() => expect(client.getQueryState(['battles'])?.status).toBe('error'));
    expect(screen.getByTestId('trap-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('load-failure')).toBeNull();
  });
});
