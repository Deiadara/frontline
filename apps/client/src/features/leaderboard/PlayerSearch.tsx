import type { PlayerStanding } from '@frontline/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { crewFileHref } from '../city/LocationSheet';
import { FactionBadge } from '../faction/FactionBadge';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { suggestPlayers } from './players';

/**
 * Finding one player on a board of a hundred (maintainer request, 2026-09-12).
 *
 * Two jobs in one field, which is why it is a combobox and not a filter box. Typing narrows the
 * table underneath, because that is what a reader comparing three crews wants. Typing also throws
 * up the best few names it can see, because a reader who came here for one person does not want a
 * shorter table, they want that person's file, and the suggestion is a door straight to it.
 *
 * The ranking lives in `players.ts`: front of the name beats front of a word beats anywhere in the
 * middle, and punctuation is forgiven on the last pass.
 *
 * ## Why a real combobox
 *
 * The list is drawn rather than native, like every other menu in this game (`Dropdown` has the
 * argument). That buys the look and costs the keyboard, so the keyboard is put back by hand: down
 * and up walk the suggestions, enter opens the highlighted one (or the best one, if the reader
 * never pressed an arrow), escape puts the list away and a second escape empties the field. A
 * screen reader gets `combobox` + `listbox` + `aria-activedescendant`, so what it announces is what
 * is drawn.
 */
export function PlayerSearch({
  entries,
  query,
  onQuery,
}: {
  entries: readonly PlayerStanding[];
  query: string;
  onQuery: (query: string) => void;
}) {
  const navigate = useNavigate();
  const listId = useId();
  const [active, setActive] = useState(0);
  const [shut, setShut] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const suggestions = suggestPlayers(entries, query);
  const open = !shut && suggestions.length > 0;

  /*
   * A press anywhere else puts the list away, which is the one way out a drawn combobox does not
   * get for free.
   *
   * The list is `absolute z-20` over the top of the ranked sheet, and escape, another keystroke or
   * a pick were the only things that ever closed it: clicking somewhere else left it hanging over
   * the first five rows of the table for as long as the screen was open, and opening the sort menu
   * beside it left two menus up at once. `Dropdown` closes on a window `pointerdown` (see the note
   * there) and this is the same move, so the two controls in one strip behave the same way.
   *
   * A press *inside* is excluded rather than the listener being hung on the field: closing on a
   * press that landed on a suggestion would unmount the link under the finger, and the click that
   * follows it would land on whatever the table had moved up into that place.
   */
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

  // Clamped rather than reset on every keystroke: the highlight should survive another letter
  // being typed, and only fall back to the best match when the list it pointed into got shorter.
  const at = Math.min(active, suggestions.length - 1);

  const type = (next: string) => {
    onQuery(next);
    setActive(0);
    setShut(false);
  };

  const go = (entry: PlayerStanding) => {
    setShut(true);
    void navigate(crewFileHref(entry.userId));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // Stepped from `at`, the row actually highlighted, not from `active`, which can be pointing
      // past the end of a list that got shorter. On `active` 4 with two rows left both arrows came
      // back to 1 and the keyboard was dead until the reader typed another letter.
      setActive((at + step + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Enter') {
      const picked = suggestions[at];
      if (!open || !picked) return;
      event.preventDefault();
      go(picked);
      return;
    }
    if (event.key === 'Escape') {
      // The list first, the field second: escape on an open list should not also throw away the
      // three letters that opened it.
      if (open) setShut(true);
      else if (query !== '') type('');
    }
  };

  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-[20rem]">
      {/* The name of the field is inside it rather than over it. A label on its own line is the
          honest default, and here it cost the table a row: the sheet at 720 has about 440px for
          a heading, a strip of controls and a hundred ranked crews. The placeholder says the same
          thing, and `aria-label` says it to anybody the placeholder does not reach. */}
      <span className="relative flex min-w-0 items-center">
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 text-ink-400 [&_svg]:h-4 [&_svg]:w-4"
        >
          <Icon name="eye" />
        </span>
        <input
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
          placeholder="Find a player"
          aria-label="Find a player by name"
          data-testid="standings-search"
          className="ink-box w-full bg-surface-900/80 py-2 pl-8 pr-8 font-body text-[14px] text-ink-100 placeholder:text-ink-500"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => type('')}
            aria-label="Clear the search"
            data-testid="standings-search-clear"
            className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-sm text-ink-400 hover:text-brass-300 [&_svg]:h-3.5 [&_svg]:w-3.5"
          >
            <Icon name="close" />
          </button>
        )}
      </span>

      {open && (
        /*
         * Two elements, and the outer one carries nothing but the position.
         *
         * `.card-paper` declares `position: relative`, and it lands after Tailwind's `.absolute`
         * in the sheet, so a list wearing both is *in flow*: the strip grew by the height of the
         * list every time somebody typed, and the tabs, the picker and the whole table under them
         * slid down the page. Every gate stayed green, because nothing was clipped and nothing
         * overflowed. The screenshot is what caught it.
         */
        <div className="absolute left-0 right-0 top-full z-20 mt-1">
          <ul
            id={listId}
            role="listbox"
            aria-label="Best matches"
            data-testid="standings-suggestions"
            className="ink-frame card-paper washed edge-lit flex flex-col overflow-hidden shadow-panel"
          >
            {suggestions.map((entry, index) => (
              <li
                key={entry.userId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === at}
              >
                <Link
                  to={crewFileHref(entry.userId)}
                  onClick={() => setShut(true)}
                  onMouseEnter={() => setActive(index)}
                  data-testid={`standings-suggestion-${entry.username}`}
                  className={cn(
                    'flex items-center gap-2.5 border-b border-surface-700/60 px-3 py-2 last:border-b-0',
                    index === at ? 'bg-brass-300/15' : 'hover:bg-brass-300/10',
                  )}
                >
                  {/* 22 wide and 27 tall, not a square. `FactionBadge` draws at `size * 1.2`
                      (its viewBox is 100 by 120), so a square slot is four pixels shorter than the
                      badge in it and every badge here spilled its box. The ranked sheet carries the
                      same note beside the same number. */}
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
                  <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                    #<span className="tabular-nums">{entry.rank}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
