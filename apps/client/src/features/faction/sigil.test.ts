import { describe, expect, it } from 'vitest';
import { SIGIL_FACES, SIGIL_HATS, SIGIL_SKULLS, sigilOf } from './sigil';

/**
 * The face somebody at the table wears.
 *
 * The failure this guards is not a crash. A hash that collapses draws a roster of five identical
 * people, which looks like a rendering bug and is invisible to every other gate: the component
 * renders, the paths are valid, and the screenshot shows a tidy row of cards.
 */

describe('the face a member is drawn with', () => {
  it('is the same face for the same account, every time', () => {
    expect(sigilOf('ally-user')).toEqual(sigilOf('ally-user'));
    expect(sigilOf('me-user')).toEqual(sigilOf('me-user'));
  });

  it('only ever names a drawing that exists', () => {
    for (let at = 0; at < 500; at += 1) {
      const { skull, face, hat } = sigilOf(`user-${at}`);
      expect(skull).toBeGreaterThanOrEqual(0);
      expect(skull).toBeLessThan(SIGIL_SKULLS);
      expect(face).toBeGreaterThanOrEqual(0);
      expect(face).toBeLessThan(SIGIL_FACES);
      expect(hat).toBeGreaterThanOrEqual(0);
      expect(hat).toBeLessThan(SIGIL_HATS);
    }
  });

  /*
   * Ids that differ in one character have to land apart, because that is what the seeded world
   * hands out: the two accounts at the fixture's own table are `me-user` and `ally-user`.
   *
   * Stated as a rate rather than as "these five are all different", which is not a property this
   * can have: 80 drawings and five people is a one-in-nine chance of a pair sharing a face by the
   * birthday argument alone, and the first version of this test failed on exactly that. Measured
   * over 2,000 consecutive ids the rate is 0.45%, against the 1.25% a fair hash would give.
   */
  it('does not put neighbouring accounts in the same face', () => {
    expect(sigilOf('me-user')).not.toEqual(sigilOf('ally-user'));

    let shared = 0;
    for (let at = 0; at < 2000; at += 1) {
      if (JSON.stringify(sigilOf(`user-${at}`)) === JSON.stringify(sigilOf(`user-${at + 1}`))) {
        shared += 1;
      }
    }
    expect(shared / 2000).toBeLessThan(0.03);
  });

  /*
   * ...and the three parts are picked off different bits of the hash. Taking successive remainders
   * of one number correlates them, and a correlated set draws far fewer than the 80 faces it
   * claims: measured on 4,000 ids, the whole space has to be reachable.
   */
  it('reaches every drawing across a crowd', () => {
    const seen = { skull: new Set<number>(), face: new Set<number>(), hat: new Set<number>() };
    for (let at = 0; at < 4000; at += 1) {
      const sigil = sigilOf(`player-${at}`);
      seen.skull.add(sigil.skull);
      seen.face.add(sigil.face);
      seen.hat.add(sigil.hat);
    }
    expect(seen.skull.size).toBe(SIGIL_SKULLS);
    expect(seen.face.size).toBe(SIGIL_FACES);
    expect(seen.hat.size).toBe(SIGIL_HATS);

    const combinations = new Set<string>();
    for (let at = 0; at < 4000; at += 1) {
      combinations.add(JSON.stringify(sigilOf(`player-${at}`)));
    }
    expect(combinations.size).toBe(SIGIL_SKULLS * SIGIL_FACES * SIGIL_HATS);
  });
});
