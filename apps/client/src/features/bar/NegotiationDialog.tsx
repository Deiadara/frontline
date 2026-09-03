import {
  BENCH_LABEL,
  OFFICER_ROLE_LABELS,
  negotiationLine,
  negotiationVoice,
  openNegotiation,
  type BarRecruit,
  type Negotiation,
  type NegotiationMood,
  type OfficerRole,
} from '@frontline/shared';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useNegotiate } from '../../lib/queries';

/**
 * Sitting down with somebody about money (§H7).
 *
 * The Bar had a number field and an Offer button, which is a form for submitting a bid: the
 * negotiation happened entirely inside one server call and the player never saw it. This is the
 * same rules with the conversation put back on top: they open, you say a number, they answer in
 * their own voice, their demand moves or it does not, and you can feel their patience going.
 *
 * ## What is on screen, and why each thing is there
 *
 * - **The transcript.** Every exchange, oldest first, as speech. It is the whole reason to open
 *   this window rather than type in the field on the card, and it is why the offers are shown as
 *   things *the player said* rather than as a log of requests.
 * - **What they are asking now.** The one number that moves, drawn large. A player who cannot see
 *   their demand coming down has no way to tell a productive haggle from a stalled one.
 * - **Patience, as a bar.** Football Manager shows you an interest meter and it is the single thing
 *   that makes its negotiations feel like negotiations: it is the cost of the next lowball, made
 *   visible before you pay it.
 *
 * The floor is never labelled, because working out where it is *is* the game, and the card behind
 * this window already tells an attentive player exactly enough to derive it.
 */

/** What the window's frame says about how the last exchange went. */
const MOOD_TONE: Record<NegotiationMood, { edge: string; text: string; word: string }> = {
  opening: { edge: 'border-brass-300/30', text: 'text-ink-200', word: 'Talking' },
  considering: { edge: 'border-brass-300/30', text: 'text-ink-200', word: 'Thinking about it' },
  close: { edge: 'border-verdigris-300/40', text: 'text-verdigris-100', word: 'Nearly there' },
  insulted: { edge: 'border-oxblood-500/50', text: 'text-oxblood-300', word: 'Insulted' },
  stonewalled: { edge: 'border-oxblood-500/40', text: 'text-warning', word: 'Going nowhere' },
  agreed: { edge: 'border-verdigris-300/60', text: 'text-verdigris-100', word: 'Agreed' },
  overpaid: { edge: 'border-verdigris-300/60', text: 'text-verdigris-100', word: 'Agreed, gladly' },
  walked: { edge: 'border-oxblood-500/70', text: 'text-oxblood-300', word: 'Gone' },
};

/** One turn of the conversation, as it is remembered. */
interface Exchange {
  /** What the player put on the table, or `null` for the character's opening line. */
  offer: number | null;
  said: string;
  mood: NegotiationMood;
}

export interface NegotiationDialogProps {
  recruit: BarRecruit;
  /** Where the conversation stands, or `null` if it has not started. */
  standing: Negotiation | null;
  /**
   * Caps a week still uncommitted on the payroll book (§H7).
   *
   * Not the stockpile. Signing takes nothing out of it: what an offer has to fit inside is the
   * ceiling, so an offer above what is left is one the server will refuse however rich the crew
   * is. Shown as it is typed rather than discovered on the refusal.
   */
  payrollLeft: number;
  onClose: () => void;
  /**
   * Every turn, as it lands.
   *
   * The card behind this window shows the standing demand and whether the character has walked,
   * and the negotiate call deliberately does not refetch the Bar: a whole-roster reload
   * mid-sentence would swap this window's state out from under the player. So the state comes back
   * up this way instead.
   */
  onTurn: (negotiation: Negotiation) => void;
  /** Called with the agreed weekly wage once they say yes, so the card behind can say so too. */
  onAgreed: (wage: number) => void;
  /**
   * Roles this crew still has open (§C2). Empty means there is nowhere to put them.
   *
   * The role picker lives in here rather than only on the card because **the handshake and the
   * signature are one moment**. Agreeing a wage and then closing the window to go and find a
   * separate Offer button is how somebody says yes and never joins the crew, which is exactly
   * what happened: the agreement wrote a number into the card's counter-offer slot, the card said
   * "Turned it down", and nobody was hired.
   */
  openRoles: readonly OfficerRole[];
  /** Signs them at the agreed wage. The Bar owns the mutation; this window owns the moment. */
  /** `null` signs them to the bench: on the books, drawing a wage, in no chair yet. */
  onSign: (role: OfficerRole | null, wage: number) => void;
  signing: boolean;
  /** Why the signature is refused right now: a full roster, the day's one signing already spent. */
  signBlocked: string | null;
  signError: string | null;
}

/** The select's stand-in for "no chair". See the note on `role` below. */
const BENCH_VALUE = '__bench';

export function NegotiationDialog({
  recruit,
  standing,
  payrollLeft,
  onClose,
  onTurn,
  onAgreed,
  openRoles,
  onSign,
  signing,
  signBlocked,
  signError,
}: NegotiationDialogProps) {
  const negotiateTurn = useNegotiate();
  const asking = recruit.askingWage ?? 0;
  // A conversation that has not started yet is opened *here* rather than defaulted to zeroes: the
  // opening position is a pure function of the asking price and §H4, so the client can draw it
  // exactly as the server would create it. A hand-rolled placeholder got this wrong in the obvious
  // way: patience of zero, which drew an empty meter next to somebody who had not said a word.
  const opening = standing ?? openNegotiation(asking, recruit.attributes);

  const [state, setState] = useState<Negotiation>(opening);
  // Opened on what they are *asking*, never on what they would settle for. Prefilling the
  // reservation value would hand the player the one number the whole negotiation is about finding.
  const [offer, setOffer] = useState<number>(opening.standing);
  // Seeded with the character's opening line so the window is never a blank room. It is not part
  // of the server's state: an opening line is a pure function of who they are.
  const [said, setSaid] = useState<Exchange[]>(() => [
    {
      offer: null,
      said: negotiationLine(negotiationVoice(recruit.id), 'opening', 0),
      mood: 'opening',
    },
  ]);
  /*
   * The chair, or the bench (board request).
   *
   * A sentinel string rather than `null`, because the picker is a `<select>` underneath and a
   * select's value is a string. Defaulted to the first open chair, so the common case is one
   * press: the bench is the deliberate choice, not the accidental one.
   */
  const [role, setRole] = useState<string>(() => openRoles[0] ?? BENCH_VALUE);
  const scroller = useRef<HTMLDivElement>(null);

  const proposed = Math.max(0, Math.trunc(offer));
  const affordable = proposed <= payrollLeft;
  const tone = MOOD_TONE[state.mood];
  const patienceLeft = state.closed && state.mood === 'walked' ? 0 : state.patience;
  // Their patience at the start, as far as this window can know it: what is left plus what has
  // been spent. Enough for a bar, and it never claims a maximum the model did not hand over.
  const patienceFloor = Math.max(patienceLeft + state.rounds, 1);
  /** Closed on a handshake rather than on a walk-out: the one state with nothing left to time. */
  const signed = state.closed && state.mood !== 'walked';

  const send = (): void => {
    if (state.closed || !affordable || negotiateTurn.isPending) return;
    negotiateTurn.mutate(
      { recruitId: recruit.id, offerWage: proposed },
      {
        onSuccess: (result) => {
          setState(result.negotiation);
          onTurn(result.negotiation);
          setSaid((before) => [
            ...before,
            { offer: proposed, said: result.line, mood: result.negotiation.mood },
          ]);
          // Scrolled after the paint, so the newest line is the one in view rather than the one
          // that was newest when the request went out.
          requestAnimationFrame(() => {
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
          });
          if (result.accepted) onAgreed(proposed);
        },
      },
    );
  };

  return (
    // Named, because it now opens *over* the seat screen: two dialogs are on the page at once and
    // `getByRole('dialog')` no longer picks one.
    <Modal
      onClose={onClose}
      labelledBy="negotiation-title"
      size="wide"
      className={tone.edge}
      data-testid="negotiation-window"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-surface-600/60 px-5 py-4">
        <div className="min-w-0">
          <p className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300">
            Terms
          </p>
          <h2
            id="negotiation-title"
            className="mt-1 font-stamp text-[21px] leading-tight text-ink-100"
          >
            {recruit.name}
          </h2>
        </div>
        <span className="shrink-0 text-right">
          <span className="block font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
            Asking now
          </span>
          <span
            className="block font-stamp text-[22px] leading-none text-brass-100"
            data-testid="negotiation-standing"
          >
            {state.standing.toLocaleString()}
          </span>
          <span className="block font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            caps a week
          </span>
        </span>
      </header>

      {/* What the player knows about the person across the table, before they say anything. Both
          halves of §H4 and the number this started at: everything the card behind the window
          already shows, gathered where the decision is actually being made. */}
      <dl className="flex shrink-0 flex-wrap gap-x-6 gap-y-1 border-b border-surface-700 px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          {/* What used to be "Wants" and "How far they go": two personality tags that shaped the
              haggle from behind a label. The temper is read off the sheet now, so the two numbers
              that decide how this goes can simply be named. */}
          <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            Holds out
          </dt>
          <dd className="font-stamp text-[14px] leading-none text-ink-100">
            {recruit.attributes.composure} composure
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            Gives ground
          </dt>
          <dd className="font-stamp text-[14px] leading-none text-ink-100">
            {recruit.attributes.negotiation} negotiation
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            Opened at
          </dt>
          <dd className="font-stamp text-[14px] leading-none tabular-nums text-ink-100">
            {asking.toLocaleString()}
          </dd>
        </div>
      </dl>

      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4"
        data-testid="negotiation-transcript"
      >
        {said.map((exchange, index) => (
          <div key={index} className="flex flex-col gap-2">
            {/* What the player said, ranged right: the two sides of a table. */}
            {exchange.offer !== null && (
              <p className="self-end rounded-sm border border-brass-500/40 bg-brass-500/10 px-3 py-1.5 font-stamp text-[15px] leading-tight text-brass-100">
                {exchange.offer.toLocaleString()} a week.
              </p>
            )}
            <p
              className={cn(
                'max-w-[36rem] self-start rounded-sm border border-surface-600 bg-surface-800/70 px-3.5 py-2.5',
                'font-stamp text-[16px] leading-[1.35]',
                MOOD_TONE[exchange.mood].text,
              )}
            >
              {exchange.said}
            </p>
          </div>
        ))}
      </div>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-surface-700 px-5 py-4">
        {/*
         * The meter goes away the moment they sign (board request).
         *
         * It measures one thing: how much longer they will sit here arguing. Once they have said
         * yes there is nothing left to measure, and leaving a part-full bar under "They said yes"
         * read as though the clock were still running on the offer: players hurried the role
         * picker, or closed the window, thinking the deal could still expire. It cannot. Their
         * walking out still ends on an empty bar, because there the number is the reason.
         */}
        {signed ? null : (
          <ProgressBar
            progress={patienceLeft / patienceFloor}
            label={`How much longer ${recruit.name} will sit here`}
            remaining={tone.word}
            tone={patienceLeft <= 1 ? 'oxblood' : patienceLeft <= 2 ? 'brass' : 'verdigris'}
            size="md"
          />
        )}

        {state.closed && state.mood === 'walked' ? (
          <div className="flex items-center justify-between gap-3">
            <p
              className="font-display text-lg font-bold uppercase tracking-[0.14em] text-oxblood-300"
              data-testid="negotiation-walked"
            >
              They walked out
            </p>
            <p className={cn('font-body text-[13px] leading-relaxed', tone.text)}>
              Nothing signed. They will not sit down with you again for six hours, and when they do
              they will be asking ten percent more than they were tonight.
            </p>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : state.closed ? (
          /* The handshake, and the signature, in one place: see `openRoles` on the props. */
          <div className="flex flex-col gap-3" data-testid="negotiation-sign">
            <p
              className="font-display text-lg font-bold uppercase tracking-[0.14em] text-verdigris-100"
              data-testid="negotiation-agreed"
            >
              They said yes
            </p>
            <p className={cn('font-body text-[13px] leading-relaxed', tone.text)}>
              Agreed at{' '}
              <span className="font-semibold tabular-nums">
                {(state.lastOffer ?? 0).toLocaleString()}
              </span>{' '}
              caps a week, off a book with {payrollLeft.toLocaleString()} left on it. Put them
              somewhere and it is done.
            </p>
            {/*
             * There is always somewhere to put them now.
             *
             * This used to refuse the whole signing when every chair was filled: "Nowhere to put
             * them, whatever they agreed to", after a negotiation the player had just won. The
             * bench is that somewhere, so a full roster is a reason to think about the wage
             * rather than a dead end at the last step.
             */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                  Sign as
                </span>
                <Dropdown
                  label={`Role for ${recruit.name}`}
                  value={role}
                  onChange={setRole}
                  options={[
                    ...openRoles.map((option) => ({
                      value: option,
                      label: OFFICER_ROLE_LABELS[option],
                    })),
                    { value: BENCH_VALUE, label: BENCH_LABEL },
                  ]}
                  data-testid="negotiation-role"
                />
              </label>
              <Button
                disabled={signing || signBlocked !== null}
                onClick={() =>
                  onSign(role === BENCH_VALUE ? null : (role as OfficerRole), state.lastOffer ?? 0)
                }
                data-testid="negotiation-sign-confirm"
              >
                {signing ? 'Signing…' : `Sign ${recruit.name.split(' ')[0] ?? 'them'}`}
              </Button>
            </div>
            {signBlocked !== null && (
              <p role="alert" className="font-body text-[13px] text-warning">
                {signBlocked}
              </p>
            )}
            {signError !== null && (
              <p role="alert" className="font-body text-[13px] text-oxblood-300">
                {signError}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
                  Your offer, caps a week
                </span>
                {/*
                 * The game's own field, not the browser's. This was the last player-facing
                 * `type="number"` in the interface: everywhere else a count is entered, the panel
                 * draws its own steppers in brass, and the Bar was showing a pair of grey system
                 * chevrons on painted tin. Ten caps a step, because a wage is haggled in tens and a
                 * stepper that moves a forty-cap offer by one is a stepper nobody presses.
                 */}
                <NumberField
                  label={`Offer to ${recruit.name}`}
                  value={offer}
                  onChange={setOffer}
                  min={0}
                  /*
                   * Deliberately **above** what the crew can afford. Clamping at `payrollLeft` would
                   * make the "that does not fit on the book" line below unreachable, which is the
                   * one thing on this screen that tells a player why a signing they can see is
                   * refused. The field lets you overshoot; the panel tells you that you did.
                   */
                  max={Math.max(payrollLeft, asking) * 2}
                  step={10}
                  onKeyDown={(event) => event.key === 'Enter' && send()}
                  className="w-full min-w-0"
                  data-testid="negotiation-offer"
                />
              </label>
              <Button
                disabled={!affordable || proposed <= 0 || negotiateTurn.isPending}
                onClick={send}
                data-testid="negotiation-say"
              >
                {negotiateTurn.isPending ? 'Saying it…' : 'Say it'}
              </Button>
            </div>
            {!affordable && (
              <p role="alert" className="font-body text-[13px] text-oxblood-300">
                Your payroll book has {payrollLeft.toLocaleString()} caps a week left. Raise it at
                the Nexus, or offer less.
              </p>
            )}
            {negotiateTurn.error !== null && (
              <p role="alert" className="font-body text-[13px] text-oxblood-300">
                {negotiateTurn.error.message}
              </p>
            )}
          </>
        )}
      </footer>
    </Modal>
  );
}
