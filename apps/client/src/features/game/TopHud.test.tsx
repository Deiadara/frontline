import {
  FEARED_INFAMY,
  OVERSEER_PRESETS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  startingEconomy,
  type EconomyState,
  type Overseer,
} from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RESOURCE_META } from '../../components/Resources';
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

const renderHud = (override: Partial<EconomyState> = {}) =>
  render(
    <TopHud
      overseer={overseer}
      resources={STARTING_RESOURCES}
      economy={{ ...economy, ...override }}
    />,
  );

describe('TopHud', () => {
  it('shows every one of the five resources with its amount (GDD §D1–§D6)', () => {
    renderHud();

    expect(RESOURCE_KEYS).toHaveLength(5);
    for (const key of RESOURCE_KEYS) {
      expect(screen.getByText(RESOURCE_META[key].label)).toBeInTheDocument();
      expect(screen.getAllByText(String(STARTING_RESOURCES[key])).length).toBeGreaterThan(0);
    }
  });

  it('shows the morale and infamy meters (§D4, §D7)', () => {
    renderHud();

    expect(screen.getByText('Morale')).toBeInTheDocument();
    expect(screen.getByText('Infamy')).toBeInTheDocument();
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
