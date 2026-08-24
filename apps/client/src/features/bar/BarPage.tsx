import {
  ALIGNMENT_BAND_LABELS,
  AMBITION_SPECS,
  ATTRIBUTE_LABELS,
  MORAL_COMPASS_SPECS,
  OFFICER_ROLE_LABELS,
  OFFICER_ROLES,
  TRAIT_CATALOG,
  isFlaw,
  reservationWage,
  type AlignmentBand,
  type AttributeName,
  type BarOfficer,
  type BarRecruit,
  type DispositionSpec,
  type JoinBlocker,
  type Negotiation,
  type OfficerRole,
  type TraitId,
} from '@frontline/shared';
import { useState } from 'react';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { Button } from '../../components/ui/Button';
import { DescribedTag } from '../../components/ui/DescribedTag';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBar, useHireRecruit } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';
import { NegotiationDialog } from './NegotiationDialog';

/** Devotion reads in the player's own accent; a walkout reads as a warning. */
const BAND_STYLE: Record<AlignmentBand, string> = {
  leaving: 'border-oxblood-500/50 text-oxblood-300',
  unsettled: 'border-surface-600 text-ink-200',
  settled: 'border-brass-300/50 text-brass-300',
  devoted: 'border-bile-300/50 text-bile-300',
};

const BLOCKER_LABEL: Record<JoinBlocker, string> = {
  infamy: 'Not infamous enough',
  reputation: 'Wants no part of you',
};

/**
 * `className` carries the *whole* colour, border included, and replaces the neutral default rather
 * than layering over it.
 *
 * `cn` is `clsx`: it concatenates classes and does not resolve Tailwind conflicts, so a base
 * `text-ink-300` and a caller's `text-oxblood-300` both land on the element and the generated
 * stylesheet's order silently picks the winner — which was the base. Every coloured tag on this
 * page was rendering steel because of it. Keeping the base to layout only makes the override the
 * only colour in play, so what a caller asks for is what renders.
 */
const TAG_NEUTRAL = 'border-surface-600 text-ink-300';

function Tag({ label, className = TAG_NEUTRAL }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center border px-2 py-1 font-display text-[10px] uppercase tracking-[0.18em]',
        className,
      )}
    >
      {label}
    </span>
  );
}

/** §H5 — the meter itself, so "too low" and "high" are visible rather than inferred. */
function AlignmentMeter({ value, band }: { value: number; band: AlignmentBand }) {
  const fill =
    band === 'leaving' ? 'bg-oxblood-300' : band === 'devoted' ? 'bg-bile-300' : 'bg-brass-300';
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1 min-w-0 flex-1 overflow-hidden bg-surface-700">
        <div className={cn('h-full', fill)} style={{ width: `${Math.round(value)}%` }} />
      </div>
      <span className="shrink-0 font-display text-[11px] font-semibold tabular-nums text-ink-200">
        {Math.round(value)}
      </span>
    </div>
  );
}

/**
 * What a character wants and how far they will go for it (§H4).
 *
 * Both words decide whether this person will sign at all, read against the crew's own reputation
 * word, so the card says which reputations each one is drawn to and which put it off. That is the
 * whole rule, and it is the difference between a player choosing a reputation and a player finding
 * out afterwards that nobody good will talk to them.
 */
function Disposition({ ambition, moralCompass }: Pick<BarRecruit, 'ambition' | 'moralCompass'>) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      <DescribedTag
        label={AMBITION_SPECS[ambition].label}
        description={AMBITION_SPECS[ambition].description}
        detail={dispositionDetail(AMBITION_SPECS[ambition])}
        className="border-hextech-100/40 text-hextech-100"
      />
      <DescribedTag
        label={MORAL_COMPASS_SPECS[moralCompass].label}
        description={MORAL_COMPASS_SPECS[moralCompass].description}
        detail={dispositionDetail(MORAL_COMPASS_SPECS[moralCompass])}
      />
    </div>
  );
}

/** Which reputation words this half of §H4 will sign with, and which it will not. */
function dispositionDetail(spec: DispositionSpec): string {
  return `Signs with ${spec.drawnTo.join(', ')} · walks from ${spec.repelledBy.join(', ')}`;
}

/** A trait's whole mechanical effect, written out. `+8 stealth` is the rule; the name is flavour. */
function traitDetail(trait: TraitId): string {
  return Object.entries(TRAIT_CATALOG[trait].bonus)
    .map(
      ([name, amount]) =>
        `${amount > 0 ? '+' : ''}${amount} ${ATTRIBUTE_LABELS[name as AttributeName]}`,
    )
    .join(' · ');
}

interface RecruitCardProps {
  recruit: BarRecruit;
  filledRoles: readonly OfficerRole[];
  caps: number;
  /** §H8 — every slot is taken, so no offer can be made however willing the character is. */
  full: boolean;
  /** §H2b — this crew has already signed somebody today. Same effect, different reason. */
  signedToday: boolean;
  pending: boolean;
  /** §H7 — they turned an offer down and named their price. A refusal, not a deal. */
  counter: number | null;
  /** §H7 — a wage struck in the negotiation window that nobody has signed yet. A deal, not a refusal. */
  agreed: number | null;
  /** §H7 — the conversation with this character, if one has been opened today. */
  negotiation: Negotiation | undefined;
  onOffer: (recruitId: string, role: OfficerRole, offerWage: number) => void;
  onNegotiate: (recruitId: string) => void;
}

/**
 * One person at the Bar (§H1–§H4, §H7).
 *
 * Nothing on this card says what role they would be *good* at — the player reads the sheet and
 * decides, which is what §B8 asks for. The role picker is a hiring choice (§C2), not a hint.
 */
function RecruitCard({
  recruit,
  filledRoles,
  caps,
  full,
  signedToday,
  pending,
  counter,
  agreed,
  negotiation,
  onOffer,
  onNegotiate,
}: RecruitCardProps) {
  const open = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));
  const [role, setRole] = useState<OfficerRole>(() => open[0] ?? 'head_spy');
  const [offer, setOffer] = useState<string>('');

  const asking = recruit.askingWage;
  // An agreed wage prefills ahead of a counter-offer: it is the newer fact, and it is the number
  // the player just spent a conversation arriving at.
  const proposed = offer === '' ? (agreed ?? counter ?? asking ?? 0) : Number(offer);
  const affordable = proposed <= caps;
  const canOffer =
    recruit.assessment.interested &&
    !recruit.hired &&
    !full &&
    open.length > 0 &&
    proposed > 0 &&
    affordable;

  return (
    <article
      className="flex min-w-0 flex-col gap-3 border border-surface-700 bg-surface-950 p-4"
      data-testid={`recruit-${recruit.id}`}
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-display text-sm font-semibold uppercase tracking-[0.12em] text-ink-100">
          {recruit.name}
        </h3>
        {recruit.hired ? (
          <Tag label="On your books" className="border-bile-300/50 text-bile-300" />
        ) : recruit.assessment.interested ? (
          <Tag label={`${asking ?? 0} caps/wk`} className="border-brass-300/50 text-brass-300" />
        ) : (
          <Tag label="Not talking" className="border-oxblood-500/50 text-oxblood-300" />
        )}
      </header>

      <Disposition ambition={recruit.ambition} moralCompass={recruit.moralCompass} />

      <AttributeSheet attributes={recruit.attributes} />

      {recruit.traits.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {/* §B7 — a flaw is a reason *not* to hire, so it must not read as another credential. */}
          {recruit.traits.map((trait) => (
            <DescribedTag
              key={trait}
              label={TRAIT_CATALOG[trait].name}
              description={TRAIT_CATALOG[trait].description}
              detail={traitDetail(trait)}
              className={
                isFlaw(trait)
                  ? 'border-oxblood-500 text-oxblood-300'
                  : 'border-surface-600 text-ink-300'
              }
            />
          ))}
        </div>
      )}

      {recruit.requirement.minInfamy > 0 && (
        <p className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Wants a crew at{' '}
          <span className="tabular-nums text-ink-200">{recruit.requirement.minInfamy}</span> infamy
        </p>
      )}

      {recruit.hired ? null : recruit.assessment.interested ? (
        <div className="mt-auto flex min-w-0 flex-col gap-2 pt-1">
          {negotiation !== undefined && !negotiation.closed && (
            <p className="min-w-0 break-words font-hand text-[19px] leading-snug text-brass-100">
              Mid-conversation. They are asking {negotiation.standing.toLocaleString()} a week.
            </p>
          )}
          {negotiation?.mood === 'walked' && (
            <p className="min-w-0 break-words font-hand text-[19px] leading-snug text-oxblood-300">
              They walked. Nothing more to say to you today.
            </p>
          )}
          {agreed !== null ? (
            <p className="min-w-0 break-words text-[12px] leading-relaxed text-verdigris-100">
              Shook on {agreed.toLocaleString()} caps a week. Pick a role and sign them.
            </p>
          ) : (
            counter !== null && (
              <p className="min-w-0 break-words text-[12px] leading-relaxed text-warning">
                Turned it down. They will sign for {counter.toLocaleString()} caps a week.
              </p>
            )
          )}
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
              Hire as
            </span>
            {/* The board's word for the native control was "boring", and it was right about more
                than the look: a `<select>` drops an operating-system menu over the artwork, which
                is the one surface in the interface no stylesheet can reach. */}
            <Dropdown
              label={`Role for ${recruit.name}`}
              value={role}
              onChange={setRole}
              options={open.map((option) => ({
                value: option,
                label: OFFICER_ROLE_LABELS[option],
              }))}
              data-testid={`role-${recruit.id}`}
            />
          </label>
          <div className="flex min-w-0 items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                Offer (caps/wk)
              </span>
              <input
                aria-label={`Weekly wage for ${recruit.name}`}
                type="number"
                min={0}
                inputMode="numeric"
                placeholder={String(counter ?? asking ?? 0)}
                value={offer}
                onChange={(event) => setOffer(event.target.value)}
                className="w-full min-w-0 rounded-sm border border-surface-600 bg-surface-900 px-2 py-1.5 font-hand text-[19px] tabular-nums text-ink-100"
              />
            </label>
            {/* §H7 — the door into the conversation, beside the field that skips it. Both stay:
                a player who knows the number they want should not have to sit through a
                negotiation to offer it, and a player who does not now has somewhere to find out. */}
            <Button
              size="sm"
              variant="ghost"
              disabled={negotiation?.closed === true || signedToday || pending}
              onClick={() => onNegotiate(recruit.id)}
              data-testid={`negotiate-${recruit.id}`}
            >
              {negotiation?.closed === true ? 'Finished' : 'Negotiate'}
            </Button>
            <Button
              size="sm"
              disabled={!canOffer || signedToday || pending}
              onClick={() => onOffer(recruit.id, role, Math.round(proposed))}
            >
              {pending ? 'Talking…' : signedToday ? 'Not today' : 'Offer'}
            </Button>
          </div>
          {asking !== null && (
            <p className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              They will not go below{' '}
              <span className="tabular-nums text-ink-300">{reservationWage(asking)}</span>
            </p>
          )}
          {!affordable && (
            <p className="text-[12px] leading-relaxed text-oxblood-300">
              You do not have the caps for the first payment.
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-auto flex min-w-0 flex-col gap-1 pt-1">
          {recruit.assessment.blockers.map((blocker) => (
            <li
              key={blocker}
              className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.16em] text-oxblood-300/80"
            >
              {BLOCKER_LABEL[blocker]}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** One officer on the books, with their §H5 standing and §H6 level. */
function OfficerRow({ officer }: { officer: BarOfficer }) {
  const { commander } = officer;
  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.12em] text-ink-100">
          {commander.name}
        </span>
        <Tag label={ALIGNMENT_BAND_LABELS[officer.band]} className={BAND_STYLE[officer.band]} />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          {OFFICER_ROLE_LABELS[commander.role]} · Lv {commander.level}
        </span>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          <span className="tabular-nums text-ink-200">{officer.weeklyWage}</span> caps/wk
        </span>
      </div>
      <AlignmentMeter value={commander.alignment} band={officer.band} />
      {officer.skillBonus > 0 && (
        <p className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.14em] text-bile-300">
          +{officer.skillBonus} to {officer.bonusAttributes.join(', ')}
        </p>
      )}
      {officer.threateningToLeave && (
        <p className="min-w-0 break-words text-[12px] leading-relaxed text-oxblood-300">
          Says they are done unless something changes.
        </p>
      )}
      {commander.unspentPoints > 0 && (
        <p className="min-w-0 break-words font-display text-[10px] uppercase tracking-[0.14em] text-brass-300">
          {commander.unspentPoints} point{commander.unspentPoints === 1 ? '' : 's'} to assign
        </p>
      )}
    </li>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-4 py-6 text-center font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
      {text}
    </p>
  );
}

/**
 * The Bar (GDD §H1) — today's roster and the crew it has already given you.
 *
 * The roster is the same for every player on the same UTC day (§H2), which the header says out
 * loud: it is a shared room, not a personalised shortlist.
 */
export function BarPage() {
  const barQuery = useBar();
  const hire = useHireRecruit();
  const [counters, setCounters] = useState<Record<string, number>>({});
  /**
   * Wages struck in the negotiation window and not yet signed.
   *
   * Deliberately **not** the same map as `counters`. A counter-offer is a refusal carrying a price
   * ("turned it down; they will sign for N"); an agreement is a yes. Writing an accepted wage into
   * the counter map is the bug this pair of maps exists to make impossible — it made the card
   * announce "Turned it down" the moment somebody said yes, and hired nobody.
   */
  const [agreed, setAgreed] = useState<Record<string, number>>({});
  /** §H7 — which conversation is open, if any. One at a time: it is a table, not a phone bank. */
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  /**
   * Conversations this session has moved on, over the ones the read arrived with.
   *
   * The negotiate call deliberately does not refetch the Bar — a whole-roster reload mid-sentence
   * would swap the window's state out from under the player — so the card behind the window needs
   * somewhere to learn that the standing demand has changed.
   */
  const [talks, setTalks] = useState<Record<string, Negotiation>>({});

  const data = barQuery.data;
  const recruits = data?.recruits ?? [];
  const officers = data?.officers ?? [];
  const full = data !== undefined && data.slotsUsed >= data.slotsTotal;
  // §H2b — the shared room's other limit. Distinct from `full`: one is about the crew's own
  // recruit slots, the other about how many people the whole city may take out of the room today.
  const signedToday = data !== undefined && data.hiresLeftToday === 0;

  const onOffer = (recruitId: string, role: OfficerRole, offerWage: number) => {
    hire.reset();
    hire.mutate(
      { recruitId, role, offerWage },
      {
        onSuccess: (result) => {
          setCounters((current) => {
            if (result.accepted) {
              const { [recruitId]: _signed, ...rest } = current;
              return rest;
            }
            return { ...current, [recruitId]: result.wage };
          });
          if (result.accepted) {
            // Signed: the deal is spent, and the window (if this came from one) has done its job.
            setAgreed((current) => {
              const { [recruitId]: _done, ...rest } = current;
              return rest;
            });
            setTalkingTo((open) => (open === recruitId ? null : open));
          }
        },
      },
    );
  };

  // Derived once here rather than per card: the negotiation window needs the same list, and two
  // derivations of "which roles are open" is how a window offers a seat the card says is taken.
  const filledRoles = data?.filledRoles ?? [];
  const openRoles = OFFICER_ROLES.filter((role) => !filledRoles.includes(role));

  const negotiationFor = (recruitId: string): Negotiation | undefined =>
    talks[recruitId] ?? data?.negotiations[recruitId];

  const talking = recruits.find((recruit) => recruit.id === talkingTo);

  return (
    <PageShell
      title="The Bar"
      icon="bar"
      lede="Same faces in here whoever you are, and every crew in the city is reading the same list. Sign somebody and they walk out of it. For everybody."
    >
      <InfoNote tone="warn">
        Every crew in the city is reading this same list, and signing somebody takes them off it for
        all of them. You get one signature a day. So the question is never whether you can afford
        this person — it is whether they are the one worth spending today on.
      </InfoNote>

      <Panel
        title="Your Crew"
        action={
          <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
            <span className={cn('tabular-nums', full ? 'text-warning' : 'text-ink-200')}>
              {data?.slotsUsed ?? 0}
            </span>
            <span className="tabular-nums"> / {data?.slotsTotal ?? 0}</span> recruits
          </span>
        }
      >
        {barQuery.isLoading ? (
          <EmptyRow text="Reading the room…" />
        ) : officers.length === 0 ? (
          <EmptyRow text="You are drinking alone" />
        ) : (
          <ul className="flex flex-col divide-y divide-surface-700">
            {officers.map((officer) => (
              <OfficerRow key={officer.commander.id} officer={officer} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={data ? `Tonight, ${data.day}` : 'Tonight'}
        action={
          <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            {full ? (
              <span className="text-warning">No room for another</span>
            ) : signedToday ? (
              <span className="text-warning" data-testid="daily-hire-limit">
                Signed somebody today. Back tomorrow
              </span>
            ) : (
              <>
                Street reads <span className="text-ink-200">{data?.reputation ?? '—'}</span>
              </>
            )}
          </span>
        }
      >
        {/*
         * Two columns only from `xl`. A recruit card carries the whole 32-attribute sheet (§B6),
         * and at 1024px a two-up grid squeezes its four columns to 61px — enough to ellipsise
         * `communication` and `marksmanship`, which is fixed copy and so a permanent defect
         * rather than a fat-content edge case.
         */}
        {barQuery.isLoading ? (
          <EmptyRow text="Reading the room…" />
        ) : (
          <div className="grid gap-3 p-4 xl:grid-cols-2">
            {recruits.map((recruit) => (
              <RecruitCard
                key={recruit.id}
                recruit={recruit}
                filledRoles={filledRoles}
                agreed={agreed[recruit.id] ?? null}
                signedToday={signedToday}
                caps={data?.caps ?? 0}
                full={full}
                pending={hire.isPending && hire.variables?.recruitId === recruit.id}
                counter={counters[recruit.id] ?? null}
                negotiation={negotiationFor(recruit.id)}
                onOffer={onOffer}
                onNegotiate={setTalkingTo}
              />
            ))}
          </div>
        )}
      </Panel>

      {talking !== undefined && (
        <NegotiationDialog
          recruit={talking}
          standing={negotiationFor(talking.id) ?? null}
          caps={data?.caps ?? 0}
          onClose={() => setTalkingTo(null)}
          onTurn={(negotiation) =>
            setTalks((current) => ({ ...current, [talking.id]: negotiation }))
          }
          onAgreed={(wage) => setAgreed((current) => ({ ...current, [talking.id]: wage }))}
          openRoles={openRoles}
          onSign={(role, wage) => onOffer(talking.id, role, wage)}
          signing={hire.isPending && hire.variables?.recruitId === talking.id}
          signBlocked={
            full
              ? 'Your crew is full. Free a recruit slot and they will still be here tomorrow.'
              : signedToday
                ? 'You have already signed somebody today. This one keeps until tomorrow.'
                : null
          }
          signError={
            hire.error !== null && hire.variables?.recruitId === talking.id
              ? hire.error.message
              : null
          }
        />
      )}
    </PageShell>
  );
}
