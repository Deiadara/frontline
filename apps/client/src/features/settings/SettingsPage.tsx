import {
  GAME_TIMEZONE,
  OFFERED_TIMEZONES,
  PLAYER_ICONS,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  UsernameSchema,
  formatDayClock,
  isValidTimezone,
  zoneCity,
  zoneLabel,
  type PlayerIcon,
} from '@frontline/shared';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { NotificationFilters } from '../social/NotificationFilters';
import { cn } from '../../lib/cn';
import { useChangePassword, useSettings, useUpdateProfile } from '../../lib/queries';
import { playSound, setSoundVolume } from '../../lib/sound';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';

/**
 * The player's own file.
 *
 * Four panels, and they are four panels because they are four different transactions: who you are
 * to other people, what clock you read the game in, how loud it is, and the credential you log in
 * with. Folding them into one form with one Save would mean either asking for a passphrase to
 * change an icon, or accepting a passphrase change without asking for the old one.
 *
 * Each panel says what it did and stops there. A settings screen that navigates away on success is
 * a settings screen that makes you go back to check.
 */

/** The one place a field's chrome is described, so the three panels cannot drift apart. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-ink-200">
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="font-body text-[12px] leading-snug text-ink-300">{hint}</span>
      )}
    </label>
  );
}

const INPUT =
  'w-full min-w-0 rounded-sm border border-surface-600 bg-surface-950 px-3 py-2 font-body ' +
  'text-[14px] text-ink-100 outline-none transition-colors placeholder:text-ink-300/50 ' +
  'focus:border-brass-300';

/** A short line under a form that says what just happened. Green for done, red for refused. */
function Result({ error, done }: { error: Error | null; done: string | null }) {
  if (error) {
    return (
      <p role="alert" className="font-body text-[13px] text-oxblood-300">
        {error.message}
      </p>
    );
  }
  if (done !== null) {
    return (
      <p role="status" className="font-body text-[13px] text-bile-300">
        {done}
      </p>
    );
  }
  return null;
}

function ProfilePanel({
  username,
  displayName,
  icon,
}: {
  username: string;
  displayName: string | null;
  icon: PlayerIcon;
}) {
  const save = useUpdateProfile();
  const [name, setName] = useState(username);
  const [shown, setShown] = useState(displayName ?? '');
  const [glyph, setGlyph] = useState<PlayerIcon>(icon);
  const [done, setDone] = useState<string | null>(null);

  // The server is the source of truth, so a save that changed something the server normalised (or
  // a change made in another tab) pulls the fields back into line rather than leaving stale text
  // sitting in an input that looks authoritative.
  useEffect(() => {
    setName(username);
    setShown(displayName ?? '');
    setGlyph(icon);
  }, [username, displayName, icon]);

  const nameError = UsernameSchema.safeParse(name).success
    ? null
    : 'Three to twenty-four letters, digits or underscores.';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (nameError) return;
    setDone(null);
    save.mutate(
      {
        username: name,
        // An empty box means "call me by my username again", and that is `null`, not an omitted
        // field: omitting it means "leave it alone", so clearing the box used to save nothing and
        // the sync effect above put the old name straight back while the panel said "Saved."
        displayName: shown.trim() === '' ? null : shown.trim(),
        icon: glyph,
      },
      { onSuccess: () => setDone('Saved.') },
    );
  };

  return (
    <Panel title="Who you are">
      <form className="flex flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Operator ID" hint="What you log in with. It has to be unique.">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="username"
              data-testid="settings-username"
              className={cn(INPUT, nameError !== null && 'border-oxblood-500')}
            />
          </Field>
          <Field label="Name" hint="What everybody else sees. Blank means your Operator ID.">
            <input
              value={shown}
              onChange={(event) => setShown(event.target.value)}
              placeholder={username}
              data-testid="settings-display-name"
              className={INPUT}
            />
          </Field>
        </div>

        {nameError !== null && (
          <p className="font-body text-[12px] text-oxblood-300">{nameError}</p>
        )}

        <Field label="Mark" hint="Your glyph on the board, in a listing, and beside your name.">
          {/* Six a row, not "as many as fit". Wrapped, the twelve glyphs broke 10 + 1 at 1440 and
              9 + 2 at 1280: a full row and an orphan, in a different place on every browser. Two
              rows of six is the same picture everywhere and the marks stay their own size, which
              is why the grid is `w-fit` rather than stretched across the column. */}
          <div className="grid w-fit grid-cols-6 gap-2" data-testid="settings-icons">
            {PLAYER_ICONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={option}
                aria-pressed={glyph === option}
                onClick={() => setGlyph(option)}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-sm border transition-all duration-100',
                  glyph === option
                    ? 'border-brass-300/80 bg-brass-300/20 text-brass-100 shadow-brass'
                    : 'border-surface-600 bg-surface-800/70 text-ink-300 hover:border-iris-300/70 hover:text-iris-100',
                )}
              >
                <Icon name={option as IconName} className="h-6 w-6" />
              </button>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={save.isPending || nameError !== null}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Result error={save.error} done={done} />
        </div>
      </form>
    </Panel>
  );
}

function ClockPanel({
  timezone,
  serverNow,
  receivedAt,
}: {
  timezone: string;
  serverNow: string;
  receivedAt: number;
}) {
  const save = useUpdateProfile();
  const [zone, setZone] = useState(timezone);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setZone(timezone), [timezone]);

  // A zone the player has that is not in the offered list still has to appear, or the picker would
  // silently show them somebody else's clock the moment it rendered.
  const options = OFFERED_TIMEZONES.includes(zone as (typeof OFFERED_TIMEZONES)[number])
    ? OFFERED_TIMEZONES
    : [zone, ...OFFERED_TIMEZONES];
  // The panel is called "Your clock", so it has to tick: `new Date(serverNow)` was the response's
  // timestamp, frozen at page load, on a query with no poll.
  const at = useServerClock(serverNow, receivedAt);

  return (
    <Panel
      title="Your clock"
      data-testid="settings-clock-panel"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          House time is {zoneCity(GAME_TIMEZONE)}
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          Every clock, countdown and refresh in the game runs on {zoneCity(GAME_TIMEZONE)} time: the
          day the black market turns over on, and the day the Runner&apos;s hours are quoted
          against. Changing this changes what you are <em>shown</em>; it does not move the day
          boundary, because that one is shared with everybody in the city.
        </p>

        <Field label="Show times in">
          <Dropdown
            label="Which clock to read the game on"
            value={zone}
            onChange={setZone}
            options={options.map((option) => ({
              value: option,
              label: zoneCity(option) + (option === GAME_TIMEZONE ? ' (house)' : ''),
              hint: zoneLabel(at, option),
            }))}
            data-testid="settings-timezone"
          />
        </Field>

        <p
          className="rounded-sm border border-brass-500/40 bg-surface-900/60 px-3 py-2.5 font-display text-[14px] tabular-nums text-ink-100"
          data-testid="settings-clock-preview"
        >
          {formatDayClock(at, zone)} · {zoneLabel(at, zone)}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={save.isPending || !isValidTimezone(zone)}
            onClick={() => {
              setDone(null);
              save.mutate({ timezone: zone }, { onSuccess: () => setDone('Clock changed.') });
            }}
          >
            {save.isPending ? 'Saving…' : 'Use this clock'}
          </Button>
          <Result error={save.error} done={done} />
        </div>
      </div>
    </Panel>
  );
}

/**
 * The volume bar, painted rather than native.
 *
 * `<input type="range">` cannot be dressed without fighting three vendors' shadow DOM for the
 * thumb and the track, and what comes out still does not look like the rest of this game. This is
 * a div with `role="slider"` on it, which is the same control to a screen reader and to a keyboard,
 * and pressed metal to everybody else.
 *
 * Keyboard: arrows move it 5, Page Up and Page Down move it 20, Home and End go to the ends. The
 * step is 5 rather than 1 because a hundred presses to cross the bar is not an interface, and
 * nobody can hear a single percent.
 */
const VOLUME_STEP = 5;
const VOLUME_PAGE = 20;

function VolumeBar({
  value,
  onChange,
  onSettle,
}: {
  value: number;
  /** Called on every movement: the engine follows immediately so the preview is at the new level. */
  onChange: (next: number) => void;
  /** Called when the player lets go, which is when they get to hear what they set. */
  onSettle: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const clamp = (next: number) =>
    Math.round(Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, next)));

  const fromPointer = (clientX: number): number => {
    const box = trackRef.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return value;
    return clamp(((clientX - box.left) / box.width) * SOUND_VOLUME_MAX);
  };

  /*
   * Capture is an improvement, not the mechanism.
   *
   * `setPointerCapture` is what keeps a drag that wanders off the bar still moving it. It is also
   * the one call here that can throw (`InvalidPointerId`, for a pointer the browser no longer
   * considers active), so it goes last and inside a guard: a bar that stops moving because a
   * capture was refused is a worse bar than one that only tracks while the pointer is over it.
   *
   * The move handler therefore reads the button state rather than asking whether it holds the
   * capture, which is correct either way: with capture the events keep arriving here off the bar,
   * and without it they arrive while the pointer is on it.
   */
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    onChange(fromPointer(event.clientX));
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the capture API will not take. The drag still works while it is over the bar.
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // Primary button only, and only while it is held: a pointer merely passing over the bar on its
    // way somewhere else must not move it.
    if ((event.buttons & 1) === 0) return;
    onChange(fromPointer(event.clientX));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
    onSettle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: VOLUME_STEP,
      ArrowUp: VOLUME_STEP,
      ArrowLeft: -VOLUME_STEP,
      ArrowDown: -VOLUME_STEP,
      PageUp: VOLUME_PAGE,
      PageDown: -VOLUME_PAGE,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      onChange(clamp(value + move));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? SOUND_VOLUME_MIN : SOUND_VOLUME_MAX);
    }
  };

  const percent = `${value}%`;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="How loud the interface is"
      aria-orientation="horizontal"
      aria-valuemin={SOUND_VOLUME_MIN}
      aria-valuemax={SOUND_VOLUME_MAX}
      aria-valuenow={value}
      aria-valuetext={percent}
      data-testid="settings-sound-volume"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      // Played on the way up rather than on every step, so holding an arrow key down is one sound
      // at the end and not a rasp all the way across.
      onKeyUp={onSettle}
      className={cn(
        'rivets relative flex h-10 w-full cursor-pointer touch-none select-none items-center',
        'rounded-sm border border-surface-600 bg-surface-950 px-3.5 outline-none transition-colors',
        'focus-visible:border-brass-300',
      )}
    >
      <div ref={trackRef} className="relative h-1.5 w-full rounded-sm bg-surface-700">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-brass-500"
          style={{ width: percent }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-brass-300 bg-brass-500 shadow-lifted"
          style={{ left: percent }}
        />
      </div>
    </div>
  );
}

/**
 * How loud the game is.
 *
 * The bar drives the engine on every movement, because the click it plays when you let go is the
 * only way to know what a number means. Saving is what makes it follow the account to another
 * browser: until then it is this machine's setting, mirrored into `localStorage` by the engine.
 */
function SoundsPanel({ soundVolume }: { soundVolume: number }) {
  const save = useUpdateProfile();
  const [level, setLevel] = useState(soundVolume);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setLevel(soundVolume);
  }, [soundVolume]);

  const move = (next: number) => {
    setLevel(next);
    setSoundVolume(next);
    setDone(null);
  };

  return (
    <Panel
      title="Sounds"
      data-testid="settings-sounds-panel"
      action={
        <span
          className="font-display text-[13px] tabular-nums tracking-[0.14em] text-brass-300"
          data-testid="settings-sound-percent"
        >
          {level}%
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          One bar for the lot: the click under a button, the swish between screens, the chime when a
          crew comes home and the drum when somebody calls a fight. Clicks sit well under the
          events, so working through a screen is quieter than the game telling you something
          happened. Nothing plays until you have clicked once, because no browser lets a page make
          noise before that. At 0 the game is silent.
        </p>

        {/* Not a `Field`: that wraps its children in a `<label>`, and a `<label>` finds nothing to
            label when the control inside it is a div with `role="slider"` rather than an input. The
            bar carries its own `aria-label`. */}
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-ink-200">
            How loud
          </span>
          <VolumeBar value={level} onChange={move} onSettle={() => playSound('click')} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              setDone(null);
              save.mutate({ soundVolume: level }, { onSuccess: () => setDone('Saved.') });
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Result error={save.error} done={done} />
        </div>
      </div>
    </Panel>
  );
}

function PassphrasePanel() {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const mismatch = again !== '' && next !== again;
  const tooShort = next !== '' && next.length < 8;
  const blocked = current === '' || next.length < 8 || next !== again;

  return (
    <Panel title="Passphrase">
      <form
        className="flex flex-col gap-4 p-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked) return;
          setDone(null);
          change.mutate(
            { currentPassword: current, newPassword: next },
            {
              onSuccess: () => {
                setDone('Changed. Your session stays open.');
                setCurrent('');
                setNext('');
                setAgain('');
              },
            },
          );
        }}
      >
        <Field
          label="Current"
          hint="Asked for even though you are logged in. It is the only proof."
        >
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
            data-testid="settings-current-password"
            className={INPUT}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New" hint="Eight characters at least.">
            <input
              type="password"
              value={next}
              autoComplete="new-password"
              onChange={(event) => setNext(event.target.value)}
              data-testid="settings-new-password"
              className={cn(INPUT, tooShort && 'border-oxblood-500')}
            />
          </Field>
          <Field label="Again">
            <input
              type="password"
              value={again}
              autoComplete="new-password"
              onChange={(event) => setAgain(event.target.value)}
              data-testid="settings-repeat-password"
              className={cn(INPUT, mismatch && 'border-oxblood-500')}
            />
          </Field>
        </div>

        {mismatch && (
          <p className="font-body text-[12px] text-oxblood-300">Those two do not match.</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={blocked || change.isPending}>
            {change.isPending ? 'Changing…' : 'Change it'}
          </Button>
          <Result error={change.error} done={done} />
        </div>
      </form>
    </Panel>
  );
}

export function SettingsPage() {
  const query = useSettings();
  const data = query.data;

  if (!data) {
    /*
     * The two states told apart, in the frame.
     *
     * This drew "Pulling your file..." for every state that was not data, so a 500 read as a slow
     * network and read as one for ever: the failure `LoadFailure` exists to end. It was also
     * rendered bare into the shell's outlet, which puts it at the top-left of the viewport under
     * the standing bar, so even the loading line was invisible.
     */
    return (
      <ScreenLoadSheet
        what="Your file"
        loading="Pulling your file…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <PageShell quote="The Combine keeps a file on you either way. This is the part you get to write.">
      <InfoNote label="What is yours alone">
        Everything here is yours alone. Changing your Operator ID changes what you log in with;
        changing your Name changes only what other crews see.
      </InfoNote>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <ProfilePanel
          username={data.user.username}
          displayName={data.user.displayName}
          icon={data.user.icon}
        />
        <ClockPanel
          timezone={data.user.timezone}
          serverNow={data.serverNow}
          receivedAt={query.dataUpdatedAt}
        />
        <SoundsPanel soundVolume={data.user.soundVolume} />
      </div>

      {/* The board asked for the filter to live here. It is the same control the bell's own second
          tab draws, sharing one query rather than a second copy of the state: a player annoyed by a
          category is usually looking at it, and a player hunting for a switch comes here. */}
      <Panel title="What you hear about">
        <NotificationFilters />
      </Panel>

      <PassphrasePanel />
    </PageShell>
  );
}
