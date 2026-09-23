import {
  GAME_TIMEZONE,
  OFFERED_TIMEZONES,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  UsernameSchema,
  formatDayClock,
  isValidTimezone,
  zoneCity,
  zoneLabel,
} from '@frontline/shared';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { NotificationFilters } from '../social/NotificationFilters';
import { cn } from '../../lib/cn';
import { useChangePassword, useSettings, useUpdateProfile } from '../../lib/queries';
import { playSound, setSoundVolume } from '../../lib/sound';
import { PageShell, ScreenLoadSheet } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { useSession } from '../../store/session';

/**
 * The player's own file.
 *
 * Four panels, and they are four panels because they are four different transactions: who you are
 * to other people, what clock you read the game in, how loud it is, and the credential you log in
 * with. Folding them into one form with one Save would mean either asking for a password to
 * change an icon, or accepting a password change without asking for the old one.
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
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="font-body text-[12px] leading-snug text-ink-300">{hint}</span>
      )}
    </label>
  );
}

/**
 * A box somebody ruled, not a plated input (maintainer, 2026-09-22: make this screen match the
 * rest of the game).
 *
 * `.ink-field` is the pen's own rectangle, the same one the Bar's bid box and the console's
 * knobs wear. It is a background image, so the element keeps a transparent ground and the paper
 * under it shows through; the focus ring is a brass glow rather than a border colour, because
 * there is no border to recolour.
 */
const INPUT =
  'ink-field w-full min-w-0 bg-transparent px-3 py-2 font-body text-[14px] text-ink-100 ' +
  'outline-none transition-shadow placeholder:text-ink-300/40 ' +
  'focus:shadow-[0_0_0_1px_rgb(240_173_76_/_0.55)]';

/** The same box when what is in it is wrong: the glow is oxblood and it is always on. */
const INPUT_BAD = 'shadow-[0_0_0_1px_rgb(154_58_58_/_0.75)]';

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

/**
 * Who you are: the login and the name other people read.
 *
 * The mark, a twelve-glyph picker, was here and is gone (maintainer, 2026-09-22). The account
 * still carries an icon on the wire, so nothing that draws one has to change; what is gone is
 * the choosing of it, which was a wall of buttons above the one field anybody came here for.
 */
function ProfilePanel({ username, displayName }: { username: string; displayName: string | null }) {
  const save = useUpdateProfile();
  const [name, setName] = useState(username);
  const [shown, setShown] = useState(displayName ?? '');
  const [done, setDone] = useState<string | null>(null);

  // The server is the source of truth, so a save that changed something the server normalised (or
  // a change made in another tab) pulls the fields back into line rather than leaving stale text
  // sitting in an input that looks authoritative.
  useEffect(() => {
    setName(username);
    setShown(displayName ?? '');
  }, [username, displayName]);

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
      },
      { onSuccess: () => setDone('Saved.') },
    );
  };

  return (
    <Panel title="Who you are" tone="paper">
      <form className="flex flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Operator ID" hint="What you log in with. It has to be unique.">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="username"
              data-testid="settings-username"
              className={cn(INPUT, nameError !== null && INPUT_BAD)}
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

        <div className="flex flex-wrap items-center gap-3">
          <DrawnButton type="submit" size="sm" disabled={save.isPending || nameError !== null}>
            {save.isPending ? 'Saving…' : 'Save'}
          </DrawnButton>
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
      tone="paper"
      data-testid="settings-clock-panel"
      action={
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          House time is {zoneCity(GAME_TIMEZONE)}
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          The game clock runs in {zoneCity(GAME_TIMEZONE)} time.
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
          className="ink-box px-3 py-2.5 text-center font-stamp text-[15px] tabular-nums text-brass-300"
          data-testid="settings-clock-preview"
        >
          {formatDayClock(at, zone)} · {zoneLabel(at, zone)}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <DrawnButton
            size="sm"
            disabled={save.isPending || !isValidTimezone(zone)}
            onClick={() => {
              setDone(null);
              save.mutate({ timezone: zone }, { onSuccess: () => setDone('Clock changed.') });
            }}
          >
            {save.isPending ? 'Saving…' : 'Use this clock'}
          </DrawnButton>
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
 * The way out (maintainer, 2026-09-23). There was none on any screen: the only log-out the game
 * had was the one the API forced on a 401. It sits under the clock and is stretched to the foot
 * of its column, so its bottom edge is the sounds panel's bottom edge across the way.
 */
function LogOutPanel() {
  const logout = useSession((s) => s.logout);
  return (
    <Panel title="Log out" tone="paper" data-testid="settings-logout-panel" className="flex-1">
      <div className="flex h-full flex-col justify-between gap-4 p-4">
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          Signs this browser out. The crew keeps running while you are gone.
        </p>
        <div>
          <DrawnButton size="sm" tone="danger" onClick={logout} data-testid="settings-logout">
            Log out
          </DrawnButton>
        </div>
      </div>
    </Panel>
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
      tone="paper"
      data-testid="settings-sounds-panel"
      // Stretched to the foot of its column, as the log-out panel across the way is: whichever
      // column is taller sets the line both end on.
      className="flex-1"
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
          <DrawnButton
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              setDone(null);
              save.mutate({ soundVolume: level }, { onSuccess: () => setDone('Saved.') });
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </DrawnButton>
          <Result error={save.error} done={done} />
        </div>
      </div>
    </Panel>
  );
}

function PasswordPanel() {
  const change = useChangePassword();
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const mismatch = again !== '' && next !== again;
  const tooShort = next !== '' && next.length < 8;
  const blocked = next.length < 8 || next !== again;

  return (
    <Panel title="Password" tone="paper">
      <form
        className="flex flex-col gap-4 p-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked) return;
          setDone(null);
          change.mutate(
            { newPassword: next },
            {
              onSuccess: () => {
                setDone('Changed. Your session stays open.');
                setNext('');
                setAgain('');
              },
            },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New" hint="Eight characters at least.">
            <input
              type="password"
              value={next}
              autoComplete="new-password"
              onChange={(event) => setNext(event.target.value)}
              data-testid="settings-new-password"
              className={cn(INPUT, tooShort && INPUT_BAD)}
            />
          </Field>
          <Field label="Again">
            <input
              type="password"
              value={again}
              autoComplete="new-password"
              onChange={(event) => setAgain(event.target.value)}
              data-testid="settings-repeat-password"
              className={cn(INPUT, mismatch && INPUT_BAD)}
            />
          </Field>
        </div>

        {mismatch && (
          <p className="font-body text-[12px] text-oxblood-300">Those two do not match.</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <DrawnButton type="submit" size="sm" disabled={blocked || change.isPending}>
            {change.isPending ? 'Changing…' : 'Change it'}
          </DrawnButton>
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
    <PageShell quote="The only part that the city allows you to control" ruled>
      {/*
       * Two columns, each a stack (maintainer, 2026-09-23). It was one grid of three panels, so
       * the sounds sat in the second row under whichever of the first two was taller, with the
       * difference as dead space over it. Now the left column is who you are and then the sounds,
       * the right is the clock and then the way out, and the way out is pushed to the foot of its
       * column so the two columns end on one line above the sound preferences.
       */}
      <div className="grid items-stretch gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <ProfilePanel username={data.user.username} displayName={data.user.displayName} />
          <SoundsPanel soundVolume={data.user.soundVolume} />
        </div>
        <div className="flex flex-col gap-5">
          <ClockPanel
            timezone={data.user.timezone}
            serverNow={data.serverNow}
            receivedAt={query.dataUpdatedAt}
          />
          <LogOutPanel />
        </div>
      </div>

      {/* The maintainer asked for the filter to live here. It is the same control the bell's own second
          tab draws, sharing one query rather than a second copy of the state: a player annoyed by a
          category is usually looking at it, and a player hunting for a switch comes here. */}
      <Panel
        title="Sound Preferences"
        tone="paper"
        data-testid="settings-notify-panel"
        // Framed by hand like the battle rail, and the rows inside it ruled with the same pen.
        // `NotificationFilters` draws its rows with a plain 1px `border` because the bell's tab is a
        // narrow list where a drawn frame per row would be noise; here the maintainer asked for the
        // hand-drawn lines, so the rows are re-ruled from this side, through their `li > label`,
        // rather than by giving the shared control a flag it only needs on one screen. The brass
        // frame on hover stands in for the `border-brass` the plain border showed, on rows that
        // can still be switched.
        // The frame comes with `tone="paper"` now; what is left here is the rows inside it,
        // re-ruled with the same pen (the bell's own tab draws them with a plain 1px border,
        // which is right for a narrow list and not for this screen).
        className={cn(
          '[&_li>label]:ink-frame [&_li>label:hover:has(input:enabled)]:ink-frame-brass',
        )}
      >
        {/* The other three panels inset their units by `p-4`; this one handed the control the whole
            box, so its lead line and rows ran flush against the panel's own drawn edge and read as
            outside it (maintainer report, 2026-09-15). */}
        <div className="flex flex-col p-4" data-testid="settings-notify-body">
          {/* Without its opening paragraph (maintainer, 2026-09-23): the rows say enough here. */}
          <NotificationFilters lede={false} />
        </div>
      </Panel>

      <PasswordPanel />
    </PageShell>
  );
}
