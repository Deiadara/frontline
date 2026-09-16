import {
  BATTLE_ODDS_LABELS,
  MISC_AREA_ID,
  UNLED_PENALTY,
  battleOdds,
  chanceTone,
  composeProfile,
  enemyStrength,
  fieldStrength,
  leaderFit,
  makeAttributes,
  missionOdds,
  type Attributes,
  type LeaderHold,
  type MissionLeader,
  type MissionOffer,
  type MissionsResponse,
  type UnledRule,
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
 * the launch both price with, so the derived assertions here are the contract; and the unled
 * cases are pinned to literal percentages that do not go through it, because a test that only
 * ever asks the source what the source says cannot catch a rule that was applied nowhere.
 */

const NOW = '2026-08-13T12:00:00.000Z';

/** A job that leans on one thing, so a leader's fit on it is a fact and not a blend. */
const HAUL: MissionOffer = {
  templateId: 'test-haul',
  name: 'Bay Clearance',
  brief: 'Somebody wants a bay emptied before the morning shift.',
  kind: 'standard',
  difficulty: 'easy',
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
  pagePrize: null,
  // 62 rather than a round half: `chanceTone` bands at every twenty, and 62 with the unled
  // penalty on it is 52, which is a *different* band. A figure that stayed in its band under the
  // penalty would let a dial that never re-coloured pass.
  authoredChance: 0.62,
  leanings: ['haul'],
  battleTier: null,
};

/** And a fight, at the tier a level-1 crew reads as 1,400 of `fieldStrength` (`enemyStrength`). */
const FIGHT: MissionOffer = {
  ...HAUL,
  templateId: 'test-fight',
  name: 'Yard Skirmish',
  brief: 'They are on that ground and they intend to stay there.',
  kind: 'battle',
  leanings: ['fight'],
  battleTier: 'skirmish',
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

function boardWith(unledRule: UnledRule, leaders: MissionLeader[] = LEADERS): MissionsResponse {
  return {
    missions: [],
    justResolved: [],
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
    activeLimit: 2,
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
    army: { razors: 12, scavengers: 4 },
    serverNow: NOW,
    leaders,
    unledRule,
    level: LEVEL,
  };
}

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The level the fixture player is at, which is what a battle tier is scaled against. */
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
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the leader picker', () => {
  it('offers the Overseer first, with each one’s kind and fit for this job', async () => {
    stub(boardWith('free'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    await openPicker(dialog);
    const options = screen.getAllByRole('option');

    // "Nobody" is the first entry only because the rule allows it; the Overseer heads the people.
    const people = options.filter((option) => !/Nobody/.test(option.textContent ?? ''));
    expect(people[0]).toHaveTextContent('Rook');
    expect(people[0]).toHaveTextContent('Overseer');

    const profile = composeProfile(HAUL.leanings);
    for (const one of [OVERSEER, FREE_OFFICER, HOPELESS]) {
      const row = screen.getByRole('option', { name: new RegExp(one.name) });
      const fit = Math.round(leaderFit(one.attributes, profile).fit * 100);
      expect(row, `${one.name} shows no fit for this job`).toHaveTextContent(`${fit}%`);
    }
  });

  it('draws somebody who is out as out, and will not let them be picked', async () => {
    stub(boardWith('free'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    const option = await pick(dialog, /Odile Marchetti/);
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent('out leading a run');
    // The click did nothing: no leader chosen, so the dial still reads the bare authored figure.
    expect(within(dialog).queryByTestId('leader-fit')).toBeNull();
    expect(dial(dialog).figure).toBe('62%');
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
      boardWith('free', [
        OVERSEER,
        leader('h-run', 'Rosa Vey', 'officer', makeAttributes(20), 'run', backAt),
        leader('h-fight', 'Tam Brisk', 'officer', makeAttributes(20), 'fight', null),
        leader('h-scout', 'Nils Amadi', 'officer', makeAttributes(20), 'scouting', backAt),
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
      ['Nils Amadi', `out scouting, ${HELD_TEXT}`],
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
    // All four holds, on sheets that would each win the button outright if it read the whole list.
    const strong = makeAttributes(90, { logistics: 100, organization: 100, navigation: 100 });
    stub(
      boardWith('free', [
        OVERSEER,
        FREE_OFFICER,
        leader('h-run', 'Rosa Vey', 'officer', strong, 'run', backAt),
        leader('h-fight', 'Tam Brisk', 'officer', strong, 'fight', null),
        leader('h-scout', 'Nils Amadi', 'officer', strong, 'scouting', backAt),
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
    stub(boardWith('free'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    fireEvent.click(within(dialog).getByTestId('best-leader'));

    // Odile is the better hauler and she is away. Reza is the best of the ones who can go.
    expect(within(dialog).getByTestId('send-leader')).toHaveTextContent('Reza Malik');
    expect(within(dialog).getByTestId('send-leader')).not.toHaveTextContent('Odile');
  });

  it('moves the dial when the leader changes, up for a good one and down for a bad one', async () => {
    stub(boardWith('free'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    const bare = dial(dialog);
    expect(bare.figure).toBe('62%');
    expect(bare.tone).toBe('green');

    const profile = composeProfile(HAUL.leanings);
    const oddsWith = (attributes: Attributes) =>
      missionOdds({ authored: HAUL.authoredChance, leader: attributes, profile, unled: 'free' });

    await pick(dialog, /Reza Malik/);
    const good = dial(dialog);
    expect(good.figure).toBe(`${Math.round(oddsWith(FREE_OFFICER.attributes).chance * 100)}%`);
    expect(good.tone).toBe(chanceTone(oddsWith(FREE_OFFICER.attributes).chance));
    expect(Number.parseInt(good.figure, 10)).toBeGreaterThan(62);
    // The needle travels with it: -90 degrees is the left of the dial, +90 the right.
    expect(good.angle).toBeGreaterThan(bare.angle);

    await pick(dialog, /Little Ivo/);
    const bad = dial(dialog);
    expect(Number.parseInt(bad.figure, 10)).toBeLessThan(62);
    expect(bad.tone).toBe(chanceTone(oddsWith(HOPELESS.attributes).chance));
    expect(bad.angle).toBeLessThan(bare.angle);
  });
});

describe('going out with nobody in charge', () => {
  it('refuses the launch outright until the crew has researched it', async () => {
    stub(boardWith('forbidden'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    take(dialog, 'Razors', 2);
    expect(within(dialog).getByTestId('unled-note')).toHaveTextContent(
      'Nobody leads this. Research unled runs, or send somebody.',
    );
    expect(within(dialog).getByTestId('confirm-send')).toBeDisabled();

    // And there is no "nobody" to choose, because choosing it is not a thing this crew may do.
    await openPicker(dialog);
    expect(screen.queryByRole('option', { name: /send them alone/i })).toBeNull();
  });

  it('takes the penalty off the dial, and says so, once the first rung is done', async () => {
    stub(boardWith('penalised'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    // 62 authored less the ten-point penalty, which is also a band lower on the dial.
    expect(dial(dialog).figure).toBe(`${Math.round((HAUL.authoredChance - UNLED_PENALTY) * 100)}%`);
    expect(dial(dialog).figure).toBe('52%');
    expect(dial(dialog).tone).toBe('yellow');
    expect(within(dialog).getByTestId('unled-note')).toHaveTextContent(/10.*points off the odds/);
    // It is a price, not a refusal: the crew still goes.
    take(dialog, 'Razors', 2);
    expect(within(dialog).getByTestId('confirm-send')).toBeEnabled();

    // Putting somebody in charge pays the penalty back and takes the line away.
    await pick(dialog, /Reza Malik/);
    expect(Number.parseInt(dial(dialog).figure, 10)).toBeGreaterThan(62);
    expect(within(dialog).queryByTestId('unled-note')).toBeNull();
  });

  it('says nothing at all once the crew has researched its way out of the penalty', async () => {
    stub(boardWith('free'));
    renderPage();
    await screen.findByTestId('board-area');

    const dialog = await openSend(HAUL);
    expect(within(dialog).queryByTestId('unled-note')).toBeNull();
    expect(dial(dialog).figure).toBe('62%');
    take(dialog, 'Razors', 2);
    expect(within(dialog).getByTestId('confirm-send')).toBeEnabled();
  });
});

describe('a battle job', () => {
  it('shows a band and never a number, and the band follows the force sent', async () => {
    stub(boardWith('free'));
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

    // Eight Razors is exactly what a skirmish fields at this level, which is the top of the
    // middle. Read through the shared function so a stat retune moves the fixture, not the rule.
    take(dialog, 'Razors', 8);
    const expected = battleOdds({
      ours: fieldStrength({ razors: 8 }),
      theirs: enemyStrength('skirmish', LEVEL),
      edge: 0,
    });
    expect(dial(dialog).figure).toBe(BATTLE_ODDS_LABELS[expected]);
    expect(dial(dialog).figure).not.toBe('Low chance');

    take(dialog, 'Razors', 12);
    expect(dial(dialog).figure).toBe('Very high chance');
    expect(dial(dialog).tone).toBe('blue');
  });

  it('says which tier it is on the card, and nothing about what is fought', async () => {
    stub(boardWith('free'));
    renderPage();
    await screen.findByTestId('board-area');

    const chips = await screen.findByTestId(`job-chips-${FIGHT.templateId}`);
    expect(chips).toHaveTextContent('A skirmish');
    // The standard job beside it says what it leans on instead.
    expect(screen.getByTestId(`job-chips-${HAUL.templateId}`)).toHaveTextContent('A haul');
  });
});
