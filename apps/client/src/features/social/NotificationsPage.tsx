import { NOTIFICATION_KIND_SPECS, type Notification } from '@frontline/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { useNotifications, useReadAllNotifications, useReadNotification } from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { NotificationFilters } from './NotificationFilters';

/**
 * The bell (board request).
 *
 * Two tabs, and they are the two halves of what a notification system is: **what happened**, and
 * **what you want to hear about**. Putting the filters on a separate screen was considered and
 * rejected: a player who is annoyed by a category is looking at that category when they decide, and
 * making them go and find a settings page is how the filters end up never being used.
 *
 * Every row is a link. A notification is a receipt for something that happened somewhere else, and
 * one that does not take you there is a line of text that makes you go and hunt.
 */

const TABS = [
  { id: 'list', label: 'What happened' },
  { id: 'settings', label: 'What reaches you' },
] as const;
type TabId = (typeof TABS)[number]['id'];

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
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('list');

  const data = query.data;
  if (!data) return null;
  const now = Date.parse(data.serverNow);

  /** Opening a receipt marks it read and goes where it points. Both, in one gesture. */
  const openEntry = (entry: Notification) => {
    if (entry.readAt === null) read.mutate({ id: entry.id });
    void navigate(entry.link);
  };

  return (
    <PageShell title="Notifications" fills wide>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-pressed={tab === entry.id}
              data-testid={`notification-tab-${entry.id}`}
              className={cn(
                'rounded-sm border px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
                tab === entry.id
                  ? 'border-brass-300 bg-brass-300/10 text-brass-100'
                  : 'border-surface-600 text-ink-300 hover:border-brass-300/60',
              )}
            >
              {entry.label}
            </button>
          ))}
          {tab === 'list' && data.unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={readAll.isPending}
              data-testid="read-all-notifications"
              onClick={() => readAll.mutate(undefined)}
            >
              Mark all read
            </Button>
          )}
        </div>

        <div
          className="card-paper washed rivets edge-lit min-h-0 flex-1 overflow-y-auto rounded-sm border border-surface-600/70"
          data-testid="notification-list"
        >
          {tab === 'list' ? (
            data.notifications.length === 0 ? (
              <p className="p-4 font-body text-[13px] italic text-ink-400">
                Nothing has happened that you asked to hear about.
              </p>
            ) : (
              <ul>
                {data.notifications.map((entry) => (
                  <Row key={entry.id} entry={entry} now={now} onOpen={openEntry} />
                ))}
              </ul>
            )
          ) : (
            <div className="p-4">
              <NotificationFilters />
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
