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
