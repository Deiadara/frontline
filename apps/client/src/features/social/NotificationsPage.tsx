import { NOTIFICATION_KIND_SPECS, type Notification } from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { useNotifications, useReadAllNotifications, useReadNotification } from '../../lib/queries';
import { Modal } from '../../components/ui/Modal';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { PageShell } from '../game/PageShell';
import { NotificationDetail } from './NotificationDetail';
import { NotificationFilters } from './NotificationFilters';

/**
 * The bell (board request).
 *
 * **The list is the screen.** It used to be two equal tabs, "What happened" and "What reaches you",
 * which made a player choose between the news and the settings every time they opened the bell:
 * two buttons across the top, one of them always the wrong one, and the news, which is the entire
 * reason the screen exists, given half the billing. Now the news is simply what is here, with no
 * heading over it and nothing to click to reach it, and the filters are one drawn button in the
 * corner marked **Preferences**.
 *
 * Every row opens. A notification is a receipt for something that happened somewhere else, and one
 * that cannot be opened is a line of text that makes you go and hunt for the thing it is about.
 */

/** How long ago, in the coarsest unit that is still true. */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Row({
  entry,
  now,
  onOpen,
}: {
  entry: Notification;
  now: number;
  onOpen: (entry: Notification) => void;
}) {
  const spec = NOTIFICATION_KIND_SPECS[entry.kind];
  return (
    <li className="border-b border-surface-700/70 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(entry)}
        data-testid={`notification-${entry.id}`}
        className="flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-700/40"
      >
        <span
          aria-hidden
          className={cn(
            'icon-plate mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm [&_svg]:h-5 [&_svg]:w-5',
            entry.readAt === null ? 'text-brass-300' : 'text-ink-400',
          )}
        >
          <Icon name={spec.icon as IconName} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'truncate text-[14px] leading-tight',
              entry.readAt === null ? 'font-stamp text-ink-100' : 'font-body text-ink-300',
            )}
          >
            {entry.title}
          </span>
          {entry.body && (
            <span className="truncate font-body text-[12px] leading-tight text-ink-400">
              {entry.body}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {entry.readAt === null && (
            <span aria-hidden className="h-2 w-2 rounded-full bg-oxblood-400" />
          )}
          <span className="font-display text-[10px] tabular-nums text-ink-400">
            {ago(entry.createdAt, now)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function NotificationsPage() {
  const query = useNotifications();
  const read = useReadNotification();
  const readAll = useReadAllNotifications();
  const [opened, setOpened] = useState<Notification | null>(null);
  const [preferences, setPreferences] = useState(false);

  const data = query.data;
  /*
   * A failure is said out loud rather than rendered as a blank sheet.
   *
   * `return null` here drew *nothing at all* on a failed read: no heading, no text, no way to tell
   * a broken request from an empty inbox. See `LoadFailure` for the bug that taught us.
   */
  if (!data) {
    if (!query.isError) return null;
    return (
      <PageShell title="Notifications" wide>
        <LoadFailure what="Your notifications" onRetry={() => void query.refetch()} />
      </PageShell>
    );
  }
  const now = Date.parse(data.serverNow);

  /** Opening a receipt marks it read and shows what is behind it. Both, in one gesture. */
  const openEntry = (entry: Notification) => {
    if (entry.readAt === null) read.mutate({ id: entry.id });
    setOpened(entry);
  };

  /*
   * Both controls ride the title row rather than a row of their own.
   *
   * A strip under the heading holding two right-aligned buttons is forty pixels of sheet spent on
   * whitespace, and it pushes the list down the screen for as long as the screen exists. `PageShell`
   * already keeps a slot on the title line for exactly this.
   */
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {data.unread > 0 && (
        <Button
          size="sm"
          variant="ghost"
          disabled={readAll.isPending}
          data-testid="read-all-notifications"
          onClick={() => readAll.mutate(undefined)}
        >
          Mark all read
        </Button>
      )}
      {/* The filters, drawn rather than filled: this is a door to a settings sheet, not the other
          half of the screen. */}
      <button
        type="button"
        onClick={() => setPreferences(true)}
        data-testid="notification-preferences"
        className="ink-box inline-flex items-center gap-1.5 px-3.5 py-1.5 font-stamp text-[13px] leading-none text-brass-200 transition-colors hover:text-brass-100"
      >
        <Icon name="gear" aria-hidden className="h-3.5 w-3.5" />
        Preferences
      </button>
    </div>
  );

  return (
    <PageShell title="Notifications" action={controls} fills wide>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="ink-frame card-paper washed rivets edge-lit min-h-0 flex-1 overflow-y-auto"
          data-testid="notification-list"
        >
          {/* Nothing at all when nothing has happened. No heading, no empty-state paragraph
              explaining that the list is empty: an empty sheet says that already. */}
          {data.notifications.length > 0 && (
            <ul>
              {data.notifications.map((entry) => (
                <Row key={entry.id} entry={entry} now={now} onOpen={openEntry} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {opened && <NotificationDetail entry={opened} onClose={() => setOpened(null)} />}

      {preferences && (
        <Modal onClose={() => setPreferences(false)} labelledBy="prefs-title" size="wide">
          <div className="flex min-h-0 flex-col gap-3 p-5">
            <h2 id="prefs-title" className="font-stamp text-xl text-ink-100">
              Preferences
            </h2>
            <span aria-hidden className="ink-rule h-1 w-full" />
            <div className="min-h-0 overflow-y-auto">
              <NotificationFilters />
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}
