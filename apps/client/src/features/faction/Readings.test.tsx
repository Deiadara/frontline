import { averageLevel, type FactionResponse } from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { Readings } from './Readings';

/**
 * The four dials over the room, and the two the board changed on 2026-09-12.
 *
 * **Earned** is the faction's own append-only total, and it used to be the sum of the members'
 * contribution rows. Those two agree right up until somebody leaves: the faction keeps what a
 * leaver won (§J8) and the sum does not, so the faction screen and the standings quoted two
 * different numbers for one thing and the screen was the wrong one. The fixture below is built so
 * they disagree, because on the shipped fixture they happen to match and a test written against it
 * would pass whichever field it read.
 *
 * **Av. level** is new: what the table is worth walking into, as a whole number, off the roster on
 * every render so a seat changing hands changes it.
 */

const NOW = new Date(F.factionScreen.serverNow);

/** The shipped screen with one seat emptied, which is the state the two figures disagree in. */
function afterSomebodyLeft(): FactionResponse {
  const stayed = F.factionScreen.members[0];
  if (!stayed) throw new Error('fixture error: the faction screen has no members');
  return { ...F.factionScreen, members: [stayed] };
}

function draw(data: FactionResponse) {
  render(
    <Readings
      data={data}
      now={NOW}
      canAsk
      onInvite={() => {}}
      onOpenFight={() => {}}
      onOpenFights={() => {}}
    />,
  );
}

describe('the readings over the faction room', () => {
  it('reports what the badge has earned, not what is left at the table', () => {
    const data = afterSomebodyLeft();
    const faction = data.faction;
    if (!faction) throw new Error('fixture error: no faction on the screen');
    const stillSeated = data.members.reduce((total, member) => total + member.infamyEarned, 0);
    // The precondition: the two candidate figures are genuinely different numbers here.
    expect(stillSeated).not.toBe(faction.infamyEarned);

    draw(data);

    const dial = within(screen.getByTestId('dial-earned'));
    expect(dial.getByText(faction.infamyEarned.toLocaleString())).toBeInTheDocument();
    expect(dial.queryByText(stillSeated.toLocaleString())).toBeNull();
  });

  it('averages the levels at the table as a whole number', () => {
    draw(F.factionScreen);

    const levels = F.factionScreen.members.map((member) => member.level);
    // The precondition again: a roster where everybody is the same level cannot tell a mean from
    // any other reading of it.
    expect(new Set(levels).size).toBeGreaterThan(1);

    const dial = within(screen.getByTestId('dial-level'));
    expect(dial.getByText(String(averageLevel(levels)))).toBeInTheDocument();
    // Not the best of them wearing a different label.
    expect(dial.queryByText(String(Math.max(...levels)))).toBeNull();
  });

  it('moves the average when the roster does', () => {
    draw(F.factionScreen);
    const both = screen.getByTestId('dial-level').textContent ?? '';

    screen.getByTestId('dial-level').remove();
    draw(afterSomebodyLeft());
    const alone = screen.getByTestId('dial-level').textContent ?? '';

    expect(alone).not.toBe(both);
  });
});
