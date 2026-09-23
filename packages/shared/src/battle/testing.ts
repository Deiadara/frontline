import type { SkirmishOutcome } from './skirmish.js';

/**
 * Test doubles for the skirmish engine, and nothing else.
 *
 * Split out of `skirmish.ts` on 2026-09-24. `skirmishOutcome` has eighteen consumers and every one
 * of them is a test: it is scaffolding that was sitting in the middle of the engine's own module,
 * where a reader had to work out that the shipped contract carried a fixture builder. It is still
 * exported from the package, because the server's tests import it across the workspace boundary
 * and there is no test-only entry point to put it behind; what this file buys is that its name
 * says what it is.
 */

/**
 * A complete outcome from whichever fields a caller cares about.
 *
 * The outcome grew five fields when the coin flip was replaced, and every stub engine in the
 * server suite had to be edited to say `winnerLosses: {}`, which is noise that teaches nothing and
 * will have to be done again on the next field. A stub says what it is testing and this fills in
 * the rest.
 */
export function skirmishOutcome(partial: Partial<SkirmishOutcome> = {}): SkirmishOutcome {
  return {
    winner: 'attacker',
    log: [],
    fled: {},
    killed: {},
    winnerLosses: {},
    turned: {},
    executed: 0,
    executedForce: {},
    turnedAlive: {},
    rounds: 1,
    findings: [],
    standing: { attacker: [], defender: [] },
    perimeterCaught: {},
    perimeterLosses: {},
    brokeThrough: true,
    officers: { attacker: null, defender: null },
    jam: { attacker: 0, defender: 0 },
    ...partial,
  };
}
