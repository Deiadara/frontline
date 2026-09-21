import {
  combineLeaderOf,
  COMBINE_LEADERS,
  findUnit,
  unitRules,
  type DistrictDetailResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { leaderGroundLine, leaderOption, leaderTagLine, spokenName } from './CombineLeader';
import { DistrictView } from './DistrictView';

/**
 * The Combine legendary on the district screen (`city/combine.ts`, 2026-09-19).
 *
 * Rendered through `DistrictView` rather than the tag alone, because the screen has two readings
 * (the fog column and the painted band) and the tag has to stand in the header of both. The
 * fixtures already carry the leaders: Directive Xero in the CCS, which the fixture keeps in the
 * fog, and the Syndic on the Annexes, which it paints.
 */
const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function open(detail: DistrictDetailResponse) {
  const id = detail.district.id;
  fetchMock.mockImplementation((path: string) => {
    const url = String(path);
    if (url.endsWith(`/city/${id}`)) return reply(detail);
    if (url.endsWith('/me')) return reply(F.me);
    if (url.endsWith('/battles')) return reply(F.battles);
    throw new Error(`unstubbed request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/game/city/${id}`]}>
        <Routes>
          <Route path="/game/city/:districtId" element={<DistrictView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A district's fixture with its leader dead. */
function fallen(id: string): DistrictDetailResponse {
  const detail = F.districtDetailFor(id);
  if (!detail.combineLeader) throw new Error(`${id} has no leader to kill`);
  return { ...detail, combineLeader: { ...detail.combineLeader, alive: false } };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('how a leader is named', () => {
  it('gives the titles an article and the codename none', () => {
    expect(spokenName({ unitId: 'syndic', name: 'Syndic' })).toBe('the Syndic');
    expect(spokenName({ unitId: 'executioner', name: 'Executioner' })).toBe('the Executioner');
    expect(spokenName({ unitId: 'directive_xero', name: 'Directive Xero' })).toBe('Directive Xero');
  });

  it('reads alive and dead differently on the tag and in the ground box', () => {
    const syndic = F.districtDetailFor('datavault-sigma').combineLeader!;
    expect(leaderTagLine(syndic)).toBe('Under the Syndic');
    expect(leaderTagLine({ ...syndic, alive: false })).toBe('The Syndic is dead');
    expect(leaderGroundLine(syndic)).toBe(syndic.powerLine);
    expect(leaderGroundLine({ ...syndic, alive: false })).toBe(
      'The Syndic is dead. This ground fights without her.',
    );
  });
});

describe('the leader on the district screen', () => {
  it('is a precondition that the fixtures carry the three leaders and no fourth', () => {
    for (const id of ['datavault-sigma', 'blacksite-7', 'combine-spire']) {
      const leader = F.districtDetailFor(id).combineLeader;
      expect(leader?.unitId, id).toBe(combineLeaderOf(id)?.unitId);
      expect(leader?.name, id).toBe(findUnit(leader?.unitId ?? '')?.name);
    }
    expect(F.districtDetailFor('rustyard').combineLeader).toBeNull();
    expect(F.districtDetailFor('neon-docks').combineLeader).toBeNull();
  });

  /**
   * The hover draws the **roster's own card** (maintainer, 2026-09-20).
   *
   * It was a narrow `InfoWindow` with a 75px stamped portrait in its header and his power as a
   * paragraph. "Bigger space for the portrait, and more similar to the unit card": it is the unit
   * card, so the picture is the card's own column at its full 3:4 and the hover and the window
   * are one drawing of one man rather than two.
   *
   * His power moved with it. The sentence is on the chip's own hover now, so what the card face
   * carries is its **name**, which is what every other thing a unit brings to a fight carries.
   */
  it('marks the fog column, and the hover draws his card', async () => {
    // The CCS is the fixture's unscouted district, so this is the column reading of the screen.
    const detail = F.districtDetailFor('combine-spire');
    open(detail);
    const tag = await screen.findByTestId('combine-leader');
    expect(tag).toHaveTextContent('Under Directive Xero');
    fireEvent.focus(tag);
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent('Directive Xero');
    expect(card).toHaveTextContent(detail.combineLeader!.powerName);
    expect(card).toHaveTextContent('The Chosen Chapel');
    // The unit card itself, by its own id, and the portrait column with it.
    expect(within(card).getByTestId(`unit-${detail.combineLeader!.unitId}`)).toBeInTheDocument();
    expect(
      within(card).getByTestId(`unit-portrait-${detail.combineLeader!.unitId}`),
    ).toBeInTheDocument();
  });

  /**
   * The click, which is the half the hover cannot do (maintainer, 2026-09-20).
   *
   * A `HoverCard`'s card is portalled `pointer-events-none`, so the marks on his sheet were
   * coloured words nothing could be pointed at. His marks are the counterplay against him, so the
   * densest sheet in the game was the one that could not explain itself. The dialog is the same
   * card with its chips live.
   *
   * Asserted on a real chip's own hover rather than on the dialog merely being open, because
   * "the window appeared" is true of the broken version too: it was interactive content inside a
   * tooltip that a pointer could not reach, and only asking a chip a question catches that.
   */
  it('opens his file on a click, with the marks on his sheet live', async () => {
    const detail = F.districtDetailFor('combine-spire');
    open(detail);
    const tag = await screen.findByTestId('combine-leader');
    expect(screen.queryByTestId('combine-leader-window')).toBeNull();

    fireEvent.click(tag);
    const window_ = screen.getByTestId('combine-leader-window');
    expect(window_).toHaveTextContent('Directive Xero');

    // The **roster's own card**, by its own test id, not a second layout that resembles it.
    const leader = detail.combineLeader!;
    const sheet = findUnit(leader.unitId)!;
    expect(within(window_).getByTestId(`unit-${sheet.id}`)).toBeInTheDocument();

    // His power is a named mark, the way every other thing a unit carries is, and the sentence
    // is on its hover rather than printed as prose.
    const power = within(window_).getByRole('button', { name: leader.powerName });
    fireEvent.focus(power);
    expect(screen.getByRole('tooltip')).toHaveTextContent(leader.powerLine);
    fireEvent.blur(power);

    // ...and the catalogue's own marks are live beside it.
    const mark = unitRules(sheet)[0];
    expect(mark, 'Directive Xero carries no marks, so there is nothing to point at').toBeDefined();
    fireEvent.focus(within(window_).getByRole('button', { name: mark!.label }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(mark!.description);
  });

  /**
   * The three things the template claims about a unit you own, which would each be a lie here.
   *
   * A count of nobody, three brackets nothing can go in (`modificationsForUnit` is empty for a
   * legendary), and a price box for a unit that trains nowhere. The card is the same card; these
   * are the parts `enemy` takes off it.
   */
  it('takes the ownership claims off his card and leaves the sheet alone', async () => {
    const detail = F.districtDetailFor('combine-spire');
    open(detail);
    fireEvent.click(await screen.findByTestId('combine-leader'));
    const window_ = screen.getByTestId('combine-leader-window');
    const id = detail.combineLeader!.unitId;

    expect(within(window_).getByTestId(`unit-count-${id}`)).not.toBeVisible();
    expect(within(window_).queryByTestId(`action-${id}`)).toBeNull();
    expect(within(window_).queryByTestId(`slots-${id}`)).toBeNull();
    // The sheet itself is untouched: the marks band is the roster's, under the roster's id.
    expect(within(window_).getByTestId(`marks-${id}`)).toBeInTheDocument();
  });

  it('shuts his file again', async () => {
    open(F.districtDetailFor('combine-spire'));
    fireEvent.click(await screen.findByTestId('combine-leader'));
    expect(screen.getByTestId('combine-leader-window')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('combine-leader-window')).toBeNull();
  });

  it('marks the painted band, and the ground box carries his line', async () => {
    const detail = F.districtDetailFor('datavault-sigma');
    open(detail);
    expect(await screen.findByTestId('district-painting-datavault-sigma')).toBeInTheDocument();
    expect(screen.getByTestId('combine-leader')).toHaveTextContent('Under the Syndic');
    fireEvent.click(screen.getByTestId('district-standing-toggle'));
    expect(screen.getByTestId('combine-leader-ground')).toHaveTextContent(
      detail.combineLeader!.powerLine,
    );
  });

  /**
   * The power mark says what the power does, dead or alive (maintainer, 2026-09-21).
   *
   * It used to open `While she stood:` once the leader was gone, which turned the one line that
   * explains the ability into a line about the leader's health. Whether he still stands is the
   * district tag's job, and the ground line under the garrison already says it in full.
   */
  it('keeps the power mark on what the power does once the leader is dead', () => {
    const detail = F.districtDetailFor('combine-spire');
    const leader = detail.combineLeader!;
    const sheet = findUnit(leader.unitId)!;
    const dead = leaderOption(sheet, { ...leader, alive: false });
    const alive = leaderOption(sheet, { ...leader, alive: true });
    expect(dead.rules[0]!.description).toBe(leader.powerLine);
    expect(dead.rules[0]!.description).toBe(alive.rules[0]!.description);
    expect(dead.rules[0]!.description).not.toMatch(/stood/i);
  });

  /**
   * The Syndic is a woman and the other two are not (her portrait landed 2026-09-21).
   *
   * Every sentence about a leader is written once for all three, so before `CombineLeader.pronoun`
   * they all said "him": the screens that name her spoke about her as a man. Asserted off the
   * catalogue rather than against a pinned word, so a fourth leader is covered the day it is added
   * and a pronoun changed in one place moves the expectation with it.
   */
  it('speaks about each leader the way that leader is spoken about', () => {
    expect(COMBINE_LEADERS.length, 'nothing to check').toBeGreaterThan(1);
    // The cast is genuinely mixed, or a shared pronoun would pass this and still be wrong.
    expect(new Set(COMBINE_LEADERS.map((one) => one.pronoun.object)).size).toBeGreaterThan(1);

    for (const leader of COMBINE_LEADERS) {
      const view = {
        unitId: leader.unitId,
        name: findUnit(leader.unitId)?.name ?? leader.unitId,
        locationId: leader.locationId,
        locationName: 'somewhere',
        alive: false,
        powerName: leader.powerName,
        pronoun: leader.pronoun,
        powerLine: leader.powerLine,
      };
      const said = leaderGroundLine(view);
      expect(said, `${leader.unitId} is spoken about as somebody else`).toContain(
        `fights without ${leader.pronoun.object}`,
      );
      for (const other of COMBINE_LEADERS) {
        if (other.pronoun.object === leader.pronoun.object) continue;
        expect(said, `${leader.unitId} borrowed ${other.unitId}'s pronoun`).not.toContain(
          `fights without ${other.pronoun.object}`,
        );
      }
    }
  });

  it('says so when she is dead, and says the ground fights without her', async () => {
    open(fallen('datavault-sigma'));
    expect(await screen.findByTestId('district-painting-datavault-sigma')).toBeInTheDocument();
    expect(screen.getByTestId('combine-leader')).toHaveTextContent('The Syndic is dead');
    fireEvent.click(screen.getByTestId('district-standing-toggle'));
    expect(screen.getByTestId('combine-leader-ground')).toHaveTextContent(
      'The Syndic is dead. This ground fights without her.',
    );
  });

  it('draws no marker on ground no legendary commands', async () => {
    open(F.districtDetailFor('rustyard'));
    expect(await screen.findByTestId('district-painting-rustyard')).toBeInTheDocument();
    expect(screen.queryByTestId('combine-leader')).toBeNull();
    fireEvent.click(screen.getByTestId('district-standing-toggle'));
    expect(screen.queryByTestId('combine-leader-ground')).toBeNull();
  });
});
