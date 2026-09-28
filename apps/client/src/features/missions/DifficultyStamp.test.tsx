import { OFFICER_MARKS } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DifficultyStamp } from './DifficultyStamp';

describe('DifficultyStamp', () => {
  it.each(OFFICER_MARKS)('draws %s as a letter, and a plus or minus when it has one', (mark) => {
    render(<DifficultyStamp mark={mark} />);
    const stamp = screen.getByTestId('difficulty-stamp');
    expect(stamp).toHaveAccessibleName(`Difficulty ${mark}`);
    expect(stamp).toHaveTextContent('DIFFICULTY');

    // The grade is pen strokes, not text: a letter the stroke table lacks draws an empty path.
    const strokes = [...stamp.querySelectorAll('path[transform]')].map((path) =>
      path.getAttribute('d'),
    );
    expect(strokes).toHaveLength(mark.length);
    for (const d of strokes) expect(d, `${mark} has a stroke with no drawing`).toMatch(/^M/);
  });

  it('inks the easy grades green, the middle ones brass and the hard ones red', () => {
    const inkOf = (mark: (typeof OFFICER_MARKS)[number]) => {
      const { unmount } = render(<DifficultyStamp mark={mark} />);
      const cls = screen.getByTestId('difficulty-stamp').getAttribute('class') ?? '';
      unmount();
      return cls;
    };
    expect(inkOf('F-')).toContain('text-verdigris-100');
    expect(inkOf('D+')).toContain('text-verdigris-100');
    expect(inkOf('C-')).toContain('text-brass-300');
    expect(inkOf('B+')).toContain('text-brass-300');
    expect(inkOf('A-')).toContain('text-oxblood-300');
    expect(inkOf('S+')).toContain('text-oxblood-300');
  });
});
