import type { SpyReport } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { SpyReportModal } from './SpyReportModal';
import { queryKeys } from '../../lib/queries';

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

/** The report, read by a player on `zone`'s clock (the house clock unless a test says otherwise). */
function draw(report: SpyReport, zone?: string) {
  const client = new QueryClient();
  if (zone !== undefined) client.setQueryData(queryKeys.me, { user: { timezone: zone } });
  return render(
    <QueryClientProvider client={client}>
      <SpyReportModal report={report} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('the readouts on a spy report', () => {
  it('prints the accuracy the report carries, as an estimate short of a full read', () => {
    draw({ ...standing(), accuracy: 0.8, unseen: null });
    expect(screen.getByTestId('spy-readouts')).toHaveTextContent('AccuracyAbout 80%');
  });

  it('prints a full read as the exact figure it is', () => {
    draw({ ...standing(), accuracy: 1, unseen: null });
    expect(screen.getByTestId('spy-readouts')).toHaveTextContent('Accuracy100%');
    expect(screen.getByTestId('spy-readouts')).not.toHaveTextContent('About');
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

// Bug pass, 2026-10-02: the report was dated by its UTC timestamp, so a report written at 01:30
// Athens read as the day before.
describe('the day a report is dated', () => {
  it("is the reader's own day, not the UTC one", () => {
    draw({ ...standing(), writtenAt: '2026-10-01T22:30:00.000Z' }, 'Europe/Athens');
    expect(screen.getByTestId('spy-report')).toHaveTextContent('2026-10-02');
  });
});
