import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { useSession } from './store/session';

function renderApp(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSession.setState({ token: null, user: null });
  localStorage.clear();
});

describe('App routing', () => {
  it('redirects an unauthenticated visitor to the auth terminal', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'FRONTLINE' })).toBeInTheDocument();
    // The door opens on its two handles (maintainer, 2026-09-23); the form is behind them.
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });
});
