import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_CARDS,
  TUTORIAL_SCREENS,
  TUTORIAL_STEPS,
  nextTutorialCard,
  tutorialCard,
  tutorialFinished,
} from './steps.js';

/**
 * The opening tutorial's rules, which are the maintainer's and not negotiable by a later edit.
 *
 * Six cards, once each, on the screens they are about, with a skip that ends all of them, and
 * nothing after the beginning. Most of that is enforced by the client, but the parts a test can
 * hold are here: that every step has a card, that every card has a screen, that the order the
 * player meets them in is the catalogue's, and that a full set is final.
 */
describe('the opening tutorial', () => {
  it('has a card and a screen for every step, and no orphans either way', () => {
    expect(TUTORIAL_STEPS).toHaveLength(6);
    for (const step of TUTORIAL_STEPS) {
      expect(tutorialCard(step), step).toBeDefined();
      expect(TUTORIAL_SCREENS[step], step).toBeTruthy();
    }
    // And nothing in the catalogue that the step list has forgotten: the two are walked from
    // opposite ends so a card added without an id, or an id added without a card, fails here.
    expect(TUTORIAL_CARDS.map((card) => card.step).sort()).toEqual([...TUTORIAL_STEPS].sort());
  });

  it('writes every card with a title, a lede and at least two paragraphs', () => {
    for (const card of TUTORIAL_CARDS) {
      expect(card.title.length, card.step).toBeGreaterThan(2);
      expect(card.lede.length, card.step).toBeGreaterThan(10);
      expect(card.body.length, card.step).toBeGreaterThanOrEqual(2);
      for (const paragraph of card.body) {
        expect(paragraph.length, `${card.step}: ${paragraph}`).toBeGreaterThan(20);
        // The project's own writing rule, held here because this is player-facing copy.
        // Written as escapes, not as the characters: `scripts/writing-style.test.ts` refuses a
        // literal em or en dash anywhere in the tree, this file included.
        expect(paragraph, card.step).not.toMatch(/[\u2014\u2013]/);
      }
    }
  });

  /**
   * Exactly one card carries a portrait, and it is the Combine's.
   *
   * The maintainer's call is that the tutorial is the game talking, not a person: a face on every
   * card would read as six characters addressing the player. The Combine card has one because the
   * card is *about* the face.
   */
  it('puts a portrait on the Combine card and on nothing else', () => {
    const withArt = TUTORIAL_CARDS.filter((card) => card.portraitUnitId !== undefined);
    expect(withArt.map((card) => card.step)).toEqual(['combine']);
    expect(withArt[0]?.portraitUnitId).toBe('directive_xero');
    // Nobody is quoted, on any card: no card opens a quotation.
    for (const card of TUTORIAL_CARDS) {
      expect(card.body.join(' '), card.step).not.toMatch(/[""]/);
    }
  });

  describe('which card comes next', () => {
    it('walks the three city cards in order and then stops asking', () => {
      const seen: string[] = [];
      for (const expected of ['welcome', 'combine', 'city']) {
        const card = nextTutorialCard('city', seen);
        expect(card?.step).toBe(expected);
        seen.push(card!.step);
      }
      expect(nextTutorialCard('city', seen)).toBeUndefined();
    });

    it('keeps each screen to its own card, whatever order the screens are walked in', () => {
      // Battles first, which is a player who pressed the bottom bar before looking at the map.
      expect(nextTutorialCard('battles', [])?.step).toBe('battles');
      expect(nextTutorialCard('missions', ['battles'])?.step).toBe('missions');
      // Seeing the battles card does not consume any of the city's.
      expect(nextTutorialCard('city', ['battles'])?.step).toBe('welcome');
    });

    it('shows nothing for a screen the tutorial says nothing about', () => {
      expect(nextTutorialCard('scrapyard', [])).toBeUndefined();
      expect(nextTutorialCard('bar', [])).toBeUndefined();
    });

    it('is finished only when every step is in the set, which is what Skip writes', () => {
      expect(tutorialFinished([])).toBe(false);
      expect(tutorialFinished(['welcome', 'combine', 'city'])).toBe(false);
      expect(tutorialFinished([...TUTORIAL_STEPS])).toBe(true);
      // An id the build no longer has does not finish it, and does not break it either.
      expect(tutorialFinished(['welcome', 'retired_card'])).toBe(false);
      expect(tutorialFinished([...TUTORIAL_STEPS, 'retired_card'])).toBe(true);
    });
  });
});
