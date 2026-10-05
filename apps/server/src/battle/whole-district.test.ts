import { ALL_DISTRICTS, RESEARCH_ITEMS } from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeWorlds,
  declare,
  holdPlot,
  makeWorld,
  register,
  aDayAfter,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';

/**
 * "Any district held whole" (maintainer, 2026-09-29): the `whole_district` channel pays in every
 * fight the crew is in while it holds at least one district end to end, anywhere on the map.
 *
 * It used to ask about the crew's own district, a residential plot with no locations, so the two
 * research rungs and three perks behind it never paid anybody.
 */

afterEach(closeWorlds);

const RUNGS = RESEARCH_ITEMS.filter((item) => item.payout.bonus?.kind === 'whole_district');
const RUNG_PERCENT = RUNGS.reduce(
  (sum, item) =>
    sum + (item.payout.bonus?.kind === 'whole_district' ? item.payout.bonus.percent : 0),
  0,
);

/** A district away from the Belt the fight is on, so holding it whole raises no gate over the fight. */
const ELSEWHERE = ALL_DISTRICTS.find(
  (district) => district.id !== 'steelbelt' && district.locations.length > 0,
)!;

function takeWhole(world: World, crew: Crew): void {
  for (const location of ELSEWHERE.locations) {
    const control = world.app.repos.city.control(location.id)!;
    world.app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: crew.baseId },
      garrison: { razors: 1 },
    });
  }
}

function research(world: World, crew: Crew): void {
  const base = world.app.repos.bases.findById(crew.baseId)!;
  world.app.repos.bases.updateResearch(crew.baseId, {
    ...base.research,
    technologies: [...base.research.technologies, ...RUNGS.map((item) => item.id)],
  });
}

/**
 * The defence the plot's holder carried into two fights on it, with `between` run after the first.
 *
 * One world rather than two compared: each account is offered its own overseer, so two worlds
 * would differ by more than the thing under test.
 */
async function twoFights(
  before: (world: World, holder: Crew) => void,
  between: (world: World, holder: Crew) => void,
): Promise<[number, number]> {
  const world = await makeWorld('defender');
  const caller = await register(world, 'caller', { razors: 3 });
  const holder = await register(world, 'holder');
  holdPlot(world, holder, { razors: 5 });
  before(world, holder);
  const firstFight = await declare(world, caller);
  runTheFight(world, firstFight);
  const first = world.seen().defenderTerritory!.defensePercent;
  between(world, holder);
  // A day on, or the caller who lost could not call the plot again (2026-10-05).
  aDayAfter(world, firstFight);
  runTheFight(world, await declare(world, caller));
  return [first, world.seen().defenderTerritory!.defensePercent];
}

const nothing = (): void => undefined;

describe('the whole-district defence', () => {
  it('has rungs to test', () => {
    // The Right Hand's; the Head of Security's went with the chair rework (2026-10-04).
    expect(RUNGS).toHaveLength(1);
    expect(RUNG_PERCENT).toBeGreaterThan(0);
  });

  it('pays in a fight away from the district the crew holds whole', async () => {
    const [without, withIt] = await twoFights(research, takeWhole);
    expect(withIt - without).toBe(RUNG_PERCENT);
    // The control: the district alone adds nothing, so the difference above is the rungs.
    const [bare, held] = await twoFights(nothing, takeWhole);
    expect(held).toBe(bare);
  });

  it('pays nothing while the crew holds no district whole', async () => {
    const [bare, researched] = await twoFights(nothing, research);
    expect(researched).toBe(bare);
  });
});
