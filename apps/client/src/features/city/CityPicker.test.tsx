import { CITIES, DEFAULT_CITY_ID, SALTMARCH_CITY_ID } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CityPicker } from './CityPicker';

/**
 * The door to another city's rooms (maintainer request, 2026-09-17).
 *
 * Three things this has to get right, and all three are about a list the client is *told* rather
 * than one it works out: it names the room you are in, it offers only the rooms the server said you
 * may enter, and it hands the choice back rather than deciding anything itself. A picker that
 * filtered the list here would be a client guessing at who holds what, which it cannot see.
 */

const nameOf = (id: string) => CITIES.find((city) => city.id === id)!.name;

describe('the city picker', () => {
  it('says which room is open', () => {
    render(<CityPicker cityId={DEFAULT_CITY_ID} cities={[DEFAULT_CITY_ID]} onChoose={() => {}} />);
    expect(screen.getByTestId('city-picker-open')).toHaveTextContent(nameOf(DEFAULT_CITY_ID));
  });

  /**
   * A crew with one city still gets the control, and it still opens nothing.
   *
   * Drawn because the door has to be discoverable before the day a player takes ground abroad, and
   * shut because a menu offering one item that is already chosen is a control that wastes a press.
   */
  it('opens no list for a crew that holds ground in one city', () => {
    render(<CityPicker cityId={DEFAULT_CITY_ID} cities={[DEFAULT_CITY_ID]} onChoose={() => {}} />);
    fireEvent.click(screen.getByTestId('city-picker-open'));
    expect(screen.queryByTestId('city-picker-list')).toBeNull();
  });

  it('lists the rooms the server said are open, and hands back the one pressed', () => {
    const chose = vi.fn();
    render(
      <CityPicker
        cityId={DEFAULT_CITY_ID}
        cities={[DEFAULT_CITY_ID, SALTMARCH_CITY_ID]}
        onChoose={chose}
      />,
    );

    fireEvent.click(screen.getByTestId('city-picker-open'));
    const list = screen.getByTestId('city-picker-list');
    expect(list).toHaveTextContent(nameOf(SALTMARCH_CITY_ID));
    // The room already open is marked as such rather than left out of its own list.
    expect(screen.getByTestId(`city-choose-${DEFAULT_CITY_ID}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByTestId(`city-choose-${SALTMARCH_CITY_ID}`));
    expect(chose).toHaveBeenCalledWith(SALTMARCH_CITY_ID);
    // And it shuts behind the press: the choice is made, so the list has nothing left to say.
    expect(screen.queryByTestId('city-picker-list')).toBeNull();
  });

  /** Whatever the server sends is what is offered: no filtering, no sorting, no inventing. */
  it('offers exactly the list it was given, in the order it was given', () => {
    render(
      <CityPicker
        cityId={SALTMARCH_CITY_ID}
        cities={[DEFAULT_CITY_ID, SALTMARCH_CITY_ID]}
        onChoose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('city-picker-open'));
    const rows = screen.getByTestId('city-picker-list').querySelectorAll('button');
    expect([...rows].map((row) => row.getAttribute('data-testid'))).toEqual([
      `city-choose-${DEFAULT_CITY_ID}`,
      `city-choose-${SALTMARCH_CITY_ID}`,
    ]);
  });
});
