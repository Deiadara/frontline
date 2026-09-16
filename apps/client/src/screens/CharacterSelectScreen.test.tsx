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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    const line = await screen.findByTestId('overseer-pool');
    await waitFor(() => expect(line).not.toHaveTextContent('Reading the files.'));
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

  /** §F6: the screen says how much of the pool is left, because four of thirty and four of five
      are very different choices and the cards alone cannot tell them apart. */
  it('says how much of the pool is left', async () => {
    await offered();
    const line = screen.getByTestId('overseer-pool');
    expect(line).toHaveTextContent(String(OVERSEER_POOL_SIZE));
    expect(line).toHaveTextContent(String(REMAINING));
  });

  // B6/F6: each card shows its *whole* sheet: every attribute, not a role-relevant subset.
  it('renders the full attribute sheet and a radar for each offered character', async () => {
    await offered();
    // By the label a player reads, not by the key: the sheet renders `ATTRIBUTE_LABELS`, and an
    // assertion on the raw key would pass only for as long as the two happen to match.
    for (const attribute of ATTRIBUTE_NAMES) {
      expect(screen.getAllByText(ATTRIBUTE_LABELS[attribute])).toHaveLength(OFFERED.length);
    }
    expect(screen.getAllByRole('img', { name: 'Attribute radar' })).toHaveLength(OFFERED.length);
  });

  /*
   * The bio is clamped to two lines and every one runs to three in that column, so the card shows
   * a sentence cut mid-word on the one screen where a player is choosing *on* the description. The
   * clamp stays (a taller card drops a whole card row at 1280x800); what cannot stay is there
   * being nowhere to read the rest.
   */
  it('carries the whole bio on the hover, not just the two lines it shows', async () => {
    await offered();
    for (const preset of OFFERED) {
      const bio = screen.getByText(preset.bio);
      expect(bio.className, `${preset.presetId}'s bio is not clamped`).toContain('line-clamp-2');
      expect(bio, `${preset.presetId}'s cut bio cannot be read anywhere`).toHaveAttribute(
        'data-tip',
        preset.bio,
      );
    }
  });

  /** B7: the signature perk is the character. It is the one thing a player is really choosing. */
  it('names each offered character signature perk', async () => {
    await offered();
    for (const preset of OFFERED) {
      for (const id of preset.perks) {
        const perk = findPerk(id);
        expect(perk, `${preset.presetId} carries an unknown perk ${id}`).toBeDefined();
        if (perk) expect(screen.getByText(perk.name)).toBeInTheDocument();
      }
    }
  });
});
