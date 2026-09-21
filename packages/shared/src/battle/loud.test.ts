import { describe, expect, it } from 'vitest';
import { bareBattlefield } from './battlefield.js';
import {
  LOUD_NOISE_TIER,
  fieldExposure,
  loudTierFor,
  noiseOnEnemy,
  simulate,
  type SideState,
  type Simulation,
  type Stack,
} from './engine.js';
import { findUnit, findUnitModification, type Army } from '../units/index.js';

/**
 * §A5: the Anodics make the *round* noisy, for the people actually fighting them.
 *
 * "Make it so that the engine can apply effects for a round only if certain units participate,
 * because I want to make this a mechanic for other units too. So Anodics make the round noisy but
 * not the whole battlefield for everyone, e.g. a stack that is not fighting Anodics."
 *
 * The first cut put the label on the copy of the battlefield each side was built against, once,
 * for the whole fight. Three things were wrong with that and this file is organised around them:
 *
 * 1. It reached a stack that never traded a shot with an Anodic.
 * 2. It went on reaching it after every Anodic was dead.
 * 3. Baked into `effective` at build time, it could not move as the fight moved.
 *
 * What replaced it is general machinery (`fieldExposure`, `noiseOnEnemy`) with `loud` as its
 * first user, because the maintainer intends more units to use it.
 */

const ANODICS = findUnit('anodics');
const RAZORS = findUnit('razors');
const DOGS = findUnit('cyber_dogs');

const fight = (attacking: Army, defending: Army, seed: string): Simulation =>
  simulate({
    seed,
    battlefield: bareBattlefield(),
    attacker: { name: 'A', army: attacking, defending: false },
    defender: { name: 'D', army: defending, defending: true },
  });

const stackOf = (side: SideState, unitId: string): Stack => {
  const found = side.stacks.find((stack) => stack.unit.id === unitId);
  if (!found) throw new Error(`no ${unitId} on this side`);
  return found;
};

/** A side, back at full strength, so a measurement is about the rule and not about casualties. */
const fresh = (side: SideState): SideState => ({
  ...side,
  stacks: side.stacks.map((stack) => ({ ...stack, alive: stack.started, brokeAt: null })),
});

describe('who is producing the effect', () => {
  it('is the Anodics and nobody else, at the tier the card says', () => {
    expect(ANODICS?.loud).toBe(true);
    expect(RAZORS?.loud).toBeUndefined();
    expect(LOUD_NOISE_TIER).toBe(2);
  });

  it('is nothing at all on a side that brought none of them', () => {
    const plain = fight({ razors: 20 }, { cyber_dogs: 20 }, 'loud-none');
    expect(noiseOnEnemy(fresh(plain.attacker), fresh(plain.defender)).size).toBe(0);
  });
});

/**
 * The scoping the maintainer asked for, and the reason it is a *share* rather than a flag.
 *
 * Every stack spreads its fire across every live enemy stack (`allocate`), so this engine has no
 * binary "these two are engaged" to key off, and inventing one would be a second targeting model
 * running beside the first. Exposure is the fraction of the fire coming at a stack that comes
 * from the units making the noise, which is the same weighting the damage loop already spends.
 */
describe('who hears it', () => {
  it('gives a stack facing nothing but Anodics the full racket', () => {
    const only = fight({ anodics: 20 }, { cyber_dogs: 20 }, 'loud-solo');
    const defenders = fresh(only.defender);
    const exposure = fieldExposure(fresh(only.attacker), defenders);
    expect(exposure.get(stackOf(defenders, 'cyber_dogs'))).toBeCloseTo(1, 6);
  });

  it('gives a stack fighting a mostly-quiet line proportionally less of it', () => {
    // A few Anodics in a line that is mostly Razors: the enemy is taking most of its fire from
    // people making no noise at all, so it is only partly in it. This is the assertion the old
    // battlefield-wide version could not pass.
    const mixed = fight({ anodics: 4, razors: 40 }, { cyber_dogs: 20 }, 'loud-mixed');
    const defenders = fresh(mixed.defender);
    const heard = fieldExposure(fresh(mixed.attacker), defenders).get(
      stackOf(defenders, 'cyber_dogs'),
    );
    expect(heard).toBeGreaterThan(0);
    expect(heard, 'a mostly-quiet line still delivered the whole racket').toBeLessThan(0.5);
  });

  it('stops the moment the last of them is down, which is the counterplay', () => {
    const only = fight({ anodics: 20 }, { cyber_dogs: 20 }, 'loud-dead');
    const side = fresh(only.attacker);
    const dead: SideState = {
      ...side,
      stacks: side.stacks.map((stack) =>
        stack.unit.loud === true ? { ...stack, alive: 0 } : stack,
      ),
    };
    expect(noiseOnEnemy(side, fresh(only.defender)).size).toBeGreaterThan(0);
    expect(noiseOnEnemy(dead, fresh(only.defender)).size).toBe(0);
  });

  it('stops for a stack that has broken and left the fight', () => {
    const only = fight({ anodics: 20 }, { cyber_dogs: 20 }, 'loud-broke');
    const side = fresh(only.attacker);
    const routed: SideState = {
      ...side,
      stacks: side.stacks.map((stack) =>
        stack.unit.loud === true ? { ...stack, brokeAt: 2 } : stack,
      ),
    };
    expect(noiseOnEnemy(routed, fresh(only.defender)).size).toBe(0);
  });
});

describe('what it is worth to the one it lands on', () => {
  it('costs each sheet what the noise is worth to that sheet, not one flat figure', () => {
    const mix = fight({ anodics: 20 }, { cyber_dogs: 10, razors: 10 }, 'loud-worth');
    const side = fresh(mix.defender);
    const noise = noiseOnEnemy(fresh(mix.attacker), side);
    const dogs = noise.get(stackOf(side, 'cyber_dogs'))?.percent ?? 0;
    const razors = noise.get(stackOf(side, 'razors'))?.percent ?? 0;
    // A dog that hunts by ear (`affinities.noisy: -7` a tier) suffers more than a Razor with a
    // knife. This is the whole reason the rule is a label read through each sheet.
    expect(dogs).toBeGreaterThan(razors);
    expect(DOGS?.affinities?.noisy ?? 0).toBeLessThan(0);
  });

  /**
   * A sheet that *likes* noise is left alone entirely, and this is asserted on the size of the
   * map rather than on what is in it.
   *
   * The first cut of this test walked `noise.values()` and checked each was positive, which is
   * vacuous when the map is empty: it passed with the guard deleted. Measured to make the case
   * real: `labelEffectPercent` puts an Anodic at **+26** at Noisy II, so without the guard an
   * enemy Anodic would have taken a 26-point penalty for enjoying itself.
   */
  it('leaves a sheet that likes noise out of it entirely', () => {
    const mirror = fight({ anodics: 20 }, { anodics: 20 }, 'loud-mirror');
    const defenders = fresh(mirror.defender);
    // They are being shot at, so they are engaged: this is the guard and not a missing exposure.
    expect(
      fieldExposure(fresh(mirror.attacker), defenders).get(stackOf(defenders, 'anodics')),
    ).toBeGreaterThan(0);
    expect(noiseOnEnemy(fresh(mirror.attacker), defenders).size).toBe(0);
    expect(ANODICS?.affinities?.noisy ?? 0).toBeGreaterThan(0);
  });
});

describe('the Stereo Rig', () => {
  it('takes the racket from Noisy II to Noisy IV and fits nobody else', () => {
    const card = findUnitModification('stereo_rig');
    expect(card?.noiseTier).toBe(4);
    expect(card?.fits).toEqual(['anodics']);
    expect(loudTierFor([])).toBe(LOUD_NOISE_TIER);
    expect(loudTierFor(['stereo_rig'])).toBe(4);
  });

  it('is a ceiling rather than a sum, so two of them are not eight tiers', () => {
    expect(loudTierFor(['stereo_rig', 'stereo_rig'])).toBe(4);
  });

  it('makes the noise measurably worse for the people standing in it', () => {
    const at = (upgrades: Record<string, string[]> | undefined) => {
      const sim = simulate({
        seed: 'loud-rig',
        battlefield: bareBattlefield(),
        attacker: {
          name: 'A',
          army: { anodics: 20 },
          defending: false,
          ...(upgrades ? { upgrades } : {}),
        },
        defender: { name: 'D', army: { cyber_dogs: 20 }, defending: true },
      });
      const side = fresh(sim.defender);
      return noiseOnEnemy(fresh(sim.attacker), side).get(stackOf(side, 'cyber_dogs'))?.percent ?? 0;
    };
    expect(at({ anodics: ['stereo_rig'] })).toBeGreaterThan(at(undefined));
  });
});

describe('what it does to a fight', () => {
  it('kills more of an ear-hunting enemy than the same force without the rule', () => {
    const lost = (side: SideState) =>
      side.stacks.reduce((total, stack) => total + (stack.started - stack.alive), 0);
    const sheet = ANODICS as unknown as Record<string, boolean | undefined>;
    const loud = fight({ anodics: 24 }, { cyber_dogs: 18 }, 'loud-fight');
    const had = sheet['loud'];
    delete sheet['loud'];
    let quiet: Simulation;
    try {
      quiet = fight({ anodics: 24 }, { cyber_dogs: 18 }, 'loud-fight');
    } finally {
      sheet['loud'] = had;
    }
    expect(lost(loud.defender)).toBeGreaterThan(lost(quiet.defender));
  });
});
