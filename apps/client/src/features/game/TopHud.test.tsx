import {
  FEARED_INFAMY,
  OVERSEER_PRESETS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  startingEconomy,
  type EconomyState,
  type Overseer,
} from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TopHud } from './TopHud';

const [preset] = OVERSEER_PRESETS;
if (!preset) throw new Error('expected at least one overseer preset');

const overseer: Overseer = {
  id: 'ov-1',
  name: preset.name,
  archetype: preset.archetype,
  portraitId: preset.portraitId,
  bio: preset.bio,
  attributes: preset.attributes,
  traits: preset.traits,
};

const economy: EconomyState = startingEconomy('2026-08-13T09:30:00.000Z');

/** A real Apothecary, because the stockpile ceiling is read off what is standing. */
const buildings = [
  {
    id: 'b-apothecary',
    kind: 'apothecary' as const,
    level: 4,
    modifications: [],
    damage: 0,
    garrisons: 0,
  },
];

// Inside a router: the identity on the right is a link to the Overseer's own file, and a `Link`
// outside a router context throws rather than degrading.
const renderHud = (override: Partial<EconomyState> = {}) =>
  render(
    <MemoryRouter>
      <TopHud
        overseer={overseer}
        faction="The Ninth Street Reclamation Company"
        resources={STARTING_RESOURCES}
        economy={{ ...economy, ...override }}
        buildings={buildings}
      />
    </MemoryRouter>,
  );

describe('TopHud', () => {
  it('shows every one of the five resources with its amount (GDD §D1–§D6)', () => {
    renderHud();

    expect(RESOURCE_KEYS).toHaveLength(5);
    for (const key of RESOURCE_KEYS) {
      // The chip's name, not a word printed beside it: the bar has to fit five resources, two
      // meters and an identity on one line over the artwork, so the label is what the icon *means*
      // rather than something taking width next to it.
      const chip = screen.getByTestId(`resource-chip-${key}`);
      expect(chip).toBeInTheDocument();
      expect(within(chip).getByText(String(STARTING_RESOURCES[key]))).toBeInTheDocument();
      // The ceiling is drawn as a fill, which is the half of "how much do I have" a bare number
      // cannot answer: whether the next hour of production has anywhere to go.
      expect(within(chip).getByTestId(`resource-fill-${key}`)).toBeInTheDocument();
    }
  });

  it('shows the morale and infamy meters (§D4, §D7)', () => {
    renderHud();

    expect(screen.getByTestId('meter-chip-morale')).toBeInTheDocument();
    expect(screen.getByTestId('meter-chip-infamy')).toBeInTheDocument();
    expect(screen.getByText(String(economy.morale))).toBeInTheDocument();
  });

  it('shows reputation as a word rather than a number (§D8)', () => {
    renderHud();

    expect(screen.getByText('Reputation')).toBeInTheDocument();
    expect(screen.getByText('Cautious')).toBeInTheDocument();
  });

  it('follows the reputation the tally actually derives', () => {
    renderHud({ infamy: FEARED_INFAMY });

    expect(screen.getByText('Feared')).toBeInTheDocument();
  });
});
