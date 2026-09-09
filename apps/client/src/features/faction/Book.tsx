import {
  FACTION_BLURB_MAX,
  FACTION_NAME_MAX,
  FACTION_RANKS,
  FACTION_RANK_BLURBS,
  FACTION_RANK_LABELS,
  canEditDescription,
  canEditIdentity,
  type FactionBadge as Badge,
  type FactionResponse,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Confirm } from '../../components/ui/Confirm';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { BadgeBuilder } from './BadgeBuilder';
import { FactionBadge } from './FactionBadge';
import { Heading, WindowHead } from './parts';

/**
 * The book: what the faction is called, what each rank carries, and the leader's way to end it.
 *
 * A window rather than a band on the page, because these are things you come here to *change*
 * rather than to read, and none of them is worth a line of the arrival view. The badge builder
 * alone is six rows of swatches: on the page it was most of the screen for a control that a leader
 * touches twice in the life of a faction.
 *
 * Each part is gated differently and the window says so: the leader owns the name, the badge and
 * the disbanding, a chief keeps the description. Your own way out is not in here: it is on your own
 * file, opened from your seat (`MemberWindow`), where the person leaving is the person on screen.
 */
export function Book({
  data,
  faction,
  onIdentity,
  onDescription,
  onDisband,
  onClose,
  busy,
}: {
  data: FactionResponse;
  faction: NonNullable<FactionResponse['faction']>;
  onIdentity: (name: string, badge: Badge) => void;
  onDescription: (blurb: string) => void;
  onDisband: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const rank = data.rank;
  const [name, setName] = useState(faction.name);
  const [badge, setBadge] = useState<Badge>(faction.badge);
  const [blurb, setBlurb] = useState(faction.blurb);
  const [disbanding, setDisbanding] = useState(false);

  const mayIdentity = rank !== null && canEditIdentity(rank);
  const mayDescribe = rank !== null && canEditDescription(rank);

  return (
    <Modal onClose={onClose} labelledBy="book-title" size="full" data-testid="faction-book">
      <WindowHead id="book-title" title="The book" onClose={onClose}>
        <FactionBadge badge={faction.badge} size={30} />
      </WindowHead>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
        <section className="flex flex-col gap-3">
          <Heading>Name and badge</Heading>
          {mayIdentity ? (
            <>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={FACTION_NAME_MAX}
                data-testid="edit-name"
                aria-label="Faction name"
                className="rounded-sm border border-surface-500 bg-surface-900 px-3 py-2 font-stamp text-[16px] text-ink-100"
              />
              <BadgeBuilder badge={badge} onChange={setBadge} />
              <Button
                className="self-start"
                disabled={busy || name.trim().length < 3}
                data-testid="save-identity"
                onClick={() => onIdentity(name.trim(), badge)}
              >
                Save name and badge
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <FactionBadge badge={faction.badge} size={64} title={`${faction.name}'s badge`} />
              <div className="flex flex-col gap-1">
                <span className="font-stamp text-[17px] text-ink-100">{faction.name}</span>
                <span className="font-body text-[12px] text-ink-400">
                  Only the leader changes these.
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Description</Heading>
          {mayDescribe ? (
            <>
              <textarea
                value={blurb}
                onChange={(event) => setBlurb(event.target.value)}
                maxLength={FACTION_BLURB_MAX}
                rows={2}
                data-testid="edit-blurb"
                aria-label="Faction description"
                className="rounded-sm border border-surface-500 bg-surface-900 px-3 py-2 font-body text-[13px] text-ink-100"
              />
              <Button
                className="self-start"
                size="sm"
                disabled={busy}
                data-testid="save-blurb"
                onClick={() => onDescription(blurb.trim())}
              >
                Save description
              </Button>
            </>
          ) : (
            <p className="font-body text-[13px] leading-relaxed text-ink-300">
              {faction.blurb || 'Nothing written down.'}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <Heading>What each rank carries</Heading>
          <ul className="grid gap-1.5 sm:grid-cols-3" data-testid="rank-book">
            {FACTION_RANKS.map((entry) => (
              <li
                key={entry}
                className={cn(
                  'flex min-w-0 flex-col rounded-sm border px-3 py-2',
                  entry === rank ? 'border-brass-300/70 bg-brass-300/10' : 'border-surface-600/80',
                )}
              >
                <span className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
                  {FACTION_RANK_LABELS[entry]}
                  {entry === rank && <span className="ml-2 text-ink-300">you</span>}
                </span>
                <span className="font-body text-[12px] leading-snug text-ink-300">
                  {FACTION_RANK_BLURBS[entry]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {mayIdentity && data.members.length > 1 && (
          <section className="flex flex-col gap-2">
            <Heading>Ending it</Heading>
            <p className="font-body text-[13px] leading-relaxed text-ink-300">
              Disbanding closes the table for everybody at it. To walk out and leave it standing,
              hand it to somebody first, then leave from your own seat.
            </p>
            <Button
              variant="danger"
              className="self-start"
              disabled={busy}
              data-testid="disband-faction"
              onClick={() => setDisbanding(true)}
            >
              Disband it
            </Button>
          </section>
        )}
      </div>

      {disbanding && (
        <Confirm
          title="Disband the faction"
          body={`${faction.name} and everything at its table goes, for all ${data.members.length} of you. This cannot be undone.`}
          confirm="Disband it"
          testId="confirm-disband"
          onCancel={() => setDisbanding(false)}
          onConfirm={() => {
            setDisbanding(false);
            onDisband();
          }}
        />
      )}
    </Modal>
  );
}
