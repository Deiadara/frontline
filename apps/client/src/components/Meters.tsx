import {
  METER_MAX,
  NOTORIETY_BLURBS,
  REPUTATION_LABEL_SPECS,
  notorietyTier,
  notorietyUpgradeCost,
  nextNotorietyTier,
  type EconomyState,
  type ReputationLabel,
} from '@frontline/shared';
import { cn } from '../lib/cn';
import { useUpgradeNotoriety } from '../lib/queries';
import { HoverCard } from './ui/HoverCard';
import { InfoWindow, WindowSection } from './ui/InfoWindow';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';

type MeterKind = 'morale' | 'infamy';

/** GDD §D4 morale and §D7 infamy. Infamy is notoriety, not virtue, so it reads hostile. */
const METER_META: Record<MeterKind, { label: string; fill: string; text: string }> = {
  morale: { label: 'Morale', fill: 'bg-bile-300', text: 'text-bile-300' },
  infamy: { label: 'Infamy', fill: 'bg-oxblood-300', text: 'text-oxblood-300' },
};

interface MeterChipProps {
  kind: MeterKind;
  /** Morale is 0..100. Infamy is a running point total with no ceiling at all (§D7). */
  value: number;
  /**
   * What the bar fills towards.
   *
   * Morale is the only meter with a top of its own. Infamy is a wallet, so the caller supplies the
   * one figure that makes a bar mean anything for it: the price of the next rung on the ladder.
   */
  ceiling?: number;
  /** What follows the figure. Morale is `/ 100`; infamy is `points`. */
  denominator?: string;
}

/** Compact 0..100 meter for the HUD strip. */
/** What each meter is, in the player's words. Shown on hover: see `ReputationChip`. */
const METER_EXPLAINER: Record<MeterKind, string> = {
  morale:
    'How the crew feels about working for you. It does not jump when you do something. It drifts towards whatever the district can actually sustain: power, beds, and a payday that lands when you said it would.',
  infamy:
    'How loudly the city knows your name, as a running total that has no top. Everything you kill adds to it, and taking ground off the Combine adds more. Nothing takes it away except you spending it.',
};

/** The concrete levers behind each meter, so the window teaches rather than describes. */
const METER_DRIVERS: Record<MeterKind, readonly string[]> = {
  morale: [
    'Beds in the Quarters, and power to run them',
    'A payday that lands on time, and food in the store',
    'The Infirmary, which takes the edge off a bad week',
  ],
  infamy: [
    'Every unit you kill, priced by what it was',
    'Taking ground, and more of it off the Combine',
    'It gates who signs with you, what the workshop will fit, and what you may field',
  ],
};

export function MeterChip({
  kind,
  value,
  ceiling = METER_MAX,
  denominator = `/ ${METER_MAX}`,
}: MeterChipProps) {
  const meta = METER_META[kind];
  const pct = ceiling > 0 ? Math.max(0, Math.min(100, (value / ceiling) * 100)) : 100;
  const reading =
    kind === 'infamy'
      ? `${meta.label}: ${Math.round(value)} points`
      : `${meta.label}: ${Math.round(value)} of ${METER_MAX}`;
  return (
    <HoverCard
      data-testid={`meter-hover-${kind}`}
      label={reading}
      size="window"
      card={
        <InfoWindow
          eyebrow="Standing"
          title={meta.label}
          tone={kind === 'infamy' ? 'oxblood' : 'brass'}
          icon={
            <span className={cn('block h-full w-full [&_svg]:h-full [&_svg]:w-full', meta.text)}>
              <Icon name={kind === 'morale' ? 'morale' : 'infamy'} />
            </span>
          }
          figure={
            <span className="flex items-baseline gap-2">
              <span className={cn('font-display text-2xl font-bold tabular-nums', meta.text)}>
                {Math.round(value)}
              </span>
              <span className="font-display text-base tabular-nums text-ink-300">
                {denominator}
              </span>
            </span>
          }
        >
          <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950/80">
            <span
              className={cn('block h-full rounded-sm', meta.fill)}
              style={{ width: `${pct}%` }}
            />
          </span>
          <p className="font-body text-[14px] leading-relaxed text-ink-100">
            {METER_EXPLAINER[kind]}
          </p>
          <WindowSection label="What moves it">
            <ul className="flex flex-col gap-0.5">
              {METER_DRIVERS[kind].map((driver) => (
                <li
                  key={driver}
                  className="flex gap-2 font-body text-[13px] leading-snug text-ink-100"
                >
                  <span
                    aria-hidden
                    className={cn('mt-[7px] h-1 w-1 shrink-0 rounded-full', meta.fill)}
                  />
                  {driver}
                </li>
              ))}
            </ul>
          </WindowSection>
        </InfoWindow>
      }
    >
      <div
        className="edge-lit flex shrink-0 items-center gap-1.5 rounded-sm border border-surface-600/80 bg-surface-800/80 px-1.5 py-1"
        data-testid={`meter-chip-${kind}`}
      >
        {/* Same tile the stockpile chips use, for the same reason: a glyph on the panel's own
            colour is the least legible thing in the bar. */}
        <span
          aria-hidden
          className={cn(
            'icon-tile flex h-12 w-12 shrink-0 items-center justify-center rounded-sm',
            '[&_svg]:h-11 [&_svg]:w-11',
            meta.text,
          )}
        >
          <Icon name={kind === 'morale' ? 'morale' : 'infamy'} />
        </span>
        {/* The word, and under it a bar only as wide as the word.
            The bar used to be a fixed 40-56px sitting *beside* the label, which is 50px of a
            standing bar that already has the same number written next to it in full contrast.
            Doubling the glyphs had to come out of somewhere, and a duplicated readout is the
            cheapest thing on the row. */}
        <span className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden font-display text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-ink-200 [@media(min-width:1700px)]:block"
          >
            {meta.label}
          </span>
          <span className="hidden h-1.5 w-full rounded-sm bg-surface-700 [@media(min-width:1700px)]:block">
            <span
              className={cn('block h-full rounded-sm', meta.fill)}
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
        <span className={cn('font-display text-lg font-bold leading-none tabular-nums', meta.text)}>
          {Math.round(value)}
        </span>
      </div>
    </HoverCard>
  );
}

/**
 * §D7: the wallet and the rank, side by side.
 *
 * Infamy is two things now and the chip has to show both, because they behave in opposite
 * directions: the points go up when you kill people and *down* when you spend them, and the rank
 * only ever goes up. A player who saw the points fall after buying a boost, with no rank beside
 * them, would reasonably conclude the game had taken their standing away.
 *
 * The bar under the word fills towards the price of the next rung rather than towards nothing,
 * which is what turns a running total into a goal. At the top of the ladder there is no next rung
 * and the bar is simply full.
 *
 * The card is interactive, so the button inside it is a real button. The chip itself does nothing
 * on click: a purchase this expensive should not be one stray click away.
 */
export function InfamyChip({ infamy, notoriety }: { infamy: number; notoriety: number }) {
  const tier = notorietyTier(notoriety);
  const next = nextNotorietyTier(notoriety);
  const cost = notorietyUpgradeCost(notoriety);
  const upgrade = useUpgradeNotoriety();
  const affordable = cost !== null && infamy >= cost;
  const pct = cost === null ? 100 : Math.max(0, Math.min(100, (infamy / cost) * 100));

  return (
    <HoverCard
      data-testid="infamy-hover"
      label={`Infamy: ${Math.round(infamy)} points, and they call you ${tier}`}
      size="window"
      interactive
      card={
        <InfoWindow
          eyebrow="They call you"
          title={tier}
          tone="oxblood"
          plate="dark"
          icon={
            <span className="block h-full w-full text-oxblood-300 [&_svg]:h-full [&_svg]:w-full">
              <Icon name="infamy" />
            </span>
          }
          figure={
            <span className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold tabular-nums text-oxblood-300">
                {Math.round(infamy)}
              </span>
              <span className="font-display text-base text-ink-300">infamy</span>
            </span>
          }
        >
          <p className="font-body text-[14px] leading-relaxed text-ink-100">
            {NOTORIETY_BLURBS[tier]}
          </p>
          <WindowSection label={next === null ? 'The top of it' : 'Next up'}>
            {next === null || cost === null ? (
              <p className="font-body text-[13px] leading-snug text-ink-100">
                There is no name above this one. Everything you earn from here is yours to spend.
              </p>
            ) : (
              <div className="flex flex-col gap-2" data-testid="notoriety-next">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-base font-bold tracking-[0.08em] text-brass-300">
                    {next}
                  </span>
                  <span className="font-display text-[13px] tabular-nums text-ink-200">
                    {cost.toLocaleString()} infamy
                  </span>
                </div>
                <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950/80">
                  <span
                    className="block h-full rounded-sm bg-oxblood-300"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <p className="font-body text-[13px] leading-snug text-ink-300">
                  {affordable
                    ? 'The points are spent and the name is yours for good. Nothing takes a rank back.'
                    : `${Math.max(0, cost - Math.round(infamy)).toLocaleString()} short. Kill something worth talking about.`}
                </p>
                <Button
                  size="sm"
                  disabled={!affordable || upgrade.isPending}
                  onClick={() => upgrade.mutate(undefined)}
                  data-testid="upgrade-tier"
                >
                  Upgrade Tier
                </Button>
              </div>
            )}
          </WindowSection>
        </InfoWindow>
      }
    >
      <div
        className="edge-lit flex shrink-0 items-center gap-1.5 rounded-sm border border-surface-600/80 bg-surface-800/80 px-1.5 py-1"
        data-testid="infamy-chip"
      >
        <span
          aria-hidden
          className="icon-plate flex h-12 w-12 shrink-0 items-center justify-center rounded-sm text-oxblood-300 [&_svg]:h-10 [&_svg]:w-10"
        >
          <Icon name="infamy" />
        </span>
        <span className="flex flex-col gap-1.5">
          <span
            aria-hidden
            className="hidden font-display text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-ink-200 [@media(min-width:1700px)]:block"
          >
            Infamy
          </span>
          <span className="hidden h-1.5 w-full rounded-sm bg-surface-700 [@media(min-width:1700px)]:block">
            <span className="block h-full rounded-sm bg-oxblood-300" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="font-display text-lg font-bold leading-none tabular-nums text-oxblood-300">
          {Math.round(infamy)}
        </span>
        {/* The rank, beside the points and visibly a different kind of thing: a word on a brass
            plate, not another number.

            Hidden below 1400px, which is the same width the two meter labels appear at and for the
            same reason: the standing bar has to fit five resources, two doors and an identity on
            one line, and a line that wraps costs fifty pixels of the world underneath it. The hover
            card carries the rank at every width, and it is the only place the ladder and its price
            are legible anyway. */}
        <span
          className="hidden shrink-0 border-l border-surface-600 pl-1.5 font-display text-[12px] font-bold uppercase leading-none tracking-[0.1em] text-brass-300 [@media(min-width:1400px)]:block"
          data-testid="notoriety-tier"
        >
          {tier}
        </span>
      </div>
    </HoverCard>
  );
}

/**
 * §D8: reputation is a word, not a number. The label is derived from tallied actions, so it is
 * shown as the street's verdict rather than as a score the player can read off a bar.
 */
/**
 * What the street calls you, and, on hover, what that actually means.
 *
 * A one-word standing is the most opaque thing in the HUD: "Opportunist" is flavour until somebody
 * tells you it is a *judgement the city has made about your behaviour*, and nothing in the
 * interface ever said so. The sentence already exists: every label carries one in
 * `REPUTATION_LABEL_SPECS`, written by the people who designed the mechanic, and it was being
 * shown nowhere at all. This is the cheapest possible fix: put words that are already written in
 * front of the player at the moment they are looking at the thing they describe.
 */
export function ReputationChip({ label }: { label: ReputationLabel }) {
  const spec = REPUTATION_LABEL_SPECS[label];
  return (
    <HoverCard
      data-testid="reputation-chip"
      label={`Reputation: ${label}`}
      size="window"
      card={
        <InfoWindow eyebrow="The street calls you" title={label}>
          <p className="font-body text-[14px] leading-relaxed text-ink-100">{spec.description}</p>
          <WindowSection label="Where it comes from">
            <p className="font-body text-[13px] leading-snug text-ink-100">
              Read off what you have actually done: raids, contracts, who you left standing. It
              fades if you stop.
            </p>
          </WindowSection>
          <WindowSection label="What it changes">
            <p className="font-body text-[13px] leading-snug text-ink-100">
              Every character at the Bar judges your crew by this word before they will sign, and
              half of them will walk over it. It is the one number other players see.
            </p>
          </WindowSection>
        </InfoWindow>
      }
    >
      <div className="edge-lit flex shrink-0 items-center gap-2 rounded-sm border border-brass-500/40 bg-surface-800/80 px-2.5 py-2">
        {/* The word costs ~80px and says nothing the hover card does not. Below xl the standing
            itself is the label, which is the half a player is actually reading. */}
        <span className="hidden font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-200 [@media(min-width:1700px)]:inline">
          Reputation
        </span>
        <span className="font-display text-base font-bold tracking-[0.08em] text-brass-300">
          {label}
        </span>
      </div>
    </HoverCard>
  );
}

interface StandingReadoutProps {
  economy: EconomyState;
  reputation: ReputationLabel;
}

/** The full standing block for the base screen: both meters plus the reputation the street uses. */
export function StandingReadout({ economy, reputation }: StandingReadoutProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <MeterChip kind="morale" value={economy.morale} />
        <InfamyChip infamy={economy.infamy} notoriety={economy.notoriety} />
      </div>
      <div className="border border-surface-600/70 bg-surface-950 p-3">
        <p className="font-display text-[10px] uppercase tracking-[0.25em] text-ink-300">
          They call you
        </p>
        <p className="mt-1 font-display text-lg font-bold tracking-[0.12em] text-brass-300">
          {reputation}
        </p>
        <p className="mt-1 font-body text-[12px] leading-relaxed text-ink-300">
          {REPUTATION_LABEL_SPECS[reputation].description}
        </p>
      </div>
    </div>
  );
}
