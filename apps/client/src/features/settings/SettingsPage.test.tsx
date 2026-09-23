import {
  TUTORIAL_STEPS,
  UpdateProfileRequestSchema,
  type SettingsResponse,
  type UpdateProfileRequest,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { useSession } from '../../store/session';

/**
 * Taking a display name off has to be sayable on the wire.
 *
 * `db/repos/users.ts` documents `undefined` as "leave this field alone" and `null` as the real
 * value meaning "call me by my username again", and `updateProfile` loops with `if (value ===
 * undefined) continue`. The panel cleared its box and then **omitted** the field, which is the
 * first of those, so the column was untouched, the panel said "Saved.", and the sync effect put the
 * old name straight back into the input on the next `/me`. There was no way to remove a display
 * name once set and the screen said twice that there was.
 */

const NOW = '2026-08-26T12:00:00.000Z';

const settings: SettingsResponse = {
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW,
    displayName: 'The Ninth Street Crew',
    icon: 'shield',
    timezone: 'Europe/Athens',
    soundVolume: 60,
    // Seen, so the opening tutorial does not draw over a test about something else.
    tutorialSeen: [...TUTORIAL_STEPS],
  },
  serverNow: NOW,
  gameTimezone: 'Europe/Athens',
};

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The body of the one PATCH the panel sent. */
function patchBody(): UpdateProfileRequest {
  const patch = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
  );
  if (!patch) throw new Error('nothing was saved');
  return JSON.parse((patch[1] as RequestInit).body as string) as UpdateProfileRequest;
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/game/settings']}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => reply(path.endsWith('/settings') ? settings : {}));
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the display name', () => {
  it('is cleared with an explicit null rather than by leaving the field out', async () => {
    renderSettings();
    const field = await screen.findByTestId<HTMLInputElement>('settings-display-name');
    expect(field.value).toBe('The Ninth Street Crew');

    fireEvent.change(field, { target: { value: '  ' } });
    // The profile form, addressed through its own field: all three panels have a "Save".
    fireEvent.submit(field.closest('form')!);

    await waitFor(() => expect(patchBody()).toHaveProperty('displayName'));
    expect(patchBody().displayName).toBeNull();
  });

  it('sends the trimmed name when there is one, and never an empty string', async () => {
    renderSettings();
    const field = await screen.findByTestId<HTMLInputElement>('settings-display-name');

    fireEvent.change(field, { target: { value: '  Vermilion  ' } });
    fireEvent.submit(field.closest('form')!);

    await waitFor(() => expect(patchBody().displayName).toBe('Vermilion'));
  });

  /*
   * The other half of the same fix, asserted here because this is the only place that depends on
   * it: `apiFetch` validates the *response*, so a client sending a `null` the request schema
   * refuses would pass every test in this file and be rejected by the route.
   */
  it('is a value the wire schema admits, where an empty string is not', () => {
    expect(UpdateProfileRequestSchema.safeParse({ displayName: null }).success).toBe(true);
    expect(UpdateProfileRequestSchema.safeParse({ displayName: '' }).success).toBe(false);
    // ...and omitting it still means "leave it alone", which is a different instruction.
    expect(UpdateProfileRequestSchema.safeParse({ icon: 'shield' }).success).toBe(true);
  });
});

/**
 * A panel called "Your clock" has to tick.
 *
 * `new Date(serverNow)` was the response's own timestamp, frozen at page load on a query with no
 * poll, so the preview a player uses to check their zone showed the minute they opened the page
 * for as long as they left it open.
 */
describe('the clock preview', () => {
  it('moves with the clock while the page is left alone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse(NOW));
    try {
      renderSettings();
      const preview = await screen.findByTestId('settings-clock-preview');
      const shown = preview.textContent;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      await waitFor(() => expect(preview.textContent).not.toBe(shown));
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The words on the sheet, as the maintainer asked for them (2026-09-15).
 *
 * The strings are the assertion. The quotation is the one line the screen opens on, the standing
 * note under it is gone rather than reworded, the filter panel is called "Sound Preferences", the
 * volume bar carries no line over it and the filters no opening paragraph (maintainer,
 * 2026-09-23), and the credential is a password everywhere the page speaks.
 */
describe('the sheet reads as asked', () => {
  it('opens on the city line and carries no standing note', async () => {
    renderSettings();
    expect(
      await screen.findByText('The only part that the city allows you to control'),
    ).toBeTruthy();
    expect(screen.queryByText(/The Combine keeps a file on you/)).toBeNull();
    expect(screen.queryByText('What is yours alone')).toBeNull();
    expect(screen.queryByTestId('info-note')).toBeNull();
  });

  it('names the filter panel Sound Preferences and the credential a password', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { name: 'Sound Preferences' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Password' })).toBeTruthy();
    expect(screen.queryByText('What you hear about')).toBeNull();
    expect(screen.queryByText(/passphrase/i)).toBeNull();
  });

  it('says nothing over the volume bar, nothing over the filters, and one line about the clock', async () => {
    renderSettings();
    await screen.findByTestId('settings-sounds-panel');
    expect(screen.queryByText(/One bar for every sound/)).toBeNull();
    expect(screen.queryByText(/A kind you switch off is never recorded/)).toBeNull();
    expect(screen.getByText(/^The game clock runs in .+ time\.$/)).toBeTruthy();
    expect(screen.queryByText(/Every clock, countdown and refresh/)).toBeNull();
  });

  it('changes the password without asking for the old one', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Password' });
    expect(screen.queryByTestId('settings-current-password')).toBeNull();
    expect(screen.getByTestId('settings-new-password')).toBeTruthy();
  });
});
