import {
  STARTING_RESOURCES,
  battlefieldFor,
  carriedSpeedPercent,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type BattleView,
  type BattlesResponse,
  type MeResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattlePage } from './BattlePage';
import { useSession } from '../../store/session';

/**
 * The machines panel quotes a fact about the machines, because there is no column yet.
 *
 * It used to read `carriedSpeedPercent(view.vehicles, view.muster.size)` and label the answer "for
 * this column". `muster.size` is the whole side's folded deployment (`battle/view.ts:86-95` builds
 * it from `sideForce`, which merges every crew's row), so it counts allies and everything already
 * standing on the ground. The server computes the same function per column, over
 * `input.army + input.perimeter`. Three War Haulers seated among 200 bodies gives one number; the
 * same three under the six Razors a player actually sends gives a much larger one, so the label
 * understated the discount and named a column that did not exist.
 *
 * Both numbers are read out of the catalogue rather than typed in. They were `17` and `28`, and the
 * vehicle rebalance moved them: what this file is about is *which force the panel divides by*, and
 * pinning the speed table here made a tuning pass look like a regression in the label.
 */

const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

/** Three War Haulers: 3 x 40 seats, all at the same 28%. */
const FLEET = { war_hauler: 3 } as const;
const SEATS = 120;

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

/** The fight, with the machines loaded and a great many bodies already on the ground. */
const view: BattleView = {
  battle: {
    id: 'press',
    target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
    attackerBaseId: base.id,
    defender: { kind: 'looters' },
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
  role: 'attacker',
  side: 'attacker',
  deploymentOpen: true,
  // The whole side, allies included: 200 bodies already standing, not a column anybody is sending.
  muster: { army: { razors: 200 }, perimeter: {}, size: 200 },
  enemySize: 10,
  enemyIntel: 'A rough count.',
  opponentName: 'Looters',
  boosts: [],
  boostId: null,
  officerId: null,
  vehicles: { ...FLEET },
  yard: {},
  leaders: [],
};

const battles: BattlesResponse = {
  coming: [view],
  reports: [],
  slots: [],
  infamy: 40,
  gates: [],
  structures: [],
  traps: [],
  serverNow: NOW,
};

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/battles')) return reply(battles);
    if (path.endsWith('/actions')) return reply({ movements: [], serverNow: NOW });
    if (path.endsWith('/me')) return reply(me);
    throw new Error(`unstubbed request: ${path}`);
  });
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

/** What the panel would say if it divided by the whole standing muster, and what it says instead. */
const AT_MUSTER = carriedSpeedPercent(FLEET, view.muster?.size ?? 0);
const AT_FULL_LOAD = carriedSpeedPercent(FLEET, SEATS);

describe('the machines panel', () => {
  it('is a precondition that the muster and a full load disagree', () => {
    // Not the values themselves: that they differ, and which way round. A panel that quoted either
    // one would pass a test pinned to a single number.
    expect(AT_MUSTER).toBeLessThan(AT_FULL_LOAD);
    expect(AT_MUSTER).toBeGreaterThan(0);
  });

  it('quotes the seats and the full-load rate, not the standing muster', async () => {
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

    const panel = await screen.findByTestId('vehicle-picker');
    const picker = within(panel);
    // The per-vehicle rows also say "off the road", so the note is addressed by its own phrasing.
    await waitFor(() => expect(picker.getByText(/seats ·/)).toBeInTheDocument());
    const note = picker.getByText(/seats ·/);
    expect(note).toHaveTextContent(`${SEATS} seats · ${AT_FULL_LOAD}% off the road at a full load`);
    // The number the standing muster produces, and the phrase that promised a column.
    expect(panel).not.toHaveTextContent(`${AT_MUSTER}%`);
    expect(panel).not.toHaveTextContent('this column');
  });
});
