import {
  MESSAGE_RECIPIENTS_MAX,
  MESSAGE_REFUSAL_TEXT,
  type PlayerStanding,
} from '@frontline/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { FactionBadge } from '../faction/FactionBadge';
import { suggestPlayers } from '../leaderboard/players';

/**
 * Who a letter goes to (maintainer request, 2026-09-23).
 *
 * The To field used to be a text box, and a name typed with one letter wrong came back as a
 * refusal after the whole letter had been written. It works like the standings search now: typing
 * throws up the best few names it can see, and a name is a recipient only once it has been ticked.
 * More than one can be ticked, and the chosen names sit in the field itself, highlighted and
 * comma-separated, each with its own way out.
 *
 * ## Where the names come from
 *
 * The same board the standings draw, which is every crew in the city, so what this field can see
 * is exactly what the standings search can see. The writer's own name is left out: the server
 * refuses a letter to yourself and there is no reason to offer the choice.
 *
 * ## A name that matches nobody
 *
 * Said here, under the field, while the reader is still typing: `no_such_player` in the server's
 * own words. It used to be the server's answer to the finished letter, drawn on the page behind
 * the composer where the reader was not looking.
 */
export function RecipientPicker({
  entries,
  exclude,
  chosen,
  onChange,
}: {
  entries: readonly PlayerStanding[];
  /** The writer's own name, never offered. */
  exclude: string | null;
  chosen: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [shut, setShut] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const offered = entries.filter((entry) => entry.username !== exclude);
  const suggestions = suggestPlayers(offered, query, 6);
  const open = !shut && suggestions.length > 0;
  const nobody = query.trim() !== '' && suggestions.length === 0;
  const full = chosen.length >= MESSAGE_RECIPIENTS_MAX;

  // A press anywhere else puts the list away; a press inside keeps it, so several names can be
  // ticked off one list. Same move as `PlayerSearch` and `Dropdown`.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && box.current?.contains(target)) return;
      setShut(true);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  const at = Math.min(active, suggestions.length - 1);

  const type = (next: string) => {
    setQuery(next);
    setActive(0);
    setShut(false);
  };

  const toggle = (username: string) => {
    if (chosen.includes(username)) {
      onChange(chosen.filter((name) => name !== username));
      return;
    }
    if (full) return;
    onChange([...chosen, username]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at + step + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Enter') {
      const picked = suggestions[at];
      if (!open || !picked) return;
      event.preventDefault();
      toggle(picked.username);
      return;
    }
    if (event.key === 'Backspace' && query === '' && chosen.length > 0) {
      onChange(chosen.slice(0, -1));
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation();
        setShut(true);
      } else if (query !== '') {
        event.stopPropagation();
        type('');
      }
    }
  };

  return (
    <div ref={box} className="relative flex flex-col gap-1">
      {/* The field is the box, and the chosen names live inside it with the caret after the last
          one: one click anywhere in the box puts the caret back in the text. */}
      <div
        onClick={() => field.current?.focus()}
        data-testid="compose-recipients"
        className="flex min-h-[2.5rem] cursor-text flex-wrap items-center gap-x-1 gap-y-1 rounded-sm border border-surface-500 bg-surface-900 px-2.5 py-1.5"
      >
        {chosen.map((name, index) => (
          <span key={name} className="flex items-center">
            <span
              data-testid={`compose-recipient-${name}`}
              className="flex items-center gap-1 rounded-sm border border-brass-300/60 bg-brass-300/15 px-1.5 py-px font-stamp text-[13px] leading-tight text-brass-100"
            >
              {name}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(name);
                }}
                aria-label={`Take ${name} off the letter`}
                data-testid={`compose-recipient-remove-${name}`}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-brass-300 hover:text-ink-100 [&_svg]:h-3 [&_svg]:w-3"
              >
                <Icon name="close" />
              </button>
            </span>
            {index < chosen.length - 1 && (
              <span aria-hidden className="font-body text-[14px] text-ink-300">
                ,
              </span>
            )}
          </span>
        ))}
        <input
          ref={field}
          value={query}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setShut(false)}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${at}` : undefined}
          aria-label="Who it goes to"
          placeholder={chosen.length === 0 ? 'Start typing a name' : ''}
          data-testid="compose-to"
          className="min-w-[8rem] flex-1 bg-transparent font-body text-[14px] text-ink-100 outline-none placeholder:text-ink-500"
        />
      </div>

      {nobody && (
        <p
          role="alert"
          data-testid="recipient-no-match"
          className="font-body text-[12px] text-oxblood-300"
        >
          {MESSAGE_REFUSAL_TEXT.no_such_player}
        </p>
      )}
      {full && (
        <p data-testid="recipient-full" className="font-body text-[12px] text-ink-400">
          {MESSAGE_RECIPIENTS_MAX} names is as many as one letter carries.
        </p>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1">
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            aria-label="Best matches"
            data-testid="recipient-suggestions"
            className="ink-frame card-paper washed edge-lit flex flex-col overflow-hidden shadow-panel"
          >
            {suggestions.map((entry, index) => {
              const ticked = chosen.includes(entry.username);
              const barred = full && !ticked;
              return (
                <li
                  key={entry.userId}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={ticked}
                  aria-disabled={barred || undefined}
                  onClick={() => toggle(entry.username)}
                  onMouseEnter={() => setActive(index)}
                  data-testid={`recipient-option-${entry.username}`}
                  className={cn(
                    'flex items-center gap-2.5 border-b border-surface-700/60 px-3 py-2 last:border-b-0',
                    barred ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    index === at ? 'bg-brass-300/15' : 'hover:bg-brass-300/10',
                  )}
                >
                  {/* The tick is the row's state drawn, not a second control: the row is the
                      option and the box only says whether it is on the letter. */}
                  <input
                    type="checkbox"
                    checked={ticked}
                    readOnly
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none h-3.5 w-3.5 accent-brass-300"
                  />
                  <span className="flex h-[27px] w-[22px] shrink-0 items-center justify-center">
                    {entry.factionBadge ? (
                      <FactionBadge badge={entry.factionBadge} size={22} />
                    ) : (
                      <span aria-hidden className="text-ink-500 [&_svg]:h-4 [&_svg]:w-4">
                        <Icon name="crew" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-stamp text-[14px] leading-tight text-ink-100">
                    {entry.username}
                  </span>
                  {entry.isBot && (
                    <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.16em] text-ink-400">
                      House crew
                    </span>
                  )}
                  <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                    #<span className="tabular-nums">{entry.rank}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
