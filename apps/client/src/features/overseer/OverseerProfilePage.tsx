import {
  ATTRIBUTE_EFFECTS,
  ATTRIBUTE_LABELS,
  CHANNEL_LABELS,
  EFFECT_CHANNELS,
  attributesDriving,
  type AttributeName,
  type EffectChannel,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { RATING_TEXT, ratingBand } from '../../lib/rating';
import { useCrewStanding } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { AttributeRadar } from './AttributeRadar';
import { AttributeSheet } from './AttributeSheet';
import { OverseerPortrait } from './OverseerPortrait';
import { PerkTags } from '../../components/PerkTags';

/**
 * Who you are, and what the people around you are worth (§F1, §F2).
 *
 * The second half is the part that did not exist. A sheet of thirty-five numbers is unreadable
 * unless it says what the numbers *do*, and until now they did nothing at all, so this page is
 * built the other way round from a character sheet: it leads with the outcomes, and each outcome
 * names the attributes that moved it and the crew's rating in each. A player asking "why is my
 * research slow" gets the answer on one line, along with who they would need to hire to fix it.
 *
 * The crew sheet is best-of across the Overseer and every officer, which is why an officer's good
 * number shows up here as *yours*. That is the point of hiring one.
 *
 * ## The shape of it
 *
 * A fixed frame with the person down the left and their numbers in the middle, the same console
 * shape the Training, Research and Bar screens use. It was a scrolling document, and the twenty-two
 * outcome rows are the longest thing on it: the radar that reads them ended up stranded in a
 * column beside a list that ran off the bottom of the screen.
 */

/**
 * What each outcome touches, so twenty-two rows read as three kinds of thing.
 *
 * A `Record` over the channel union rather than a lookup with a fallback: a channel added to
 * `EFFECT_CHANNELS` and not grouped here is a **compile error**, which is the only kind of
 * exhaustiveness worth relying on. A `?? 'district'` would have shipped the next one silently in
 * the wrong bucket.
 */
const CHANNEL_GROUP: Readonly<Record<EffectChannel, 'fight' | 'district' | 'books' | 'intel'>> = {
  defensePercent: 'fight',
  unitOffensePercent: 'fight',
  unitVitalityPercent: 'fight',
  unitMoraleFlat: 'fight',
  unitSpeedPercent: 'fight',
  unitStealthPercent: 'fight',
  intimidationFlat: 'fight',
  casualtyRecoveryPercent: 'fight',
  cohesionPercent: 'fight',
  lootCapacityPercent: 'fight',
  travelSpeedPercent: 'fight',
  researchSpeedPercent: 'district',
  buildSpeedPercent: 'district',
  trainingSpeedPercent: 'district',
  trainingCostPercent: 'district',
  productionPercent: 'district',
  storageCapacityPercent: 'district',
  buildCostPercent: 'district',
  wageDiscountPercent: 'books',
  recruitPoolPercent: 'books',
  intelYieldPercent: 'intel',
  intelResistancePercent: 'intel',
};

const GROUP_STYLE: Readonly<
  Record<(typeof CHANNEL_GROUP)[EffectChannel], { icon: IconName; ink: string; edge: string }>
> = {
  fight: { icon: 'sword', ink: 'text-oxblood-300', edge: 'border-oxblood-500/40' },
  district: { icon: 'district', ink: 'text-verdigris-100', edge: 'border-verdigris-300/40' },
  books: { icon: 'crew', ink: 'text-brass-300', edge: 'border-brass-500/40' },
  intel: { icon: 'eye', ink: 'text-iris-100', edge: 'border-iris-300/40' },
};

/** A section of the file: a plated mark, a name, a drawn rule, and what is under it. */
function FileSection({
  icon,
  title,
  note,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
          >
            <Icon name={icon} />
          </span>
          <h2 className="min-w-0 flex-1 font-stamp text-[17px] leading-tight text-ink-100">
            {title}
          </h2>
          {action}
        </div>
        <span aria-hidden className="ink-rule block w-full" />
        {note !== undefined && (
          <p className="font-body text-[12px] leading-snug text-ink-300">{note}</p>
        )}
      </header>
      {children}
    </section>
  );
}

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
    <PageShell wide fills>
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        {/* Who. The one block on the screen that is about the person rather than the numbers. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Panel className="min-h-0 border border-surface-500/70">
            <div className="min-h-0 overflow-y-auto">
              {/* Capped against the viewport, not just the rail's width. A 3:4 portrait at the
                  rail's full width is 405px tall, which on a 720-tall laptop leaves nothing under
                  it: the name was cut in half at the panel's scroll edge. Cropped from the bottom,
                  because that is where a portrait has least to say. */}
              <div className="painted washed edge-lit max-h-[30vh] shrink-0 overflow-hidden border-b border-surface-600/70">
                <OverseerPortrait
                  portraitId={overseer.portraitId}
                  archetype={overseer.archetype}
                  showTag={false}
                />
              </div>
              <div className="flex flex-col gap-2.5 p-3.5">
                <div>
                  <h1
                    className="break-words font-stamp text-[20px] leading-tight text-ink-100"
                    data-testid="overseer-name"
                  >
                    {overseer.name}
                  </h1>
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                    Overseer
                  </p>
                </div>
                <span aria-hidden className="ink-rule block w-full" />
                <p className="font-body text-[13px] italic leading-relaxed text-ink-200">
                  {overseer.bio}
                </p>
                <PerkTags perks={overseer.perks} tone="profile" />
              </div>
            </div>
          </Panel>

          {/* The one thing you can do about any of it, at the foot of the rail. */}
          <Link
            to="/game/training"
            className="door-tile mt-auto flex shrink-0 items-center justify-center gap-2 rounded-md border border-brass-500/60 px-3 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-all duration-150 hover:-translate-y-0.5 hover:border-brass-300 hover:text-brass-100"
          >
            <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
              <Icon name="training" />
            </span>
            <span className="relative z-[2]">Go and train</span>
          </Link>
        </div>

        <div
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto"
          data-testid="file-body"
        >
          <FileSection
            icon="crew"
            title="Your own sheet"
            note="Every attribute you carry, whatever your role"
          >
            <AttributeSheet attributes={overseer.attributes} columns={4} />
          </FileSection>

          <FileSection
            icon="spark"
            title="What the crew is buying"
            note="The best figure anyone on your books has, and what it pays for"
            action={
              <InfoNote label="Whose numbers these are">
                Every number below is the best anyone on your books has, yourself included. Hiring a
                specialist raises it; so does an hour in the Training tab. Nothing here is about how
                well somebody suits their job, which is yours to judge.
              </InfoNote>
            }
          >
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_14rem]">
              <ul
                className="grid min-w-0 gap-2 md:grid-cols-2 [@media(min-width:1600px)]:grid-cols-3"
                data-testid="crew-effects"
              >
                {live.map((channel) => (
                  <ChannelCard
                    key={channel}
                    channel={channel}
                    amount={effects[channel] ?? 0}
                    sheet={crewSheet}
                  />
                ))}
              </ul>
              {/* The radar gets a frame and a name. It used to float in a column beside the list
                  with four three-letter labels and nothing to say what it was. */}
              <div className="card-paper edge-lit flex flex-col gap-1.5 rounded-sm border border-surface-500/70 p-3">
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
                  The shape of the crew
                </p>
                <div className="h-44 w-full">
                  <AttributeRadar attributes={crewSheet} />
                </div>
              </div>
            </div>
          </FileSection>

          {dormant.length > 0 && (
            <FileSection
              icon="lock"
              title="Nothing there yet"
              note="Channels no one on the books can open"
            >
              <ul className="flex flex-wrap gap-1.5">
                {dormant.map((channel) => (
                  <li
                    key={channel}
                    className="flex items-center gap-1.5 rounded-sm border border-surface-700 px-2 py-1 font-display text-[11px] uppercase tracking-[0.12em] text-ink-300"
                  >
                    <Icon name="lock" className="h-3 w-3" />
                    {CHANNEL_LABELS[channel].label}
                  </li>
                ))}
              </ul>
            </FileSection>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** One outcome, what it is worth, and who on the books is responsible for it. */
function ChannelCard({
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
  const style = GROUP_STYLE[CHANNEL_GROUP[channel]];

  return (
    <li
      data-testid={`channel-${channel}`}
      /*
       * `card-paper` and `edge-lit`, never `painted` or `washed`.
       *
       * Both of those are `mix-blend-mode: soft-light` layers. One over a panel is the intended
       * texture; twenty-two of them stacked down this list washed the whole column out to a pale
       * grey static field with the type barely readable through it. Measured, not guessed: dropping
       * them from these cards alone restores the page, with the same classes left in place on the
       * shell and on the portrait. `card-paper` is a plain gradient and `edge-lit` an inset shadow,
       * so neither blends and neither compounds. There is a gate for this in `visual.spec.ts`
       * (`expectSheetNotWashedOut`); put `painted` back here and it fails.
       */
      className={cn(
        'card-paper edge-lit flex min-w-0 flex-col gap-2 rounded-sm border p-2.5',
        style.edge,
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn('mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4', style.ink)}
          data-tip={CHANNEL_LABELS[channel].label}
        >
          <Icon name={style.icon} />
        </span>
        <span className="min-w-0 flex-1 break-words font-body text-[13px] leading-tight text-ink-100">
          {label}
        </span>
        {/* The figure on a plate: it is the one number on the card and what two outcomes are
            compared on. */}
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1.5 py-0.5 font-display text-[12px] font-bold tabular-nums',
            style.edge,
            style.ink,
          )}
        >
          +{amount}
          {unit === 'percent' ? '%' : ''}
        </span>
      </div>
      {/* Who is responsible, as chips carrying their own rating colour rather than a row of grey
          `Label 15`s. The colour is the same four bands every rating in the game is read on, so
          "which of these is holding the number down" is answered without reading a digit. */}
      <div className="flex min-w-0 flex-wrap gap-1">
        {drivers.map((name: AttributeName) => (
          <span
            key={name}
            data-tip={ATTRIBUTE_EFFECTS[name].summary}
            className="flex items-center gap-1 rounded-sm border border-surface-600/70 bg-surface-950/40 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.1em] text-ink-300"
          >
            {ATTRIBUTE_LABELS[name]}
            <span
              className={cn('font-bold tabular-nums', RATING_TEXT[ratingBand(sheet[name] ?? 0)])}
            >
              {sheet[name] ?? 0}
            </span>
          </span>
        ))}
      </div>
    </li>
  );
}
