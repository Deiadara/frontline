import {
  ITEM_CATALOG,
  findBlackMarketGood,
  findUnit,
  type FeatReward,
  type ItemId,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { RESOURCE_META, RESOURCE_ORDER, ResourceIcon } from '../../components/Resources';
import { Icon } from '../../components/ui/Icon';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { cn } from '../../lib/cn';

/**
 * What a feat pays, as a row of small drawn tokens.
 *
 * Six channels, one vocabulary. The alternative the first draft had was a sentence per channel
 * ("600 caps, 200 scrap and 120 planks, plus 150 experience"), which is unreadable at a hundred
 * and sixty entries and impossible to scan for the one thing a player is short of. A token with
 * the game's own glyph on it is the same information at a glance, and it is the same glyph the
 * stockpile, the inventory and the roster already use, so nothing here has to be learned.
 *
 * Every token carries the thing's name for anybody who cannot see the glyph. It is not drawn,
 * because "+600" beside the caps icon is what the rest of this interface says and a row of six
 * named amounts would be three lines deep on every rung of every ladder.
 */

interface Token {
  key: string;
  glyph: ReactNode;
  /** The figure, drawn. Short: this sits in a row of up to six. */
  amount: string;
  /** What the token is, for assistive tech and for the hover. */
  name: string;
  tone: string;
}

const countByKey = (ids: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

/**
 * The tokens a reward comes to, in the order the channels are worth reading.
 *
 * Exported so the claim receipt and the rung draw the same thing from the same list rather than
 * two components agreeing by accident about what a boost is called.
 */
export function rewardTokens(reward: FeatReward): Token[] {
  const tokens: Token[] = [];

  for (const kind of RESOURCE_ORDER) {
    const amount = reward.resources?.[kind] ?? 0;
    if (amount <= 0) continue;
    tokens.push({
      key: `resource-${kind}`,
      glyph: <ResourceIcon kind={kind} className="h-4 w-4" />,
      amount: `+${Math.round(amount).toLocaleString()}`,
      name: RESOURCE_META[kind].label,
      tone: 'text-ink-100',
    });
  }

  for (const [id, count] of Object.entries(reward.items ?? {})) {
    // A retired id draws the inventory's own mark and is named by its id rather than crashing the
    // screen it is on: `ItemGlyph` reads `ITEM_CATALOG[id].kind` and would throw. The catalogue
    // test refuses an unknown one, so this is only reachable on a save older than a retirement.
    const known = id in ITEM_CATALOG ? (id as ItemId) : undefined;
    const spec = known === undefined ? undefined : ITEM_CATALOG[known];
    tokens.push({
      key: `item-${id}`,
      glyph:
        known === undefined ? (
          <Icon name="inventory" className="h-4 w-4" />
        ) : (
          <ItemGlyph id={known} className="h-4 w-4" />
        ),
      amount: `x${count}`,
      name: spec?.name ?? id,
      tone: 'text-verdigris-100',
    });
  }

  for (const [id, count] of Object.entries(reward.units ?? {})) {
    if (!count) continue;
    tokens.push({
      key: `unit-${id}`,
      glyph: <Icon name="units" className="h-4 w-4" />,
      amount: `x${count}`,
      name: findUnit(id)?.name ?? id,
      tone: 'text-iris-100',
    });
  }

  if (reward.xp !== undefined) {
    tokens.push({
      key: 'xp',
      glyph: <Icon name="level" className="h-4 w-4" />,
      amount: `+${reward.xp.toLocaleString()}`,
      name: 'Experience',
      // `hextech`, the blue the level chip in the top HUD is drawn in. It was brass, which is the
      // pigment caps and the seal already use here, so the one token a player most wants to pick
      // out of a row of six was the same colour as the row. Matching the HUD means the glyph a
      // reward promises and the meter it pays into are recognisably the same thing.
      tone: 'text-hextech-100',
    });
  }

  if (reward.infamy !== undefined) {
    tokens.push({
      key: 'infamy',
      glyph: <Icon name="infamy" className="h-4 w-4" />,
      amount: `+${reward.infamy.toLocaleString()}`,
      name: 'Infamy',
      tone: 'text-oxblood-100',
    });
  }

  // Counted rather than listed: `contraband_2` pays five boosts and only three different ones, so
  // the naive version draws the same token twice under the same name and reads as a bug.
  for (const [id, count] of countByKey(reward.boosts ?? [])) {
    tokens.push({
      key: `boost-${id}`,
      glyph: <Icon name="spark" className="h-4 w-4" />,
      amount: count > 1 ? `x${count}` : '',
      name: findBlackMarketGood(id)?.name ?? id,
      tone: 'text-tangerine-300',
    });
  }

  return tokens;
}

export function RewardTally({
  reward,
  className,
  'data-testid': testId,
}: {
  reward: FeatReward;
  className?: string;
  'data-testid'?: string;
}) {
  const tokens = rewardTokens(reward);

  return (
    <ul
      className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}
      data-testid={testId}
    >
      {tokens.map((token) => (
        <li
          key={token.key}
          // `shrink-0` and no truncation: these are two or three characters each, and a token that
          // wrapped between its glyph and its figure would read as two tokens.
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-sm border border-surface-600/70 bg-surface-900/60 px-1.5 py-0.5',
            'font-display text-[11px] font-bold leading-none tabular-nums',
            token.tone,
          )}
          data-tip={token.name}
        >
          {token.glyph}
          <span className="sr-only">{token.name}</span>
          {token.amount !== '' && <span>{token.amount}</span>}
        </li>
      ))}
    </ul>
  );
}
