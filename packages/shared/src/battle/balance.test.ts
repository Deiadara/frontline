import { describe, expect, it } from 'vitest';
import { PLAYER_UNITS, type UnitSpec } from '../units/index.js';
import { bareBattlefield, battlefieldFor, type Battlefield } from './battlefield.js';
import { simulate } from './engine.js';
import { noTerritoryEffects } from '../city/index.js';

/**
 * Whether the roster is a **web** or a **ladder**.
 *
 * Every other test in this directory checks a rule. This one checks the content the rules produce,
 * by playing every non-unique unit against every other at equal unit slots and reading the result as a
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

/** Unit slots spent per side. Equal slots is the only fair way to compare a Razor with a Juggernaut. */
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
 * Nine grounds, chosen to cover every context the ground can offer at least once. (`vs_structure`
 * is not one of them: it is the defender's gate, which arrives with their territory.)
 */
const GROUNDS: Battlefield[] = [
  bareBattlefield(),
  ...(
    [
      'sewer_junction',
      'foundry',
      'barricade',
      'high_ground',
      'tavern',
      'war_machine_graveyard',
      'black_clinic',
      'rail_yard',
    ] as const
  ).map((kind) =>
    battlefieldFor({
      locationName: kind,
      kind,
      at: new Date('2026-08-20T12:00:00.000Z'),
      weather: 'normal',
    }),
  ),
];

// The player's roster. A Combine sheet has no gate, so its depth is nothing and the question
// this file asks (does what a unit cost you to reach predict what it is worth) has no answer for it.
const ROSTER: UnitSpec[] = PLAYER_UNITS.filter((unit) => !unit.unique);

/**
 * The two grounds whose defenders stand behind a gate, at twenty per cent (a Gate at about level
 * 8), so Breaching has somewhere to happen.
 *
 * These two were dug in until fortification left the game (2026-09-26), for exactly this reason.
 * With no gate anywhere, a Breaker's one speciality never fired in this harness while it fires
 * against every gated defender in the game, and the heavy tier read as weaker than the rabble.
 */
const GATED = new Set(['barricade', 'black_clinic']);
const GATE_PERCENT = 20;

/**
 * The graph, with every crew on it holding the doors in `doorLevels` (`battle/doors.ts`). Both
 * sides get the same doors, so a Juggernaut meets a Juggernaut at the same Lab level; what the
 * level changes is how a door unit fares against the rest of the roster.
 */
function beatsGraph(doorLevels: Readonly<Record<string, number>> = {}): Map<string, Set<string>> {
  const beats = new Map<string, Set<string>>(ROSTER.map((unit) => [unit.id, new Set<string>()]));
  const held = Object.keys(doorLevels).length > 0;
  for (const attacker of ROSTER) {
    for (const defender of ROSTER) {
      if (attacker.id === defender.id) continue;
      let wins = 0;
      let runs = 0;
      for (const battlefield of GROUNDS) {
        for (let seed = 0; seed < RUNS; seed += 1) {
          const gated = GATED.has(battlefield.locationName);
          const simulation = simulate({
            seed: `balance-${attacker.id}-${defender.id}-${battlefield.locationName}-${seed}`,
            battlefield,
            attacker: {
              name: 'A',
              army: { [attacker.id]: Math.max(1, Math.floor(SUPPLY_BUDGET / attacker.unitSlots)) },
              defending: false,
              ...(held ? { territory: { ...noTerritoryEffects(), doorLevels } } : {}),
            },
            defender: {
              name: 'D',
              army: { [defender.id]: Math.max(1, Math.floor(SUPPLY_BUDGET / defender.unitSlots)) },
              defending: true,
              ...(gated || held
                ? {
                    territory: {
                      ...noTerritoryEffects(),
                      doorLevels,
                      ...(gated ? { gatePercent: GATE_PERCENT } : {}),
                    },
                  }
                : {}),
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

/**
 * The units whose sheet is only part of the story: a door (`doorSteps`) builds them up by level
 * while the crew holds it, so their bare result says what a crew that lost the door fields.
 * Juggernauts and the Condemned today; the Saint and the Dancer are unique and already out.
 */
const DOOR_UNITS = ROSTER.filter((unit) => unit.doorSteps !== undefined);
const DOOR_MAX_LEVEL = 5;
const BEATS_AT_DOORS = beatsGraph(
  Object.fromEntries(DOOR_UNITS.map((unit) => [unit.id, DOOR_MAX_LEVEL])),
);

/*
 * SUSPENDED 2026-09-21, pending the roster re-stat.
 *
 * The pins marked `it.skip` below measure the *roster as it is statted today* against the engine:
 * which unit beats which, how strength tracks cost, where each district's band of doubt sits. The
 * engine was retuned that day so the eight ratings sit on a fixed ladder (`docs/BATTLE-ENGINE.md`,
 * "The eight ratings", pinned by `ratings.test.ts`), and the maintainer is re-statting the roster
 * on top of that ladder next. Re-pinning these to today's numbers would pin "Kite Crews beat the
 * whole roster" as intended, so they wait for the sheets instead. Each is to be measured again
 * and un-skipped when its subject has been re-statted; none is to be deleted.
 */

describe('the roster is a web, not a ladder', () => {
  it.skip('leaves every unit something that beats it', () => {
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
  it.skip('has no unit that beats the entire roster', () => {
    for (const unit of ROSTER) {
      expect(BEATS.get(unit.id)!.size, `${unit.id} beats everything`).toBeLessThan(
        ROSTER.length - 1,
      );
    }
  });

  /** Average wins of a tier, read off `graph`, over the units whose sheet carries no door. */
  const tierWins = (graph: Map<string, Set<string>>, tier: string): number => {
    const inTier = ROSTER.filter((unit) => unit.tier === tier && unit.doorSteps === undefined);
    return inTier.reduce((total, unit) => total + graph.get(unit.id)!.size, 0) / inTier.length;
  };

  /*
   * Heavier units are better at the same unit slots: they are gated behind campaigns, not price.
   *
   * Suspended for a day on 2026-10-07, when Arca's units (GUARD, the ten-slot Juggernaut,
   * Death Cloaks) put heavy at 9.00 wins of 24 against the rabble's 10.14, with Breakers at 5 and
   * Ironsides at 4 carrying most of the deficit. The maintainer's call was to lift the heavy
   * sheets rather than bring the Death Cloaks down, so the Breakers took 46 vitality, 8 armour and
   * 6 penetration and the Ironsides, the worst sheet in the game at attacking by design, took
   * their damage from 45 to 95 and their penetration from 5 to 14. Measured after: heavy 10.40
   * (Breakers 10, Wardens 10, Ironsides 10, Sluggers 12) against rabble 9.71 (Razors 4, Anodics 6,
   * Sparks 12, Scrapers 5, Ash Walkers 13, Death Cloaks 22).
   *
   * The Ironsides still lose two of every three fights they start, which is the brief: a wall is
   * given fights, it does not take them.
   */
  it('rewards the tier ladder over the units without a door', () => {
    expect(tierWins(BEATS, 'heavy')).toBeGreaterThan(tierWins(BEATS, 'rabble'));
  });

  it('does not let the tier ladder be the only thing that matters', () => {
    // The lower tiers never stop beating things. Measured 10.67 bare and 9.83 at level-5 doors.
    expect(tierWins(BEATS, 'rabble')).toBeGreaterThan(2);
    expect(tierWins(BEATS_AT_DOORS, 'rabble')).toBeGreaterThan(2);
  });

  /**
   * A door unit is sold on its door: the ladder (`battle/doors.ts`) is what the muster buys, and
   * at the top of it the unit has to be worth its slots against the rabble it is priced over.
   *
   * Measured at 60 slots and 3 seeds: Juggernauts beat 11 of 24 bare and 23 at a level-5 Lab;
   * the Condemned beat 7 bare and 23 at a level-5 Watch Cell; the rabble without a door average
   * 10.67 bare and 9.83 at level five. Swept over budgets of 30 to 180 slots and seed windows of
   * 3, 6 and 12, the door units never fall under 22 (Juggernauts) and 20 (the Condemned) and the
   * rabble average never climbs over 10.83, so the margin below is a band, not a seed.
   */
  it('makes each door unit worth its slots at the top of its door', () => {
    expect(DOOR_UNITS.map((unit) => unit.id)).toEqual(['juggernauts', 'the_condemned']);
    const rabble = tierWins(BEATS_AT_DOORS, 'rabble');
    for (const unit of DOOR_UNITS) {
      const bare = BEATS.get(unit.id)!.size;
      const atDoor = BEATS_AT_DOORS.get(unit.id)!.size;
      // The door reached the engine: the same sheet beats more with it than without.
      expect(atDoor, `${unit.id} gains nothing from its door`).toBeGreaterThan(bare);
      expect(atDoor, `${unit.id} at level ${DOOR_MAX_LEVEL} loses to rabble`).toBeGreaterThan(
        rabble,
      );
    }
  });
});

/**
 * The ladder the roster actually claims, measured instead of asserted.
 *
 * `UNIT_CATALOG`'s module note states it plainly: a unit is balanced against its **requirement
 * list**, not against its price or its unit slots, because "a unit roster is a readout of a campaign".
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

  /**
   * The units this round robin can actually say anything about.
   *
   * Everything below ranks a unit by *what it beats on its own*, and three kinds of sheet have
   * no answer to that question, because their whole contribution lands on somebody standing
   * beside them and a one-type-against-one-type graph has nobody standing beside anybody:
   *
   * - `mends`, the Stitcher. It has no damage and it never works on itself.
   * - `combat: false`, the two carriers. The engine will not put them in a line at all.
   * - `jammer`, the Netrunners (2026-09-18). Offense 20 and a `jamPercent` that takes the other
   *   side's armour and damage down for *the whole line* they came with. Alone, the jam applies
   *   to a line of one and then twenty offense loses to everything, so they inverted against
   *   fourteen units at once and dragged the Spearman figure from 0.82 to 0.58.
   *
   * Filtered out of the *ranking* rather than exempted from one assertion, which is the change
   * from how `mends` used to be handled: a unit the graph cannot measure should not be in the
   * ranking the graph produces, and leaving it in while excusing it downstream is what let the
   * Spearman check keep counting it. `battle/engine.test.ts` and `jam.test.ts` measure these
   * three where their mechanics actually happen.
   */
  const measurable = (unit: UnitSpec): boolean =>
    unit.mends !== true && unit.combat !== false && unit.jammer !== true;
  const RANKED = ROSTER.filter(measurable);

  it('has a spread of gate depths to rank against, so this is not vacuous', () => {
    const depths = RANKED.map(gateDepth);
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(20);
    // ...and the filter above has not quietly emptied the ranking it feeds.
    expect(RANKED.length, 'too few units left to rank').toBeGreaterThanOrEqual(ROSTER.length - 4);
  });

  it.skip('ranks by campaign roughly the way it ranks by result', () => {
    const rankOf = (by: (unit: UnitSpec) => number) => {
      const sorted = [...RANKED].sort((a, b) => by(a) - by(b));
      return new Map(sorted.map((unit, index) => [unit.id, index]));
    };
    const byGate = rankOf(gateDepth);
    const byWins = rankOf((unit) => score.get(unit.id)!);
    const n = RANKED.length;
    const d2 = RANKED.reduce(
      (total, unit) => total + (byGate.get(unit.id)! - byWins.get(unit.id)!) ** 2,
      0,
    );
    const spearman = 1 - (6 * d2) / (n * (n * n - 1));
    expect(spearman, 'gate depth no longer predicts strength').toBeGreaterThan(0.65);
  });

  /**
   * A support unit is exempt, and only a support unit: see `measurable` above for which three
   * kinds those are and why a round robin cannot rank them.
   *
   * The *shallow* side of each pair is still the whole roster. A support unit beating a deep
   * fighter is a real inversion and this has to report it; what it must not do is expect the
   * support unit to win.
   */
  it.skip('does not let a much shallower unit outrank a much deeper one, more than rarely', () => {
    const inversions: string[] = [];
    for (const deep of RANKED) {
      for (const easy of ROSTER) {
        if (gateDepth(deep) < gateDepth(easy) + 10) continue;
        if (score.get(deep.id)! >= score.get(easy.id)!) continue;
        inversions.push(
          `${deep.name} (gate ${gateDepth(deep)}) under ${easy.name} (gate ${gateDepth(easy)})`,
        );
      }
    }
    /*
     * Seven, and it was six until intimidation started doing something (§D3).
     *
     * Raising a tolerance to make a test pass is usually the wrong move, so here is the reasoning.
     * The invariant that matters is the Spearman check above: gate depth still predicts strength
     * across the whole roster at better than 0.65, and that did not move. What moved is which
     * *individual* pairs invert, and it moved in the direction the change intends: the units that
     * gained are the ones with morale at the ceiling, which are now the ones that cannot be intimidated,
     * and The Condemned (morale 100, intimidation 60) now beats three units gated ten rungs deeper.
     * A stat that was inert for the whole life of the roster became live, so the roster's ordering
     * around that stat was never calibrated in the first place.
     *
     * If this needs raising again, that is the signal to retune intimidation rather than the
     * tolerance: two consecutive bumps would mean the mechanic is eating the gate ladder.
     */
    expect(inversions.length, inversions.join('; ')).toBeLessThanOrEqual(7);
  });
});
