import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_GROUP_LABELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_SPECS,
  isAlwaysOn,
  withMuted,
  type NotificationKind,
} from '@frontline/shared';
import { cn } from '../../lib/cn';
import { useNotificationSettings, useNotifications } from '../../lib/queries';

/**
 * Which kinds of notification reach this player.
 *
 * One component, rendered in two places: on the bell's own second tab, where somebody who is
 * annoyed by a category is already looking at it, and in Settings, which is where a player goes
 * when they are looking for a switch rather than for news. Both read and write the same query, so
 * there is no second copy of the state to fall out of step: this is a shared control, not a
 * duplicated screen.
 */
export function NotificationFilters() {
  const query = useNotifications();
  const save = useNotificationSettings();
  const settings = query.data?.settings;
  if (!settings) return null;

  return (
    <div className="flex flex-col gap-5" data-testid="notification-settings">
      <p className="font-body text-[13px] leading-relaxed text-ink-300">
        A kind you switch off is never recorded, so turning it back on is about what happens next
        rather than about unpacking what you missed. Two cannot be switched off: a battle report and
        an attack on your district are how you find out something irreversible has happened.
      </p>
      {/* A refused save left the box exactly as it was, with nothing said: indistinguishable from a
          click that missed, and the player walks away believing a kind is muted when it is not. The
          checkbox is not optimistic (`checked` is derived from `settings.muted`, which only moves on
          the mutation's `onSuccess`), so the message is the only signal there can be. */}
      {save.error !== null && (
        <p role="alert" className="font-body text-[13px] text-oxblood-300">
          {save.error.message}
        </p>
      )}
      {NOTIFICATION_GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
            {NOTIFICATION_GROUP_LABELS[group]}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {NOTIFICATION_KINDS.filter((kind) => NOTIFICATION_KIND_SPECS[kind].group === group).map(
              (kind: NotificationKind) => {
                const spec = NOTIFICATION_KIND_SPECS[kind];
                const locked = isAlwaysOn(kind);
                const on = locked || !settings.muted.includes(kind);
                return (
                  <li key={kind}>
                    <label
                      className={cn(
                        'flex min-w-0 items-start gap-3 rounded-sm border px-3 py-2 transition-colors',
                        locked
                          ? 'border-surface-700 opacity-70'
                          : 'cursor-pointer border-surface-600 hover:border-brass-300/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={locked || save.isPending}
                        data-testid={`notify-${kind}`}
                        onChange={(event) =>
                          save.mutate(withMuted(settings, kind, !event.target.checked))
                        }
                        className="mt-0.5"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-body text-[13px] leading-tight text-ink-100">
                          {spec.label}
                          {locked && (
                            <span className="ml-2 font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
                              always on
                            </span>
                          )}
                        </span>
                        <span className="font-body text-[12px] leading-snug text-ink-400">
                          {spec.blurb}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              },
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
