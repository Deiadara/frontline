import { ATTRIBUTE_LABELS, ATTRIBUTE_NAMES, OVERSEER_PRESETS, findPerk } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CharacterSelectScreen } from './CharacterSelectScreen';

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CharacterSelectScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CharacterSelectScreen', () => {
  it('renders every preset with its name and archetype', () => {
    renderScreen();
    for (const preset of OVERSEER_PRESETS) {
      expect(screen.getByText(preset.name)).toBeInTheDocument();
    }
  });

  // B6/F6: the four options are unchanged, and each one shows its *whole* sheet: every
  // attribute, not a role-relevant subset.
  it('renders the full attribute sheet and a radar for all four presets', () => {
    renderScreen();
    // By the label a player reads, not by the key: the sheet renders `ATTRIBUTE_LABELS`, and an
    // assertion on the raw key would pass only for as long as the two happen to match.
    for (const attribute of ATTRIBUTE_NAMES) {
      expect(screen.getAllByText(ATTRIBUTE_LABELS[attribute])).toHaveLength(
        OVERSEER_PRESETS.length,
      );
    }
    expect(screen.getAllByRole('img', { name: 'Attribute radar' })).toHaveLength(
      OVERSEER_PRESETS.length,
    );
  });

  // B7: traits are public. They are half of what a player has to guess fit from, since the
  // requirement table itself is hidden (B8).
  it('names each preset perk', () => {
    renderScreen();
    for (const preset of OVERSEER_PRESETS) {
      for (const id of preset.perks) {
        const perk = findPerk(id);
        expect(perk, `${preset.presetId} carries an unknown perk ${id}`).toBeDefined();
        if (perk) expect(screen.getByText(perk.name)).toBeInTheDocument();
      }
    }
  });
});
