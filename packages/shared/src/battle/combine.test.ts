import { describe, expect, it } from 'vitest';
import {
  COMBINE_LEADERS,
  DIRECTIVE_XERO_MORALE,
  EXECUTIONER_THRESHOLD,
  SYNDIC_ARMOR,
  SYNDIC_PENETRATION,
  combineGarrison,
  combineSlotBudget,
  combineLeaderAlive,
  combinePresenceOver,
  type CombinePower,
} from '../city/combine.js';
import { bareBattlefield } from './battlefield.js';
import {
  MAX_INTIMIDATED_SHARE,
  intimidate,
  takeDamage,
  menace,
  nerve,
  simulate,
  type SideSetup,
} from './engine.js';
import { defaultSkirmishEngine } from './skirmish.js';
import { findUnit } from '../units/catalog.js';
import { MAX_RATING } from '../units/stats.js';

/**
 * The Combine's three leaders, in the engine (maintainer, 2026-09-19).
 *
 * Every block below is an A/B on one seed: the same two forces with and without the leader's
 * power on the defence, and the assertion is about the *difference*. A test that only ran the
 * powered fight would pass on an engine that ignored `presence` entirely, because the numbers it
 * read would all be plausible numbers; what proves the hook is the fight it changes.
 */

const SYNDIC: CombinePower = {
  kind: 'syndic',
  penetration: SYNDIC_PENETRATION,
  armor: SYNDIC_ARMOR,
};
const EXECUTIONER: CombinePower = { kind: 'executioner', threshold: EXECUTIONER_THRESHOLD };
const ZERO: CombinePower = {
  kind: 'directive_xero',
  morale: DIRECTIVE_XERO_MORALE,
  changeOfHeart: true,
};

const fight = (
  attacker: SideSetup['army'],
  defender: SideSetup['army'],
  presence: CombinePower | undefined,
  seed = 'combine-ab',
) =>
  simulate({
    seed,
    battlefield: bareBattlefield(),
    attacker: { name: 'Crew', army: attacker, defending: false },
    defender: {
      name: 'The Combine',
      army: defender,
      defending: true,
      ...(presence ? { presence } : {}),
    },
  });

const stack = (sim: ReturnType<typeof simulate>, side: 'attacker' | 'defender', unitId: string) => {
  const found = sim[side].stacks.find((one) => one.unit.id === unitId && one.turncoat !== true);
  if (!found) throw new Error(`no ${unitId} on the ${side}`);
  return found;
};

describe('the Syndic', () => {
  const without = fight({ razors: 30 }, { greycoat: 20 }, undefined);
  const withHim = fight({ razors: 30 }, { greycoat: 20 }, SYNDIC);

  it('puts her points on every sheet she stands with, and names herself as the reason', () => {
    const bare = stack(without, 'defender', 'greycoat').effective;
    const backed = stack(withHim, 'defender', 'greycoat').effective;
    expect(backed.penetration).toBe(Math.min(100, bare.penetration + SYNDIC_PENETRATION));
    expect(backed.armor).toBe(Math.min(100, bare.armor + SYNDIC_ARMOR));
    expect(backed.reasons).toContain('The Syndic');
    expect(bare.reasons).not.toContain('The Syndic');
  });

  /**
   * ...and nothing at all on the attacker's sheet (maintainer, 2026-09-20).
   *
   * The opening power took 20 armour off everybody sent against her, and reaching across the line
   * to change the attacker's numbers is the one thing none of the other two leaders do. It is
   * gone, and so is the morale, which was doing the Directive's job a district early. This is the
   * half a retune is most likely to leave behind: the points stop being added and the old
   * subtraction stays.
   */
  it('changes nothing on the sheet of whoever is sent against her', () => {
    const bare = stack(without, 'attacker', 'razors').effective;
    const sent = stack(withHim, 'attacker', 'razors').effective;
    expect(sent.armor).toBe(bare.armor);
    expect(sent.morale).toBe(bare.morale);
    expect(sent.penetration).toBe(bare.penetration);
    expect(sent.reasons).not.toContain('The Syndic');
  });

  /** And her own line keeps the morale it brought: the ceiling is the Directive's, not hers. */
  it('leaves her own units the morale their sheets give them', () => {
    const bare = stack(without, 'defender', 'greycoat').effective;
    const backed = stack(withHim, 'defender', 'greycoat').effective;
    expect(backed.morale).toBe(bare.morale);
  });

  /**
   * The ceiling, on a defence no district actually fields (maintainer's rule, 2026-09-15).
   *
   * A rating is 0..100 whatever adds to it, and `applyPresence` is a path that adds to two of
   * them. Measured on the shipped sheets, nothing the Combine stands anywhere can reach it: the
   * heaviest thing in the Annexes is a Street Enforcer at 30 armour and 30 penetration, so +25
   * lands at 55 and the cap never fires in a real fight. That is exactly why it needs a test of
   * its own rather than a `Math.min` folded into an assertion about the addition, which would
   * pass on an engine that had no ceiling at all.
   *
   * The defence here is two sheets picked for being over the line once her points are on them,
   * and the two `toBeGreaterThan` controls are what make that a measurement rather than a claim.
   */
  it('holds her points inside the 0..100 a rating has', () => {
    const over = { the_colossus: 1, the_loose_end: 1 };
    const bare = fight({ razors: 10 }, over, undefined);
    const backed = fight({ razors: 10 }, over, SYNDIC);
    const plate = stack(bare, 'defender', 'the_colossus').effective.armor;
    const point = stack(bare, 'defender', 'the_loose_end').effective.penetration;
    expect(plate + SYNDIC_ARMOR, 'nothing to cap').toBeGreaterThan(MAX_RATING);
    expect(point + SYNDIC_PENETRATION, 'nothing to cap').toBeGreaterThan(MAX_RATING);
    expect(stack(backed, 'defender', 'the_colossus').effective.armor).toBe(MAX_RATING);
    expect(stack(backed, 'defender', 'the_loose_end').effective.penetration).toBe(MAX_RATING);
  });

  /**
   * A sweep rather than one seed, and a matchup on the edge on purpose.
   *
   * Re-measured on these exact seeds after the 2026-09-20 retune, 20 Greycoats holding against:
   *
   * | Razors | without her | with her |
   * | --- | --- | --- |
   * | 20 | 79 | 80 |
   * | 22 | 35 | 80 |
   * | 24 | 3 | 75 |
   * | 26 | 0 | 27 |
   *
   * 24 is the one to sweep, because it is the only row where **neither** end is against a rail: at
   * 22 she wins every seed and at 26 the bare defence loses every seed, so either of those would
   * pin a number that a further retune could move a long way without the assertion noticing.
   *
   * The band moved when the power did. The old +20 penetration, +20 morale and -20 attacker
   * armour was worth 16 seeds at 22 Razors; +25 penetration and +25 armour on her own line is
   * worth 72 at 24. That is the retune being a good deal larger than a swap of two numbers, which
   * is the thing worth writing down rather than the thing worth hiding behind a `toBeGreaterThan`.
   */
  it('is worth something to the defence, not only to the sheet', () => {
    const holds = (presence: CombinePower | undefined) =>
      Array.from({ length: 80 }, (_, i) =>
        fight({ razors: 24 }, { greycoat: 20 }, presence, `syndic-sweep-${i}`),
      ).filter((sim) => sim.winner === 'defender').length;
    const bare = holds(undefined);
    const backed = holds(SYNDIC);
    expect(backed).toBeGreaterThan(bare);
    expect(backed - bare).toBeGreaterThanOrEqual(8);
  });

  it('reaches every Combine stack in the fight, not the one he is standing in', () => {
    // He is not even on the field here: the power is the district's, his body is one plot's.
    const sim = fight({ razors: 30 }, { greycoat: 10, street_enforcers: 5 }, SYNDIC);
    for (const one of sim.defender.stacks) expect(one.effective.reasons).toContain('The Syndic');
    expect(sim.defender.stacks.some((one) => one.unit.id === 'syndic')).toBe(false);
  });
});

describe('the Executioner', () => {
  /*
   * Several stacks and several seeds, because his line is a tenth of a life: on one stack over
   * four rounds it comes up on roughly half the seeds (measured 2026-09-20: one execution on three
   * of six seeds, none on the other three), and a single-seed assertion here would be a coin.
   */
  const line = { razors: 30, scrapers: 20, ghosts: 10, sluggers: 10 };
  const garrison = { street_enforcers: 15, greycoat: 20 };
  const seeds = Array.from({ length: 12 }, (_, i) => `executioner-${i}`);
  const without = seeds.map((seed) => fight(line, garrison, undefined, seed));
  const withHim = seeds.map((seed) => fight(line, garrison, EXECUTIONER, seed));

  it('finishes what an exchange leaves under the line, and counts it', () => {
    expect(without.every((sim) => sim.executed === 0)).toBe(true);
    const finished = withHim.reduce((n, sim) => n + sim.executed, 0);
    expect(finished).toBeGreaterThan(3);
  });

  it('never leaves a wounded front unit under the threshold standing on the enemy side', () => {
    for (const sim of withHim) {
      for (const one of sim.attacker.stacks) {
        if (one.alive <= 0) continue;
        const wounded = one.pool - (one.alive - 1) * one.effective.vitality;
        // A whole body at the front (wounded == vitality) or one at or above the line.
        expect(wounded, one.unit.id).toBeGreaterThanOrEqual(
          one.effective.vitality * EXECUTIONER_THRESHOLD,
        );
      }
    }
  });

  /**
   * The rule itself, on the maintainer's own worked example (2026-09-21).
   *
   * Ten bodies of 10 hp, a line at 20%, 20 damage: the first body is finished after 8 (it reaches
   * 2), the second after another 8, and the last 4 leave the third at 6. The stack has 76 left,
   * not 80, because what a finished body had left under the line is forfeited rather than spent
   * or carried. Without him the same 20 damage is 20 damage.
   */
  it('finishes a body the moment it reaches his line, and forfeits what it had left', () => {
    const bodies = new Array<number>(10).fill(10);
    expect(takeDamage(bodies, 20, 10, 0.2)).toEqual({ fell: 2, executed: 2 });
    expect(bodies).toEqual([6, 10, 10, 10, 10, 10, 10, 10]);
    expect(bodies.reduce((a, b) => a + b, 0)).toBe(76);

    const plain = new Array<number>(10).fill(10);
    expect(takeDamage(plain, 20, 10)).toEqual({ fell: 2, executed: 0 });
    expect(plain.reduce((a, b) => a + b, 0)).toBe(80);

    // A body brought exactly to the line is on it. Overkill past the last body is lost either way.
    const exact = [10, 10];
    expect(takeDamage(exact, 8, 10, 0.2)).toEqual({ fell: 1, executed: 1 });
    expect(exact).toEqual([10]);
    const two = [10, 10];
    expect(takeDamage(two, 500, 10, 0.2).fell).toBe(2);
    expect(two).toEqual([]);
  });

  it('costs the attacker bodies it would otherwise have kept', () => {
    const standing = (sims: ReturnType<typeof simulate>[]) =>
      sims.reduce((n, sim) => n + sim.attacker.stacks.reduce((m, one) => m + one.alive, 0), 0);
    expect(standing(withHim)).toBeLessThan(standing(without));
  });
});

describe('Directive Xero', () => {
  // A loud attacker against a shaky line: 30 Juggernauts are 2250 of menace against the Levy's
  // 1200 of nerve, so without him §D3 silences the whole Levy up to the ceiling.
  const loud = { juggernauts: 30 };
  const shaky = { civic_levy: 40 };
  const without = fight(loud, shaky, undefined);
  const withHim = fight(loud, shaky, ZERO);

  it('stands his whole side at the morale ceiling, so nothing intimidates it', () => {
    for (const one of withHim.defender.stacks.filter((s) => s.turncoat !== true)) {
      expect(one.effective.morale).toBe(DIRECTIVE_XERO_MORALE);
      expect(one.effective.reasons).toContain('Directive Xero');
    }
    expect(withHim.intimidated.defender).toBe(0);
    // The control: the same line without him is intimidated, or the assertion above is free.
    expect(without.intimidated.defender).toBeGreaterThan(0);
  });

  it('turns the attackers §D3 would have intimidated, instead of intimidating them', () => {
    // A timid attacker against his menace, so §D3 has somebody to name: 20 Razors are 800 of
    // nerve against 1440 from thirty Suppressors and him.
    const timid = { razors: 20 };
    const menacing = { suppressor: 30, directive_xero: 1 };
    const plain = fight(timid, menacing, undefined);
    const turned = fight(timid, menacing, ZERO);
    expect(plain.intimidated.attacker).toBeGreaterThan(0);
    // The same men, counted once. He recruits them instead of silencing them, so the intimidated figure
    // is nought and the crossing carries the number: reporting both told a crew of twenty that
    // thirty of its units had been affected (fixed 2026-09-20).
    expect(turned.intimidated.attacker).toBe(0);
    const crossed = Object.values(turned.turned).reduce((n, count) => n + count, 0);
    expect(crossed).toBe(plain.intimidated.attacker);
    // Nobody stands silenced on the attacker's side: they crossed rather than sat down.
    expect(turned.attacker.stacks.every((one) => one.suppressed === 0)).toBe(true);
    // ...and they are on his side, flagged, at his morale, still Razors.
    const turncoats = turned.defender.stacks.filter((one) => one.turncoat === true);
    expect(turncoats.length).toBeGreaterThan(0);
    for (const one of turncoats) {
      expect(one.unit.id).toBe('razors');
      expect(one.morale).toBe(DIRECTIVE_XERO_MORALE);
      expect(one.effective.reasons).toContain('Changed sides');
    }
    expect(turned.turned).toEqual({ razors: crossed });
  });

  it('keeps the §D3 ceiling: a quarter of the line always stays yours', () => {
    const timid = { razors: 20 };
    const menacing = { suppressor: 30, directive_xero: 1 };
    const sim = fight(timid, menacing, ZERO);
    const crossed = Object.values(sim.turned).reduce((n, count) => n + count, 0);
    // The budget (640 over 40 a head) would take 16; the ceiling takes 15.
    expect(crossed).toBe(Math.floor(20 * MAX_INTIMIDATED_SHARE));
  });

  it('reports the turncoats still standing at the end, separately from the turned', () => {
    const sim = fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, ZERO);
    const crossed = Object.values(sim.turned).reduce((n, count) => n + count, 0);
    const standing = Object.values(sim.turnedAlive).reduce((n, count) => n + count, 0);
    expect(standing).toBeLessThanOrEqual(crossed);
    expect(standing).toBe(
      sim.defender.stacks
        .filter((one) => one.turncoat === true)
        .reduce((n, one) => n + one.alive, 0),
    );
  });

  it('takes the turncoats off the attacker before the casualty arithmetic sees them', () => {
    const sim = fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, ZERO);
    const crossed = Object.values(sim.turned).reduce((n, count) => n + count, 0);
    const razors = stack(sim, 'attacker', 'razors');
    // `started` is the denominator for every casualty figure, and the crossed are not in it.
    expect(razors.started).toBe(20 - crossed);
  });
});

describe('the outcome the settle reads', () => {
  const engine = defaultSkirmishEngine;
  const input = {
    seed: 'combine-outcome',
    attackerName: 'Crew',
    defenderName: 'The Combine',
    locationName: 'The Chosen Chapel',
    attacking: { razors: 20 },
    defending: { suppressor: 30, directive_xero: 1 },
  };

  it('carries the turned, the standing turncoats and the executions on the wire', () => {
    const outcome = engine.resolve({ ...input, defenderPresence: ZERO });
    const crossed = Object.values(outcome.turned).reduce((n, count) => n + count, 0);
    expect(crossed).toBeGreaterThan(0);
    expect(outcome.executed).toBe(0);
    const bare = engine.resolve(input);
    expect(bare.turned).toEqual({});
    expect(bare.turnedAlive).toEqual({});
  });

  it('settles a turncoat as nobody: not fled, not killed, not a winner loss', () => {
    const outcome = engine.resolve({ ...input, defenderPresence: ZERO });
    const crossed = Object.values(outcome.turned).reduce((n, count) => n + count, 0);
    const accounted =
      (outcome.fled['razors'] ?? 0) +
      (outcome.killed['razors'] ?? 0) +
      (outcome.winnerLosses['razors'] ?? 0) +
      (outcome.turnedAlive['razors'] ?? 0);
    // Every Razor is one of: home, dead, a winner's loss, or a turncoat still standing, plus the
    // turncoats who died on his side, who are none of those. So the four accounted ledgers plus
    // the turncoat dead equal the twenty that marched.
    const turncoatDead = crossed - (outcome.turnedAlive['razors'] ?? 0);
    expect(accounted + turncoatDead).toBe(20);
  });
});

/**
 * What the report tells a crew that met him (found by a bug sweep, 2026-09-20).
 *
 * Two figures were wrong at once, and both were wrong in the direction that makes a player
 * distrust the whole card. The men who crossed were reported as intimidated **as well as** turned, so a
 * force of twenty came back with thirty units accounted for; and `changeOfHeart` takes the
 * turncoats off their stack's `started`, which is right for the casualty ledger and wrong for
 * "what I sent", so the same crew was told it had committed five.
 */
describe('what the report says about a fight he was over', () => {
  const outcome = defaultSkirmishEngine.resolve({
    seed: 'report-truth',
    attackerName: 'Crew',
    defenderName: 'The Combine',
    locationName: 'The Chosen Chapel',
    attacking: { razors: 20 },
    defending: { suppressor: 30, directive_xero: 1 },
    defenderPresence: ZERO,
  });
  const crossed = Object.values(outcome.turned).reduce((total, count) => total + count, 0);

  it('counts every body that marched, turncoats included', () => {
    expect(crossed).toBeGreaterThan(0);
    expect(outcome.analysis?.attacker.committed).toBe(20);
  });

  it('does not also call them intimidated: they fired, for him', () => {
    expect(outcome.analysis?.attacker.intimidated).toBe(0);
  });

  it('still reports an ordinary intimidated count when he is not over the ground', () => {
    const plain = defaultSkirmishEngine.resolve({
      seed: 'report-truth',
      attackerName: 'Crew',
      defenderName: 'The Combine',
      locationName: 'The Chosen Chapel',
      attacking: { razors: 20 },
      defending: { suppressor: 30, directive_xero: 1 },
    });
    // The same menace, and without him it is spent on silencing rather than on recruiting.
    expect(plain.analysis?.attacker.intimidated).toBe(crossed);
    expect(plain.turned).toEqual({});
    expect(plain.analysis?.attacker.committed).toBe(20);
  });
});

/**
 * Nothing a leader does ever lands on the people sent against him.
 *
 * Three separate claims, and only the first of them had a test. The Syndic's block above proves
 * her points stay on her own sheets; the other two powers had nothing saying the same thing, and
 * the shape of the omission is the one that survives a refactor: `applyPresence(defender, ...)`
 * with a second call bolted on beside it reads as a fix rather than as a break, and every
 * assertion about the *defence* keeps passing while it.
 *
 * `SkirmishInput` carries one presence and it is the defence's, so a wrong side cannot arrive
 * through the settler (`apps/server/src/battle/combine-presence.test.ts` measures that end). The
 * engine's own `SideSetup` has the field on both sides, which is the seam this block covers: a
 * power handed to the attacking side does nothing at all.
 */
describe('never the attacker', () => {
  const line = { razors: 30, sluggers: 10 };
  const garrison = { greycoat: 20, street_enforcers: 6 };

  const sheets = (sim: ReturnType<typeof simulate>, side: 'attacker' | 'defender') =>
    sim[side].stacks.map((one) => ({
      id: one.unit.id,
      turncoat: one.turncoat === true,
      ...one.effective,
    }));

  /**
   * A power on the attacking `SideSetup` changes nothing whatsoever.
   *
   * Compared as whole simulations rather than as a handful of fields: the failure worth catching
   * is a reading of `input.attacker.presence` folded in beside the defence's, and that one moves
   * the *defender's* sheets, which no assertion about the attacker would see.
   */
  it('ignores a power handed to the attacking side, whichever of the three it is', () => {
    for (const power of [SYNDIC, EXECUTIONER, ZERO]) {
      const bare = simulate({
        seed: 'wrong-side',
        battlefield: bareBattlefield(),
        attacker: { name: 'Crew', army: line, defending: false },
        defender: { name: 'The Combine', army: garrison, defending: true },
      });
      const armed = simulate({
        seed: 'wrong-side',
        battlefield: bareBattlefield(),
        attacker: { name: 'Crew', army: line, defending: false, presence: power },
        defender: { name: 'The Combine', army: garrison, defending: true },
      });
      expect(sheets(armed, 'attacker'), power.kind).toEqual(sheets(bare, 'attacker'));
      expect(sheets(armed, 'defender'), power.kind).toEqual(sheets(bare, 'defender'));
      expect(armed.winner, power.kind).toBe(bare.winner);
      expect(armed.executed, power.kind).toBe(bare.executed);
      expect(armed.turned, power.kind).toEqual(bare.turned);
      expect(armed.intimidated, power.kind).toEqual(bare.intimidated);
    }
  });

  /**
   * ...and the defence's own power does not reach across the line either.
   *
   * The Syndic has this test already. Directive Xero is the one that needed it: his power is a
   * morale ceiling, and a second `applyPresence` call on the attacking side would stand the
   * *crew* at 100 morale and make them unshakeable, which is the opposite of what a legendary on
   * the other side is for. The Executioner changes no sheet at all, so his half of this is that
   * both sides' numbers are exactly the ones they brought.
   */
  it('leaves the sheets sent against him exactly as they marched', () => {
    const bare = fight(line, garrison, undefined, 'across-the-line');
    for (const power of [SYNDIC, EXECUTIONER, ZERO]) {
      const armed = fight(line, garrison, power, 'across-the-line');
      expect(sheets(armed, 'attacker'), power.kind).toEqual(sheets(bare, 'attacker'));
      for (const one of armed.attacker.stacks) {
        expect(one.effective.reasons, power.kind).not.toContain('The Syndic');
        expect(one.effective.reasons, power.kind).not.toContain('Directive Xero');
      }
    }
  });

  /**
   * The Executioner costs the attacker bodies and the Combine none.
   *
   * "None" is read off `executedForce`, which names every body finished on his line by unit id:
   * every one has to be a unit the crew brought, and none a unit the regime fields. That is the
   * direct reading of the refactor this guards against, his line being handed to the defence, and
   * it is the one that still holds now that his rule runs inside the damage walk. The old reading,
   * that the Combine's own casualty count is unchanged by him, does not: measured 2026-09-21, the
   * garrison loses 262 bodies under him against 248 bare on these seeds, because a defence that
   * reads the enemy's losses as its own good news holds longer and bleeds longer for it.
   */
  it('costs the attacker bodies and the Combine none', () => {
    const heavy = { razors: 30, scrapers: 20, ghosts: 10, sluggers: 10 };
    const blacksite = { street_enforcers: 15, greycoat: 20 };
    const seeds = Array.from({ length: 12 }, (_, i) => `executioner-${i}`);
    const run = (presence: CombinePower | undefined) =>
      seeds.map((seed) => fight(heavy, blacksite, presence, seed));
    const bodies = (sims: ReturnType<typeof simulate>[], side: 'attacker' | 'defender') =>
      sims.reduce(
        (total, sim) =>
          total + sim[side].stacks.reduce((sum, one) => sum + (one.started - one.alive), 0),
        0,
      );
    const bare = run(undefined);
    const withHim = run(EXECUTIONER);
    expect(
      withHim.reduce((n, sim) => n + sim.executed, 0),
      'nothing to measure',
    ).toBeGreaterThan(3);
    expect(bodies(withHim, 'attacker')).toBeGreaterThan(bodies(bare, 'attacker'));
    for (const sim of withHim) {
      for (const unitId of Object.keys(sim.executedForce)) {
        expect(unitId in heavy, `${unitId} is not the crew's`).toBe(true);
        expect(unitId in blacksite, `${unitId} is the Combine's`).toBe(false);
      }
    }
  });

  /** Directive Xero's crossing runs one way: his side never loses anybody to the crew. */
  it('turns the attacker and never his own line', () => {
    const sim = fight({ razors: 20 }, { suppressor: 30, directive_xero: 1 }, ZERO, 'one-way');
    const crossed = Object.values(sim.turned).reduce((total, count) => total + count, 0);
    expect(crossed, 'nothing to measure').toBeGreaterThan(0);
    expect(sim.attacker.stacks.some((one) => one.turncoat === true)).toBe(false);
    // Every Combine sheet that marched is still counted on the Combine's books.
    for (const one of sim.defender.stacks.filter((stack) => stack.turncoat !== true)) {
      expect(one.effective.reasons).not.toContain('Changed sides');
    }
  });
});

describe('the leaders, on the map', () => {
  it('stands each one on a Combine plot in his own district, and one line names his power', () => {
    for (const leader of COMBINE_LEADERS) {
      expect(findUnit(leader.unitId)?.faction).toBe('combine');
      expect(findUnit(leader.unitId)?.tier).toBe('legendary');
      expect(leader.locationId.startsWith(leader.districtId)).toBe(true);
      expect(leader.powerLine.length).toBeGreaterThan(40);
    }
  });

  it('is alive while he stands in a Combine garrison on his plot, and not otherwise', () => {
    const [syndic] = COMBINE_LEADERS;
    if (!syndic) throw new Error('no leaders');
    const row = (
      holder: string,
      garrison: Record<string, number>,
      locationId = syndic.locationId,
    ) => ({
      locationId,
      holder: { kind: holder },
      garrison,
    });
    expect(combineLeaderAlive(syndic, [row('government', { syndic: 1, greycoat: 4 })])).toBe(true);
    // Killed: the plot changed hands.
    expect(combineLeaderAlive(syndic, [row('crew', { razors: 5 })])).toBe(false);
    // The Combine holds the plot but he is not on it.
    expect(combineLeaderAlive(syndic, [row('government', { greycoat: 4 })])).toBe(false);
    // He is on some other plot: not his, so not alive as its leader.
    expect(combineLeaderAlive(syndic, [row('government', { syndic: 1 }, 'elsewhere')])).toBe(false);
    expect(combineLeaderAlive(syndic, [])).toBe(false);
  });

  it('casts his shadow over the whole district only while he lives', () => {
    const [syndic] = COMBINE_LEADERS;
    if (!syndic) throw new Error('no leaders');
    const alive = [
      { locationId: syndic.locationId, holder: { kind: 'government' }, garrison: { syndic: 1 } },
    ];
    expect(combinePresenceOver(syndic.districtId, alive)?.unitId).toBe('syndic');
    expect(combinePresenceOver(syndic.districtId, [])).toBeUndefined();
    expect(combinePresenceOver('neon-docks', alive)).toBeUndefined();
  });

  it('never musters or garrisons a leader off his plot: the tables only deal in the regiment', () => {
    for (const difficulty of [1, 2, 4, 6, 8, 10]) {
      for (const slots of [2, 5, 15, 40, 110]) {
        const line = combineGarrison(difficulty, slots);
        const faces = Object.keys(line);
        expect(faces.some((id) => COMBINE_LEADERS.some((l) => l.unitId === id))).toBe(false);
        expect(faces.every((id) => findUnit(id)?.faction === 'combine')).toBe(true);
        expect(faces.length).toBeGreaterThan(0);
        // The budget is in unit slots, and it is spent: within a body of the cheapest sheet on
        // the list, because whole bodies cannot hit every figure exactly.
        const spent = Object.entries(line).reduce(
          (total, [id, count]) => total + count * (findUnit(id)?.unitSlots ?? 1),
          0,
        );
        expect(spent, `${difficulty} at ${slots} slots`).toBeGreaterThanOrEqual(Math.min(slots, 2));
        expect(spent, `${difficulty} at ${slots} slots`).toBeLessThanOrEqual(slots + 8);
      }
    }
  });

  /**
   * The budget itself, which is the number the whole ladder rests on.
   *
   * Pinned by hand against a `baseDefense` of 5, because a test that recomputed the formula would
   * pass on any formula at all. The figures are the measured ones behind the 2026-09-20 retune:
   * a first crew of eight Razors takes the Docks, twelve are wanted for the Steelbelt and twenty
   * for the Glasshouse Fields.
   */
  it('climbs the slot budget steeply enough that the top of the map is a wall', () => {
    const at = (difficulty: number) => combineSlotBudget(difficulty, 5);
    expect([1, 2, 3, 6, 8, 10].map(at)).toEqual([10, 15, 22, 54, 83, 118]);
    // Strictly climbing, all the way up, so no district is ever easier than a shallower one.
    for (let d = 2; d <= 10; d += 1) expect(at(d), `${d}`).toBeGreaterThan(at(d - 1));
  });
});

describe('§D3 itself, after the refactor', () => {
  it('still silences cheapest first, within the budget and the ceiling', () => {
    const sim = fight({ razors: 20 }, { civic_levy: 30, greycoat: 10 }, undefined);
    // The plan is deterministic from the opening rosters, so re-running it on the built side is a
    // pure function of the numbers already there.
    const defender = { ...sim.defender, stacks: sim.defender.stacks.map((s) => ({ ...s })) };
    for (const s of defender.stacks) s.suppressed = 0;
    const silenced = intimidate(defender, menace(sim.attacker));
    const budget = Math.max(0, menace(sim.attacker) - nerve(defender));
    const ceiling = Math.floor(
      defender.stacks.reduce((n, s) => n + s.alive, 0) * MAX_INTIMIDATED_SHARE,
    );
    expect(silenced).toBeLessThanOrEqual(ceiling);
    const spent = defender.stacks.reduce((n, s) => n + s.suppressed * s.effective.morale, 0);
    expect(spent).toBeLessThanOrEqual(budget);
    // The Levy (lower morale) is taken before the Greycoats.
    const levy = defender.stacks.find((s) => s.unit.id === 'civic_levy');
    const grey = defender.stacks.find((s) => s.unit.id === 'greycoat');
    if (levy && grey && grey.suppressed > 0) expect(levy.suppressed).toBe(levy.alive);
  });
});
