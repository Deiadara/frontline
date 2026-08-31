import {
  DEFAULT_BADGE,
  FACTION_BLURB_MAX,
  FACTION_NAME_MAX,
  FACTION_NAME_MIN,
  MAX_FACTION_MEMBERS,
  randomBadge,
  type FactionBadge as Badge,
  type FactionResponse,
} from '@frontline/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { useAnswerFactionInvite, useCreateFaction } from '../../lib/queries';
import { BadgeBuilder } from './BadgeBuilder';
import { FactionBadge } from './FactionBadge';
import { refusalText } from './refusal';

/**
 * The screen for somebody with no faction: the two ways in, and nothing else.
 *
 * It used to be two stacked panels pinned to the top left of a wide page, which left most of the
 * screen empty and read as a form somebody had not finished. This is the same two choices as a
 * *front door*: one centred column, the question at the top of it, and the two answers side by side
 * as separate drawn sheets.
 *
 * ## Joining is not a button
 *
 * There is deliberately no "find a faction" list. An invitation is the only way in, it arrives in
 * the mailbox like anything else somebody sends you, and the left-hand sheet's job is to say so
 * rather than to offer a door that is not there. When invitations *are* held, they are the sheet.
 */
export function FoundFaction({ data }: { data: FactionResponse }) {
  const [building, setBuilding] = useState(false);

  return (
    /*
     * `my-auto` on the column rather than `items-center` on the scroller.
     *
     * Centring a flex child that is taller than its scroll container pins the overflow *above* the
     * top edge, where it cannot be scrolled to; auto margins collapse to zero instead, so a short
     * screen scrolls normally and a tall one still centres.
     */
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto py-3">
      <div
        className={cn(
          'my-auto flex w-full flex-col items-center gap-4 px-4',
          // The two doors read best as a narrow centred column. The builder is the opposite: at
          // 62rem its swatch rows wrap twice over and push Create below the fold of a 720p screen.
          building ? 'max-w-[76rem]' : 'max-w-[62rem]',
        )}
        data-testid="faction-none"
      >
        {/* Gone once the builder is open. The sheet is titled "Create your own" itself, so the
            banner above it is the same words twice, and it is the ~100px that decides whether the
            Create button is on screen at 1280x720.

            The mark sits beside the question rather than over it, for the same reason: stacked,
            the two cost 50px the shortest supported screen does not have to give. */}
        {!building && (
          <header className="flex flex-col items-center gap-1.5 text-center">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="ink-disc flex h-9 w-9 shrink-0 items-center justify-center"
              >
                <Icon name="faction" className="h-5 w-5 text-brass-300" />
              </span>
              <h1 className="font-stamp text-[23px] leading-tight text-ink-100 sm:text-[27px]">
                Join a faction or create your own
              </h1>
            </div>
            <span aria-hidden className="ink-rule h-1 w-56" />
            {/* Gone on a short screen. At 1024x768 the content area is 314px and the two doors plus
                this paragraph do not both fit; the doors are the screen and the paragraph is the
                caption, so the caption yields. The heading still says what the screen is. */}
            <p className="max-w-[40rem] font-body text-[12px] leading-snug text-ink-300 [@media(max-height:790px)]:hidden">
              {MAX_FACTION_MEMBERS} districts at most, one badge between them. Everybody sees
              everybody else&rsquo;s army, and a fight one of you calls is one the rest can join.
            </p>
          </header>
        )}

        {building ? (
          <CreateSheet onCancel={() => setBuilding(false)} />
        ) : (
          <div className="grid w-full gap-4 md:grid-cols-2">
            <JoinSheet data={data} />
            <CreateInvitation onStart={() => setBuilding(true)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The left-hand door: an invitation, or the fact that you need one. */
function JoinSheet({ data }: { data: FactionResponse }) {
  const answer = useAnswerFactionInvite();
  const held = data.invites;

  return (
    <section
      className="ink-frame card-paper washed rivets flex flex-col gap-2 p-4"
      data-testid="join-sheet"
    >
      <h2 className="font-stamp text-[19px] leading-none text-ink-100">Join one</h2>
      <span aria-hidden className="ink-rule h-1 w-full" />

      {held.length === 0 ? (
        <>
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            An invitation is the only way in, and it arrives the way anything else somebody sends
            you does: in your messages, with a button on it.
          </p>
          <p className="font-body text-[13px] leading-relaxed text-ink-400">
            Nobody has asked you yet. Ask around, or start your own and do the asking.
          </p>
          <Link
            to="/game/messages"
            data-testid="to-messages"
            className="ink-box mt-auto inline-flex items-center justify-center gap-2 px-4 py-2 font-stamp text-[14px] leading-none text-brass-200 transition-colors hover:text-brass-100"
          >
            <Icon name="messages" aria-hidden className="h-4 w-4" />
            Check your messages
          </Link>
        </>
      ) : (
        <>
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            You have been asked. Accepting puts your district at their table.
          </p>
          <ul className="flex flex-col gap-2.5">
            {held.map((invite) => (
              <li
                key={invite.id}
                className="flex min-w-0 items-center gap-3 rounded-sm border border-surface-600/80 bg-surface-900/50 p-2.5"
              >
                <FactionBadge badge={invite.factionBadge} size={38} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-stamp text-[15px] leading-tight text-ink-100">
                    {invite.factionName}
                  </span>
                  <span className="truncate font-body text-[11px] text-ink-400">
                    {invite.invitedBy} sent it
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    disabled={answer.isPending}
                    data-testid={`accept-${invite.id}`}
                    onClick={() => answer.mutate({ inviteId: invite.id, accept: true })}
                  >
                    Join
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={answer.isPending}
                    data-testid={`decline-${invite.id}`}
                    onClick={() => answer.mutate({ inviteId: invite.id, accept: false })}
                  >
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {answer.error && (
        <p role="alert" className="font-body text-[12px] text-oxblood-300">
          {refusalText(answer.error.message)}
        </p>
      )}
    </section>
  );
}

/** The right-hand door, before it is opened. */
function CreateInvitation({ onStart }: { onStart: () => void }) {
  return (
    <section className="ink-frame ink-frame-brass card-paper washed rivets flex flex-col gap-2 p-4">
      <h2 className="font-stamp text-[19px] leading-none text-ink-100">Create your own</h2>
      <span aria-hidden className="ink-rule h-1 w-full" />
      <p className="font-body text-[13px] leading-relaxed text-ink-300">
        Name it, draw its badge, say what it is for. You lead what you found, and everybody else
        comes in by your invitation.
      </p>
      {/* Sized to what 1024x768 can spare: the content area there is 314px, and the two sheets
          plus the question come to 329 with these at 44px. Decoration does not get to be the
          reason a player cannot see the Create button. */}
      <div aria-hidden className="flex justify-center gap-2">
        {/* Three of the ninety thousand, so the badge reads as something you make rather than
            something you are assigned. Seeded, so the sheet does not reshuffle on every render. */}
        {[3, 17, 44].map((seed) => (
          <FactionBadge key={seed} badge={randomBadge(seed)} size={38} />
        ))}
      </div>
      <Button className="mt-auto self-stretch" data-testid="start-faction" onClick={onStart}>
        Create a faction
      </Button>
    </section>
  );
}

/**
 * The creation sheet: the three fields the board asked for.
 *
 * Two columns rather than one long form, and that is a fit rather than a taste. Stacked, the name,
 * the builder, the description and the button come to ~520px and the shortest supported screen has
 * ~370px to give, so the Create button sat below the fold of the form that needs it. Side by side
 * the whole decision is on screen at once, which is also the right shape for it: the fields you
 * type into on the left, the thing you are drawing on the right.
 */
function CreateSheet({ onCancel }: { onCancel: () => void }) {
  const create = useCreateFaction();
  const [name, setName] = useState('');
  const [badge, setBadge] = useState<Badge>(DEFAULT_BADGE);
  const [blurb, setBlurb] = useState('');
  const tooShort = name.trim().length < FACTION_NAME_MIN;

  return (
    <section
      className="ink-frame card-paper washed rivets flex w-full flex-col gap-3 p-4"
      data-testid="create-sheet"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-stamp text-[19px] leading-none text-ink-100">Create your own</h2>
        <button
          type="button"
          onClick={onCancel}
          data-testid="cancel-create"
          className="font-body text-[12px] text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
        >
          Never mind
        </button>
      </div>
      <span aria-hidden className="ink-rule h-1 w-full" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
              Faction name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={FACTION_NAME_MAX}
              data-testid="faction-name"
              placeholder="The Ninth Circle"
              className="rounded-sm border border-surface-500 bg-surface-900 px-3 py-2 font-stamp text-[16px] text-ink-100 placeholder:text-ink-500"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
              Faction description
            </span>
            <textarea
              value={blurb}
              onChange={(event) => setBlurb(event.target.value)}
              maxLength={FACTION_BLURB_MAX}
              rows={3}
              data-testid="faction-blurb"
              placeholder="What you are for, and who you are looking for."
              className="rounded-sm border border-surface-500 bg-surface-900 px-3 py-2 font-body text-[13px] text-ink-100 placeholder:text-ink-500"
            />
          </label>

          {create.error && (
            <p role="alert" className="font-body text-[13px] text-oxblood-300">
              {refusalText(create.error.message)}
            </p>
          )}

          <Button
            className="mt-auto"
            disabled={create.isPending || tooShort}
            data-testid="found-faction"
            onClick={() => create.mutate({ name: name.trim(), badge, blurb: blurb.trim() })}
          >
            Create
          </Button>
          <span className="font-body text-[11px] leading-snug text-ink-400">
            {tooShort
              ? `A name is at least ${FACTION_NAME_MIN} letters.`
              : 'The name and the badge can both be changed later.'}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
            Faction badge
          </span>
          <BadgeBuilder badge={badge} onChange={setBadge} />
        </div>
      </div>
    </section>
  );
}
