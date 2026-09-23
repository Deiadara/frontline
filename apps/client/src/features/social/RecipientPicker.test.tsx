import {
  MESSAGE_RECIPIENTS_MAX,
  MESSAGE_REFUSAL_TEXT,
  type PlayerStanding,
} from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { leaderboardPlayers } from '../../../e2e/fixtures';
import { RecipientPicker } from './RecipientPicker';

/**
 * The To field picks people rather than taking text (maintainer request, 2026-09-23).
 *
 * A name is on the letter only once it has been ticked off the list the field throws up, more
 * than one can be, and the chosen names sit in the field itself. A name that matches nobody is
 * said under the field, in the server's words, while the reader is still typing.
 */

const entries: readonly PlayerStanding[] =
  leaderboardPlayers.board === 'players' ? leaderboardPlayers.entries : [];

function Harness({
  exclude = null,
  start = [],
  offered = entries,
}: {
  exclude?: string | null;
  start?: string[];
  offered?: readonly PlayerStanding[];
}) {
  const [chosen, setChosen] = useState<string[]>(start);
  return (
    <MemoryRouter>
      <RecipientPicker entries={offered} exclude={exclude} chosen={chosen} onChange={setChosen} />
      <output data-testid="chosen">{chosen.join('|')}</output>
    </MemoryRouter>
  );
}

const field = () => screen.getByTestId('compose-to');

describe('the recipient picker', () => {
  it('puts a ticked name on the letter, and a second tick takes it off', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: 'sab' } });

    const option = screen.getByTestId('recipient-option-Sable_Ninth');
    expect(option).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(option);
    expect(screen.getByTestId('chosen')).toHaveTextContent('Sable_Ninth');
    expect(screen.getByTestId('compose-recipient-Sable_Ninth')).toBeInTheDocument();
    // The list stays up after a pick so a second name can be ticked off the same list.
    expect(screen.getByTestId('recipient-option-Sable_Ninth')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.click(screen.getByTestId('recipient-option-Sable_Ninth'));
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
    expect(screen.queryByTestId('compose-recipient-Sable_Ninth')).toBeNull();
  });

  it('carries several names, comma-separated, each with its own way off', () => {
    render(<Harness start={['Sable_Ninth', 'Marrow']} />);
    const box = screen.getByTestId('compose-recipients');
    expect(box).toHaveTextContent('Sable_Ninth,Marrow');
    expect(screen.getByTestId('chosen')).toHaveTextContent('Sable_Ninth|Marrow');

    fireEvent.click(screen.getByTestId('compose-recipient-remove-Sable_Ninth'));
    expect(screen.getByTestId('chosen')).toHaveTextContent('Marrow');
    expect(screen.queryByTestId('compose-recipient-Sable_Ninth')).toBeNull();
  });

  it('says, under the field, when what was typed matches nobody', () => {
    render(<Harness />);
    expect(screen.queryByTestId('recipient-no-match')).toBeNull();
    fireEvent.change(field(), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('recipient-no-match')).toHaveTextContent(
      MESSAGE_REFUSAL_TEXT.no_such_player,
    );
    expect(screen.queryByTestId('recipient-suggestions')).toBeNull();
  });

  it('never offers the writer their own name', () => {
    render(<Harness exclude="Nikos" />);
    fireEvent.change(field(), { target: { value: 'nik' } });
    expect(screen.queryByTestId('recipient-option-Nikos')).toBeNull();
    expect(screen.getByTestId('recipient-no-match')).toBeInTheDocument();
  });

  it('stops at the cap and says so', () => {
    // The fixture board is five names, which is the cap: doubled so there is a name to refuse.
    const many = [
      ...entries,
      ...entries.map((entry) => ({
        ...entry,
        userId: `${entry.userId}-second`,
        username: `${entry.username}_II`,
      })),
    ];
    const names = many.map((entry) => entry.username);
    render(<Harness offered={many} start={names.slice(0, MESSAGE_RECIPIENTS_MAX)} />);
    expect(screen.getByTestId('recipient-full')).toBeInTheDocument();
    const spare = names[MESSAGE_RECIPIENTS_MAX]!;
    fireEvent.change(field(), { target: { value: spare } });
    const option = screen.getByTestId(`recipient-option-${spare}`);
    expect(option).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(option);
    expect(screen.getByTestId('chosen')).not.toHaveTextContent(spare);
  });

  it('walks the list on the keyboard and ticks on enter', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: 'a' } });
    const first = screen.getAllByRole('option')[0]!;
    const name = first.getAttribute('data-testid')!.replace('recipient-option-', '');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByTestId('chosen')).toHaveTextContent(name);
    // Backspace on an empty field takes the last name back off.
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.keyDown(field(), { key: 'Backspace' });
    expect(screen.getByTestId('chosen')).toHaveTextContent('');
  });
});
