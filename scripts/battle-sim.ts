import {
  TacticalSkirmishEngine,
  bareBattlefield,
  battlefieldFor,
  forecast,
  simulate,
  type Army,
  type Battlefield,
  type SideSetup,
} from '@frontline/shared';

/**
 * The battle engine, run to convergence: `pnpm --filter @frontline/scripts battle-sim [runs]`.
 *
 * Every matchup below is fought `runs` times on fresh seeds and the attacker's win rate is printed
 * with a 95% confidence interval, beside the mean length, what each side walked away with, and how
 * often the round cap called it. It is what "what should we expect from X against Y" is answered
 * with, and it is the check that a retune has not turned a favourite into a coin flip: the numbers
 * the board signed off on are in `docs/PLAN-research-and-blueprints.md`, Section V.
 *
 * Three more checks ride along: the win rate is monotone in numbers, the sixty-run forecast a
 * player sees agrees with the long run, and the wrapper's ledger adds up (everybody who set out is
 * either home, fled, or dead).
 */

const runs = Number(process.argv[2] ?? 3000);
const interval = (p: number): number => 1.96 * Math.sqrt((p * (1 - p)) / runs);

const survival = (side: { stacks: { started: number; alive: number }[] }): number => {
  const started = side.stacks.reduce((total, stack) => total + stack.started, 0);
  return started === 0 ? 1 : side.stacks.reduce((total, stack) => total + stack.alive, 0) / started;
};

interface Matchup {
  label: string;
  attacker: Army;
  defender: Army;
  battlefield?: Battlefield;
  attackerSetup?: Partial<SideSetup>;
}

function measure(matchup: Matchup): number {
  const battlefield = matchup.battlefield ?? bareBattlefield();
  let wins = 0;
  let rounds = 0;
  let attackerLeft = 0;
  let defenderLeft = 0;
  let onPower = 0;
  let shortest = Number.POSITIVE_INFINITY;
  let longest = 0;
  for (let run = 0; run < runs; run += 1) {
    const simulation = simulate({
      seed: `sim:${matchup.label}:${run}`,
      battlefield,
      attacker: { name: 'A', army: matchup.attacker, defending: false, ...matchup.attackerSetup },
      defender: { name: 'D', army: matchup.defender, defending: true },
    });
    if (simulation.winner === 'attacker') wins += 1;
    rounds += simulation.rounds.length;
    shortest = Math.min(shortest, simulation.rounds.length);
    longest = Math.max(longest, simulation.rounds.length);
    attackerLeft += survival(simulation.attacker);
    defenderLeft += survival(simulation.defender);
    if (simulation.decidedOnPower) onPower += 1;
  }
  const p = wins / runs;
  const pct = (value: number) => `${(value * 100).toFixed(value < 0.1 || value > 0.9 ? 1 : 0)}%`;
  console.log(
    `${matchup.label.padEnd(44)} attacker wins ${pct(p).padStart(6)} ±${(interval(p) * 100).toFixed(1)}` +
      `  rounds ${(rounds / runs).toFixed(1)} [${shortest}..${longest}]` +
      `  survive A ${pct(attackerLeft / runs)} D ${pct(defenderLeft / runs)}` +
      `  on power ${pct(onPower / runs)}`,
  );
  return p;
}

const press = (level: number): Battlefield =>
  battlefieldFor({
    locationName: 'Kessler Press',
    kind: 'scrap_press',
    fortifyDifficulty: 'medium',
    fortifyLevel: level,
    at: new Date('2026-08-13T12:00:00.000Z'),
    weather: 'normal',
  });

const narrow: Battlefield = { ...bareBattlefield(), frontage: 12 };

console.log(`${runs} runs per matchup\n`);

console.log('--- mirrors: what the ground is worth to whoever holds it ---');
for (const unit of [
  'razors',
  'snipers',
  'ghosts',
  'breakers',
  'wardens',
  'sluggers',
  'juggernauts',
  'ironsides',
]) {
  measure({
    label: `${unit} 20 vs 20 ${unit}`,
    attacker: { [unit]: 20 },
    defender: { [unit]: 20 },
  });
}

console.log('\n--- numbers: the edge that decides a fight ---');
let previous = 0;
for (const count of [10, 14, 18, 20, 22, 26, 30, 40]) {
  const p = measure({
    label: `razors ${count} vs 20 razors`,
    attacker: { razors: count },
    defender: { razors: 20 },
  });
  if (p + 0.02 < previous) console.log('   NOT MONOTONE: more bodies won less often');
  previous = p;
}

console.log('\n--- ground and fortification (the press caps at level 3) ---');
measure({
  label: 'razors 30 vs 20 razors, press open',
  attacker: { razors: 30 },
  defender: { razors: 20 },
  battlefield: press(0),
});
measure({
  label: 'razors 30 vs 20 razors, press dug in 3',
  attacker: { razors: 30 },
  defender: { razors: 20 },
  battlefield: press(3),
});
measure({
  label: '60 razors vs 30 razors, narrow',
  attacker: { razors: 60 },
  defender: { razors: 30 },
  battlefield: narrow,
});
measure({
  label: '60 razors +50% cohesion vs 30, narrow',
  attacker: { razors: 60 },
  defender: { razors: 30 },
  battlefield: narrow,
  attackerSetup: { cohesionPercent: 50 },
});

console.log('\n--- counters, tiers and support ---');
measure({ label: 'snipers 20 vs 20 razors', attacker: { snipers: 20 }, defender: { razors: 20 } });
measure({ label: 'razors 20 vs 20 snipers', attacker: { razors: 20 }, defender: { snipers: 20 } });
measure({
  label: 'breakers 20 vs 20 ironsides',
  attacker: { breakers: 20 },
  defender: { ironsides: 20 },
});
measure({
  label: 'ironsides 10 vs 30 razors',
  attacker: { ironsides: 10 },
  defender: { razors: 30 },
});
measure({
  label: 'juggernauts 5 vs 30 razors',
  attacker: { juggernauts: 5 },
  defender: { razors: 30 },
});
measure({
  label: 'mixed 10r 6s 4i vs 20 razors',
  attacker: { razors: 10, snipers: 6, ironsides: 4 },
  defender: { razors: 20 },
});
measure({
  label: '20 razors vs mixed 10r 6s 4i',
  attacker: { razors: 20 },
  defender: { razors: 10, snipers: 6, ironsides: 4 },
});
measure({
  label: '20 razors + 6 stitchers vs 24 razors',
  attacker: { razors: 20, stitchers: 6 },
  defender: { razors: 24 },
});
measure({
  label: '20 razors vs 40 scavengers (porters)',
  attacker: { razors: 20 },
  defender: { scavengers: 40 },
});
measure({
  label: '20 razors vs 20 razors + 40 scavengers',
  attacker: { razors: 20 },
  defender: { razors: 20, scavengers: 40 },
});

console.log('\n--- the sixty-run forecast a player sees, against the long run ---');
for (const matchup of [
  { label: 'razors 22 vs 20', attacker: { razors: 22 }, defender: { razors: 20 } },
  { label: 'ironsides 10 vs 30 razors', attacker: { ironsides: 10 }, defender: { razors: 30 } },
]) {
  const seen = forecast({
    attacker: { name: 'A', army: matchup.attacker, defending: false },
    defender: { name: 'D', army: matchup.defender, defending: true },
  });
  const truth = measure({ ...matchup, label: `  ${matchup.label}` });
  console.log(
    `  forecast(60) says ${(seen.winChance * 100).toFixed(0)}%, the long run ${(truth * 100).toFixed(1)}%`,
  );
}

console.log('\n--- the wrapper: everybody who set out is home, fled or dead ---');
const engine = new TacticalSkirmishEngine();
const total = (army: Army): number => Object.values(army).reduce((sum, count) => sum + count, 0);
let mismatches = 0;
for (let run = 0; run < 500; run += 1) {
  const attacking = { razors: 20, snipers: 5 };
  const defending = { razors: 18, ironsides: 3 };
  const outcome = engine.resolve({
    seed: `wrap:${run}`,
    attackerName: 'A',
    defenderName: 'D',
    locationName: 'the yard',
    attacking,
    defending,
    attackerPerimeter: { road_reavers: 3 },
  });
  const loser = outcome.winner === 'attacker' ? total(defending) : total(attacking);
  if (total(outcome.fled) + total(outcome.killed) !== loser) mismatches += 1;
}
console.log(`ledger mismatches: ${mismatches} in 500`);
