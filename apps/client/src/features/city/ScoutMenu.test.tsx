import type { DistrictDetailResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { ScoutMenu } from './ScoutMenu';

/**
 * The door to unscouted ground (maintainer, 2026-09-23).
 *
 * Four states off one district read, and the blocked one is a checklist rather than a sentence:
 * the chair and the research each get a tick or a cross, so the thing that is missing is the
 * thing the player reads first.
 */

const fetchMock = vi.fn();
const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

let posted: { url: string; body: unknown }[] = [];

function open(detail: DistrictDetailResponse) {
  const id = detail.district.id;
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    const url = String(path);
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(init.body as string) });
      return reply({ district: detail, base: F.lateGameBase });
    }
    if (url.endsWith(`/city/${id}`)) return reply(detail);
    throw new Error(`unstubbed request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game/city']}>
        <ScoutMenu districtId={id} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const dark = () => F.districtDetailFor(F.UNSCOUTED_DISTRICT_ID);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  posted = [];
  useSession.setState({ token: 'session-token', user: null });
});
afterEach(() => vi.unstubAllGlobals());

/**
 * Two children of the same flex row, side by side rather than stacked.
 *
 * jsdom has no layout, so this reads the row's own declaration rather than measuring boxes: a
 * `flex` container that is not `flex-col` lays its children out across. Playwright measures the
 * real thing (`screenshots`), and this keeps the shape from being undone by an edit nobody
 * screenshots again.
 */
function onOneRow(row: HTMLElement): boolean {
  const classes = row.className.split(/\s+/);
  return row.children.length === 2 && classes.includes('flex') && !classes.includes('flex-col');
}

describe('the scout sheet', () => {
  it('is the fixture it thinks it is: dark, with a plan and no blocker', () => {
    const detail = dark();
    expect(detail.scouted).toBe(false);
    expect(detail.scoutBlocker).toBeNull();
    expect(detail.scoutPlan).not.toBeNull();
    expect(detail.scoutingRun).toBeNull();
  });

  it('names the district and offers Send Scouts, which posts the district', async () => {
    const detail = dark();
    open(detail);
    expect(await screen.findByTestId('scout-menu-title')).toHaveTextContent(detail.district.name);
    expect(screen.getByText(/would be gone/)).toBeInTheDocument();
    expect(screen.queryByTestId('scout-nobody')).toBeNull();

    fireEvent.click(screen.getByTestId('send-scout'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toMatch(/\/city\/scout$/);
    expect(posted[0]!.body).toEqual({ districtId: detail.district.id });
  });

  /*
   * The foot of the sheet is one row (maintainer, 2026-09-24): whatever the sheet's action is on
   * the left, Back to the map on the right. It used to be a row of its own under everything, so
   * the sheet ended on a line with one word on it and the action sat somewhere above.
   */
  it('puts Send Scouts and Back to the map on the same row', async () => {
    open(dark());
    const row = await screen.findByTestId('scout-actions');
    expect(row).toContainElement(screen.getByTestId('send-scout'));
    expect(row).toContainElement(screen.getByTestId('scout-menu-close'));
    expect(onOneRow(row)).toBe(true);
  });

  // An unclaimed home plot is closed until a crew moves in (maintainer, 2026-09-28).
  it('says an unclaimed plot is closed, and offers nothing to send', async () => {
    open({ ...dark(), closed: true, scoutPlan: null });
    expect(await screen.findByTestId('scout-closed')).toHaveTextContent(/stays closed/);
    expect(screen.queryByTestId('send-scout')).toBeNull();
    expect(screen.queryByTestId('scout-nobody')).toBeNull();
  });

  it('draws the chair as missing and the research as missing with nobody in the chair', async () => {
    open({ ...dark(), scoutBlocker: 'no_whispers' });
    await screen.findByTestId('scout-nobody');
    expect(screen.getByTestId('scout-need-whispers')).toHaveAttribute('data-met', 'no');
    expect(screen.getByTestId('scout-need-research')).toHaveAttribute('data-met', 'no');
    expect(screen.getByText(/Sign one at the Bar/)).toBeInTheDocument();
    expect(screen.queryByTestId('send-scout')).toBeNull();
    // Nothing to press on the left, so the row holds the way out alone and keeps it on the right.
    const row = screen.getByTestId('scout-actions');
    expect(row).toContainElement(screen.getByTestId('scout-menu-close'));
    expect(row.children).toHaveLength(1);
  });

  it('ticks the chair and crosses the research when Scouting is not worked out', async () => {
    open({ ...dark(), scoutBlocker: 'not_researched' });
    await screen.findByTestId('scout-nobody');
    expect(screen.getByTestId('scout-need-whispers')).toHaveAttribute('data-met', 'yes');
    expect(screen.getByTestId('scout-need-research')).toHaveAttribute('data-met', 'no');
    expect(screen.getByText(/first rung on their track/)).toBeInTheDocument();
    expect(screen.queryByTestId('send-scout')).toBeNull();
  });

  it('shows the countdown and the X while a party is on the road here', async () => {
    const detail = dark();
    const run = {
      districtId: detail.district.id,
      districtName: detail.district.name,
      officerId: 'off-3',
      officerName: 'Scout Party',
      departedAt: new Date(Date.now() - 60_000).toISOString(),
      returnsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
      travelMinutes: 47,
      recalledAt: null,
    };
    open({ ...detail, scoutPlan: null, scoutingRun: run });
    await screen.findByTestId('scout-underway');
    expect(screen.getByTestId('scout-countdown')).toBeInTheDocument();
    expect(screen.getByTestId('recall-scout')).toBeInTheDocument();
    expect(screen.queryByTestId('send-scout')).toBeNull();
    // The X to turn them round is this state's action, so it is what shares the row.
    const row = screen.getByTestId('scout-actions');
    expect(row).toContainElement(screen.getByTestId('recall-scout'));
    expect(row).toContainElement(screen.getByTestId('scout-menu-close'));
    expect(onOneRow(row)).toBe(true);
  });

  it('says where the party is when it is out somewhere else', async () => {
    const detail = dark();
    open({
      ...detail,
      scoutPlan: null,
      scoutingRun: {
        districtId: 'neon-docks',
        districtName: 'Neon Docks',
        officerId: 'off-3',
        officerName: 'Scout Party',
        departedAt: new Date().toISOString(),
        returnsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        travelMinutes: 20,
        recalledAt: null,
      },
    });
    const elsewhere = await screen.findByTestId('scout-elsewhere');
    expect(elsewhere).toHaveTextContent('Neon Docks');
    expect(screen.queryByTestId('send-scout')).toBeNull();
    expect(screen.queryByTestId('recall-scout')).toBeNull();
    const row = screen.getByTestId('scout-actions');
    expect(row).toContainElement(screen.getByTestId('scout-menu-close'));
    expect(row.children).toHaveLength(1);
  });
});
