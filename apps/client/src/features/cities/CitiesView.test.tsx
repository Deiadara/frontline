import {
  CITIES,
  DEFAULT_CITY_ID,
  TERMINUS_CITY_ID,
  cityHomeOffers,
  homePlots,
} from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CitiesView } from './CitiesView';

/**
 * One wall of paintings, two modes (maintainer, 2026-09-24).
 *
 * The world screen's is a wall of doors and the opening's is a wall of things to pick between.
 * They are one component on purpose, so what this file is really holding is that giving it the
 * second mode did not quietly change the first: `cities.spec.ts` drives the door mode in a real
 * browser, and this is the cheap guard that runs on every commit.
 */

const SHUT = CITIES.find((city) => !city.open)!;

describe('the world screen: a wall of doors', () => {
  it('opens the city that was pressed and refuses the ones with no map', () => {
    const onEnterCity = vi.fn();
    render(<CitiesView onEnterCity={onEnterCity} />);

    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));
    expect(onEnterCity).toHaveBeenCalledWith(DEFAULT_CITY_ID);

    const shut = screen.getByTestId(`city-card-${SHUT.id}`);
    expect(shut).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(shut);
    expect(onEnterCity).toHaveBeenCalledTimes(1);
  });

  it('says nothing about plots, which is a question only the opening asks', () => {
    render(<CitiesView onEnterCity={vi.fn()} />);
    for (const city of CITIES) {
      expect(screen.queryByTestId(`city-status-${city.id}`)).toBeNull();
    }
  });
});

describe('the opening: a wall of homes', () => {
  /** Terminus full, Ashfall with room: every state a card can be in, on one screen. */
  const offers = cityHomeOffers(homePlots(TERMINUS_CITY_ID));

  it('selects rather than enters, and only where the server says there is room', () => {
    const onSelect = vi.fn();
    render(<CitiesView choosing={{ offers, selectedId: null, onSelect }} />);

    fireEvent.click(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`));
    expect(onSelect).toHaveBeenCalledWith(DEFAULT_CITY_ID);

    fireEvent.click(screen.getByTestId(`city-card-${TERMINUS_CITY_ID}`));
    fireEvent.click(screen.getByTestId(`city-card-${SHUT.id}`));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('tells a full city apart from one with no map', () => {
    render(<CitiesView choosing={{ offers, selectedId: null, onSelect: vi.fn() }} />);

    expect(screen.getByTestId(`city-status-${DEFAULT_CITY_ID}`)).toHaveTextContent(
      '4 of 4 plots free',
    );
    expect(screen.getByTestId(`city-status-${TERMINUS_CITY_ID}`)).toHaveTextContent(
      'Full: 4 crews already live here',
    );
    expect(screen.getByTestId(`city-status-${SHUT.id}`)).toHaveTextContent('No map here yet');
  });

  it('marks the chosen card, and only that one', () => {
    render(<CitiesView choosing={{ offers, selectedId: DEFAULT_CITY_ID, onSelect: vi.fn() }} />);

    expect(screen.getByTestId(`city-card-${DEFAULT_CITY_ID}`)).toHaveAttribute(
      'data-chosen',
      'true',
    );
    expect(screen.getByTestId(`city-status-${DEFAULT_CITY_ID}`)).toHaveTextContent('Chosen');
    for (const city of CITIES.filter((one) => one.id !== DEFAULT_CITY_ID)) {
      expect(screen.getByTestId(`city-card-${city.id}`)).not.toHaveAttribute('data-chosen');
    }
  });

  it('locks a city the offer says nothing about at all', () => {
    // A city the server did not answer for is not a city a crew may be seated in, so it is drawn
    // the way an unbuilt one is rather than guessed at.
    render(<CitiesView choosing={{ offers: [], selectedId: null, onSelect: vi.fn() }} />);
    for (const city of CITIES) {
      expect(screen.getByTestId(`city-card-${city.id}`)).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByTestId(`city-status-${city.id}`)).toHaveTextContent('No map here yet');
    }
  });
});
