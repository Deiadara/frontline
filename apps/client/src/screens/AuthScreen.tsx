import {
  GAME_TIMEZONE,
  LoginRequestSchema,
  MVP_DEV_CREDENTIALS,
  PASSWORD_MAX_BYTES,
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
import { DrawnButton } from '../components/ui/DrawnButton';
import { type IconName } from '../components/ui/Icon';
import { DrawnGlyph } from '../components/ui/DrawnMarks';
import { InkSkyline } from './InkSkyline';
import { useSession } from '../store/session';
import { ErrorNote } from '../components/ui/ErrorNote';
import { PressError } from '../components/ui/PressError';

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
 * pushes the password field below the fold is worse than no marketing panel.
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
 * visitor to a deployed build got the seeded account's password typed into the form and spelled
 * out below it: a credential that is seeded on every boot of the server is not a secret the
 * interface may also publish.
 *
 * `pnpm dev` and the Playwright stack both run the dev server, so the convenience survives where
 * it is for. Register mode starts blank either way: the dev password is 5 characters and would
 * fail `RegisterRequestSchema`'s 8-character minimum.
 */
const DEV_PREFILL = import.meta.env.DEV;

const prefillFor = (mode: Mode) =>
  DEV_PREFILL && mode === 'login'
    ? { username: MVP_DEV_CREDENTIALS.username, password: MVP_DEV_CREDENTIALS.password }
    : { username: '', password: '' };

/**
 * Said before the player types a long passphrase rather than after it is refused (bug pass,
 * 2026-09-29): the hash reads 72 bytes, so the form stops there and says what a byte is.
 */
const PASSWORD_HINT = `Up to ${String(PASSWORD_MAX_BYTES)} bytes. A plain letter is one; accents and symbols take two to four.`;

/** The pitch, broken where its two halves come out the same length. See the paragraph below. */
const PITCH_LINES = [
  'The Combine runs the lights, the water and the checkpoints. You run',
  'six streets and a generator that is one bad week from cutting out.',
] as const;

/** What the game is, in four marks. Titles only: the pitch above says the rest. */
const PROMISES: readonly { icon: IconName; title: string }[] = [
  { icon: 'district', title: 'Hold a district' },
  { icon: 'sword', title: 'Take the city' },
  { icon: 'infamy', title: 'Earn a name' },
  { icon: 'combine', title: 'Defeat the Combine' },
];

export function AuthScreen() {
  const setSession = useSession((s) => s.login);
  const [mode, setMode] = useState<Mode>('login');
  /*
   * The door has two handles before it has a form (maintainer, 2026-09-23): Sign up and Log in,
   * and nothing else on the card until one is pressed. The tabs that used to sit over the form
   * are gone; what is under the form still switches, for whoever picked the wrong one.
   */
  const [chosen, setChosen] = useState(false);
  const [username, setUsername] = useState(prefillFor('login').username);
  const [password, setPassword] = useState(prefillFor('login').password);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation<AuthResponse, Error, void>({
    mutationFn: () =>
      mode === 'login' ? login({ username, password }) : register({ username, password }),
    // The session arrived as an httpOnly cookie; `data.token` is for scripted callers and is
    // deliberately left on the floor (`AuthResponseSchema`).
    onSuccess: (data) => setSession(data.user),
  });

  const switchMode = (next: Mode) => {
    const prefill = prefillFor(next);
    setMode(next);
    setChosen(true);
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
    <main className="vignette relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface-950 px-4 py-6">
      <SceneBackdrop />
      <div className="grain pointer-events-none absolute inset-0 z-10" />
      {/* The skyline, inked across the foot of the screen, with the Combine's spire and its lights
          over the rooftops (`InkSkyline`). Under the glass, over the painting. */}
      <InkSkyline className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[27vh] w-full overflow-visible opacity-75" />
      {/* The same pane of dirty glass that runs over the game's chrome, so the door and the rooms
          behind it are lit by one light. */}
      <div className="patina pointer-events-none absolute inset-0 z-30" />

      <div className="relative z-20 grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* The pitch. Hidden below `lg`, where the board needs the whole column. */}
        <section className="hidden min-w-0 flex-col gap-7 lg:flex">
          <h1 className="-rotate-[1.5deg] self-start drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)]">
            <Wordmark className="w-[26rem] max-w-full" />
          </h1>

          {/*
           * Two white lines of one length and a brass line under a blank one (maintainer,
           * 2026-09-30). The break is placed by hand at the middle of the words, and each line is
           * justified out to the width of the longer one (`w-max` on the paragraph), so both edges
           * line up. The size is the largest that fits the longer line in the pitch column: 572px
           * from 1024 to 1279 takes 16px, and the 604px column from 1280 up takes the 17px the pitch
           * was set in before. `auth-pitch.spec.ts` measures it at four widths.
           */}
          <p
            className="w-max max-w-full font-stamp text-[16px] leading-[1.6] text-ink-100 xl:text-[17px]"
            data-testid="auth-pitch"
          >
            {PITCH_LINES.map((line) => (
              <span
                key={line}
                className="block whitespace-nowrap [text-align-last:justify] [text-align:justify]"
                data-testid="auth-pitch-line"
              >
                {line}
              </span>
            ))}
            <span
              className="relative mt-[1.6em] inline-block whitespace-nowrap text-brass-100"
              data-testid="auth-pitch-call"
            >
              It&apos;s up to you to change that.
              <InkUnderline />
            </span>
          </p>

          <ul className="flex flex-col gap-4">
            {PROMISES.map((promise) => (
              <li key={promise.title} className="flex items-center gap-4">
                <span className="ink-disc flex h-14 w-14 shrink-0 items-center justify-center text-brass-300">
                  <DrawnGlyph name={promise.icon} className="h-7 w-7" />
                </span>
                <span className="min-w-0 font-stamp text-[15px] uppercase tracking-[0.12em] text-ink-100">
                  {promise.title}
                </span>
              </li>
            ))}
          </ul>

          {/* The house clock, stated before anybody signs up. Every schedule in the game runs on
              it, and finding that out from a countdown that is two hours off is the wrong way. */}
          <p className="flex items-center gap-2 font-stamp text-[13px] uppercase tracking-[0.16em] text-ink-200">
            <DrawnGlyph name="clock" className="h-5 w-5 text-brass-300" />
            City time is {formatClock(now, GAME_TIMEZONE)}
          </p>
        </section>

        {/* The board. */}
        <section className="min-w-0 justify-self-center lg:justify-self-end">
          {/* The wordmark again, for the narrow layout where the pitch is not on screen to carry
              it. `aria-hidden` and not a heading: the real `h1` is in the pitch above, which stays
              in the document at every width: two of them would be one document outline with the
              game's name in it twice. */}
          <div aria-hidden className="mb-6 text-center lg:hidden">
            <Wordmark className="mx-auto w-64 max-w-full -rotate-[1.5deg]" />
          </div>

          {/* A pass, inked on the glass: the double drawn frame the paper screens wear, and the
              entry stamp pressed on its corner. */}
          <div className="ink-frame ink-frame-brass relative w-full max-w-sm bg-surface-950/80 shadow-panel backdrop-blur-sm">
            <EntryStamp />
            {!chosen ? (
              <div className="flex flex-col gap-4 px-7 pb-7 pt-9" data-testid="auth-choice">
                <p className="text-center font-stamp text-[15px] leading-snug text-ink-100">
                  New to the district, or back for more?
                </p>
                <span aria-hidden className="ink-rule" />
                <DrawnButton
                  onClick={() => switchMode('register')}
                  className="w-full justify-center"
                  data-testid="auth-choose-register"
                  data-sound="click"
                >
                  Sign up
                </DrawnButton>
                <DrawnButton
                  onClick={() => switchMode('login')}
                  className="w-full justify-center"
                  data-testid="auth-choose-login"
                  data-sound="click"
                >
                  Log in
                </DrawnButton>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-4 px-7 pb-7 pt-9" noValidate>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-stamp text-[15px] uppercase tracking-[0.2em] text-brass-300">
                    {mode === 'login' ? 'Log in' : 'Sign up'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setChosen(false)}
                    data-testid="auth-back"
                    className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-400 hover:text-brass-300"
                  >
                    Back
                  </button>
                </div>
                <p className="font-body text-[13px] leading-snug text-ink-300">
                  {mode === 'login'
                    ? 'Back to the district. Nothing waited for you.'
                    : 'Pick a handle the street can shout. Eight characters on the password, minimum.'}
                </p>

                <Field
                  label="Overseer ID"
                  value={username}
                  onChange={setUsername}
                  autoComplete="username"
                  error={fieldErrors.username}
                />
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  error={fieldErrors.password}
                  hint={mode === 'register' ? PASSWORD_HINT : undefined}
                />

                {DEV_PREFILL && mode === 'login' && (
                  <p className="border border-dashed border-warning/40 bg-warning/5 px-3 py-2 font-body text-[12px] leading-relaxed text-warning/90">
                    MVP build. Dev login prefilled ({MVP_DEV_CREDENTIALS.username} /{' '}
                    {MVP_DEV_CREDENTIALS.password})
                  </p>
                )}

                {serverError && <PressError>{serverError}</PressError>}

                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  className="w-full justify-center"
                >
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
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

/** A marker stroke under the line that matters, drawn rather than ruled. */
function InkUnderline() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 10"
      preserveAspectRatio="none"
      className="pointer-events-none absolute -bottom-2 left-0 h-2.5 w-full overflow-visible"
    >
      <path
        d="M2 6 C 40 3.5, 90 7.5, 140 4.8 S 190 5.5, 198 3.6"
        fill="none"
        stroke="#f0ad4c"
        strokeOpacity="0.85"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M14 8.4 C 60 6.8, 120 8.8, 176 7"
        fill="none"
        stroke="#f0ad4c"
        strokeOpacity="0.4"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The entry stamp on the pass: a ring pressed off the square, lifted early on one side, the way
 * the officer marks are (`MarkStamp`). Red, because it is ink somebody put on the paper.
 */
function EntryStamp() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 120"
      className="pointer-events-none absolute -right-3 -top-14 h-20 w-20 rotate-[14deg] text-oxblood-300 opacity-80"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M60 8 A52 52 0 1 1 22 24" strokeWidth="3" />
        <circle cx="60" cy="60" r="42" strokeWidth="1.4" strokeDasharray="3 4" />
      </g>
      <text
        x="60"
        y="56"
        textAnchor="middle"
        fill="currentColor"
        style={{ font: '700 15px "Special Elite", monospace', letterSpacing: '0.12em' }}
      >
        ENTRY
      </text>
      <text
        x="60"
        y="76"
        textAnchor="middle"
        fill="currentColor"
        style={{ font: '600 9px "Special Elite", monospace', letterSpacing: '0.2em' }}
      >
        GRANTED
      </text>
    </svg>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  error?: string | undefined;
  /** A standing line under the box, for a rule worth knowing before it is broken. */
  hint?: string | undefined;
}

function Field({ label, value, onChange, type = 'text', autoComplete, error, hint }: FieldProps) {
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
      {hint && <span className="font-body text-[12px] leading-snug text-ink-300">{hint}</span>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </label>
  );
}
