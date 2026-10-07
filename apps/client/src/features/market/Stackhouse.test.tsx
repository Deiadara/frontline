import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';

const book = vi.hoisted((): { current: unknown } => ({ current: undefined }));
vi.mock('../../lib/queries', () => ({
  useStackhouse: () => ({ data: book.current, dataUpdatedAt: Date.now() }),
  useMe: () => ({ data: { base: { resources: { caps: 3_000 } } } }),
  usePlaceStackhouseBet: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const { StackhousePanel } = await import('./Stackhouse');

const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

beforeEach(() => {
  book.current = { ...F.stackhouseBook, serverNow: new Date().toISOString() };
});

/*
 * The window keeps a copy of the fight it opened on (maintainer, 2026-10-06). It drew only while
 * the fight was on the book, so the five-second poll taking the fight off closed it mid-thought and
 * took any refusal with it.
 */
describe('the bet window', () => {
  it('stays up when its fight leaves the book, until it is closed', () => {
    const { rerender } = render(<StackhousePanel />);
    fireEvent.click(screen.getByTestId('stackhouse-fight-bet-1'));
    expect(screen.getByTestId('stackhouse-window')).toBeInTheDocument();

    book.current = { ...F.stackhouseBook, fights: F.stackhouseBook.fights.slice(1) };
    rerender(<StackhousePanel />);
    expect(screen.getByTestId('stackhouse-window')).toHaveTextContent('The Rustyard Pumphouse');
  });

  it('shuts the bet at the close, on its own clock', () => {
    const [first] = F.stackhouseBook.fights;
    book.current = {
      ...F.stackhouseBook,
      serverNow: new Date().toISOString(),
      fights: [{ ...first!, closesAt: at(-1_000), startsAt: at(3_600_000) }],
    };
    render(<StackhousePanel />);
    fireEvent.click(screen.getByTestId('stackhouse-fight-bet-1'));
    fireEvent.click(screen.getByTestId('stackhouse-side-attacker'));
    const place = screen.getByTestId('stackhouse-place');
    expect(place).toBeDisabled();
    expect(place).toHaveAttribute('data-tip', 'Betting on this fight has closed');
  });
});
