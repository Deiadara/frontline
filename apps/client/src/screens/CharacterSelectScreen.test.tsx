import { OVERSEER_PRESETS, SKILL_NAMES } from '@frontline/shared';
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

  it('renders skill bars and a radar for all four presets', () => {
    renderScreen();
    for (const skill of SKILL_NAMES) {
      expect(screen.getAllByText(skill)).toHaveLength(OVERSEER_PRESETS.length);
    }
    expect(screen.getAllByRole('img', { name: 'Skill radar' })).toHaveLength(
      OVERSEER_PRESETS.length,
    );
  });
});
