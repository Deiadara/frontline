import {
  NOTORIETY_BLURBS,
  NOTORIETY_TIERS,
  describeNotorietyGrant,
  notorietySpentTo,
  notorietyTier,
  notorietyUpgradeCost,
  type NotorietyTier,
} from '@frontline/shared';
import { useMe } from '../../lib/queries';
import { cn } from '../../lib/cn';
import { DrawnMeter } from '../../components/Meters';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoadSheet } from '../game/PageShell';
import { DoneMark, RungDisc } from './marks';
import { PaperBlock, StandingSheet } from './StandingSheet';

/**
 * The whole notoriety ladder: fourteen rungs, what each costs and what each pays.
 *
 * The infamy chip's card sells exactly one rung, the next one, which is the right thing for a card
 * that is two inches wide and has a Buy button on it. It is the wrong thing for the question a
 * player actually has, which is what the far end of this looks like and whether it is worth saving
 * for. `Nameless` costs 300 x 3^12 infamy; a player should be able to see that from where they are
 * standing, the way a Grepolis player can read the whole title list on day one.
 *
 * Every figure is read off `@frontline/shared`: {@link NOTORIETY_TIERS} for the names,
 * {@link notorietyUpgradeCost} for the price of a rung, {@link notorietySpentTo} for the total, and
 * {@link describeNotorietyGrant} for what it pays. Nothing on this screen is re-derived, so
 * retuning `NOTORIETY_FIRST_COST` moves the page with the game.
 */

function Rung({
  at,
  tier,
  rank,
}: {
  /** The rung's index into {@link NOTORIETY_TIERS}. */
  at: number;
  tier: NotorietyTier;
  /** The rank the crew currently holds. */
  rank: number;
}) {
  const held = at <= rank;
  const here = at === rank;
  // The price of *reaching* this rung, which is what the rung below it charges to leave.
  const price = at === 0 ? null : notorietyUpgradeCost(at - 1);
  const grant = describeNotorietyGrant(at);

  return (
    <li
      className="flex items-start gap-3 py-2"
      data-testid={`notoriety-rung-${at}`}
      // The rung the crew holds, said in the markup rather than only in brass.
      aria-current={here ? 'step' : undefined}
    >
      <RungDisc tone={here ? 'text-brass-300' : held ? 'text-ink-500' : 'text-iris-300'}>
        {at}
      </RungDisc>
      <span className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              'font-stamp text-[15px] leading-none',
              here ? 'text-brass-100' : held ? 'text-ink-300' : 'text-ink-100',
            )}
          >
            {tier}
          </span>
          {held && <DoneMark className="text-verdigris-300" />}
          <span aria-hidden className="ink-rule min-w-0 flex-1 translate-y-[-2px]" />
          {price === null ? (
            <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.12em] text-ink-400">
              Where everybody starts
            </span>
          ) : (
            <>
              <span className="shrink-0 font-stamp text-[14px] leading-none tabular-nums text-oxblood-300">
                {price.toLocaleString()}
              </span>
              <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.12em] text-ink-400">
                infamy
              </span>
              {/* The running total, because the price of one rung is not what a player is saving
                  up: the ladder triples, so by `Scourge` the rung and the journey are different
                  orders of magnitude and only one of them answers "how far is this". */}
              <span
                className="shrink-0 font-display text-[11px] tabular-nums text-ink-400"
                data-testid={`notoriety-total-${at}`}
              >
                ({notorietySpentTo(at).toLocaleString()} in all)
              </span>
            </>
          )}
        </span>
        <span className="font-body text-[12px] leading-snug text-ink-300">
          {NOTORIETY_BLURBS[tier]}
        </span>
        {grant.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={`What ${tier} pays`}>
            {grant.map((line) => (
              <li
                key={line}
                className="rounded-sm border border-brass-300/40 bg-brass-500/10 px-1.5 py-px font-display text-[11px] font-bold tracking-[0.04em] text-brass-100"
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </span>
    </li>
  );
}

export function NotorietyLadderPage() {
  const me = useMe();
  const base = me.data?.base ?? null;

  if (base === null) {
    return (
      <ScreenLoadSheet
        what="The ladder"
        loading="Asking around about you…"
        isError={me.isError}
        onRetry={() => void me.refetch()}
      />
    );
  }

  const { infamy, notoriety } = base.economy;
  const tier = notorietyTier(notoriety);
  const cost = notorietyUpgradeCost(notoriety);
  const pct = cost === null ? 100 : Math.max(0, Math.min(100, (infamy / cost) * 100));

  return (
    <StandingSheet title="The name they give you">
      <PaperBlock
        className="flex flex-wrap items-center gap-x-6 gap-y-3"
        data-testid="notoriety-standing"
      >
        <span className="flex items-center gap-3">
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center text-oxblood-300 [&_svg]:h-9 [&_svg]:w-9">
            <Icon name="infamy" />
          </span>
          <span className="flex flex-col">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-400">
              They call you
            </span>
            <span className="font-stamp text-[22px] leading-none text-ink-100">{tier}</span>
          </span>
        </span>
        <span className="flex min-w-[16rem] flex-1 flex-col gap-2">
          <span className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tabular-nums text-oxblood-300">
              {Math.round(infamy).toLocaleString()}
            </span>
            <span className="font-display text-base text-ink-300">
              {cost === null
                ? 'infamy, and no rank above this one'
                : `infamy, of ${cost.toLocaleString()} for the next rung`}
            </span>
          </span>
          <DrawnMeter
            percent={pct}
            className="text-oxblood-300"
            data-testid="notoriety-standing-meter"
          />
        </span>
      </PaperBlock>

      <PaperBlock>
        <ol className="flex flex-col" data-testid="notoriety-ladder">
          {NOTORIETY_TIERS.map((name, at) => (
            <Rung key={name} at={at} tier={name} rank={notoriety} />
          ))}
        </ol>
      </PaperBlock>

      {/* The one thing about this ladder a player has to be told rather than shown: the points and
          the rank are two fields, and buying a rank spends the first without touching the second.
          §D7 exists because they used to be one number doing both jobs. */}
      <PaperBlock>
        <p className="font-body text-[13px] leading-snug text-ink-300">
          A rank is bought once and kept. Infamy is the wallet: it goes up when you take ground and
          down when you spend it, and spending it never costs you a rank you have already earned.
        </p>
      </PaperBlock>
    </StandingSheet>
  );
}
