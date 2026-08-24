import {
  ATTRIBUTE_EFFECTS,
  ATTRIBUTE_LABELS,
  CHANNEL_LABELS,
  EFFECT_CHANNELS,
  TRAIT_CATALOG,
  attributesDriving,
  isFlaw,
  type AttributeName,
  type EffectChannel,
  type TraitId,
} from '@frontline/shared';
import { Link } from 'react-router-dom';
import { DescribedTag } from '../../components/ui/DescribedTag';
import { cn } from '../../lib/cn';
import { useCrewStanding } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { AttributeRadar } from './AttributeRadar';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';

/**
 * Who you are, and what the people around you are worth (§F1, §F2).
 *
 * The second half is the part that did not exist. A sheet of thirty-five numbers is unreadable
 * unless it says what the numbers *do*, and until now they did nothing at all — so this page is
 * built the other way round from a character sheet: it leads with the outcomes, and each outcome
 * names the attributes that moved it and the crew's rating in each. A player asking "why is my
 * research slow" gets the answer on one line, along with who they would need to hire to fix it.
 *
 * The crew sheet is best-of across the Overseer and every officer, which is why an officer's good
 * number shows up here as *yours*. That is the point of hiring one.
 */
export function OverseerProfilePage() {
  const query = useCrewStanding();

  const data = query.data;
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Reading the file…
        </p>
      </div>
    );
  }

  const { overseer, crewSheet, effects } = data;
  const live = EFFECT_CHANNELS.filter((channel) => (effects[channel] ?? 0) > 0);
  const dormant = EFFECT_CHANNELS.filter((channel) => (effects[channel] ?? 0) <= 0);

  return (
    <PageShell title={overseer.name} icon="crew" wide>
      <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="painted washed rivets edge-lit overflow-hidden rounded-sm border border-surface-600/70">
            <OverseerPortrait
              portraitId={overseer.portraitId}
              archetype={overseer.archetype}
              showTag={false}
            />
          </div>
          <div>
            <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
              Overseer
            </p>
            <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-200">
              {overseer.bio}
            </p>
          </div>
          {overseer.traits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {overseer.traits.map((trait: TraitId) => (
                <DescribedTag
                  key={trait}
                  label={TRAIT_CATALOG[trait].name}
                  description={TRAIT_CATALOG[trait].description}
                  detail={traitDetail(trait)}
                  className={
                    isFlaw(trait)
                      ? 'border-oxblood-500 text-oxblood-300'
                      : 'border-brass-300/50 text-brass-300'
                  }
                />
              ))}
            </div>
          )}
          <Link
            to="/game/training"
            className="rounded-sm border border-brass-300/60 px-3 py-2 text-center font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-colors hover:bg-brass-300/10"
          >
            Go and train
          </Link>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <InfoNote>
            Every number below is the best anyone on your books has, yourself included. Hiring a
            specialist raises it; so does an hour in the Training tab. Nothing here is about how
            well somebody suits their job, which is yours to judge.
          </InfoNote>

          <section className="flex flex-col gap-2">
            <h2 className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
              Your own sheet
            </h2>
            <div className="painted washed rounded-sm border border-surface-600/70 bg-surface-800/50 p-3">
              <AttributeSheet attributes={overseer.attributes} />
            </div>
          </section>

          <section className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
                What the crew is buying
              </h2>
              <ul className="flex flex-col gap-1.5" data-testid="crew-effects">
                {live.map((channel) => (
                  <ChannelRow
                    key={channel}
                    channel={channel}
                    amount={effects[channel] ?? 0}
                    sheet={crewSheet}
                  />
                ))}
              </ul>
            </div>
            <div className="h-44 w-full">
              <AttributeRadar attributes={crewSheet} />
            </div>
          </section>

          {dormant.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
                Nothing there yet
              </h2>
              <ul className="flex flex-wrap gap-1.5">
                {dormant.map((channel) => (
                  <li
                    key={channel}
                    className="rounded-sm border border-surface-700 px-2 py-1 font-display text-[11px] uppercase tracking-[0.12em] text-ink-300"
                  >
                    {CHANNEL_LABELS[channel].label}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** One outcome, what it is worth, and who on the books is responsible for it. */
function ChannelRow({
  channel,
  amount,
  sheet,
}: {
  channel: EffectChannel;
  amount: number;
  sheet: Record<string, number>;
}) {
  const { label, unit } = CHANNEL_LABELS[channel];
  const drivers = attributesDriving(channel);

  return (
    <li
      data-testid={`channel-${channel}`}
      // Deliberately not `painted`, unlike the sheet above it and the shell around it.
      //
      // `painted::before` is a soft-light layer, and soft-light is a *blend*: one of them over a
      // panel is the intended texture, but twenty-two of them stacked down one scrolling column
      // washed the whole column out to a pale grey static field with the type barely readable
      // through it. Measured, not guessed — dropping the class from these rows alone restores the
      // page, with the same class left in place on the block above and on the shell. There is a
      // gate for it in `visual.spec.ts`; put `painted` back here and it fails.
      className="rounded-sm border border-surface-600/70 bg-surface-800/50 px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-body text-[13px] text-ink-100">{label}</span>
        <span className="shrink-0 font-display text-[13px] font-bold tabular-nums text-brass-300">
          +{amount}
          {unit === 'percent' ? '%' : ''}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {drivers.map((name: AttributeName) => (
          <span
            key={name}
            title={ATTRIBUTE_EFFECTS[name].summary}
            className={cn(
              'font-display text-[11px] uppercase tracking-[0.1em] tabular-nums',
              (sheet[name] ?? 0) > 0 ? 'text-ink-300' : 'text-ink-300',
            )}
          >
            {ATTRIBUTE_LABELS[name]} {sheet[name] ?? 0}
          </span>
        ))}
      </div>
    </li>
  );
}

/** A trait's whole mechanical effect, written out — the rule behind the name. */
function traitDetail(trait: TraitId): string {
  return Object.entries(TRAIT_CATALOG[trait].bonus)
    .map(
      ([name, amount]) =>
        `${amount > 0 ? '+' : ''}${amount} ${ATTRIBUTE_LABELS[name as AttributeName]}`,
    )
    .join(' · ');
}
