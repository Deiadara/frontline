import {
  MISC_AREA_ID,
  findBlueprintPage,
  makeAttributes,
  type Mission,
  type MissionLeader,
} from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MissionReportWindow } from './MissionReportWindow';
import { landedOf } from './WastedAtTheGate';

/**
 * The report a returned row opens (maintainer, 2026-09-12).
 *
 * What the row no longer says has to be said here, and two of the sentences are the whole reason
 * the window exists: the haul carried against what the job actually paid, which is the only place
 * in the game that says a crew was under-carried, and the drops by name, which is the only place
 * that says what a run turned up.
 */

const ROOK: MissionLeader = {
  id: 'ov-1',
  name: 'Rook',
  kind: 'overseer',
  arrivalPercent: 0,
  attributes: makeAttributes(22),
  held: null,
  heldUntil: null,
};

/** A page id this build definitely knows, so the name under test is a real one. */
const PAGE_ID = 'pg_snipers_barrel_liners';

function mission(fields: Partial<Mission> = {}): Mission {
  return {
    id: 'r-1',
    baseId: 'base-1',
    templateId: 'foundry-raid',
    areaId: MISC_AREA_ID,
    payPercent: 0,
    xp: 240,
    force: { razors: 3, scavengers: 1 },
    vehicles: {},
    pricedMinutes: 0,
    startedAt: '2026-08-13T10:00:00.000Z',
    travelMinutes: 5,
    durationMinutes: 50,
    status: 'resolved',
    officerId: null,
    grade: null,
    overseerLed: true,
    lost: {},
    reported: true,
    outcome: 'success',
    rewards: { scrap: 40 },
    spoils: { scrap: 40 },
    found: {},
    resolvedAt: '2026-08-13T11:00:00.000Z',
    recalledAt: null,
    pagePrize: null,
    pageWon: null,
    ...fields,
  };
}

const show = (one: Mission) =>
  render(
    <MissionReportWindow
      mission={one}
      leaders={[ROOK]}
      overseerName="Rook"
      onClose={() => undefined}
    />,
  );

/**
 * What the crew could lift is the figure the settle kept on the run (bug pass, 2026-10-06). The
 * report used to rebuild it from today's loadouts, bag and marks, so a crew whose kit changed
 * since read "all 300 of it, out of the 200 they could lift". A run settled before the figure was
 * kept drops the clause rather than guess.
 */
describe('what the report says the crew could lift', () => {
  it('prints the figure the settle kept', () => {
    const one = mission({ rewards: { scrap: 40 }, spoils: { scrap: 40 }, carryCapacity: 212.4 });
    show(one);
    expect(screen.getByTestId(`mission-carry-${one.id}`)).toHaveTextContent(
      'They carried all 40 loot of it home, out of the 212 loot they could lift between them.',
    );
  });

  it('drops the clause on a run settled before the figure was kept', () => {
    const one = mission({ rewards: { scrap: 40 }, spoils: { scrap: 40 } });
    show(one);
    const note = screen.getByTestId(`mission-carry-${one.id}`);
    expect(note).toHaveTextContent('They carried all 40 loot of it home.');
    expect(note).not.toHaveTextContent('could lift');
  });
});

describe('the haul, carried against earned', () => {
  it('says how much of the total came home when the crew could not carry it', () => {
    show(mission({ rewards: { scrap: 40 }, spoils: { scrap: 100 } }));

    expect(screen.getByTestId('haul-scrap')).toHaveTextContent('40 of 100');
    const note = screen.getByTestId('mission-carry-r-1');
    expect(note).toHaveTextContent('could not carry everything');
    // In the game's own units rather than as a bare ratio, so "send more carriers" is actionable.
    // Loot, not kilograms (maintainer request, 2026-09-15): a weight is a unit the game never
    // otherwise uses, and the figure it labels is the raid's haul.
    expect(note).toHaveTextContent('loot');
    expect(note).not.toHaveTextContent('kg');
  });

  it('says they carried it all when the two agree', () => {
    show(mission());

    expect(screen.getByTestId('mission-carry-r-1')).toHaveTextContent('carried all');
    expect(screen.getByTestId('mission-carry-r-1')).not.toHaveTextContent('could not carry');
  });

  /**
   * A run settled before `spoils` was recorded knows only what was banked. "40 of 40" there would
   * be a claim the row cannot support, and printing nothing would imply nothing was left behind.
   */
  it('says the total is not known on a run that never recorded one', () => {
    show(mission({ spoils: {} }));

    expect(screen.getByTestId('mission-carry-r-1')).toHaveTextContent('total is not known');
    expect(screen.getByTestId('haul-scrap')).not.toHaveTextContent('of');
  });
});

describe('what a run turned up', () => {
  it('names the page and the salvage beside it', () => {
    show(mission({ pageWon: PAGE_ID, found: { [PAGE_ID]: 1, rotor_hub: 2 } }));

    const drops = screen.getByTestId('mission-drops-r-1');
    const pageName = findBlueprintPage(PAGE_ID)?.name;
    expect(pageName, 'the fixture names a page this build does not have').toBeTruthy();
    expect(within(drops).getByTestId('mission-page-r-1')).toHaveTextContent(pageName ?? '');
    expect(drops).toHaveTextContent('Rotor Hub');
    expect(drops).toHaveTextContent('2 of them');
  });

  /**
   * The settler folds the won page into `found`, so the two together must not name it twice; a row
   * settled before `found` existed carries only `pageWon`, and that page still has to be drawn.
   */
  it('names the page once when it is in both, and still draws it when it is in neither', () => {
    show(mission({ pageWon: PAGE_ID, found: { [PAGE_ID]: 1 } }));
    expect(within(screen.getByTestId('mission-drops-r-1')).getAllByRole('listitem')).toHaveLength(
      1,
    );

    show(mission({ id: 'r-2', pageWon: PAGE_ID, found: {} }));
    expect(screen.getByTestId('mission-page-r-2')).toBeInTheDocument();
  });

  it('falls back to the id for an item this build has never heard of', () => {
    // An inventory written by a newer server. Naming it as itself beats taking the window down.
    show(mission({ found: { 'nothing-like-this': 1 } as unknown as Mission['found'] }));

    expect(screen.getByTestId('mission-drops-r-1')).toHaveTextContent('nothing-like-this');
  });

  it('draws no section at all when the run turned up nothing', () => {
    show(mission());

    expect(screen.queryByTestId('mission-drops-r-1')).toBeNull();
  });
});

describe('the rest of the report', () => {
  it('names the outcome, the ground, who led it, the XP and the round trip', () => {
    show(mission({ areaId: 'steelbelt', outcome: 'failure', xp: 240 }));

    expect(screen.getByTestId('mission-outcome-r-1')).toHaveTextContent('Lost');
    expect(screen.getByTestId('mission-outcome-r-1')).toHaveTextContent('Steelbelt');
    expect(screen.getByTestId('mission-leader-r-1')).toHaveTextContent('Rook');
    const report = screen.getByTestId('mission-report-r-1');
    // What the run paid, not what it would have: a failed run banks a fifth of its 240.
    expect(report).toHaveTextContent('48 XP');
    expect(report).not.toHaveTextContent('240 XP');
    // 5 out, 50 on site, 5 back.
    expect(report).toHaveTextContent('1h 00m');
  });

  // A recall settles as a failure, but nobody was lost, and they were out for minutes rather than
  // the planned hour (bug pass, 2026-10-02).
  // A battle job pays infamy and, with a Bone Market, caps for its dead; the report said neither.
  it('prints the infamy and the Bone Market refund the return paid, and only when it paid them', () => {
    show(mission({ outcome: 'success', infamyPaid: 18, refund: { caps: 140 } }));
    expect(screen.getByTestId('mission-infamy-r-1')).toHaveTextContent('+18');
    expect(screen.getByTestId('mission-refund-r-1')).toHaveTextContent('140');
  });

  it('prints neither on a run that paid none', () => {
    show(mission({ outcome: 'success' }));
    expect(screen.queryByTestId('mission-infamy-r-1')).toBeNull();
    expect(screen.queryByTestId('mission-refund-r-1')).toBeNull();
  });

  it('calls a recalled run called back, with the time they were really out', () => {
    const sent = mission({ outcome: 'failure', xp: 240 });
    const recalledAt = new Date(Date.parse(sent.startedAt) + 3 * 60_000).toISOString();
    show({ ...sent, recalledAt });

    expect(screen.getByTestId('mission-outcome-r-1')).toHaveTextContent('Called back');
    expect(screen.getByTestId('mission-outcome-r-1')).not.toHaveTextContent('Lost');
    const report = screen.getByTestId('mission-report-r-1');
    expect(report).not.toHaveTextContent('1h 00m');
    expect(report).toHaveTextContent('6m');
  });

  it('prints the XP the settle paid: all of it on a clean run, none for a crew turned round', () => {
    show(mission({ xp: 240 }));
    expect(screen.getByTestId('mission-report-r-1')).toHaveTextContent('240 XP');
    show(
      mission({
        id: 'r-2',
        xp: 240,
        outcome: 'failure',
        recalledAt: '2026-08-13T10:01:00.000Z',
        rewards: {},
      }),
    );
    expect(screen.getByTestId('mission-report-r-2')).toHaveTextContent('0 XP');
    expect(screen.getByTestId('mission-report-r-2')).not.toHaveTextContent('240 XP');
  });
});

/**
 * The stores are a hard ceiling on mission pay (maintainer ruling, 2026-09-28): what came home and
 * had nowhere to go is named under the haul, so a full yard is the stated reason the stockpile
 * moved less than the haul says.
 */
describe('what the full stores threw away', () => {
  const open = (one: Mission) =>
    render(
      <MissionReportWindow
        mission={one}
        leaders={[ROOK]}
        overseerName="Rook"
        onClose={() => undefined}
      />,
    );

  it('names it under the haul, in loot and by resource', () => {
    // Oil weighs three to the unit, so the total is the weighed figure and not a count.
    const one = mission({ wasted: { scrap: 25, oil: 10 } });
    open(one);
    expect(screen.getByTestId(`mission-wasted-${one.id}`).textContent).toBe(
      'The stores were full: 55 loot of what they carried went to waste at the gate (10 Oil and 25 Scrap).',
    );
  });

  it('marks the wasted part on each resource it came out of', () => {
    const one = mission({ wasted: { scrap: 25 } });
    open(one);
    expect(screen.getByTestId('haul-wasted-scrap').textContent).toBe('25 wasted');
    expect(screen.queryByTestId('haul-wasted-oil')).toBeNull();
  });

  it('counts only what landed as the pay the stores took', () => {
    expect(landedOf(mission({ rewards: { scrap: 40, oil: 5 }, wasted: { scrap: 25 } }))).toEqual({
      scrap: 15,
      oil: 5,
    });
    expect(landedOf(mission({ rewards: { scrap: 40 }, wasted: { scrap: 40 } }))).toEqual({});
  });

  it('says nothing when everything fitted', () => {
    const one = mission({ wasted: {} });
    open(one);
    expect(screen.queryByTestId(`mission-wasted-${one.id}`)).toBeNull();
  });
});

/**
 * Bug pass, 2026-10-02: the award adds the district's and the crew's XP bonus, and the report
 * printed the frozen figure without it. A row from before the paid figure was kept falls back.
 */
describe('the experience a run paid', () => {
  const shown = (one: Mission) => {
    render(
      <MissionReportWindow
        mission={one}
        leaders={[ROOK]}
        overseerName="Rook"
        onClose={() => undefined}
      />,
    );
    return screen.getByRole('dialog');
  };

  it('prints what the return banked', () => {
    expect(shown(mission({ xp: 240, xpPaid: 257 }))).toHaveTextContent('257 XP');
  });

  it('falls back to the frozen figure on an older row', () => {
    expect(shown(mission({ xp: 240 }))).toHaveTextContent('240 XP');
  });
});
