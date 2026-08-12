import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverseerPortrait } from './OverseerPortrait';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

const renderPortrait = () =>
  render(<OverseerPortrait portraitId="overseer-1" archetype="enforcer" />);

describe('OverseerPortrait', () => {
  it('paints the silhouette while the portrait is undelivered', () => {
    const { container } = renderPortrait();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('enforcer')).toBeVisible();
  });

  it('shows the delivered portrait instead, addressing it by overseer rather than by path', () => {
    deliveredUrl.mockReturnValue('/assets/portrait-overseer-1.webp');
    const { container } = renderPortrait();
    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'portrait', portraitId: 'overseer-1' });
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/portrait-overseer-1.webp',
    );
    expect(container.querySelector('svg'), 'the silhouette is replaced, not stacked').toBeNull();
  });
});
