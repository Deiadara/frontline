import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficerPortrait, formatRecovery } from './OfficerPortrait';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

const NOW = Date.parse('2026-08-31T12:00:00.000Z');

/**
 * §D6: an injured officer looks injured, wherever their face is drawn.
 *
 * The state is drawn inside this component rather than at the four call sites, so these tests are
 * the whole of the guarantee: a screen added tomorrow gets it for free, and a screen that stops
 * passing the clock is a change somebody has to make on purpose.
 */
describe('OfficerPortrait', () => {
  it('draws nothing extra for somebody who is fit', () => {
    const { container } = render(<OfficerPortrait portraitId={null} name="Vasco Renn" />);
    expect(container.querySelector('[data-injured]')).toBeNull();
    expect(screen.queryByText('Injured')).toBeNull();
  });

  it('tints, labels and counts down for somebody who is not', () => {
    vi.setSystemTime(NOW);
    const { container } = render(
      <OfficerPortrait
        portraitId={null}
        name="Vasco Renn"
        injuredUntil={new Date(NOW + 12 * 3600_000 + 4 * 60_000).toISOString()}
      />,
    );
    const frame = container.querySelector('[data-injured="true"]');
    expect(frame).not.toBeNull();
    expect(screen.getByText('Injured')).toBeVisible();
    expect(screen.getByText('12h 04m')).toBeVisible();
    vi.useRealTimers();
  });

  it('treats a clock that has already run out as fit, with no scheduler anywhere', () => {
    vi.setSystemTime(NOW);
    const { container } = render(
      <OfficerPortrait
        portraitId={null}
        name="Vasco Renn"
        injuredUntil={new Date(NOW - 1000).toISOString()}
      />,
    );
    expect(container.querySelector('[data-injured]')).toBeNull();
    vi.useRealTimers();
  });

  it('desaturates the delivered painting under the wash rather than only tinting it', () => {
    vi.setSystemTime(NOW);
    deliveredUrl.mockReturnValue('/assets/officer-07.webp');
    const { container } = render(
      <OfficerPortrait
        portraitId="officer-07"
        name="Vasco Renn"
        injuredUntil={new Date(NOW + 3600_000).toISOString()}
      />,
    );
    expect(container.querySelector('img')?.className).toContain('grayscale');
    vi.useRealTimers();
  });

  /**
   * The band is SVG on a viewBox rather than fixed-size type, because this component is drawn at
   * 44px in the training rail and at 224px in the crew window and cut text is not allowed at
   * either. A viewBox scales; a font size does not.
   */
  it('scales the band with the frame instead of sizing it in pixels', () => {
    vi.setSystemTime(NOW);
    const { container } = render(
      <OfficerPortrait
        portraitId={null}
        name="Vasco Renn"
        injuredUntil={new Date(NOW + 3600_000).toISOString()}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 30');
    expect(svg?.getAttribute('class')).toContain('w-full');
    vi.useRealTimers();
  });
});

describe('formatRecovery', () => {
  it('reads as hours and minutes while it is hours away', () => {
    expect(formatRecovery(24 * 3600)).toBe('24h 00m');
    expect(formatRecovery(3600 + 4 * 60)).toBe('1h 04m');
  });

  it('reads as minutes and seconds inside the last hour', () => {
    expect(formatRecovery(4 * 60 + 31)).toBe('04:31');
    expect(formatRecovery(0)).toBe('00:00');
  });

  it('never runs wider than seven characters, which is what the band is sized for', () => {
    for (const seconds of [0, 59, 60, 3599, 3600, 24 * 3600, 99 * 3600]) {
      expect(formatRecovery(seconds).length, String(seconds)).toBeLessThanOrEqual(7);
    }
  });
});
