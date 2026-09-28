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
  DEFAULT_CITY_ID,
  OVERSEER_PRESETS,
  OVERSEER_POOL_SIZE,
  TERMINUS_CITY_ID,
  cityHomeOffers,
  findPerk,
  homePlots,
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

/**
 * Where the server says this player may live (maintainer, 2026-09-24).
 *
 * Terminus is full and Ashfall has room, so the screen has one city to choose, one that is full
 * and three with no map: every state a card can be in is on the wall these tests press.
 */
const CITIES_OFFERED = cityHomeOffers(homePlots(TERMINUS_CITY_ID));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((path: string) => {
    if (String(path).endsWith('/overseer/choices')) {
      return Promise.resolve({
        headers: new Headers(),
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: OFFERED,
            remaining: REMAINING,
            total: OVERSEER_POOL_SIZE,
            cities: CITIES_OFFERED,
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
        headers: new Headers(),
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: OFFERED,
            remaining: REMAINING,
            total: OVERSEER_POOL_SIZE,
            cities: CITIES_OFFERED,
          }),
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
          headers: new Headers(),
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              choices: OFFERED,
              remaining: REMAINING,
              total: OVERSEER_POOL_SIZE,
              cities: CITIES_OFFERED,
            }),
        } as Response);
      }
      return Promise.resolve({
        headers: new Headers(),
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
    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));
    fireEvent.click(screen.getByTestId('city-confirm'));

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
 * The step after the character: where the crew will live (maintainer, 2026-09-24).
 *
 * "When you first enter the game after you choose an overseer, you can choose the city to be in
 * (if a city is full it will show it but as locked)." The same wall of paintings the world screen
 * draws, with a press meaning *select* rather than *enter*, and one control that commits.
 */
describe('choosing a city', () => {
  /** Through the file and onto the wall of cities, which is where every case here starts. */
  async function atTheCities() {
    await offered();
    fireEvent.click(screen.getByText(OFFERED[0]!.name));
    fireEvent.click(screen.getByTestId('overseer-confirm'));
    await screen.findByTestId('city-wall');
  }

  it('asks for a city instead of starting the game', async () => {
    await atTheCities();
    expect(screen.getByTestId('overseer-title')).toHaveTextContent('CHOOSE YOUR CITY');
    // Nothing has been claimed yet: confirming the overseer did not write anything.
    expect(
      fetchMock.mock.calls.every((call) => String(call[0]).endsWith('/overseer/choices')),
    ).toBe(true);
  });

  it('locks a city that is full and one that has no map, and says which is which', async () => {
    await atTheCities();

    const full = screen.getByTestId(`city-card-${TERMINUS_CITY_ID}`);
    expect(full).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId(`city-status-${TERMINUS_CITY_ID}`)).toHaveTextContent(
      'Full: four crews already live here',
    );

    const unbuilt = CITIES_OFFERED.find((offer) => offer.refusal === 'unbuilt')!;
    expect(screen.getByTestId(`city-card-${unbuilt.cityId}`)).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByTestId(`city-status-${unbuilt.cityId}`)).toHaveTextContent(
      'No map here yet',
    );

    // A locked card cannot be selected, however hard it is pressed.
    fireEvent.click(full);
    expect(full).not.toHaveAttribute('data-chosen');
    expect(screen.getByTestId('city-confirm')).toBeDisabled();
  });

  it('highlights the city that was pressed rather than entering it', async () => {
    await atTheCities();
    expect(screen.getByTestId('city-confirm')).toBeDisabled();

    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));

    expect(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`)).toHaveAttribute(
      'data-chosen',
      'true',
    );
    // Still on the wall: a press is a selection, not a door.
    expect(screen.getByTestId('city-wall')).toBeInTheDocument();
    expect(screen.getByTestId('city-confirm')).toBeEnabled();
  });

  it('sends the character and the city together', async () => {
    await atTheCities();
    const posted: Record<string, unknown>[] = [];
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (String(path).endsWith('/overseer/choices')) {
        return Promise.resolve({
          headers: new Headers(),
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              choices: OFFERED,
              remaining: REMAINING,
              total: OVERSEER_POOL_SIZE,
              cities: CITIES_OFFERED,
            }),
        } as Response);
      }
      posted.push(
        JSON.parse((init?.body as string | undefined) ?? '{}') as Record<string, unknown>,
      );
      return Promise.resolve({
        headers: new Headers(),
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: { code: 'CITY_FULL', message: 'Ashfall is full.' } }),
      } as Response);
    });

    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));
    fireEvent.click(screen.getByTestId('city-confirm'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ presetId: OFFERED[0]!.presetId, cityId: DEFAULT_CITY_ID });
    // ...and the server's refusal is on the screen rather than swallowed.
    expect(await screen.findByRole('alert')).toHaveTextContent('Ashfall is full.');
  });

  /**
   * The re-read that a refused pick sets off can itself fail (MOU bugpass, 2026-09-24).
   *
   * `PRESET_REFUSED` drops `overseerChoices`, and React Query keeps the batch it already had when
   * the refetch behind that fails. So `offer.data` is still there, the player is still on the wall
   * of cities, and `offer.isError` is true at the same time. The failure panel was drawn off
   * `isError` alone while the wall was drawn off the step, which put a dead end and a live screen
   * on top of each other: two headings, two sets of controls, and a Confirm that will only ever
   * refuse again. The screen says one thing at a time.
   */
  it('shows the failure instead of the wall when the re-read fails', async () => {
    await atTheCities();
    fetchMock.mockImplementation((path: string) => {
      if (String(path).endsWith('/overseer/choices')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve({
        headers: new Headers(),
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: { code: 'PRESET_REFUSED', message: 'Somebody else is already that person' },
          }),
      } as Response);
    });

    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));
    fireEvent.click(screen.getByTestId('city-confirm'));

    await waitFor(() => expect(screen.getByTestId('load-failure')).toBeInTheDocument());
    expect(screen.queryByTestId('city-wall')).toBeNull();
  });

  it('goes back to the file with no city chosen', async () => {
    await atTheCities();
    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));
    fireEvent.click(screen.getByTestId('city-back'));

    expect(screen.getByTestId(`overseer-sheet-${OFFERED[0]!.presetId}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('overseer-confirm'));
    expect(screen.getByTestId('city-confirm')).toBeDisabled();
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
      cities: CITIES_OFFERED,
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
        return Promise.resolve({
          headers: new Headers(),
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        });
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
          headers: new Headers(),
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
