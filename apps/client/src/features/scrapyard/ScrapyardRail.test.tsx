import {
  COMBINE_UNITS,
  UNIT_MODIFICATIONS,
  scrapyardLevelForUpgrade,
  upgradePrice,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type UnitModificationSpec,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { ScrapyardPage } from './ScrapyardPage';

/**
 * The refits rail never opens a door onto a Combine sheet (2026-09-19).
 *
 * The rail is every catalogue unit some card on the board targets, so the guard is on the rail
 * rather than on the board: a card whose `targets` names the Syndic is the server's mistake, and
 * the yard must not turn it into a bench a player can open on a unit they will never own.
 */
const CARD = firstCard();

function firstCard(): UnitModificationSpec {
  const card = UNIT_MODIFICATIONS[0];
  if (!card) throw new Error('the catalogue lost its unit modifications');
  return card;
}

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** One refit card, offered against every unit in `targets`. */
function refit(targets: readonly { id: string; name: string }[]): ScrapyardEntry {
  return {
    id: CARD.id,
    kind: 'upgrade',
    name: CARD.name,
    description: CARD.description,
    building: null,
    effect: '',
    cost: upgradePrice(CARD),
    advanced: CARD.rarity !== 'basic',
    rarity: CARD.rarity,
    blueprint: null,
    owned: 0,
    requiresLevel: scrapyardLevelForUpgrade(CARD),
    documentHeld: true,
    blocker: null,
    targets: targets.map((target) => ({ ...target, fitted: false, blocker: null })),
    requirement: [],
  };
}

function drawYard(board: ScrapyardResponse) {
  fetchMock.mockImplementation((path: string) => {
    const url = String(path);
    if (url.endsWith('/scrapyard')) return reply(board);
    if (url.endsWith('/me')) return reply(F.me);
    if (url.endsWith('/units')) return reply(F.unitsResponse);
    throw new Error(`unstubbed request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game/scrapyard?view=refits']}>
        <Routes>
          <Route path="/game/scrapyard" element={<ScrapyardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the refits rail and the Combine', () => {
  it('opens a door for a player unit and none for a Combine unit the same card names', async () => {
    const board: ScrapyardResponse = {
      scrapyardLevel: 8,
      discountPercent: 0,
      resources: F.base.resources,
      entries: [
        refit([
          { id: 'razors', name: 'Razors' },
          ...COMBINE_UNITS.map((unit) => ({ id: unit.id, name: unit.name })),
        ]),
      ],
    };
    drawYard(board);
    expect(await screen.findByTestId('scrapyard-unit-razors')).toBeInTheDocument();
    for (const unit of COMBINE_UNITS) {
      expect(screen.queryByTestId(`scrapyard-unit-${unit.id}`)).toBeNull();
    }
  });
});
