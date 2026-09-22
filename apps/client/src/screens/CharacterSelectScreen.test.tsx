/**
 * Character select, now that it is a pool (§F6, maintainer request 2026-09-15).
 *
 * The screen used to map over `OVERSEER_PRESETS` and draw all four. There are thirty now and the
 * pool drains, so the four on the screen are the **server's** answer and this renders against a
 * stubbed `/overseer/choices` rather than against the catalogue. That is the point of the change
 * and it is also the thing most likely to regress: a screen that quietly went back to the
 * catalogue would draw thirty cards, and every assertion about what a card *contains* would still
 * pass. So the count is pinned against what the server sent, never against the table.
 */
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTE_NAMES,
  OVERSEER_PRESETS,
  OVERSEER_POOL_SIZE,
  findPerk,
  type OverseerPreset,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterSelectScreen } from './CharacterSelectScreen';

/** Four out of the thirty, and deliberately not the first four: see the note on the count below. */
const OFFERED: readonly OverseerPreset[] = [
  OVERSEER_PRESETS[2]!,
  OVERSEER_PRESETS[9]!,
  OVERSEER_PRESETS[17]!,
  OVERSEER_PRESETS[24]!,
];
const REMAINING = 21;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((path: string) => {
    if (String(path).endsWith('/overseer/choices')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: OFFERED,
            remaining: REMAINING,
            total: OVERSEER_POOL_SIZE,
          }),
      } as Response);
    }
    throw new Error(`unstubbed request: ${String(path)}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/**
 * The screen with no offer on it, which is the state nothing covered.
 *
 * `offer.data` is `undefined` both while the request is in flight and after it has failed, and the
 * header read the one as the other: a failed `/overseer/choices` left "Reading the files." on a
 * screen with no cards, a disabled Confirm button and no way forward. This is the one screen a
 * player cannot get past, so a silent dead end here is the account, not a page.
 */
describe('when the offer does not arrive', () => {
  it('says the request failed rather than reading the files forever', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (String(path).endsWith('/overseer/choices')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      throw new Error(`unstubbed request: ${String(path)}`);
    });

    renderScreen();
    expect(await screen.findByTestId('overseer-pool')).toHaveTextContent('Reading the files.');
    // The failing state replaces the wall rather than sitting under it, so the line it was
    // reading goes with it: waiting on the node itself would wait on a detached element for ever.
    await waitFor(() => expect(screen.queryByTestId('overseer-pool')).toBeNull());
    // The same `LoadFailure` every screen behind the nav uses, so the remedy is a retry rather
    // than a sentence telling the player to reload the one page they cannot leave.
    expect(screen.getByTestId('load-failure')).toBeInTheDocument();
    expect(screen.getByTestId('load-retry')).toBeInTheDocument();
  });

  it('asks again when the player presses Try again', async () => {
    let attempt = 0;
    fetchMock.mockImplementation((path: string) => {
      if (!String(path).endsWith('/overseer/choices')) {
        throw new Error(`unstubbed request: ${String(path)}`);
      }
      attempt += 1;
      if (attempt === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ choices: OFFERED, remaining: REMAINING, total: OVERSEER_POOL_SIZE }),
      } as Response);
    });

    renderScreen();
    fireEvent.click(await screen.findByTestId('load-retry'));
    await waitFor(() => expect(screen.getByText(OFFERED[0]!.name)).toBeInTheDocument());
    expect(screen.queryByTestId('load-failure')).toBeNull();
  });

  /** ...and the loading state is still the loading state, so the assertion above is about failure. */
  it('still says it is reading the files while the request is in flight', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderScreen();
    expect(screen.getByTestId('overseer-pool')).toHaveTextContent('Reading the files.');
  });
});

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CharacterSelectScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Waits for the offer to land, since the cards do not exist until it has. */
async function offered() {
  renderScreen();
  await waitFor(() => expect(screen.getByText(OFFERED[0]!.name)).toBeInTheDocument());
}

describe('CharacterSelectScreen', () => {
  it('draws the four the server offered, and nobody else', async () => {
    await offered();
    for (const preset of OFFERED) expect(screen.getByText(preset.name)).toBeInTheDocument();

    // The half that catches a screen which went back to the catalogue: everybody NOT offered is
    // absent. Thirty cards would pass every other assertion in this file.
    const withheld = OVERSEER_PRESETS.filter(
      (preset) => !OFFERED.some((one) => one.presetId === preset.presetId),
    );
    expect(withheld.length).toBeGreaterThan(20);
    for (const preset of withheld) expect(screen.queryByText(preset.name)).toBeNull();
  });

  /**
   * A refused pick has to re-read the offer, or the screen is stuck (§F6).
   *
   * The pool is shared, so the character a player is pressing can be taken between the render and
   * the press. The server refuses correctly, but without a re-read the dead card stays selected and
   * every further press earns the same refusal: the screen is drawing somebody who no longer
   * exists and has no way to find out.
   */
  it('re-reads the offer when the server says somebody else took that character', async () => {
    await offered();
    let choiceReads = 0;
    fetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.endsWith('/overseer/choices')) {
        choiceReads += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ choices: OFFERED, remaining: REMAINING, total: OVERSEER_POOL_SIZE }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: { code: 'PRESET_REFUSED', message: 'Somebody else is already that person' },
          }),
      } as Response);
    });

    fireEvent.click(screen.getByText(OFFERED[0]!.name));
    fireEvent.click(screen.getByRole('button', { name: /confirm overseer/i }));

    await waitFor(() => expect(choiceReads).toBeGreaterThan(0));
  });

  /**
   * B6/F6: the file shows the **whole** sheet, and it is reached by pressing a painting.
   *
   * Two steps since 2026-09-22 (maintainer): the landing is four portraits and nothing else, so
   * a sheet on screen at all means the press worked, and the sheet being whole is what the
   * second step is for. Four thumbnails could not carry any of this legibly, which is why the
   * bio used to be clamped mid-word here.
   */
  it('opens the pressed overseer file, with the full sheet, the radar and the whole bio', async () => {
    await offered();
    const preset = OFFERED[0]!;
    // Nothing but the paintings first: no attribute labels anywhere on the wall.
    expect(screen.queryByText(ATTRIBUTE_LABELS[ATTRIBUTE_NAMES[0]])).toBeNull();

    fireEvent.click(screen.getByText(preset.name));

    const sheet = await screen.findByTestId(`overseer-sheet-${preset.presetId}`);
    for (const attribute of ATTRIBUTE_NAMES) {
      expect(within(sheet).getByText(ATTRIBUTE_LABELS[attribute])).toBeInTheDocument();
    }
    expect(within(sheet).getByRole('img', { name: 'Attribute radar' })).toBeInTheDocument();
    // Whole, and no longer clamped: there is room for it at this size.
    const bio = within(sheet).getByText(preset.bio);
    expect(bio.className).not.toContain('line-clamp');
    // ...and only the one pressed. The other three are off the screen entirely.
    for (const other of OFFERED.slice(1)) {
      expect(screen.queryByText(other.bio)).toBeNull();
    }
  });

  /** B7: the signature perk is the character. It is the one thing a player is really choosing. */
  it('names each offered character signature perk, and what it is worth', async () => {
    await offered();
    for (const preset of OFFERED) {
      fireEvent.click(screen.getByText(preset.name));
      const sheet = await screen.findByTestId(`overseer-sheet-${preset.presetId}`);
      for (const id of preset.perks) {
        const perk = findPerk(id);
        expect(perk, `${preset.presetId} carries an unknown perk ${id}`).toBeDefined();
        if (!perk) continue;
        expect(within(sheet).getByText(perk.name)).toBeInTheDocument();
        expect(within(sheet).getByText(perk.description)).toBeInTheDocument();
      }
      fireEvent.click(screen.getByTestId('overseer-back'));
    }
  });

  /** Go back returns to the four, with nothing chosen (maintainer, 2026-09-22). */
  it('goes back to the paintings without choosing anybody', async () => {
    await offered();
    fireEvent.click(screen.getByText(OFFERED[0]!.name));
    expect(screen.getByTestId(`overseer-sheet-${OFFERED[0]!.presetId}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('overseer-back'));

    expect(screen.queryByTestId(`overseer-sheet-${OFFERED[0]!.presetId}`)).toBeNull();
    for (const preset of OFFERED) expect(screen.getByText(preset.name)).toBeInTheDocument();
    expect(screen.queryByTestId('overseer-confirm')).toBeNull();
  });
});

/**
 * §F6: the four on screen are held, and the hold runs out (maintainer, 2026-09-17).
 *
 * The server reserves a drawn batch for ten minutes and refuses a pick made after that with a 410
 * telling the player to refresh. A screen that never says so is a screen where Confirm works right
 * up until it does not, with nothing on it having changed. So the window is on the page and the
 * page redraws itself when the window shuts.
 *
 * Both cases run on real timers against a deliberately short window rather than on a faked clock:
 * the countdown is an interval, the redraw is a refetch, and a fake clock that advances one of
 * those without the other proves nothing about the pair.
 */
describe('while the offer is held', () => {
  /** A choices response whose hold has `ms` left on it, as the server would have sent it. */
  function heldFor(ms: number, choices: readonly OverseerPreset[] = OFFERED) {
    const serverNow = new Date();
    return {
      choices,
      remaining: REMAINING,
      total: OVERSEER_POOL_SIZE,
      serverNow: serverNow.toISOString(),
      expiresAt: new Date(serverNow.getTime() + ms).toISOString(),
    };
  }

  function answerWith(...batches: ReturnType<typeof heldFor>[]) {
    let call = 0;
    fetchMock.mockImplementation((path: string) => {
      if (String(path).endsWith('/overseer/choices')) {
        const body = batches[Math.min(call, batches.length - 1)]!;
        call += 1;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }
      throw new Error(`unstubbed request: ${String(path)}`);
    });
  }

  it('counts down the window the server gave it', async () => {
    answerWith(heldFor(10 * 60 * 1000));
    renderScreen();

    const held = await screen.findByTestId('overseer-hold');
    // 9:59 rather than 10:00 once a tick has passed, and either is the same statement.
    expect(held.textContent).toMatch(/Held for you\s*(10:00|9:59)/);
  });

  it('draws a fresh batch when the window shuts, without a reload', async () => {
    const LATER: readonly OverseerPreset[] = [
      OVERSEER_PRESETS[1]!,
      OVERSEER_PRESETS[5]!,
      OVERSEER_PRESETS[11]!,
      OVERSEER_PRESETS[19]!,
    ];
    answerWith(heldFor(1200), heldFor(10 * 60 * 1000, LATER));
    renderScreen();

    await waitFor(() => expect(screen.getByText(OFFERED[0]!.name)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(LATER[0]!.name)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.queryByText(OFFERED[0]!.name)).not.toBeInTheDocument();
  });
});

/**
 * §F6: nobody free to offer, which is a wait and not a dead end (soak finding, 2026-09-17).
 *
 * An offer holds its four for ten minutes whether or not the tab that drew them is still open, so
 * a burst of signups can leave the next person with an empty pool: thirty characters, four a head.
 * Measured against a hosted server, two of five registrations landed on it behind an earlier
 * burst. This is the one screen a player cannot get past, and in that state it has no card to press
 * and no button to try, so what it says and whether it asks again are the whole of the remedy.
 */
describe('when everybody free is already spoken for', () => {
  it('says what is being waited for rather than leaving an empty grid', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (String(path).endsWith('/overseer/choices')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              choices: [],
              remaining: 6,
              total: OVERSEER_POOL_SIZE,
              serverNow: new Date().toISOString(),
              expiresAt: null,
            }),
        } as Response);
      }
      throw new Error(`unstubbed request: ${String(path)}`);
    });

    renderScreen();

    const line = await screen.findByTestId('overseer-pool');
    await waitFor(() => expect(line).not.toHaveTextContent('Reading the files.'));
    expect(line.textContent).toContain("somebody else's booking");
  });
});
