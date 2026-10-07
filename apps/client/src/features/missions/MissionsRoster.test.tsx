import {
  BATTLE_ODDS_LABELS,
  MISC_AREA_ID,
  battleOdds,
  chanceTone,
  composeProfile,
  enemyStrength,
  fieldStrength,
  leaderEdge,
  leaderFit,
  leaderMark,
  makeAttributes,
  missionOdds,
  type Attributes,
  type LeaderHold,
  type MissionLeader,
  type MissionOffer,
  type MissionsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * Who leads a run, and what the dial says about it (maintainer, 2026-09-10).
 *
 * Every leader lives on the board payload now: the Overseer, who is on no roster and could never
 * be named by `officerId`, and the officers, with whoever is already out marked as out. The two
 * facts this file is about are the ones a player acts on. Somebody who is away cannot be sent
 * again, and picking a different name moves the odds, which is the only reason the picker is
 * worth drawing at all.
 *
 * The odds are pinned two ways on purpose. `missionOdds` is the shared function the screen and
 * the launch both price with, so the derived assertions here are the contract; and the certain
 * case is pinned to a literal that does not go through it, because a test that only ever asks the
 * source what the source says cannot catch a rule that was applied nowhere.
 */

const NOW = '2026-08-13T12:00:00.000Z';

/** A job that leans on one thing, so a leader's fit on it is a fact and not a blend. */
const HAUL: MissionOffer = {
  templateId: 'test-haul',
  boardKey: '2026-09-13',
  name: 'Bay Clearance',
  brief: 'Somebody wants a bay emptied before the morning shift.',
  kind: 'standard',
  // E, so the three free leaders below land in three different bands: the Overseer (about F+ on a
  // haul) a little short of it, Reza (S- on a haul) far past it, Little Ivo nowhere near.
  grade: 'E',
  travelMinutes: 12,
  durationMinutes: 30,
  totalMinutes: 54,
  // Hand-written rather than derived: this offer is not a real template, and the send dialog reads
  // the raw pair to quote the run. Equal to the quoted figures, because nothing is taken off here.
  rawTravelMinutes: 12,
  rawDurationMinutes: 30,
  speedPercent: 0,
  rewards: { scrap: 120 },
  payoutSlots: 8,
  xp: 240,
  failedXp: 48,
  leanings: ['haul'],
  // Out of the opening band: this fixture is about a leader's fit, not about the clock.
  ramp: null,
  golden: false,
  goldenPercent: 0,
};

/** And a fight at F-, the lightest Skirmish: 1,600 of `fieldStrength` (`enemyStrength`). */
const FIGHT: MissionOffer = {
  ...HAUL,
  templateId: 'test-fight',
  name: 'Yard Skirmish',
  brief: 'They are on that ground and they intend to stay there.',
  kind: 'battle',
  grade: 'F-',
  leanings: ['fight'],
};

const leader = (
  id: string,
  name: string,
  kind: MissionLeader['kind'],
  attributes: Attributes,
  held: LeaderHold | null = null,
  heldUntil: string | null = null,
): MissionLeader => ({ id, name, kind, attributes, arrivalPercent: 0, held, heldUntil });

/**
 * Three sheets that are genuinely different on a haul.
 *
 * Odile is the best hauler on the books *and* she is out, which is the pair that makes the
 * "most suitable" button worth testing: a button that reads the whole list rather than the free
 * half of it picks her, and picks somebody the server would refuse.
 */
/** How long every held leader below has left, so the countdown in the picker has one figure. */
/**
 * When a held leader is free again, off the *board's* clock rather than the machine's.
 *
 * The picker counts down with `useServerClock`, like every other clock on this page, so a mark
 * built from `Date.now()` here would be read against `NOW` and print the month between the two.
 * A fixture whose two clocks disagree is not a fixture of anything the server can send.
 *
 * The half minute is deliberate. `useServerClock` corrects by the gap between `serverNow` and the
 * moment the response landed, and the render happens a few milliseconds off that, so a mark sitting
 * exactly on a minute boundary rounds up or down depending on how fast the machine ran the test.
 * Half a minute clear of the boundary, `Math.ceil` can only answer one way.
 */
const BACK_AT = new Date(Date.parse(NOW) + 95.5 * 60_000).toISOString();
/** What the picker prints for {@link BACK_AT}: ninety-five and a half minutes, rounded up. */
const HELD_TEXT = 'back in 1h 36m';

const OVERSEER = leader('ov-1', 'Rook', 'overseer', makeAttributes(22));
const FREE_OFFICER = leader(
  'off-1',
  'Reza Malik',
  'officer',
  makeAttributes(15, {
    logistics: 95,
    organization: 95,
    navigation: 95,
    strength: 80,
    stamina: 80,
  }),
);
const OUT_OFFICER = leader(
  'off-2',
  'Odile Marchetti',
  'officer',
  makeAttributes(60, { logistics: 100, organization: 100, navigation: 100 }),
  'run',
  BACK_AT,
);
/** Nobody's idea of a leader: the other end of `leaderEdge`, which takes odds *off*. */
const HOPELESS = leader('off-3', 'Little Ivo', 'officer', makeAttributes(0));

const LEADERS = [OVERSEER, FREE_OFFICER, OUT_OFFICER, HOPELESS];

function boardWith(leaders: MissionLeader[] = LEADERS): MissionsResponse {
  return {
    missions: [],
    justResolved: [],
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    activeLimit: 2,
    xpBonusPercent: 0,
    areas: [
      {
        id: MISC_AREA_ID,
        name: 'Miscellaneous Missions',
        blurb: 'Work that belongs to nobody.',
        difficulty: 1,
        payPercent: 0,
        offers: [HAUL, FIGHT],
        activeMissionId: null,
      },
    ],
    // Sixteen Razors: enough to put an F- fight (1,600) past one and a half to one.
    army: { razors: 16, scavengers: 4 },
    serverNow: NOW,
    leaders,
    level: LEVEL,
    // The board's city and the rooms this crew may read. Both carry a Zod default on the
    // wire; a hand-written fixture has to say them.
    cityId: 'ashfall',
    cities: ['ashfall'],
  };
}

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The level the fixture player is at, which is what a card's grade is dealt off. */
const LEVEL = F.me.base?.level ?? 1;

function stub(board: MissionsResponse): void {
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/me')) return reply(F.me);
    if (path.endsWith('/missions')) return reply(board);
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Open one job's send window. */
async function openSend(offer: MissionOffer): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`send-${offer.templateId}`));
  return screen.getByRole('dialog');
}

/** The painted list is portalled to the unit, so its options are found on `screen`. */
async function openPicker(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByTestId('send-leader'));
  await screen.findByRole('listbox');
}

async function pick(dialog: HTMLElement, name: RegExp): Promise<HTMLElement> {
  await openPicker(dialog);
  const option = await screen.findByRole('option', { name });
  fireEvent.click(option);
  return option;
}

/** What the dial is reading right now: the struck figure and the band it is in. */
function dial(dialog: HTMLElement): { figure: string; tone: string | null; angle: number } {
  const gauge = within(dialog).getByTestId('mission-gauge');
  return {
    figure: within(gauge).getByTestId('gauge-figure').textContent ?? '',
    tone: gauge.getAttribute('data-tone'),
    angle: Number(gauge.getAttribute('data-angle')),
  };
}

const take = (dialog: HTMLElement, unitName: string, count: number) =>
  fireEvent.change(within(dialog).getByLabelText(`How many ${unitName}`), {
    target: { value: String(count) },
  });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the leader picker', () => {
  it('offers the Overseer first, with each one’s kind and grade for this job', async () => {
    stub(boardWith());
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    await openPicker(dialog);
    const options = screen.getAllByRole('option');

    // Nobody is not an option any more: every run has a leader, the Overseer first.
    expect(options.map((option) => option.textContent ?? '').join(' ')).not.toMatch(/nobody/i);
    expect(options[0]).toHaveTextContent('Rook');
    expect(options[0]).toHaveTextContent('Overseer');

    const profile = composeProfile(HAUL.leanings);
    for (const one of [OVERSEER, FREE_OFFICER, HOPELESS]) {
      const row = screen.getByRole('option', { name: new RegExp(one.name) });
      const mark = leaderMark(one.attributes, profile);
      expect(row, `${one.name} shows no grade for this job`).toHaveTextContent(
        `${mark} for this job`,
      );
    }
  });

  it('draws somebody who is out as out, and will not let them be picked', async () => {
    stub(boardWith());
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    const option = await pick(dialog, /Odile Marchetti/);
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent('out leading a run');
    // The click did nothing: the most suitable free leader is still the one picked.
    expect(within(dialog).getByTestId('send-leader')).toHaveTextContent('Reza Malik');
    expect(within(dialog).getByTestId('send-leader')).not.toHaveTextContent('Odile');
  });

  /**
   * Four reasons, four sentences, and the clock only where the server knows one.
   *
   * `out until they are back` was the one line the picker had for every hold, which was a guess
   * about a fight (nobody knows when that officer is free) and said nothing at all about the
   * three the player could act on. Each row is asserted for its own words *and* against the other
   * three, so a table wired to the wrong key still fails.
   */
  it('says why each held leader cannot go, and counts down only where there is a clock', async () => {
    const backAt = BACK_AT;
    stub(
      boardWith([
        OVERSEER,
        leader('h-run', 'Rosa Vey', 'officer', makeAttributes(20), 'run', backAt),
        leader('h-fight', 'Tam Brisk', 'officer', makeAttributes(20), 'fight', null),
        leader('h-hurt', 'Bea Quill', 'officer', makeAttributes(20), 'injury', backAt),
      ]),
    );
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    await openPicker(dialog);
    const expected: [string, string][] = [
      ['Rosa Vey', `out leading a run, ${HELD_TEXT}`],
      ['Tam Brisk', 'at a fight'],
      ['Bea Quill', `laid up, ${HELD_TEXT}`],
    ];
    for (const [name, reason] of expected) {
      const row = screen.getByRole('option', { name: new RegExp(name) });
      expect(row, `${name} is pickable`).toHaveAttribute('aria-disabled', 'true');
      expect(row).toHaveTextContent(reason);
      for (const [, other] of expected.filter(([who]) => who !== name)) {
        expect(row, `${name} reads as ${other}`).not.toHaveTextContent(other);
      }
    }
    // A fight has no mark until it settles, so that row counts down to nothing at all.
    expect(screen.getByRole('option', { name: /Tam Brisk/ })).not.toHaveTextContent('back in');
  });

  it('skips every held leader when it picks the most suitable one', async () => {
    const backAt = BACK_AT;
    // All three holds, on sheets that would each win the button outright if it read the whole list.
    const strong = makeAttributes(90, { logistics: 100, organization: 100, navigation: 100 });
    stub(
      boardWith([
        OVERSEER,
        FREE_OFFICER,
        leader('h-run', 'Rosa Vey', 'officer', strong, 'run', backAt),
        leader('h-fight', 'Tam Brisk', 'officer', strong, 'fight', null),
        leader('h-hurt', 'Bea Quill', 'officer', strong, 'injury', backAt),
      ]),
    );
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    fireEvent.click(within(dialog).getByTestId('best-leader'));

    const picked = within(dialog).getByTestId('send-leader');
    expect(picked).toHaveTextContent('Reza Malik');
    for (const name of ['Rosa Vey', 'Tam Brisk', 'Nils Amadi', 'Bea Quill']) {
      expect(picked, `${name} was sent while held`).not.toHaveTextContent(name);
    }
  });

  it('sends the most suitable of the ones who are free, never the one who is out', async () => {
    stub(boardWith());
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    fireEvent.click(within(dialog).getByTestId('best-leader'));

    // Odile is the better hauler and she is away. Reza is the best of the ones who can go.
    expect(within(dialog).getByTestId('send-leader')).toHaveTextContent('Reza Malik');
    expect(within(dialog).getByTestId('send-leader')).not.toHaveTextContent('Odile');
  });

  it('moves the dial when the leader changes, and reads the job’s grade against theirs', async () => {
    stub(boardWith());
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    const profile = composeProfile(HAUL.leanings);
    const oddsWith = (attributes: Attributes) =>
      missionOdds({ grade: HAUL.grade, leader: attributes, profile });

    // Reza, picked to start with: an S- hauler on an E job is five marks and more over, which is
    // certain. Pinned as a literal, not through `missionOdds`.
    const best = dial(dialog);
    expect(best.figure).toBe('100%');
    expect(best.tone).toBe('blue');

    await pick(dialog, /Rook/);
    const middling = dial(dialog);
    expect(middling.figure).toBe(`${Math.round(oddsWith(OVERSEER.attributes).chance * 100)}%`);
    expect(middling.tone).toBe(chanceTone(oddsWith(OVERSEER.attributes).chance));
    // The needle travels with it: -90 degrees is the left of the dial, +90 the right.
    expect(middling.angle).toBeLessThan(best.angle);

    await pick(dialog, /Little Ivo/);
    const bad = dial(dialog);
    expect(Number.parseInt(bad.figure, 10)).toBeLessThan(Number.parseInt(middling.figure, 10));
    expect(bad.tone).toBe(chanceTone(oddsWith(HOPELESS.attributes).chance));
    expect(bad.angle).toBeLessThan(middling.angle);
  });
});

/** Every run has a leader (maintainer, 2026-09-28). */
describe('a run with nobody free to lead it', () => {
  it('says so and will not send, with nobody to choose instead', async () => {
    stub(boardWith([OUT_OFFICER]));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    take(dialog, 'Razors', 2);
    expect(within(dialog).getByTestId('leader-note')).toHaveTextContent(
      'Somebody has to lead this.',
    );
    expect(within(dialog).getByTestId('confirm-send')).toBeDisabled();
  });
});

describe('a battle job', () => {
  it('shows a band and never a number, and the band follows the force sent', async () => {
    stub(boardWith());
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(FIGHT);
    // Nothing sent yet, so the worst band there is. And no percentage anywhere on the dial: what
    // a battle fields is the job's secret and a figure would be the screen inventing one.
    expect(dial(dialog).figure).toBe('Low chance');
    expect(dial(dialog).tone).toBe('red');
    expect(within(dialog).getByTestId('mission-gauge').textContent).not.toMatch(/%/);

    take(dialog, 'Razors', 2);
    expect(dial(dialog).figure).toBe('Low chance');

    // Eight Razors is about what an F- fields. Read through the shared functions, with the edge of
    // whoever the window picked, so a stat retune moves the fixture and not the rule.
    take(dialog, 'Razors', 8);
    const edge = leaderEdge(leaderFit(OVERSEER.attributes, composeProfile(FIGHT.leanings)).fit);
    const expected = battleOdds({
      ours: fieldStrength({ razors: 8 }),
      theirs: enemyStrength(FIGHT.grade),
      edge,
    });
    expect(dial(dialog).figure).toBe(BATTLE_ODDS_LABELS[expected]);
    expect(dial(dialog).figure).not.toBe('Low chance');

    take(dialog, 'Razors', 16);
    expect(dial(dialog).figure).toBe('Very high chance');
    expect(dial(dialog).tone).toBe('blue');
  });

  it('says which category it is on the card, and nothing about what is fought', async () => {
    stub(boardWith());
    renderPage();
    await screen.findByTestId('board-area');

    const chips = await screen.findByTestId(`job-chips-${FIGHT.templateId}`);
    expect(chips).toHaveTextContent('Skirmish');
    // The standard job beside it says what it leans on instead.
    expect(screen.getByTestId(`job-chips-${HAUL.templateId}`)).toHaveTextContent('A haul');
  });
});
