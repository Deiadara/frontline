import {
  STARTING_RESOURCES,
  battlefieldFor,
  columnSpeed,
  findUpgrade,
  findVehicle,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  travelMinutes,
  unitColumnSpeed,
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
import { formatDuration } from '../base/format';
import { useSession } from '../../store/session';

/**
 * The machines panel quotes a column this crew could actually send.
 *
 * It used to read `carriedSpeedPercent(view.vehicles, view.muster.size)` and label the answer "for
 * this column". `muster.size` is the whole side's folded deployment (`battle/view.ts` builds it
 * from `sideForce`, which merges every crew's row), so it counts allies and everything already
 * standing on the ground: not a force anybody is putting on a road. The panel reads the crew's own
 * roster at home instead, which is the biggest column this yard will ever have to move, and spends
 * it through `columnSpeed` and `travelMinutes`: the two functions `battle/movement.ts` measures the
 * real road with.
 *
 * Every figure is read out of the catalogue and the map rather than typed in. What this file is
 * about is *which force the panel reads*, and pinning the speed table here made a tuning pass look
 * like a regression in the label.
 */

const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

/** Three Cheese Wagons: 3 x 30 seats, all at the same speed. */
const FLEET = { armoured_car: 3 } as const;
const SEATS = 3 * (findVehicle('armoured_car')?.capacity ?? 0);
/** A real district, so the panel has a road to measure and the clock branch is exercised. */
const HOME = 'neon-docks';

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: HOME,
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
    soundVolume: 60,
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
  traps: [],
  trapId: null,
};

const battles: BattlesResponse = {
  coming: [view],
  reports: [],
  slots: [],
  infamy: 40,
  gates: [],
  structures: [],
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

const speedOf = (force: Record<string, number>) =>
  columnSpeed(FLEET, force, (unitId) => unitColumnSpeed(unitId));

/** What the panel says, and what it would say if it read the whole standing muster instead. */
const AT_HOME = speedOf(base.army);
const AT_MUSTER = speedOf(view.muster?.army ?? {});
const ROAD = travelMinutes(HOME, view.battle.target.districtId, { speed: AT_HOME });

/** The page, at the fight the fixture declares, with whatever `/me` this case wants. */
async function openPicker(session: MeResponse = me) {
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/battles')) return reply(battles);
    if (path.endsWith('/actions')) return reply({ movements: [], serverNow: NOW });
    if (path.endsWith('/me')) return reply(session);
    throw new Error(`unstubbed request: ${path}`);
  });
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
  return screen.findByTestId('vehicle-picker');
}

describe('the machines panel', () => {
  it('is a precondition that the roster at home and the standing muster disagree', () => {
    // Not the values themselves: that they differ. Eight bodies fit in one bus and ride at its
    // speed; two hundred overflow 90 seats and the rest walk at their own. A panel that quoted
    // either one would pass a test pinned to a single number.
    expect(AT_MUSTER).not.toEqual(AT_HOME);
    expect(AT_MUSTER).toBeGreaterThan(0);
    expect(ROAD).not.toBeNull();
  });

  it('quotes the seats and the column at home, not the standing muster', async () => {
    const panel = await openPicker();
    const picker = within(panel);
    // The per-vehicle rows carry a speed too, so the note is addressed by its own phrasing.
    await waitFor(() => expect(picker.getByText(/seats ·/)).toBeInTheDocument());
    const note = picker.getByText(/seats ·/);
    // Eight Razors and 90 seats: nobody walks, so the machine under them is the slowest group.
    expect(note).toHaveTextContent(
      `${SEATS} seats · Held to ${AT_HOME} by the Cheese Wagon · ${formatDuration((ROAD ?? 0) * 60)} at most`,
    );
    // The pace the standing muster would produce, and the phrase that promised a column.
    expect(note).not.toHaveTextContent(`Held to ${AT_MUSTER}`);
    expect(panel).not.toHaveTextContent('this column');
  });

  /*
   * The brackets reach the quote, which is a fact about this panel's *wiring* rather than about
   * `readColumn`.
   *
   * `battle/movement.ts` folds `fittedFor(base.unitLoadouts, unitId)` into every group's speed, and
   * the armour line takes speed away. A panel reading the printed sheet quotes a road the crew then
   * overruns, under a label that says "at most". `column.test.ts` covers the arithmetic; what can
   * only fail here is the panel forgetting to hand its base's brackets over.
   *
   * Two hundred Razors against 90 seats, so most of them walk and the column *is* their sheet.
   * With everybody aboard the rig would be invisible: the machine would still be the slowest group.
   */
  it('folds the workshop brackets on the crew base into the pace it quotes', async () => {
    const rig = findUpgrade('armour_3');
    expect(rig?.effect.speed, 'the armour line must still cost speed').toBeLessThan(0);

    const walking = { razors: SEATS + 80 };
    const rigged: MeResponse = {
      ...me,
      base: { ...base, army: walking, unitLoadouts: { razors: ['armour_3'] } },
    };
    const printed = speedOf(walking);
    const slowed = columnSpeed(FLEET, walking, (unitId) =>
      unitColumnSpeed(unitId, { fitted: ['armour_3'] }),
    );
    // The precondition: the rig has to move the answer, or this passes against a panel that
    // ignores the brackets entirely.
    expect(slowed).toBeLessThan(printed);

    const panel = await openPicker(rigged);
    const note = within(panel).getByText(/seats ·/);
    expect(note).toHaveTextContent(`Held to ${slowed} by`);
    expect(note).not.toHaveTextContent(`Held to ${printed} by`);
  });
});
