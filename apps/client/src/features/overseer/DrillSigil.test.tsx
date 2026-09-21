import { ATTRIBUTE_GROUPS, ATTRIBUTE_GROUP_LABELS } from '@frontline/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DrillSigil } from './DrillSigil';

/**
 * The four group marks on the training sheet.
 *
 * Two things can go wrong here and neither shows up in a screenshot at a glance. The first is a
 * shared filter id: four sigils are on the page at once, an `id` is document-wide, and four
 * `<defs>` under one name resolve to whichever mounted last. That works by accident while the
 * four filters are identical and stops the moment one of them is not.
 *
 * The second is the glyph going missing. The sigil draws its ring itself and takes the drawing
 * from the icon set, so a wrong or absent key leaves a ring with nothing in it: four empty
 * roundels, on a page whose gates all still pass.
 */
describe('the drill sigils', () => {
  it('gives each group a filter of its own', () => {
    const { container } = render(
      <>
        {ATTRIBUTE_GROUPS.map((group) => (
          <DrillSigil key={group} group={group} />
        ))}
      </>,
    );
    const ids = [...container.querySelectorAll('filter')].map((filter) => filter.id);
    expect(ids).toHaveLength(ATTRIBUTE_GROUPS.length);
    expect(new Set(ids).size, `two sigils share a filter id: ${ids.join(', ')}`).toBe(ids.length);
    // And every drawing points at its own, rather than at whichever id won.
    for (const group of ATTRIBUTE_GROUPS) {
      const used = container.querySelector(`[filter="url(#drill-ink-${group})"]`);
      expect(used, `${group} does not use its own filter`).not.toBeNull();
    }
  });

  it('draws a ring and a glyph for every group, and names it', () => {
    for (const group of ATTRIBUTE_GROUPS) {
      const { container } = render(<DrillSigil group={group} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-label')).toBe(`${ATTRIBUTE_GROUP_LABELS[group]} drills`);
      // The ring is one path; a glyph is at least one more. One alone means the icon key missed.
      const drawn = container.querySelectorAll('path, circle, rect');
      expect(drawn.length, `${group} drew a ring with nothing in it`).toBeGreaterThan(1);
    }
  });
});
