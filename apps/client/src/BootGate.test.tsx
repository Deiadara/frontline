import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './store/session';

interface MeState {
  isLoading: boolean;
  isError: boolean;
  data: unknown;
}

const meState = vi.hoisted(() => {
  const current: MeState = { isLoading: false, isError: false, data: undefined };
  return { current };
});

vi.mock('./lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMe: () => meState.current,
}));

const { BootGate } = await import('./App');

afterEach(() => {
  useSession.setState({ token: null, user: null });
});

/**
 * The gate in front of the whole game (bug pass, 2026-09-27). A failed *background* poll keeps the
 * data it had and still reports `isError`, and the gate used to read that alone: one 502 during a
 * restart replaced every screen with a reload notice and threw away open dialogs and drafts.
 */
describe('the boot gate', () => {
  it('keeps the game up when a poll fails but the last read is still in hand', () => {
    useSession.setState({ token: 'token', user: null });
    meState.current = { isLoading: false, isError: true, data: { user: {} } };
    render(
      <BootGate>
        <p>the game</p>
      </BootGate>,
    );
    expect(screen.getByText('the game')).toBeTruthy();
  });

  it('says the uplink failed when the first read never arrived', () => {
    useSession.setState({ token: 'token', user: null });
    meState.current = { isLoading: false, isError: true, data: undefined };
    render(
      <BootGate>
        <p>the game</p>
      </BootGate>,
    );
    expect(screen.getByText('Uplink failed. Reload to try again.')).toBeTruthy();
    expect(screen.queryByText('the game')).toBeNull();
  });
});
