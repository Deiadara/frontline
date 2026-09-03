import {
  BENCH_LABEL,
  dismissalFee,
  OFFICER_ROLES,
  OFFICER_ROLE_LABELS,
  officerPortraits,
  type CrewOfficer,
  type CrewResponse,
  type OfficerRole,
} from '@frontline/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { InkButton } from '../../components/ui/InkButton';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { OfficerPortrait } from '../overseer/OfficerPortrait';
import { AttributeSheet } from '../overseer/AttributeSheet';
import { PerkTags } from '../../components/PerkTags';
import { cn } from '../../lib/cn';
import { useCrew, useReassignOfficer, useReleaseOfficer } from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { useDayResetClock } from '../settings/usePlayerZone';

/**
 * The crew (GDD §C1, §C2): the nineteen chairs, and who is sitting in them.
 *
 * This screen used to be the **assignee** page, and most of it was arithmetic about a pool: three
 * figures across the top counting bodies granted by player level, a row of pips on every card
 * counting how many of them were standing under that officer, and a percentage saying what that was
 * worth. The pool is gone. What is left is what a player was ever looking at, which is the people:
 * the face they picked at the Bar, what that person is good at, and what they are carrying.
 *
 * So the card is the portrait. Two thirds of it is the painting, at a size where a face is a face
 * rather than a stamp, and the rest is the sheet: their best attributes, their traits, how settled
 * they are. A vacancy keeps the same frame and shows the empty chair, so the grid is one shape
 * whether the crew is full or new.
 */

interface SeatProps {
  role: OfficerRole;
  officer: CrewOfficer | undefined;
  /** This officer's face, picked against the whole roster so no two cards show one person twice. */
  portraitId: string | null;
  onOpen: () => void;
}

/**
 * One chair, filled or empty.
 *
 * A fixed frame, for the roster's reason: nineteen of these run down a page and the eye should not
 * have to re-find the name on each one. The portrait is the top two thirds and it is the whole
 * point of the card; everything under it is the caption.
 */
/**
 * The frame both states share.
 *
 * Height is *not* fixed here any more. It was `h-[26rem]`, and a fixed height is what forced the
 * portrait into whatever the caption left: the card now takes its height from a 4:5 picture plus
 * a footer, which is the same height for every card in the grid because the picture is the same
 * shape for every officer.
 */
const CARD =
  'group card-paper rivets edge-lit relative flex flex-col overflow-hidden rounded-sm border border-surface-700/80 transition-colors';

/**
 * The strip under the picture.
 *
 * A *minimum* height rather than a fixed one. Three perks with long names wrap to three rows, and
 * a fixed height clipped the last of them; grid rows equalise their own heights, so a card with no
 * perks still lines up with the three-perk card beside it without anything being cut off.
 */
const FOOTER =
  'flex min-h-[4.25rem] shrink-0 flex-col justify-center gap-1.5 border-t border-surface-700/80 px-3.5 py-2';

function Seat({ role, officer, portraitId, onOpen }: SeatProps) {
  const label = OFFICER_ROLE_LABELS[role];
  if (!officer) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`seat-${role}`}
        className={cn(CARD, 'text-left hover:border-brass-300/40')}
      >
        {/* The empty chair, drawn (`.ink-chair`). A dashed frame rather than a grey block: a
            vacancy is a shape waiting to be filled, and a solid panel reads as something that is
            broken instead. Most of the nineteen start empty, so this is the state a player spends
            the most time looking at and it earns a real drawing rather than an icon. */}
        <span
          className="relative flex w-full shrink-0 items-center justify-center overflow-hidden"
          style={{ aspectRatio: '4 / 5' }}
        >
          <span
            aria-hidden
            className="absolute inset-3 rounded-sm border border-dashed border-surface-600/70"
          />
          <span className="relative flex flex-col items-center gap-3">
            {/* Sized off the card's own width, with the height derived from it by `aspect-ratio`.
                A percentage *height* draws nothing here: the parent's height comes from its own
                aspect ratio rather than from a definite value, so there is nothing for the child
                to take a share of, and the chair silently vanished. Width has a definite parent to
                resolve against, so this scales with the card the way the intent was. */}
            <span
              aria-hidden
              className="ink-chair w-[52%] opacity-40 transition-opacity duration-200 group-hover:opacity-70"
              style={{ aspectRatio: '96 / 112' }}
            />
            <span className="font-display text-[11px] uppercase tracking-[0.2em] text-ink-400 transition-colors group-hover:text-brass-300/80">
              Vacant
            </span>
            <span className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.16em] text-ink-500 transition-colors group-hover:text-brass-300">
              <Icon name="bar" aria-hidden className="h-3 w-3" />
              Hire at the Bar
            </span>
          </span>
        </span>
        {/* The chair's name, and nothing else. The line under it used to say "Nobody hired. The
            Bar is where you find one", which the drawn chair, the word Vacant and the "Hire at the
            Bar" prompt above already say three times over. */}
        <span className={FOOTER}>
          <span className="truncate font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
            {label}
          </span>
          <span aria-hidden className="ink-rule w-full opacity-50" />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`seat-${role}`}
      className={cn(CARD, 'text-left hover:border-brass-300/50')}
    >
      {/*
       * The whole painting, uncropped.
       *
       * The frame is `aspect-[4/5]`, which is the shape the officer masters are delivered in, so
       * `object-cover` has nothing to trim: the card used to give the portrait whatever height the
       * caption left over, and at a 4-column grid that was a letterbox with the top of everybody's
       * head cut off. Sizing the picture and letting the card be as tall as it needs is the way
       * round that keeps faces intact.
       */}
      <span className="relative w-full shrink-0 overflow-hidden" style={{ aspectRatio: '4 / 5' }}>
        <OfficerPortrait
          portraitId={portraitId}
          name={officer.name}
          injuredUntil={officer.injuredUntil}
          className="absolute inset-0 h-full w-full rounded-none border-0"
        />
        {/* The mark, stamped over the picture rather than printed beside it (board brief).
            Top right, clear of the face: the portraits are 4:5 and the head sits centre-left of
            centre, so this corner is the one part of every master that is reliably background. */}
        {officer.mark !== null && (
          <MarkStamp
            mark={officer.mark}
            className="right-[7%] top-[5%] h-[26%] w-[26%] text-oxblood-300/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
            title={`${label}: ${officer.mark}`}
          />
        )}
        {/* A wash up from the bottom so the name reads off the painting rather than on a bar over
            it: the picture keeps its full height and the type still has ground to sit on. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[rgb(24_20_22)] via-[rgb(24_20_22)]/80 to-transparent"
        />
        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 px-3.5 pb-2.5">
          <span className="truncate font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
            {label}
          </span>
          {/* Wraps rather than truncating. "Wilhelmina Okonkwo-Restrepo" does not fit one line of
              a card this wide, and an ellipsis is cut text: the one rule this interface does not
              bend. The wash below is sized for two lines so the second still lands on darkness. */}
          <span className="break-words font-stamp text-[19px] leading-tight text-ink-100">
            {officer.name}
          </span>
        </span>
      </span>

      {/*
       * What they bring, and only that.
       *
       * There were four group peaks and a level here. The level is gone with the mechanic, and the
       * four numbers went because they were the wrong summary for this screen: every officer's
       * sheet sits in the same narrow recruitment band, so four numbers in the low twenties on
       * nineteen cards is a wall of noise that never decides anything. A perk is the opposite: it
       * is discrete, it is the reason this person is worth their wage, and there are at most three.
       * The sheet is still one click away in the window.
       */}
      {/* `nested`: the whole seat is a button, so these cannot be hover *buttons* of their own.
          See `DescribedTag`. */}
      <span className={FOOTER}>
        {officer.perks.length > 0 ? (
          <PerkTags perks={officer.perks} tone="card" side="top" nested />
        ) : (
          <span className="font-body text-[12px] italic leading-snug text-ink-400">
            No specialities. Just the work.
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Somebody signed and unassigned.
 *
 * The seat card without the seat: the same painting, the same perks, and the job line replaced by
 * what they are costing while they wait. Deliberately the same shape rather than a compact list
 * row, because a benched officer is a person you are meant to keep looking at until you find them
 * a chair, and a row in a list is something you stop seeing.
 */
function BenchCard({
  officer,
  portraitId,
  onOpen,
}: {
  officer: CrewOfficer;
  portraitId: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`bench-${officer.officerId}`}
      className={cn(CARD, 'text-left hover:border-brass-300/50')}
    >
      <span className="relative w-full shrink-0 overflow-hidden" style={{ aspectRatio: '4 / 5' }}>
        <OfficerPortrait
          portraitId={portraitId}
          name={officer.name}
          injuredUntil={officer.injuredUntil}
          className="absolute inset-0 h-full w-full rounded-none border-0"
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[rgb(24_20_22)] via-[rgb(24_20_22)]/80 to-transparent"
        />
        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 px-3.5 pb-2.5">
          <span className="truncate font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400">
            {BENCH_LABEL}
          </span>
          <span className="break-words font-stamp text-[19px] leading-tight text-ink-100">
            {officer.name}
          </span>
        </span>
      </span>
      <span className={FOOTER}>
        {officer.perks.length > 0 ? (
          <PerkTags perks={officer.perks} tone="card" side="top" nested />
        ) : (
          <span className="font-body text-[12px] italic leading-snug text-ink-400">
            No specialities. Just the work.
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * What an empty chair offers (board request).
 *
 * It used to be a link straight to the Bar, which was right when the Bar was the only source of an
 * officer. With a bench there are two, and the difference matters: the Bar costs a signing and one
 * of the day's hires, and the bench costs nothing because you have already paid for these people.
 * Somebody sitting on the bench is the cheapest way to fill a chair in the game, and a control that
 * walked past them to the Bar would hide that.
 *
 * The Bar is still the first thing on it, because on most rosters the bench is empty.
 */
function ChairWindow({
  role,
  bench,
  faces,
  pending,
  onAssign,
  onClose,
}: {
  role: OfficerRole;
  bench: readonly CrewOfficer[];
  faces: ReadonlyMap<string, string>;
  pending: boolean;
  onAssign: (officerId: string) => void;
  onClose: () => void;
}) {
  // The roster is keyed on an Athens date, so "midnight" was only ever true for a player on the
  // house clock. `useDayResetClock` puts the same instant on the clock this player reads.
  const resetsAt = useDayResetClock();
  return (
    <Modal onClose={onClose} labelledBy="chair-window-title" size="wide">
      <div className="flex min-h-0 flex-col" data-testid="chair-window">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-600/60 px-5 py-4">
          <div className="min-w-0">
            <h2 id="chair-window-title" className="font-stamp text-xl leading-tight text-ink-100">
              {OFFICER_ROLE_LABELS[role]}
            </h2>
            <p className="mt-0.5 font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
              Nobody in this chair
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-2">
            <Heading>Sign somebody</Heading>
            <p className="font-body text-[13px] leading-relaxed text-ink-300">
              The Bar turns over at {resetsAt}, and you may sign a limited number a day.
            </p>
            <InkButton to="/game/bar" icon="bar" className="self-start">
              Go to the Bar
            </InkButton>
          </div>

          <div className="flex flex-col gap-2">
            <Heading>Take somebody off the bench</Heading>
            {bench.length === 0 ? (
              <p className="font-body text-[13px] italic leading-relaxed text-ink-400">
                Nobody is on the bench. Anyone you sign without a chair in mind waits here.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2" data-testid="bench-picker">
                {bench.map((officer) => (
                  <li key={officer.officerId}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onAssign(officer.officerId)}
                      data-testid={`assign-${officer.officerId}`}
                      className="ink-frame card-paper washed flex w-full items-center gap-2.5 p-2 text-left transition-colors hover:border-brass-300/60 disabled:opacity-60"
                    >
                      <OfficerPortrait
                        portraitId={faces.get(officer.officerId) ?? null}
                        name={officer.name}
                        injuredUntil={officer.injuredUntil}
                        className="aspect-[4/5] w-12 shrink-0 border border-surface-600"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-stamp text-[14px] text-ink-100">
                          {officer.name}
                        </span>
                        <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
                          <span className="tabular-nums">{officer.weeklyWage}</span> caps / wk
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {children}
      </h3>
      <span aria-hidden className="ink-rule h-1 w-full" />
    </div>
  );
}

/** The whole sheet, on the card the player opened. */
function OfficerWindow({
  officer,
  portraitId,
  filledRoles,
  pending,
  onReassign,
  onClose,
}: {
  officer: CrewOfficer;
  portraitId: string | null;
  filledRoles: readonly OfficerRole[];
  pending: boolean;
  onReassign: (role: OfficerRole | null) => void;
  onClose: () => void;
}) {
  const open = OFFICER_ROLES.filter((role) => role === officer.role || !filledRoles.includes(role));
  /*
   * The chair list, with the bench on the end of it.
   *
   * A sentinel string rather than `null` in the option value, because the dropdown is a `<select>`
   * underneath and a select's value is a string: `null` round-trips through the DOM as the empty
   * string and comes back as a role nobody has.
   */
  const BENCH = '__bench';
  const release = useReleaseOfficer();
  /*
   * Two presses to end somebody's job (board request).
   *
   * The fee is ten weeks of what they are on and it is taken on the spot, so the first press only
   * *says the price* and the second is the one that pays it. A single button here would sit two
   * centimetres from the chair dropdown on a window a player opens to read a sheet, and the
   * cheapest way to lose an officer would be a misclick on the way to reassigning them.
   */
  const [ending, setEnding] = useState(false);
  const fee = dismissalFee(officer.weeklyWage);
  return (
    <Modal
      onClose={onClose}
      labelledBy="officer-window-title"
      size="wide"
      className="h-[85vh] border-brass-300/40"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="crew-detail">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-surface-600/60 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="officer-window-title"
              className="font-stamp text-2xl leading-tight text-ink-100"
            >
              {officer.name}
            </h2>
            <p className="mt-0.5 font-display text-[13px] uppercase tracking-[0.16em] text-brass-300">
              {officer.role === null ? BENCH_LABEL : OFFICER_ROLE_LABELS[officer.role]}
            </p>
          </div>
          <span className="flex items-center gap-3">
            {/* §H7: what this person costs, every week, for as long as they are on the books.
                The one number about an officer that keeps mattering after the hire, and it was
                only ever visible at the Bar. A mood badge used to sit here instead. */}
            <span className="flex flex-col items-end leading-none">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-ink-400">
                On the books
              </span>
              <span className="mt-1 font-display text-[15px] font-bold tabular-nums text-brass-300">
                {officer.weeklyWage}
                <span className="ml-1 text-[10px] font-normal tracking-[0.12em] text-ink-400">
                  caps / wk
                </span>
              </span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </span>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 p-5 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <OfficerPortrait
              portraitId={portraitId}
              name={officer.name}
              injuredUntil={officer.injuredUntil}
              className="painted rivets edge-lit aspect-[4/5] w-full border-2 border-brass-500/40"
            />
            {officer.perks.length > 0 ? (
              <PerkTags perks={officer.perks} tone="card" />
            ) : (
              <p className="font-body text-[12px] italic leading-snug text-ink-400">
                Brings no speciality to the crew.
              </p>
            )}
            {/* Drawn rather than rendered: it is the one control on this window and the window is
                already paper. Goes where the old text link went. */}
            <InkButton to="/game/training" icon="training" className="mt-1 w-full">
              Training
            </InkButton>

            {/* §H7, in the one place a player is already reading this person's whole file. It was
                only ever on the Bar's payroll list, which is where you go to look at *the book*
                rather than at somebody. */}
            <div className="mt-auto flex flex-col gap-1.5 border-t border-surface-600/60 pt-3">
              {ending ? (
                <>
                  <p className="font-body text-[12px] leading-snug text-ink-300">
                    Ending it costs{' '}
                    <span className="tabular-nums text-oxblood-300">{fee.toLocaleString()}</span>{' '}
                    caps, paid now. Their chair opens immediately.
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={release.isPending}
                      onClick={() => {
                        release.mutate(
                          { officerId: officer.officerId },
                          { onSuccess: () => onClose() },
                        );
                      }}
                      data-testid="confirm-let-go"
                    >
                      {release.isPending ? 'Ending it…' : 'Yes, let them go'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEnding(false)}>
                      Keep them
                    </Button>
                  </div>
                  {/* The server's own words. `releaseOfficer` refuses two different ways ("You
                      cannot cover what letting them go would cost" and "Nobody on your books by
                      that id"), and a 500 or a dropped connection produces neither: printing the
                      caps explanation for all three sent a player to check a number that was fine. */}
                  {release.error !== null && (
                    <p role="alert" className="font-body text-[12px] text-oxblood-300">
                      {release.error.message}
                    </p>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEnding(true)}
                  data-testid="let-go"
                  className="ink-box inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-stamp text-[13px] leading-none text-oxblood-300 transition-colors hover:text-oxblood-100"
                >
                  Let go
                  <span className="font-display text-[11px] tabular-nums text-ink-400">
                    {fee.toLocaleString()} caps
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                Their chair
              </span>
              <span aria-hidden className="ink-rule block min-w-0 flex-1" />
              <Dropdown
                label={`Position for ${officer.name}`}
                value={officer.role ?? BENCH}
                onChange={(value) => onReassign(value === BENCH ? null : value)}
                disabled={pending}
                options={[
                  ...open.map((role) => ({
                    value: role,
                    label: OFFICER_ROLE_LABELS[role],
                  })),
                  // Taking a chair back without ending the job: the other half of the bench.
                  { value: BENCH, label: BENCH_LABEL },
                ]}
                data-testid="reassign-role"
              />
            </div>
            {/* Edged by the chair they are actually sitting in: every row is coloured by how much
                this position cares about that skill, which is the whole reason a sheet is worth
                reading on the crew screen rather than only at the Bar. */}
            {/* Two across, which is `AttributeSheet`'s own guidance for a modal: at four it picks
                its columns off the *viewport*, so inside a window it lays out four-wide in whatever
                width the window has and cuts `Communication`. */}
            <AttributeSheet attributes={officer.attributes} columns={2} roomy role={officer.role} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Chairs that are actually taken. Somebody on the bench takes none, so every seat stays open. */
function seated(officers: readonly CrewOfficer[]): OfficerRole[] {
  return officers
    .map((officer) => officer.role)
    .filter((role): role is OfficerRole => role !== null);
}

function Layout({ data }: { data: CrewResponse }) {
  const reassign = useReassignOfficer();
  const [opened, setOpened] = useState<string | null>(null);
  /** The empty chair a player has clicked, if any. Separate state: a vacancy has no officer id. */
  const [chair, setChair] = useState<OfficerRole | null>(null);
  const open = data.officers.find((officer) => officer.officerId === opened);
  const bench = data.officers.filter((officer) => officer.role === null);
  /*
   * One face each, decided across the whole roster rather than per card.
   *
   * Hashing an id on its own puts the same person on two cards on a good share of rosters: forty-
   * three faces against a handful of officers is the birthday problem, and a crew screen showing
   * one woman twice reads as a bug because it is one.
   */
  const faces = officerPortraits(data.officers.map((officer) => officer.officerId));
  // Chairs, not headcount. Somebody on the bench is on the books and in no chair, so counting the
  // roster here read "5 of 19 chairs filled" with three people actually sitting in one.
  const filled = seated(data.officers).length;

  return (
    <PageShell quote="The city tests everyone. These are the ones it keeps calling back." wide>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[12px] uppercase tracking-[0.18em] text-ink-300">
          {filled} of {OFFICER_ROLES.length} chairs filled
        </span>
        <span aria-hidden className="ink-rule block min-w-0 flex-1" />
        {/* No bed count here any more (§A1, board rule): officers are not charged against the
            district's population, the army is, so a housing figure on the crew screen was a number
            nobody on this page can move. It lives on the screens that field units. */}
        <Link
          to="/game/crew/effects"
          data-testid="open-crew-effects"
          className="ink-box inline-flex items-center gap-1.5 px-3.5 py-1.5 font-stamp text-[13px] leading-none text-brass-300 transition-colors hover:text-brass-100"
        >
          <Icon name="spark" aria-hidden className="h-3.5 w-3.5" />
          What the crew is buying
        </Link>
      </div>

      {/* Said outright rather than folded into an `InfoNote`: that control starts collapsed behind
          a "How this works" toggle, which is right for a rule somebody might want and wrong for the
          one sentence explaining why the screen is empty. */}
      {filled === 0 && (
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          Nineteen positions, nobody in any of them yet. A card is a job: open an empty one and it
          takes you to the Bar to hire for it.
        </p>
      )}

      {/* Reassignment is refused by an ordinary race: somebody took the chair in another tab. The
          mutation was read only for `isPending`, so a refusal left the window open with nothing
          said, and the window staying open was the whole of the feedback. */}
      {reassign.error !== null && (
        <p role="alert" className="font-body text-[13px] text-oxblood-300">
          {reassign.error.message}
        </p>
      )}

      {chair !== null && (
        <ChairWindow
          role={chair}
          bench={bench}
          faces={faces}
          pending={reassign.isPending}
          onAssign={(officerId) => {
            reassign.mutate({ officerId, role: chair }, { onSuccess: () => setChair(null) });
          }}
          onClose={() => setChair(null)}
        />
      )}

      {open !== undefined && (
        <OfficerWindow
          officer={open}
          portraitId={faces.get(open.officerId) ?? null}
          filledRoles={seated(data.officers)}
          pending={reassign.isPending}
          onReassign={(role) => reassign.mutate({ officerId: open.officerId, role })}
          onClose={() => setOpened(null)}
        />
      )}

      {/* No panel around it. Nineteen cards inside a bordered box is a box with a border you have
          to look past; the cards are the surface, and the page they sit on already scrolls. */}
      <div
        /*
         * One more column than before at each width.
         *
         * The card got taller when the portrait went to its full 4:5, and a card's height follows
         * its width: four across a 1600px screen is a 460px picture, so a single row filled the
         * viewport. Narrower columns bring the height back down without cropping anybody, which is
         * the trade this grid exists to make.
         */
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [@media(min-width:1600px)]:grid-cols-5 [@media(min-width:1920px)]:grid-cols-6"
        data-testid="crew-books"
      >
        {OFFICER_ROLES.map((role) => {
          const officer = data.officers.find((candidate) => candidate.role === role);
          return (
            <Seat
              key={role}
              role={role}
              officer={officer}
              portraitId={officer ? (faces.get(officer.officerId) ?? null) : null}
              // A filled chair opens the person's file; an empty one asks where to fill it from.
              onOpen={() => (officer ? setOpened(officer.officerId) : setChair(role))}
            />
          );
        })}
      </div>

      {/*
       * The bench, under the chairs (board request).
       *
       * Below rather than mixed in, because these are the same kind of thing in a different state
       * and a roster is read as nineteen posts: somebody with no post does not belong in the grid
       * of posts. Drawn only when there is somebody on it, so a crew that has never used the bench
       * never sees a heading for it.
       *
       * They open the same window a seated officer does, which is where the chair is chosen. The
       * quickest route is still the other way round, from the empty chair.
       */}
      {bench.length > 0 && (
        <section className="flex flex-col gap-3" data-testid="crew-bench">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-brass-300">
              {BENCH_LABEL}
            </h2>
            <span aria-hidden className="ink-rule block min-w-0 flex-1" />
            <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-400">
              {bench.length} signed, no chair
            </span>
          </div>
          <p className="max-w-prose font-body text-[13px] leading-relaxed text-ink-300">
            On the books and drawing a wage. They still bring what they know to the crew, at a
            fraction of what the right chair would be worth, so give them one when you have it.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [@media(min-width:1600px)]:grid-cols-5 [@media(min-width:1920px)]:grid-cols-6">
            {bench.map((officer) => (
              <BenchCard
                key={officer.officerId}
                officer={officer}
                portraitId={faces.get(officer.officerId) ?? null}
                onOpen={() => setOpened(officer.officerId)}
              />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}

export function CrewPage() {
  const crew = useCrew();
  /* `return null` drew nothing at all on a failed read: no heading, no text, no way to tell a
     broken request from a slow one. See `LoadFailure` for the bug that taught us. */
  if (!crew.data) {
    return (
      <PageShell title="The crew" wide>
        <ScreenLoad
          what="Your crew"
          loading="Reading the chairs…"
          isError={crew.isError}
          onRetry={() => void crew.refetch()}
          detail="Nothing has been lost. Everybody is in the chair you left them in."
        />
      </PageShell>
    );
  }
  return <Layout data={crew.data} />;
}
