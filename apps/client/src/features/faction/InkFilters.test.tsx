import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrackSigil } from '../research/TrackSigil';
import { MemberSigil } from './MemberSigil';
import { RankStamp } from './RankStamp';

/**
 * Bug pass, 2026-10-06: each drew its ink filter under one fixed id, so two copies on a page were
 * a duplicate id and both resolved to whichever had mounted first.
 */
describe('the ink filters on repeated marks', () => {
  const pairs = {
    'rank stamps': (
      <>
        <RankStamp rank="leader" />
        <RankStamp rank="member" />
      </>
    ),
    'track sigils': (
      <>
        <TrackSigil role="fixer" />
        <TrackSigil role="researcher" />
      </>
    ),
    'member sigils': (
      <>
        <MemberSigil seed="a" name="A" />
        <MemberSigil seed="b" name="B" />
      </>
    ),
  };

  for (const [what, both] of Object.entries(pairs)) {
    it(`gives each of two ${what} a filter of its own, and points each at its own`, () => {
      const { container } = render(both);
      const ids = [...container.querySelectorAll('filter')].map((filter) => filter.id);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      for (const id of ids) {
        expect(container.querySelectorAll(`[filter="url(#${id})"]`)).toHaveLength(1);
      }
    });
  }
});
