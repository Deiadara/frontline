import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { WastedAtTheGate } from './WastedAtTheGate';

/** Bug pass, 2026-10-06: a fraction of a loss read "0 loot of what they carried went to waste". */
describe('the line about what the full stores threw away', () => {
  const run = F.missionsResponse().missions[0]!;

  it('says nothing when the loss rounds to nothing', () => {
    const { container } = render(<WastedAtTheGate mission={{ ...run, wasted: { scrap: 0.3 } }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('prints the loss whole', () => {
    const { container } = render(
      <WastedAtTheGate mission={{ ...run, wasted: { scrap: 37.413 } }} />,
    );
    expect(container).toHaveTextContent('37 Scrap');
    expect(container).not.toHaveTextContent('37.413');
  });
});
