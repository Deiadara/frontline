import {
  GAME_TIMEZONE,
  OFFERED_TIMEZONES,
  PLAYER_ICONS,
  UsernameSchema,
  formatDayClock,
  isValidTimezone,
  zoneCity,
  zoneLabel,
  type PlayerIcon,
} from '@frontline/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useChangePassword, useSettings, useUpdateProfile } from '../../lib/queries';
import { InfoNote, PageShell } from '../game/PageShell';

/**
 * The player's own file.
 *
 * Three panels, and they are three panels because they are three different transactions: who you
 * are to other people, what clock you read the game in, and the credential you log in with. Folding
 * them into one form with one Save would mean either asking for a passphrase to change an icon, or
 * accepting a passphrase change without asking for the old one.
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
        // An empty box means "call me by my username again", which the schema spells as omitting
        // the field, so it is sent only when there is something in it.
        ...(shown.trim() === '' ? {} : { displayName: shown.trim() }),
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
          <div className="flex flex-wrap gap-2" data-testid="settings-icons">
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

function ClockPanel({ timezone, serverNow }: { timezone: string; serverNow: string }) {
  const save = useUpdateProfile();
  const [zone, setZone] = useState(timezone);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setZone(timezone), [timezone]);

  // A zone the player has that is not in the offered list still has to appear, or the picker would
  // silently show them somebody else's clock the moment it rendered.
  const options = OFFERED_TIMEZONES.includes(zone as (typeof OFFERED_TIMEZONES)[number])
    ? OFFERED_TIMEZONES
    : [zone, ...OFFERED_TIMEZONES];
  const at = new Date(serverNow);

  return (
    <Panel
      title="Your clock"
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
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Pulling your file…
        </p>
      </div>
    );
  }

  return (
    <PageShell
      title="Settings"
      icon="gear"
      lede="Your name, your mark, your clock and your passphrase."
    >
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
        <ClockPanel timezone={data.user.timezone} serverNow={data.serverNow} />
      </div>

      <PassphrasePanel />
    </PageShell>
  );
}
