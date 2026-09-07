import {
  STARTING_RESOURCES,
  TRAP_CATALOG,
  battlefieldFor,
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
  trainingQueue: [],
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
  },
  overseer: null,
  base,
};

/** The board as the server builds it: an empty `traps` for anybody who is not defending. */
function viewFor(side: BattleSide, trapId: string | null): BattleView {
  return {
    battle: {
      id: 'press',
      target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
      attackerBaseId: side === 'attacker' ? base.id : 'them',
      defender: { kind: 'crew', baseId: side === 'defender' ? base.id : 'them' },
      scheduledFor: MARK,
      holdAfterCapture: false,
      declaredAt: NOW,
      resolvedAt: null,
      seed: 'press-seed',
    },
    targetName: 'Kessler Press',
    districtName: 'Steelbelt',
    battlefield: battlefieldFor({
      locationName: 'Kessler Press',
      kind: 'scrap_press',
      fortifyDifficulty: 'medium',
      fortifyLevel: 0,
      at: new Date(MARK),
      weather: 'normal',
    }),
    role: side,
    side,
    deploymentOpen: true,
    muster: { army: { razors: 8 }, perimeter: {}, size: 8 },
    enemySize: 10,
    enemyIntel: 'A rough count.',
    opponentName: 'Them',
    boosts: [],
    boostId: null,
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
  slots: [],
  infamy: 40,
  gates: [],
  structures: [],
  serverNow: NOW,
});

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The last body posted to `/battles/trap`, so the request itself can be asserted. */
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
  useSession.setState({ token: 'session-token', user: null });
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
        (spec) => `${spec.name}${spec.id === HELD.id ? '2 in the bag' : EMPTY_BLOCKER}`,
      ),
    );
    expect(options.filter((node) => node.getAttribute('aria-disabled') === 'true')).toHaveLength(
      TRAP_CATALOG.length - 1,
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
