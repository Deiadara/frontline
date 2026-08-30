import {
  MESSAGE_BODY_MAX,
  MESSAGE_REFUSAL_TEXT,
  MESSAGE_SUBJECT_MAX,
  quoted,
  replySubject,
  type Message,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import {
  useDeleteMessage,
  useMessages,
  useReadAllMessages,
  useReadMessage,
  useSendMessage,
} from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { InviteCard } from './InviteCard';

/**
 * The mailbox (board request).
 *
 * The shape every game with one uses, because players arrive already knowing it: two folders, a
 * list of rows with unread in bold, a reading pane, reply and delete, and a compose form that can
 * address one player or the whole faction.
 *
 * ## Read on open
 *
 * Opening a message marks it read, which is what moves the badge in the standing bar. Deliberately
 * not on render of the list: a count that cleared itself the moment you glanced at the inbox would
 * be a count nobody could trust, and the badge is the only reason to keep the state at all.
 */

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: 'messages' },
  { id: 'sent', label: 'Sent', icon: 'actions' },
] as const;
type FolderId = (typeof FOLDERS)[number]['id'];

function refusalText(message: string): string {
  return (MESSAGE_REFUSAL_TEXT as Record<string, string>)[message] ?? message;
}

/** `2026-08-30 14:05`, trimmed to what a row can carry. */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function MessagesPage() {
  const query = useMessages();
  const send = useSendMessage();
  const read = useReadMessage();
  const readAll = useReadAllMessages();
  const remove = useDeleteMessage();

  const [folder, setFolder] = useState<FolderId>('inbox');
  const [open, setOpen] = useState<Message | null>(null);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [toFaction, setToFaction] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const data = query.data;
  if (!data) return null;

  const error = send.error ?? read.error ?? remove.error ?? null;

  /** Opens a message and marks it read in the same gesture, which is what a mailbox does. */
  const openMessage = (message: Message) => {
    setOpen(message);
    if (message.readAt === null) read.mutate({ id: message.id });
  };

  const startReply = (message: Message) => {
    setTo(message.senderName);
    setToFaction(false);
    setSubject(replySubject(message.subject));
    setBody(quoted(message));
    setOpen(null);
    setComposing(true);
  };

  return (
    <PageShell title="Messages" fills wide>
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="card-paper washed rivets edge-lit flex flex-col rounded-sm border border-surface-500/70">
            <ul className="divide-y divide-surface-700" data-testid="message-folders">
              {FOLDERS.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setFolder(entry.id)}
                    aria-pressed={folder === entry.id}
                    data-testid={`folder-${entry.id}`}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors',
                      folder === entry.id
                        ? 'bg-brass-300/10 text-brass-100'
                        : 'text-ink-200 hover:bg-surface-700/50',
                    )}
                  >
                    <span
                      aria-hidden
                      className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
                    >
                      <Icon name={entry.icon} />
                    </span>
                    <span className="flex-1 font-display text-[12px] font-bold uppercase tracking-[0.14em]">
                      {entry.label}
                    </span>
                    {entry.id === 'inbox' && data.unread > 0 && (
                      <span className="rounded-full bg-oxblood-500 px-1.5 font-display text-[10px] font-bold tabular-nums text-ink-100">
                        {data.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Button data-testid="compose" onClick={() => setComposing(true)}>
              Write to somebody
            </Button>
            {data.unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={readAll.isPending}
                data-testid="read-all-messages"
                onClick={() => readAll.mutate(undefined)}
              >
                Mark all read
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {error && (
            <p role="alert" className="shrink-0 font-body text-[13px] text-oxblood-300">
              {refusalText(error.message)}
            </p>
          )}

          <div
            className="card-paper washed rivets edge-lit min-h-0 flex-1 overflow-y-auto rounded-sm border border-surface-600/70"
            data-testid="message-list"
          >
            {folder === 'inbox' ? (
              data.inbox.length === 0 ? (
                <p className="p-4 font-body text-[13px] italic text-ink-400">
                  Nothing in the box. Quiet is not always good.
                </p>
              ) : (
                <ul>
                  {data.inbox.map((message) => (
                    <li key={message.id} className="border-b border-surface-700/70 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => openMessage(message)}
                        data-testid={`message-${message.id}`}
                        className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-700/40"
                      >
                        {/* Unread is a mark and a weight, not colour alone. */}
                        <span
                          aria-hidden
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            message.readAt === null ? 'bg-oxblood-400' : 'bg-surface-600',
                          )}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span
                            className={cn(
                              'truncate text-[14px] leading-tight',
                              message.readAt === null
                                ? 'font-stamp text-ink-100'
                                : 'font-body text-ink-300',
                            )}
                          >
                            {message.subject}
                          </span>
                          <span className="truncate font-body text-[11px] leading-tight text-ink-400">
                            {message.senderName}
                            {message.senderFaction && ` · ${message.senderFaction}`}
                            {message.audience === 'faction' && ' · to the faction'}
                          </span>
                        </span>
                        <span className="shrink-0 font-display text-[10px] tabular-nums text-ink-400">
                          {stamp(message.sentAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : data.sent.length === 0 ? (
              <p className="p-4 font-body text-[13px] italic text-ink-400">
                You have not written to anybody.
              </p>
            ) : (
              <ul data-testid="sent-list">
                {data.sent.map((message) => (
                  <li
                    key={message.threadId}
                    className="flex min-w-0 items-center gap-3 border-b border-surface-700/70 px-3 py-2.5 last:border-b-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-body text-[14px] leading-tight text-ink-200">
                        {message.subject}
                      </span>
                      <span className="truncate font-body text-[11px] leading-tight text-ink-400">
                        to {message.addressedTo}
                        {message.audience === 'faction' && ' (the faction)'}
                      </span>
                    </span>
                    <span className="shrink-0 font-display text-[10px] tabular-nums text-ink-400">
                      {message.readBy}/{message.recipients} read
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {open && (
        <Modal onClose={() => setOpen(null)} labelledBy="message-title" size="wide">
          <div className="flex min-h-0 flex-col" data-testid="message-open">
            <div className="shrink-0 border-b border-surface-600/60 px-5 py-4">
              <h2 id="message-title" className="font-stamp text-xl leading-tight text-ink-100">
                {open.subject}
              </h2>
              <p className="mt-1 font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
                {open.senderName}
                {open.senderFaction && ` · ${open.senderFaction}`} · {stamp(open.sentAt)}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap font-body text-[14px] leading-relaxed text-ink-200">
                {open.body}
              </p>
              {open.invite && <InviteCard invite={open.invite} />}
            </div>
            <div className="flex shrink-0 gap-2 border-t border-surface-600/60 px-5 py-3">
              <Button size="sm" data-testid="reply" onClick={() => startReply(open)}>
                Reply
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  remove.mutate({ id: open.id });
                  setOpen(null);
                }}
              >
                Throw it away
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {composing && (
        <Modal onClose={() => setComposing(false)} labelledBy="compose-title" size="wide">
          <div className="flex flex-col gap-3 p-5" data-testid="compose-form">
            <h2 id="compose-title" className="font-stamp text-xl text-ink-100">
              Write
            </h2>

            {data.hasFaction && (
              <label className="flex items-center gap-2 font-body text-[13px] text-ink-200">
                <input
                  type="checkbox"
                  checked={toFaction}
                  onChange={(event) => setToFaction(event.target.checked)}
                  data-testid="to-faction"
                />
                To the whole faction
              </label>
            )}

            {!toFaction && (
              <label className="flex flex-col gap-1">
                <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                  To
                </span>
                <input
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  data-testid="compose-to"
                  className="rounded-sm border border-surface-500 bg-surface-900 px-2.5 py-2 font-body text-[14px] text-ink-100"
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                Subject
              </span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={MESSAGE_SUBJECT_MAX}
                data-testid="compose-subject"
                className="rounded-sm border border-surface-500 bg-surface-900 px-2.5 py-2 font-body text-[14px] text-ink-100"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                What you want to say
              </span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={MESSAGE_BODY_MAX}
                rows={8}
                data-testid="compose-body"
                className="rounded-sm border border-surface-500 bg-surface-900 px-2.5 py-2 font-body text-[14px] leading-relaxed text-ink-100"
              />
            </label>

            <div className="flex gap-2">
              <Button
                disabled={
                  send.isPending ||
                  subject.trim().length === 0 ||
                  body.trim().length === 0 ||
                  (!toFaction && to.trim().length === 0)
                }
                data-testid="send-message"
                onClick={() =>
                  send.mutate(
                    {
                      toUsername: toFaction ? null : to.trim(),
                      subject: subject.trim(),
                      body: body.trim(),
                    },
                    {
                      onSuccess: () => {
                        setComposing(false);
                        setTo('');
                        setSubject('');
                        setBody('');
                        setToFaction(false);
                      },
                    },
                  )
                }
              >
                Send it
              </Button>
              <Button variant="ghost" onClick={() => setComposing(false)}>
                Never mind
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}
