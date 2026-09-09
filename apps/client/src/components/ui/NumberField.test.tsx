import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MAX_DIGITS, NumberField, digitsOf, draftOf } from './NumberField';

/**
 * Typing into the field (board request, 2026-09-09).
 *
 * The field used to be a controlled number input, which could not be emptied: the empty string
 * read as zero, zero clamped to the floor, and the floor was written back in front of whatever the
 * player typed next. These pin the draft: an exact figure can be typed, a leading zero is never
 * kept, the floor waits for the field to be left, and the box is sized to its digits rather than
 * to the number in it.
 */

function Harness({
  min = 1,
  max = 999_999,
  start = 1,
}: {
  min?: number;
  max?: number;
  start?: number;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <NumberField value={value} onChange={setValue} min={min} max={max} label="how many" />
      <output data-testid="read">{value}</output>
    </>
  );
}

describe('digitsOf', () => {
  it('keeps digits, drops a leading zero, and holds six at most', () => {
    expect(digitsOf('05')).toBe('5');
    expect(digitsOf('0')).toBe('0');
    expect(digitsOf('000120')).toBe('120');
    expect(digitsOf('12a3')).toBe('123');
    expect(digitsOf('1234567')).toHaveLength(MAX_DIGITS);
    expect(digitsOf('')).toBe('');
    expect(draftOf('-12', true)).toBe('-12');
    expect(draftOf('-12', false)).toBe('12');
    expect(draftOf('-', true)).toBe('-');
  });
});

describe('the number field', () => {
  it('replaces a zero rather than putting it in front of what is typed', () => {
    render(<Harness min={0} start={0} />);
    const field = screen.getByLabelText('how many');
    fireEvent.change(field, { target: { value: '05' } });
    expect(field).toHaveValue('5');
    expect(screen.getByTestId('read')).toHaveTextContent('5');
  });

  it('lets the field be emptied and an exact figure typed, and applies the floor on leaving', () => {
    render(<Harness min={10} start={25} />);
    const field = screen.getByLabelText('how many');
    fireEvent.change(field, { target: { value: '' } });
    expect(field).toHaveValue('');
    // Under the floor while typing: the figure is still being typed, so it stands as typed.
    fireEvent.change(field, { target: { value: '7' } });
    expect(field).toHaveValue('7');
    fireEvent.change(field, { target: { value: '75' } });
    expect(field).toHaveValue('75');
    expect(screen.getByTestId('read')).toHaveTextContent('75');
    // A figure under the floor is corrected when the field is left, not before.
    fireEvent.change(field, { target: { value: '7' } });
    fireEvent.blur(field);
    expect(field).toHaveValue('10');
    expect(screen.getByTestId('read')).toHaveTextContent('10');
  });

  it('holds the ceiling while typing and steps with the arrow keys', () => {
    render(<Harness min={1} max={500} start={5} />);
    const field = screen.getByLabelText('how many');
    fireEvent.change(field, { target: { value: '9000' } });
    expect(screen.getByTestId('read')).toHaveTextContent('500');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getByTestId('read')).toHaveTextContent('499');
    expect(field).toHaveValue('499');
  });

  it('takes a minus only where the floor allows one, and holds the floor on a delta', () => {
    render(<Harness min={-3} max={0} start={0} />);
    const field = screen.getByLabelText('how many');
    fireEvent.change(field, { target: { value: '-2' } });
    expect(field).toHaveValue('-2');
    expect(screen.getByTestId('read')).toHaveTextContent('-2');
    // Past the floor as soon as the figure is as long as the floor: refused now, not on leaving.
    fireEvent.change(field, { target: { value: '-5' } });
    expect(screen.getByTestId('read')).toHaveTextContent('-3');
  });

  it('never keeps a minus where the floor is above zero', () => {
    render(<Harness min={1} start={4} />);
    const field = screen.getByLabelText('how many');
    fireEvent.change(field, { target: { value: '-2' } });
    expect(field).toHaveValue('2');
  });

  it('is sized to six digits rather than to the number in it', () => {
    render(<Harness start={1} />);
    const field = screen.getByLabelText('how many');
    // The class is the promise: a minimum width in rem, never a width that follows the digits.
    expect(field.className).toMatch(/min-w-\[4\.25rem\]/);
    expect(field.className).not.toMatch(/\bw-12\b/);
  });
});
