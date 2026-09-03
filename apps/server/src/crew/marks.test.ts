/**
 * The mark on an officer's card (§B4 to §B6).
 *
 * A mark is a statement about a *fit*, so the same person is worth a different letter in a
 * different chair. That is the whole reason it is shown: a player looking at a Head of Spies with a
 * B and wondering whether they would be better in the Lab can move them and find out.
 */
import { createCommander, markIndex, type Commander } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { projectCrewOfficer } from './roster.js';

/** Somebody built for one chair: the stealth and deception a Head of Spies is read on. */
const spy = (): Commander =>
  createCommander('o1', 'Vela', 'head_spy', {
    stealth: 90,
    deception: 85,
    signals: 70,
    logic: 60,
    resolve: 55,
  });

describe('the mark on a crew card', () => {
  it('is a letter on the ladder for somebody in a chair', () => {
    const mark = projectCrewOfficer(spy()).mark;
    expect(mark, 'a seated officer has no mark').not.toBeNull();
    expect(markIndex(mark!)).toBeGreaterThanOrEqual(0);
  });

  it('changes when the same person changes chairs', () => {
    // A specialist put somewhere their sheet says nothing about. Nothing else about them moves:
    // only the chair, which is exactly what the mark is a statement about.
    const inTrade = projectCrewOfficer(spy()).mark;
    const outOfTrade = projectCrewOfficer({ ...spy(), role: 'chief_medic' }).mark;
    expect(inTrade).not.toBeNull();
    expect(outOfTrade).not.toBeNull();
    expect(
      markIndex(inTrade!),
      'a spy reads the same in the infirmary as in the field',
    ).toBeGreaterThan(markIndex(outOfTrade!));
  });

  /** §B4: the bench is not a chair, so there is no fit to report. */
  it('is null for somebody nobody has given a job', () => {
    expect(projectCrewOfficer({ ...spy(), role: null }).mark).toBeNull();
  });
});
