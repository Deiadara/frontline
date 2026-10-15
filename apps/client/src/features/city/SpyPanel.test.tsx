import type { SpyReport } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { SpyLine, SpyPanel, spyStandingFigure } from './SpyPanel';

/**
 * What the sheet says is standing on a place, off its last report (bug pass, 2026-10-01).
 *
 * The Whole Wire prints the exact unit slots on every report, a failed one included, and the sheet
 * and the last-look line used to drop the figure: a failed report read as "Unknown".
 */
function standing(): SpyReport {
  const report = F.battles.spyReports.find((one) => !one.failed && one.totalSlots === null);
  if (!report) throw new Error('the board fixture lost its standing report');
  return report;
}

const failed = (): SpyReport => ({ ...standing(), failed: true, exposed: {}, exposedSlots: 0 });

describe('what a report says is standing there', () => {
  it('is what was seen, or nothing on a failed report, without The Whole Wire', () => {
    expect(spyStandingFigure(standing())).toMatch(/seen$/);
    expect(spyStandingFigure(failed())).toBeNull();
  });

  it("is The Whole Wire's exact slots wherever the report carries them", () => {
    expect(spyStandingFigure({ ...standing(), totalSlots: 41 })).toBe('41 unit slots');
    expect(spyStandingFigure({ ...failed(), totalSlots: 37 })).toBe('37 unit slots');
  });

  it('puts the slots on the last-look line, a failed report included', () => {
    render(
      <MemoryRouter>
        <SpyLine latest={{ ...failed(), totalSlots: 37 }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('spy-last-report')).toHaveTextContent('37 unit slots in all');
  });
});

/*
 * Bug pass, 2026-10-02: an empty or injured Master of Whispers hid the jobs already out, and with
 * them the recall, which needs no chair at all.
 */
describe('a job out while nobody works the chair', () => {
  it('keeps the job and its recall on the panel, with the blocked note under it', () => {
    const run = F.actionsResponse.spyRuns[0]!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SpyPanel
            target={run.target}
            placeName={run.placeName}
            districtId={run.districtId}
            baseId="base-1"
            caps={10_000}
            spying={{
              runs: [run],
              parties: 1,
              tiersOpen: [],
              quote: null,
              blocker: 'no_whispers',
              locationsRefused: null,
            }}
            now={new Date(Date.parse(run.departedAt) + 60_000)}
            testId="spy"
            actions={<button type="button">Close</button>}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('spy-underway')).toBeTruthy();
    expect(screen.getByTestId('spy-blocked')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });
});

/** Maintainer, 2026-10-05: one job per place. The send is gone while runners are on their way here. */
describe('a place the runners are already on their way to', () => {
  function panel(
    target: SpyReport['target'] | (typeof F.actionsResponse.spyRuns)[number]['target'],
  ) {
    const run = F.actionsResponse.spyRuns[0]!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SpyPanel
            target={target}
            placeName="the place"
            districtId={run.districtId}
            baseId="base-1"
            caps={10_000}
            spying={{
              runs: [run],
              parties: 2,
              tiersOpen: ['loose_ears'],
              quote: { minutes: 30 },
              blocker: null,
              locationsRefused: null,
            }}
            now={new Date(Date.parse(run.departedAt) + 60_000)}
            testId="spy"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('offers no send there, though a party is free', () => {
    panel(F.actionsResponse.spyRuns[0]!.target);
    expect(screen.queryByTestId('spy-send')).toBeNull();
  });

  it('still offers the free party anywhere else', () => {
    panel({ kind: 'location', locationId: 'somewhere-else' });
    expect(screen.getByTestId('spy-send')).toBeTruthy();
  });
});

/*
 * Guard, then the reason on hover (maintainer, 2026-10-06). The send greyed out for a tier the
 * crew could not pay for and said nothing about why.
 */
describe('a tier the crew cannot pay for', () => {
  function panel(caps: number) {
    const run = F.actionsResponse.spyRuns[0]!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SpyPanel
            target={{ kind: 'location', locationId: 'somewhere-else' }}
            placeName="the place"
            districtId={run.districtId}
            baseId="base-1"
            caps={caps}
            spying={{
              runs: [],
              parties: 1,
              tiersOpen: ['loose_ears'],
              quote: { minutes: 30 },
              blocker: null,
              locationsRefused: null,
            }}
            now={new Date(Date.parse(run.departedAt) + 60_000)}
            testId="spy"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return screen.getByTestId('spy-send');
  }

  it('greys the send and says what the tier costs against what is held', () => {
    const send = panel(40);
    expect(send).toBeDisabled();
    expect(send.getAttribute('data-tip')).toBe('Loose Ears costs 100 caps and you hold 40');
  });

  it('offers the send with no reason on it once the caps are there', () => {
    const send = panel(10_000);
    expect(send).toBeEnabled();
    expect(send.getAttribute('data-tip')).toBeNull();
  });
});
