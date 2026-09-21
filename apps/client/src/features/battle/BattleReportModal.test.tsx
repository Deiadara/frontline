import type { BattleAnalysis } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { BattleReportModal, turnedLine } from './BattleReportModal';

/**
 * The two Combine lines on a report (`city/combine.ts`, 2026-09-19).
 *
 * Drawn only with a number behind them: every fight the Combine is not in has neither, and a
 * report that printed "The Executioner finished 0" on a scrap with looters would be lying about
 * who was there.
 */
const analysis = boardReport();

function boardReport(): BattleAnalysis {
  const report = F.battles.reports[0]?.analysis;
  if (!report) throw new Error('the board fixture lost its report');
  return report;
}

function draw(extra: {
  turned?: Record<string, number>;
  executed?: number;
  underLeader?: BattleAnalysis['underLeader'];
}) {
  const report = { ...analysis, ...extra };
  render(<BattleReportModal analysis={report} side="attacker" onClose={() => undefined} />);
}

describe('the report and the Combine', () => {
  it('names the turncoats by unit and count', () => {
    expect(turnedLine({ razors: 3, scrapers: 1 })).toBe('3 Razors, 1 Scrapers');
    expect(turnedLine({ razors: 0 })).toBe('');
  });

  it('says who changed sides under Directive Xero', () => {
    draw({ turned: { razors: 3, scrapers: 1 } });
    expect(screen.getByTestId('report-turned')).toHaveTextContent(
      '4 units changed sides and are his now: 3 Razors, 1 Scrapers.',
    );
    expect(screen.queryByTestId('report-executed')).toBeNull();
  });

  it('counts one turncoat in the singular', () => {
    draw({ turned: { razors: 1 } });
    expect(screen.getByTestId('report-turned')).toHaveTextContent(
      '1 unit changed sides and is his now: 1 Razors.',
    );
  });

  it('says what the Executioner finished', () => {
    draw({ executed: 2 });
    expect(screen.getByTestId('report-executed')).toHaveTextContent('The Executioner finished 2.');
    expect(screen.queryByTestId('report-turned')).toBeNull();
  });

  it('draws neither line on a fight the Combine was not in', () => {
    draw({ turned: {}, executed: 0 });
    expect(screen.queryByTestId('report-turned')).toBeNull();
    expect(screen.queryByTestId('report-executed')).toBeNull();
    draw({});
    expect(screen.queryByTestId('report-turned')).toBeNull();
    expect(screen.queryByTestId('report-executed')).toBeNull();
  });

  /**
   * The Syndic is why this section exists. Her power is points on the Combine's sheets and leaves
   * no toll at all, so both lines above stay away and a player who lost a fight they should have
   * won reads an aftermath that never mentions her. Asserted on her rather than on the other two
   * for the same reason: they at least have a number to print.
   */
  it('names the leader whose ground the fight was on, tolls or no tolls', () => {
    draw({
      underLeader: { name: 'Syndic', powerName: 'Standing Orders' },
      turned: {},
      executed: 0,
    });
    const said = screen.getByTestId('report-under-leader');
    expect(said).toHaveTextContent('Fought under Syndic.');
    expect(said).toHaveTextContent('Standing Orders');
    expect(screen.queryByTestId('report-turned')).toBeNull();
    expect(screen.queryByTestId('report-executed')).toBeNull();
  });

  it('says nothing about a leader on a fight nobody led', () => {
    draw({ underLeader: null });
    expect(screen.queryByTestId('report-under-leader')).toBeNull();
  });
});
