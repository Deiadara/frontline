import {
  GAME_TIMEZONE,
  LoginRequestSchema,
  MVP_DEV_CREDENTIALS,
  RegisterRequestSchema,
  formatClock,
  type AuthResponse,
} from '@frontline/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiRequestError, login, register } from '../lib/api';
import { SceneBackdrop } from '../features/game/PageShell';
import { Wordmark } from '../brand/Wordmark';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { Icon, type IconName } from '../components/ui/Icon';
import { useSession } from '../store/session';

/**
 * The door.
 *
 * This is the first frame of the game and for a long time it was a form on a picture: two inputs, a
 * button, and nothing that said what was behind it. A sign-up board has one job beyond taking a
 * password, which is to make somebody want to type one, so the screen is split. The left half is
 * the pitch, in the game's own voice, with the three things this actually is. The right half is the
 * board itself, bolted to the wall like everything else in this city.
 *
 * The card is the one place in the interface allowed to be ornate: it is looked at once per
 * session, it is the only thing on screen, and it is where the game establishes what kind of thing
 * it is going to be. Rust, rivets, tape and a hand-drawn rule, over the district behind it.
 *
 * At narrow widths the pitch drops away and the board takes the column. A marketing panel that
 * pushes the passphrase field below the fold is worse than no marketing panel.
 */

type Mode = 'login' | 'register';

interface FieldErrors {
  username?: string | undefined;
  password?: string | undefined;
}

/**
 * MVP ONLY, **and only in a development build**: the login form starts prefilled with the seeded
 * dev operator so the build can be picked up and played, and says so underneath.
 *
 * Gated on `import.meta.env.DEV`, which Vite replaces with a literal at build time, so a
 * `vite build` drops both the prefill and the notice and the constant with them. Ungated, every
 * visitor to a deployed build got the seeded account's passphrase typed into the form and spelled
 * out below it: a credential that is seeded on every boot of the server is not a secret the
 * interface may also publish.
 *
 * `pnpm dev` and the Playwright stack both run the dev server, so the convenience survives where
 * it is for. Register mode starts blank either way: the dev passphrase is 5 characters and would
 * fail `RegisterRequestSchema`'s 8-character minimum.
 */
const DEV_PREFILL = import.meta.env.DEV;

const prefillFor = (mode: Mode) =>
  DEV_PREFILL && mode === 'login'
    ? { username: MVP_DEV_CREDENTIALS.username, password: MVP_DEV_CREDENTIALS.password }
    : { username: '', password: '' };

/** The three lines of pitch. Concrete nouns only: a feature list is not a reason to sign up. */
const PROMISES: readonly { icon: IconName; title: string; line: string }[] = [
  {
    icon: 'district',
    title: 'Hold a district',
    line: 'Thirteen structures, a build queue that never stops, and a grid that browns out if you overreach.',
  },
  {
    icon: 'sword',
    title: 'Take the city',
    line: 'Thirty-one places, ten districts, and an army that dies in the order you sent it.',
  },
  {
    icon: 'infamy',
    title: 'Earn a name',
    line: 'Infamy buys what caps cannot. There is a door at the back of the market for it.',
  },
];

export function AuthScreen() {
  const setSession = useSession((s) => s.login);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(prefillFor('login').username);
  const [password, setPassword] = useState(prefillFor('login').password);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation<AuthResponse, Error, void>({
    mutationFn: () =>
      mode === 'login' ? login({ username, password }) : register({ username, password }),
    onSuccess: (data) => setSession(data.token, data.user),
  });

  const switchMode = (next: Mode) => {
    const prefill = prefillFor(next);
    setMode(next);
    setUsername(prefill.username);
    setPassword(prefill.password);
    setFieldErrors({});
    mutation.reset();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const schema = mode === 'register' ? RegisterRequestSchema : LoginRequestSchema;
    const parsed = schema.safeParse({ username, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ username: flat.username?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    mutation.mutate();
  };

  /*
   * Anything that is not an `ApiRequestError` still has to reach the player.
   *
   * A network failure, a DNS failure, a CORS rejection, a timeout or a parse failure all arrive as
   * something else, and discarding them left the button back on "Jack In" over a form that had
   * visibly done nothing. This is the first screen of the game and the one place a player has no
   * other evidence about what is happening, so an unrecognised failure gets a sentence rather than
   * the raw message: a `TypeError: Failed to fetch` tells them less than nothing.
   */
  const serverError =
    mutation.error === null
      ? null
      : mutation.error instanceof ApiRequestError
        ? mutation.error.message
        : 'Could not reach the server. Check your connection and try again.';
  const now = new Date();

  return (
    // The city is behind the door before you are through it. A login on a flat field is a form;
    // a login over the district is the first frame of the game.
    <main className="vignette relative flex h-screen flex-col items-center justify-center overflow-hidden bg-surface-950 px-4 py-6">
      <SceneBackdrop />
      <div className="grain pointer-events-none absolute inset-0 z-10" />
      {/* The same pane of dirty glass that runs over the game's chrome, so the door and the rooms
          behind it are lit by one light. */}
      <div className="patina pointer-events-none absolute inset-0 z-30" />

      <div className="relative z-20 grid w-full max-w-5xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* The pitch. Hidden below `lg`, where the board needs the whole column. */}
        <section className="hidden min-w-0 flex-col gap-6 lg:flex">
          <div>
            <p className="font-display text-[11px] uppercase tracking-[0.3em] text-brass-300">
              Neon Docks · Sector 7
            </p>
            <h1 className="mt-3">
              <Wordmark className="w-72 max-w-full" />
            </h1>
            <p className="mt-4 max-w-md font-body text-[15px] leading-relaxed text-ink-200">
              The Combine runs the lights, the water and the checkpoints. You run six streets and a
              generator that is one bad week from cutting out. Everybody in this city is somebody
              else&apos;s problem.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {PROMISES.map((promise) => (
              <li key={promise.title} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-brass-500/40 bg-brass-300/10 text-brass-300">
                  <Icon name={promise.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[13px] font-bold uppercase tracking-[0.14em] text-ink-100">
                    {promise.title}
                  </span>
                  <span className="mt-0.5 block font-body text-[13px] leading-snug text-ink-300">
                    {promise.line}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {/* The house clock, stated before anybody signs up. Every schedule in the game runs on
              it, and finding that out from a countdown that is two hours off is the wrong way.
              The *zone* is deliberately not named here: it is named once, in Settings, where it is
              a control rather than trivia. What a player needs before signing up is what the clock
              currently reads and that they can move it. */}
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-200">
            City time is {formatClock(now, GAME_TIMEZONE)}. You can read it in your own clock from
            Settings.
          </p>
        </section>

        {/* The board. */}
        <section className="min-w-0 justify-self-center lg:justify-self-end">
          {/* The wordmark again, for the narrow layout where the pitch is not on screen to carry
              it. `aria-hidden` and not a heading: the real `h1` is in the pitch above, which stays
              in the document at every width: two of them would be one document outline with the
              game's name in it twice. */}
          <div aria-hidden className="mb-5 text-center lg:hidden">
            <p className="font-display text-[11px] uppercase tracking-[0.3em] text-brass-300">
              Neon Docks · Sector 7
            </p>
            <div className="mt-3">
              <Wordmark className="mx-auto w-64 max-w-full" />
            </div>
          </div>

          <div className="glass-strong rusted rivets taped edge-lit relative w-full max-w-sm rounded-sm border border-surface-600/80 shadow-panel">
            <div className="grid grid-cols-2">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={cn(
                    'relative border-b py-3.5 font-display text-xs font-semibold uppercase tracking-[0.25em] transition-colors',
                    mode === m
                      ? 'border-brass-300 bg-brass-300/10 text-brass-300'
                      : 'border-surface-700 text-ink-300 hover:bg-surface-800/60 hover:text-ink-200',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6" noValidate>
              <p className="font-body text-[13px] leading-snug text-ink-300">
                {mode === 'login'
                  ? 'Back to the district. Nothing waited for you.'
                  : 'Pick a handle the street can shout. Eight characters on the passphrase, minimum.'}
              </p>

              <Field
                label="Operator ID"
                value={username}
                onChange={setUsername}
                autoComplete="username"
                error={fieldErrors.username}
              />
              <Field
                label="Passphrase"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                error={fieldErrors.password}
              />

              {DEV_PREFILL && mode === 'login' && (
                <p className="border border-dashed border-warning/40 bg-warning/5 px-3 py-2 font-body text-[12px] leading-relaxed text-warning/90">
                  MVP build. Dev login prefilled ({MVP_DEV_CREDENTIALS.username} /{' '}
                  {MVP_DEV_CREDENTIALS.password})
                </p>
              )}

              {serverError && (
                <p
                  role="alert"
                  className="border border-oxblood-500/40 bg-oxblood-300/15 px-3 py-2 font-body text-xs text-oxblood-300"
                >
                  {serverError}
                </p>
              )}

              <Button type="submit" disabled={mutation.isPending} className="w-full justify-center">
                {mutation.isPending ? 'Linking…' : mode === 'login' ? 'Jack In' : 'Enlist'}
              </Button>

              <span aria-hidden className="ink-rule" />

              <p className="text-center font-body text-[12px] leading-snug text-ink-300">
                {mode === 'login' ? (
                  <>
                    No handle yet?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="font-display uppercase tracking-[0.14em] text-brass-300 underline-offset-2 hover:underline"
                    >
                      Enlist
                    </button>
                  </>
                ) : (
                  <>
                    Already down here?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="font-display uppercase tracking-[0.14em] text-brass-300 underline-offset-2 hover:underline"
                    >
                      Jack in
                    </button>
                  </>
                )}
              </p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  error?: string | undefined;
}

function Field({ label, value, onChange, type = 'text', autoComplete, error }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-[11px] uppercase tracking-[0.25em] text-ink-300">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'rounded-sm border bg-surface-950 px-3 py-2.5 font-body text-sm text-ink-100 outline-none transition-colors',
          'placeholder:text-ink-300 focus:border-brass-300',
          error ? 'border-oxblood-500' : 'border-surface-600',
        )}
      />
      {error && <span className="font-body text-[12px] text-oxblood-300">{error}</span>}
    </label>
  );
}
