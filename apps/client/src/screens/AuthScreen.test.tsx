import {
  MVP_DEV_CREDENTIALS,
  RegisterRequestSchema,
  type AuthResponse,
  type User,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';
import { useSession } from '../store/session';

const USER: User = {
  id: 'u1',
  username: 'operator',
  overseerId: null,
  createdAt: '2026-08-12T10:00:00.000Z',
  displayName: null,
  icon: 'shield',
  timezone: 'Europe/Athens',
};

const fetchMock = vi.fn();

function renderAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: null, user: null });
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('AuthScreen MVP dev prefill', () => {
  const usernameField = () => screen.getByLabelText<HTMLInputElement>(/Operator ID/);
  const passwordField = () => screen.getByLabelText<HTMLInputElement>(/Passphrase/);

  it('prefills the seeded dev credentials in login mode and flags the build', () => {
    renderAuth();

    expect(usernameField().value).toBe(MVP_DEV_CREDENTIALS.username);
    expect(passwordField().value).toBe(MVP_DEV_CREDENTIALS.password);
    expect(screen.getByText(/MVP build. Dev login prefilled/)).toBeInTheDocument();
  });

  it('clears both fields when switching to register', () => {
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'register' }));

    // The 5-character dev passphrase would fail the >= 8 register rule, so it must not linger.
    expect(usernameField().value).toBe('');
    expect(passwordField().value).toBe('');
    expect(screen.queryByText(/MVP build. Dev login prefilled/)).not.toBeInTheDocument();
  });

  it('restores the prefill when switching back to login', () => {
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'register' }));
    fireEvent.change(usernameField(), { target: { value: 'someone_else' } });
    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    expect(usernameField().value).toBe(MVP_DEV_CREDENTIALS.username);
    expect(passwordField().value).toBe(MVP_DEV_CREDENTIALS.password);
  });

  it('submits the prefilled credentials to the login endpoint untouched', async () => {
    const body: AuthResponse = { token: 'tok', user: USER };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(body),
    });

    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'Jack In' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('/api/auth/login');
    expect(JSON.parse(init.body)).toEqual({
      username: MVP_DEV_CREDENTIALS.username,
      password: MVP_DEV_CREDENTIALS.password,
    });
  });
});

describe('AuthScreen', () => {
  it('blocks submission and surfaces the schema error on invalid input', () => {
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'register' }));
    fireEvent.change(screen.getByLabelText(/Operator ID/), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enlist' }));

    const parsed = RegisterRequestSchema.safeParse({ username: 'ab', password: 'password123' });
    const expectedMessage = parsed.success
      ? ''
      : (parsed.error.flatten().fieldErrors.username?.[0] ?? '');
    expect(expectedMessage).not.toBe('');
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits to the register endpoint once validation passes', async () => {
    const body: AuthResponse = { token: 'tok', user: USER };
    const response: Response = {
      ok: true,
      status: 201,
      statusText: '',
      json: () => Promise.resolve(body),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(response);

    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'register' }));
    fireEvent.change(screen.getByLabelText(/Operator ID/), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enlist' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    await waitFor(() => expect(useSession.getState().token).toBe('tok'));
  });
});

/**
 * The prefill is a development convenience, and a deployed build must not carry it.
 *
 * The seeded operator is created on every boot of the server, so its passphrase is not a secret
 * that only the database knows: typing it into the form for every visitor and printing it
 * underneath hands the account to anyone who loads the page. `import.meta.env.DEV` is what tells
 * the two apart, and Vite replaces it with a literal at build time, so the branch and the constant
 * both leave a `vite build`.
 *
 * Re-imported under a stubbed env rather than asserted against the bundle, because the flag is read
 * once at module scope: `vi.resetModules()` is the only way to get the other side of it.
 */
describe('AuthScreen in a production build', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('offers neither the prefilled credentials nor the notice naming them', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const { AuthScreen: Built } = await import('./AuthScreen');

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Built />
      </QueryClientProvider>,
    );

    // The form is up, so the absences below are absences rather than an unmounted screen.
    expect(screen.getByRole('button', { name: 'Jack In' })).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>(/Operator ID/).value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>(/Passphrase/).value).toBe('');
    expect(screen.queryByText(/MVP build/)).toBeNull();
    expect(screen.queryByText(new RegExp(MVP_DEV_CREDENTIALS.password))).toBeNull();
  });
});

/**
 * A login that fails for any reason other than a refusal from the API used to show nothing at all.
 *
 * `mutation.error instanceof ApiRequestError ? … : null` discarded every network-shaped failure:
 * unreachable host, DNS, CORS, timeout, a parse failure. The button came back to "Jack In" over a
 * form that looked untouched, on the one screen where a player has no other evidence.
 */
describe('AuthScreen when the API cannot be reached', () => {
  it('says so rather than looking as though the press did nothing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'Jack In' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Could not reach/));
    // ...and not the browser's own wording, which tells a player nothing.
    expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
  });
});
