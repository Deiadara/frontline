import { describe, expect, it } from 'vitest';
import { UNIT_CATALOG, type UnitSpec } from '../units/index.js';
import { bareBattlefield, battlefieldFor, type Battlefield } from './battlefield.js';
import { simulate } from './engine.js';

/**
 * Whether the roster is a **web** or a **ladder**.
 *
 * Every other test in this directory checks a rule. This one checks the content the rules produce,
 * by playing every non-unique unit against every other at equal supply and reading the result as a
 * graph. Two things have to be true of that graph, and neither is guaranteed by any amount of
 * correct arithmetic:
 *
 * - **Nothing is unbeatable.** A unit that wins every matchup is not a strong unit, it is the end
 *   of the decision: everyone builds it and the roster collapses to one row.
 * - **The graph has cycles.** A ↠ B ↠ C ↠ A is what "some counter others" *means*. Without a cycle
 *   the roster is a power ranking with extra steps, however many resistances are written on it.
 *
 * This is also the harness that found the real bug in the armour curve: 0 A.D.'s per-point falloff
 * on a 0-100 stat made the heavy tier untouchable, which showed up here as a unit at 21 of 21 and
 * nowhere else.
 *
 * Unique units are excluded. They are one-of-a-kind by design and a fight of sixty Colossi is not a
 * matchup anybody can have.
 */

/** Supply spent per side. Equal supply is the only fair way to compare a Razor with a Juggernaut. */
const SUPPLY_BUDGET = 60;

/** Seeds per pairing, per ground. Enough to settle a coin flip, few enough to stay quick. */
const RUNS = 3;

/**
 * The ground the roster is judged on, and it is deliberately not one kind.
 *
 * This ran on `bareBattlefield()` alone, which is a car park: `open_ground` is the only context it
 * ever supplies, so `urban`, `indoor`, `dark`, `underground` and `vs_structure` could not fire for
 * anybody. A third of the roster's modifiers were therefore unreachable *by construction*, and the
 * units carrying them read as weak sheets rather than as situational ones. A Demolisher whose
 * `breaching` never applies is not a Demolisher, and it made the whole graph below a statement
 * about one location.
 *
 * Nine grounds, chosen to cover every context at least once, with one fortified so that
 * `vs_structure` has somewhere to happen.
 */
const GROUNDS: Battlefield[] = [
  bareBattlefield(),
  ...(
    [
      ['sewer_junction', 0],
      ['foundry', 0],
      ['barricade', 3],
      ['high_ground', 0],
      ['tavern', 0],
      ['war_machine_graveyard', 0],
      ['black_clinic', 2],
      ['rail_yard', 0],
    ] as const
  ).map(([kind, fortifyLevel]) =>
    battlefieldFor({
      locationName: kind,
      kind,
      fortifyDifficulty: 'medium',
      fortifyLevel,
      at: new Date('2026-08-20T12:00:00.000Z'),
      weather: 'normal',
    }),
  ),
];

const ROSTER: UnitSpec[] = UNIT_CATALOG.filter((unit) => !unit.unique);

function beatsGraph(): Map<string, Set<string>> {
  const beats = new Map<string, Set<string>>(ROSTER.map((unit) => [unit.id, new Set<string>()]));
  for (const attacker of ROSTER) {
    for (const defender of ROSTER) {
      if (attacker.id === defender.id) continue;
      let wins = 0;
      let runs = 0;
      for (const battlefield of GROUNDS) {
        for (let seed = 0; seed < RUNS; seed += 1) {
          const simulation = simulate({
            seed: `balance-${attacker.id}-${defender.id}-${battlefield.locationName}-${seed}`,
            battlefield,
            attacker: {
              name: 'A',
              army: { [attacker.id]: Math.max(1, Math.floor(SUPPLY_BUDGET / attacker.supply)) },
              defending: false,
            },
            defender: {
              name: 'D',
              army: { [defender.id]: Math.max(1, Math.floor(SUPPLY_BUDGET / defender.supply)) },
              defending: true,
            },
          });
          runs += 1;
          if (simulation.winner === 'attacker') wins += 1;
        }
      }
      if (wins * 2 > runs) beats.get(attacker.id)!.add(defender.id);
    }
  }
  return beats;
}

const BEATS = beatsGraph();

describe('the roster is a web, not a ladder', () => {
  it('leaves every unit something that beats it', () => {
    const unbeaten = ROSTER.filter((unit) =>
      ROSTER.every((other) => other.id === unit.id || !BEATS.get(other.id)!.has(unit.id)),
    );
    expect(unbeaten.map((unit) => unit.id)).toEqual([]);
  });

  it('has counter cycles in it', () => {
    const cycles: string[] = [];
    for (const a of ROSTER) {
      for (const b of BEATS.get(a.id)!) {
        for (const c of BEATS.get(b)!) {
          if (c !== a.id && BEATS.get(c)!.has(a.id)) cycles.push(`${a.id}→${b}→${c}→${a.id}`);
        }
      }
    }
    expect(cycles.length, 'a roster with no cycle is a power ranking').toBeGreaterThan(4);
  });

  /**
   * A support unit is allowed to lose every straight fight: a Stitcher's whole job is to be
   * somewhere else on the field. What is not allowed is a unit that *wins* every one.
   */
  it('has no unit that beats the entire roster', () => {
    for (const unit of ROSTER) {
      expect(BEATS.get(unit.id)!.size, `${unit.id} beats everything`).toBeLessThan(
        ROSTER.length - 1,
      );
    }
  });

  it('rewards the tier ladder without making it the only thing that matters', () => {
    const wins = (tier: string) => {
      const inTier = ROSTER.filter((unit) => unit.tier === tier);
      return inTier.reduce((total, unit) => total + BEATS.get(unit.id)!.size, 0) / inTier.length;
    };
    // Heavier units are better at the same supply. They are gated behind campaigns, not price.
    expect(wins('heavy')).toBeGreaterThan(wins('rabble'));
    // ...but not so much better that the lower tiers stop beating anything.
    expect(wins('rabble')).toBeGreaterThan(2);
  });
});

/**
 * The ladder the roster actually claims, measured instead of asserted.
 *
 * `UNIT_CATALOG`'s module note states it plainly: a unit is balanced against its **requirement
 * list**, not against its price or its supply, because "a unit roster is a readout of a campaign".
 * That is a testable claim. Weight each clause the way `economy/infamy.test.ts` weights it to price
 * a kill, then ask how well the ranking by gate depth predicts the ranking by result.
 *
 * It was 0.56 before the balance pass and is 0.82 after it, with the count of "a gate at least ten
 * deeper that loses anyway" down from 37 to 6. The floors below sit under those numbers with room
 * for seed noise, so ordinary tuning stays free and a change that quietly undoes the pass does not.
 */
describe('strength tracks what a unit cost you to be able to field', () => {
  /** Holding ground is a campaign; a fitted modification is a research project. Same as §D7. */
  const LOCATION_WEIGHT = 12;
  const FITTED_WEIGHT = 8;
  const gateDepth = (unit: UnitSpec): number =>
    unit.requires.reduce(
      (total, need) =>
        total +
        (need.kind === 'building'
          ? need.level
          : need.kind === 'location'
            ? LOCATION_WEIGHT
            : FITTED_WEIGHT),
      0,
    );

  /** How many of the roster each unit beats, from the graph the file already built. */
  const score = new Map(ROSTER.map((unit) => [unit.id, BEATS.get(unit.id)!.size]));

  it('has a spread of gate depths to rank against, so this is not vacuous', () => {
    const depths = ROSTER.map(gateDepth);
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(20);
  });

  it('ranks by campaign roughly the way it ranks by result', () => {
    const rankOf = (by: (unit: UnitSpec) => number) => {
      const sorted = [...ROSTER].sort((a, b) => by(a) - by(b));
      return new Map(sorted.map((unit, index) => [unit.id, index]));
    };
    const byGate = rankOf(gateDepth);
    const byWins = rankOf((unit) => score.get(unit.id)!);
    const n = ROSTER.length;
    const d2 = ROSTER.reduce(
      (total, unit) => total + (byGate.get(unit.id)! - byWins.get(unit.id)!) ** 2,
      0,
    );
    const spearman = 1 - (6 * d2) / (n * (n * n - 1));
    expect(spearman, 'gate depth no longer predicts strength').toBeGreaterThan(0.65);
  });

  /**
   * A support unit is exempt, and only a support unit.
   *
   * A Stitcher is *supposed* to lose every straight fight: it has no damage and its whole mechanic
   * (`UnitSpec.mends`) lands on somebody else, so a round robin of one unit type against another
   * cannot see it at all. `battle/engine.test.ts` measures that one where it happens.
   */
  it('does not let a much shallower unit outrank a much deeper one, more than rarely', () => {
    const inversions: string[] = [];
    for (const deep of ROSTER) {
      if (deep.mends === true) continue;
      for (const easy of ROSTER) {
        if (gateDepth(deep) < gateDepth(easy) + 10) continue;
        if (score.get(deep.id)! >= score.get(easy.id)!) continue;
        inversions.push(
          `${deep.name} (gate ${gateDepth(deep)}) under ${easy.name} (gate ${gateDepth(easy)})`,
        );
      }
    }
    expect(inversions.length, inversions.join('; ')).toBeLessThanOrEqual(6);
  });
});
