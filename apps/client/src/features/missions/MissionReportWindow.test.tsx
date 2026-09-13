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

describe('the haul, carried against earned', () => {
  it('says how much of the total came home when the crew could not carry it', () => {
    show(mission({ rewards: { scrap: 40 }, spoils: { scrap: 100 } }));

    expect(screen.getByTestId('haul-scrap')).toHaveTextContent('40 of 100');
    const note = screen.getByTestId('mission-carry-r-1');
    expect(note).toHaveTextContent('could not carry everything');
    // In the game's own units rather than as a bare ratio, so "send more carriers" is actionable.
    expect(note).toHaveTextContent('kg');
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
    // A satchel written by a newer server. Naming it as itself beats taking the window down.
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
    show(mission({ areaId: 'rustyard', outcome: 'failure', xp: 240 }));

    expect(screen.getByTestId('mission-outcome-r-1')).toHaveTextContent('Lost');
    expect(screen.getByTestId('mission-outcome-r-1')).toHaveTextContent('Steelbelt');
    expect(screen.getByTestId('mission-leader-r-1')).toHaveTextContent('Rook');
    const report = screen.getByTestId('mission-report-r-1');
    expect(report).toHaveTextContent('240 XP');
    // 5 out, 50 on site, 5 back.
    expect(report).toHaveTextContent('1h 00m');
  });
});
