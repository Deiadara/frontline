import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';

/** Bug pass, 2026-10-06: menus that outlived a second picker's press, a Tab, or their own fold. */

const OPTIONS = Array.from({ length: 20 }, (_, index) => ({
  value: `o${index}`,
  label: `Option ${index}`,
}));

function Picker({ label }: { label: string }) {
  const [value, setValue] = useState('o0');
  return <Dropdown value={value} options={OPTIONS} onChange={setValue} label={label} />;
}

const trigger = (label: string) => screen.getByRole('combobox', { name: label });
const press = (element: Element) => {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the painted picker', () => {
  it('closes when another picker is opened', () => {
    render(
      <>
        <Picker label="first" />
        <Picker label="second" />
      </>,
    );
    press(trigger('first'));
    expect(trigger('first')).toHaveAttribute('aria-expanded', 'true');
    press(trigger('second'));
    expect(trigger('second')).toHaveAttribute('aria-expanded', 'true');
    expect(trigger('first')).toHaveAttribute('aria-expanded', 'false');
  });

  it('still toggles shut on its own trigger', () => {
    render(<Picker label="only" />);
    press(trigger('only'));
    press(trigger('only'));
    expect(trigger('only')).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when focus is tabbed somewhere else, and not when it moves into the menu', () => {
    render(
      <>
        <Picker label="only" />
        <button type="button">elsewhere</button>
      </>,
    );
    press(trigger('only'));
    fireEvent.blur(trigger('only'), { relatedTarget: screen.getByRole('listbox') });
    expect(trigger('only')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(trigger('only'), { relatedTarget: null });
    expect(trigger('only')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(trigger('only'), {
      relatedTarget: screen.getByRole('button', { name: 'elsewhere' }),
    });
    expect(trigger('only')).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the highlighted option in sight as the arrows move it', () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this.textContent);
    });
    render(<Picker label="only" />);
    press(trigger('only'));
    for (let hop = 0; hop < 12; hop++) fireEvent.keyDown(trigger('only'), { key: 'ArrowDown' });
    expect(scrolled.at(-1)).toBe('Option 12');
  });
});
