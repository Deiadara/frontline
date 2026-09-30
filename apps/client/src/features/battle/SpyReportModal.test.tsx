import type { SpyReport } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { SpyReportModal } from './SpyReportModal';

/**
 * The readouts under a spy report are drawn off what the report carries (bug pass, 2026-09-28).
 *
 * The server sends the accuracy only where the reader's track prints it, so the window reads the
 * figure itself rather than a flag beside it.
 */
function standing(): SpyReport {
  const report = F.battles.spyReports.find((one) => !one.failed);
  if (!report) throw new Error('the board fixture lost its standing report');
  return report;
}

const draw = (report: SpyReport) =>
  render(<SpyReportModal report={report} onClose={() => undefined} />);

describe('the readouts on a spy report', () => {
  it('prints the accuracy the report carries', () => {
    draw({ ...standing(), accuracy: 0.82, unseen: null });
    expect(screen.getByTestId('spy-readouts')).toHaveTextContent('Accuracy82%');
  });

  it('draws no readouts when the report carries none of them', () => {
    // Looters' ground, so there was nobody to notice the runners and no line saying so.
    draw({
      ...standing(),
      holder: { kind: 'looters', name: 'Looters', player: null, faction: null },
      accuracy: null,
      accuracyShown: false,
      unseen: null,
      totalSlots: null,
    });
    expect(screen.queryByTestId('spy-readouts')).toBeNull();
  });

  it("says whether the holder knows, on a job on somebody else's ground", () => {
    draw({ ...standing(), foundOut: true });
    expect(screen.getByTestId('spy-readouts')).toHaveTextContent('NoticedThey know it was you');
  });

  it("prints The Whole Wire's exact slots on a failed report too", () => {
    draw({
      ...standing(),
      failed: true,
      exposed: {},
      accuracy: null,
      unseen: null,
      totalSlots: 40,
    });
    expect(screen.getByTestId('spy-failed')).toBeInTheDocument();
    expect(screen.getByTestId('spy-readouts')).toHaveTextContent('Standing there40 unit slots');
  });
});

/** Before Written Reports (maintainer, 2026-09-28): a count of unit slots, and no unit named. */
describe('a report that names nobody', () => {
  it('prints the slots and no unit cards', () => {
    draw({ ...standing(), unitsShown: false, exposed: {}, exposedSlots: 18 });
    expect(screen.getByTestId('spy-slots-only')).toHaveTextContent('18');
    expect(screen.queryByTestId('spy-exposed')).toBeNull();
  });
});

describe("the courier's report", () => {
  it('is headed with his rung and says nobody paid for it', () => {
    draw({ ...standing(), tier: null, capsPaid: 0 });
    expect(screen.getByTestId('spy-report')).toHaveTextContent('Turned Runners');
    expect(screen.getByTestId('spy-report-head')).toHaveTextContent('Nothing: the courier');
    expect(screen.getByTestId('spy-readouts')).not.toHaveTextContent('Noticed');
  });
});
