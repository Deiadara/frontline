import { DEFAULT_SOUND_VOLUME, SOUND_VOLUME_MAX, SOUND_VOLUME_MIN } from '@frontline/shared';
import { useEffect } from 'react';
import { useMe } from './queries';

/**
 * The game's interface audio.
 *
 * Six sounds, one slider, and one listener at the root of the app. The whole design is in
 * `docs/SOUND.md`; what follows is why the code is shaped the way it is.
 *
 * ## Delegated, not wired per button
 *
 * There are several hundred buttons in this client and none of them calls `playSound`. A single
 * listener on `document` reads the kind off the element that was clicked, the same way
 * `TooltipLayer` reads `data-tip`. Wiring audio per site is how a game ends up with three quarters
 * of its buttons silent and nobody able to say which quarter: a new screen written next month is
 * audible here without its author knowing this file exists.
 *
 * The default falls out of the markup. Every anchor in this app is a router `Link` or `NavLink`
 * (there is not one raw `<a>` in `src/`), so `a[href]` means "go somewhere" and gets the page
 * swish, and `button` means "do something" and gets the click. `data-sound` on the element or any
 * ancestor overrides that, and `data-sound="none"` silences a subtree.
 *
 * ## The autoplay policy
 *
 * A browser will not let a page make noise until the player has interacted with it, and an
 * `AudioContext` created before that starts suspended. So the context is created and resumed on
 * the first `pointerdown` or `keydown`, which is the gesture that *precedes* the click that wants
 * the sound: by the time the `click` event fires, 60 to 150ms of human mouse-hold later, the
 * context is running and six small files are decoded. Nothing plays before the buffer for that
 * kind exists, so at worst the first sound of a session is missed rather than queued and fired
 * late into silence.
 *
 * ## Failure is silence
 *
 * Every path here degrades to no sound: no `AudioContext` constructor, a refused `resume()`, a
 * file that 404s, a codec the browser will not decode. None of it is worth an error to the player,
 * and none of it may throw into a click handler that was on its way to doing something real.
 */

export const SOUND_KINDS = ['click', 'confirm', 'page', 'done', 'call', 'refuse'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(SOUND_KINDS);

export function isSoundKind(value: string | null | undefined): value is SoundKind {
  return value !== null && value !== undefined && KIND_SET.has(value);
}

/** Where the files live. Named by kind, so the mapping needs no table. */
const SOUND_URL = (kind: SoundKind): string => `/sounds/${kind}.ogg`;

/**
 * Per-kind gain, applied before the master.
 *
 * These are **level matching, not importance**. The two Kenney packs the files come from are
 * mastered at very different levels: measured RMS across the six ranges from 0.049 (the page
 * switch) to 0.265 (the confirm), a factor of five and a half. Left alone, the quiet click would
 * be inaudible at the same slider position that made the confirm painful.
 *
 * The numbers below are `target / measured RMS`, with the targets set so the interface sits under
 * the events: a click at 0.020 RMS, a page swish at 0.024, a confirm at 0.030, a refusal at 0.042,
 * a mission coming home at 0.050 and a fight being called at 0.055. That ordering is the whole
 * point of having six sounds rather than one: clicking around the game must not be as loud as the
 * game telling you something happened.
 */
export const KIND_GAIN: Readonly<Record<SoundKind, number>> = {
  click: 0.34,
  confirm: 0.11,
  page: 0.49,
  done: 0.19,
  call: 0.33,
  refuse: 0.47,
};

/**
 * The soonest the same kind may sound again.
 *
 * 60ms for the interface sounds is roughly the shortest gap two clicks can be apart and still be
 * two clicks to a listener; below it a double-click or a key held down turns into a rasp. The
 * refusal gets 250ms because a form with two invalid fields mounts two `role="alert"` nodes in one
 * frame and that is one refusal, not two.
 *
 * The two event sounds get a second and a bit. Five things settling at once (a mission home, a
 * build done, and the receipts for both) arrive as a burst of live events inside a few hundred
 * milliseconds, and the player wants to be told the game moved, once.
 */
export const MIN_GAP_MS: Readonly<Record<SoundKind, number>> = {
  click: 60,
  confirm: 60,
  page: 60,
  refuse: 250,
  done: 1_200,
  call: 1_200,
};

/**
 * Slider percent to amplitude.
 *
 * Not linear, and not the squared curve that gets reached for either. Loudness roughly halves for
 * every 10dB of level dropped, so a slider at the middle should land near 10 ** (-10 / 20), about
 * 0.316 amplitude, and `(v / 100) ** 2` puts it at 0.25, noticeably under half as loud as the
 * player just asked for. The exponent that solves `0.5 ** p = 0.316` is 5/3.
 *
 * 0 is exactly 0 and 100 is exactly 1, so a muted game is silent rather than very quiet.
 */
export function masterGain(volume: number): number {
  const clamped = Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, volume));
  if (clamped <= SOUND_VOLUME_MIN) return 0;
  return (clamped / SOUND_VOLUME_MAX) ** (5 / 3);
}

/** localStorage key holding the last volume this browser saw, so sound is right before `/me`. */
export const VOLUME_STORAGE_KEY = 'frontline.soundVolume';

/**
 * The volume to start at, before the account's own value arrives.
 *
 * A cache of the server's field and never the record: a player who set 20 on this machine and 80
 * on their phone gets 80 on both the moment `/me` lands. Reading it is best-effort, because
 * `localStorage` throws outright in a browser set to block site data.
 */
export function readStoredVolume(storage: Pick<Storage, 'getItem'> | undefined): number {
  try {
    const raw = storage?.getItem(VOLUME_STORAGE_KEY);
    if (raw === null || raw === undefined) return DEFAULT_SOUND_VOLUME;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SOUND_VOLUME;
    return Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, parsed));
  } catch {
    return DEFAULT_SOUND_VOLUME;
  }
}

function writeStoredVolume(storage: Pick<Storage, 'setItem'> | undefined, volume: number): void {
  try {
    storage?.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch {
    // A browser blocking site data. The volume still applies for this session.
  }
}

/** What the engine needs off the platform, so a test can hand it something that counts calls. */
export interface SoundEnvironment {
  /** `undefined` where the browser has no Web Audio, which is a game with no sound and no error. */
  createContext: (() => AudioContext) | undefined;
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
}

export interface SoundEngine {
  /** Plays one sound, if the volume allows it, the buffer is ready and the gap has passed. */
  play(kind: SoundKind): void;
  /** Creates and resumes the context. Safe to call on every gesture; only the first does work. */
  unlock(): void;
  /** Whether the context exists and the buffers have been asked for. */
  unlocked(): boolean;
  setVolume(volume: number, options?: { persist?: boolean }): void;
  volume(): number;
}

function browserEnvironment(): SoundEnvironment {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  return {
    createContext: Ctor ? () => new Ctor() : undefined,
    fetchBytes: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`sound ${url}: ${response.status}`);
      return response.arrayBuffer();
    },
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
  };
}

export function createSoundEngine(env: SoundEnvironment = browserEnvironment()): SoundEngine {
  let volume = readStoredVolume(env.storage);
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  /** One entry per kind once the file has been asked for. Missing means "not loaded". */
  const buffers = new Map<SoundKind, AudioBuffer>();
  let loading = false;
  const lastPlayedAt = new Map<SoundKind, number>();

  function load(ctx: AudioContext): void {
    if (loading) return;
    loading = true;
    for (const kind of SOUND_KINDS) {
      void env
        .fetchBytes(SOUND_URL(kind))
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          buffers.set(kind, buffer);
        })
        .catch(() => {
          // A missing or undecodable file is one silent sound, not a broken game.
        });
    }
  }

  return {
    unlock() {
      if (context !== null || env.createContext === undefined) return;
      try {
        context = env.createContext();
        master = context.createGain();
        master.gain.value = masterGain(volume);
        master.connect(context.destination);
        // Created suspended when the page has not been interacted with yet. `resume` is why this
        // is called from a gesture handler rather than from an effect on mount.
        void context.resume().catch(() => undefined);
        load(context);
      } catch {
        context = null;
        master = null;
      }
    },
    unlocked() {
      return context !== null;
    },
    play(kind) {
      if (volume <= SOUND_VOLUME_MIN) return;
      const ctx = context;
      const out = master;
      if (ctx === null || out === null) return;
      const buffer = buffers.get(kind);
      if (buffer === undefined) return;

      const at = env.now();
      const last = lastPlayedAt.get(kind);
      if (last !== undefined && at - last < MIN_GAP_MS[kind]) return;
      lastPlayedAt.set(kind, at);

      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const shape = ctx.createGain();
        shape.gain.value = KIND_GAIN[kind];
        source.connect(shape);
        shape.connect(out);
        source.start();
      } catch {
        // A context the browser closed under us on a backgrounded tab.
      }
    },
    setVolume(next, options) {
      volume = Math.round(Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, next)));
      if (master !== null) master.gain.value = masterGain(volume);
      if (options?.persist !== false) writeStoredVolume(env.storage, volume);
    },
    volume() {
      return volume;
    },
  };
}

/** The one engine the app plays through. */
const engine = createSoundEngine();

export function playSound(kind: SoundKind): void {
  engine.play(kind);
}

export function setSoundVolume(volume: number, options?: { persist?: boolean }): void {
  engine.setVolume(volume, options);
}

export function soundVolume(): number {
  return engine.volume();
}

/** What a click on this element should sound like: the nearest `data-sound`, else the tag. */
/**
 * Everything a press can land on that does something.
 *
 * `button` and `a[href]` were the whole list, and a switch in the settings, a filter on the board,
 * the hold-the-ground tick on a declaration and an option in the painted picker are pressed the
 * same way and did the same kind of thing in silence. Text fields are not here: typing is not a
 * press, and the platform's own caret click is not a decision.
 */
const PRESSABLE =
  'button, a[href], input[type="checkbox"], input[type="radio"], summary, ' +
  '[role="button"], [role="option"], [role="switch"], [role="tab"], [role="menuitem"]';

export function kindForTarget(target: Element): SoundKind | null {
  const control = target.closest(PRESSABLE);
  if (control === null) return null;
  const declared = target.closest('[data-sound]')?.getAttribute('data-sound');
  if (declared === 'none') return null;
  if (isSoundKind(declared)) return declared;
  return control.matches('a[href]') ? 'page' : 'click';
}

/**
 * Marks the document once the gesture unlock has run.
 *
 * There is no way to assert from a browser test that a sound was heard, and a test that stubbed
 * `AudioContext` would be asserting against its own stub. This attribute is the one honest thing
 * an e2e run can check: the gesture happened, the context was built, and the buffers were asked
 * for. Whether the speaker made a noise is the board's ears, not Playwright's.
 */
const READY_ATTRIBUTE = 'data-sound-ready';

/**
 * Installs the whole layer on `document`. Returns the teardown.
 *
 * Three listeners and an observer:
 *
 * - `pointerdown` / `keydown`, capturing, to unlock on the first gesture of the session;
 * - `click`, bubbling, which is the delegated player for every button and link;
 * - a `MutationObserver` for `role="alert"`, which is how a refusal is heard.
 *
 * The refusal is watched rather than called, because the mutation hooks that would raise it live in
 * `lib/queries.ts` and this client's `QueryClient` has no `MutationCache.onError` to hang one on.
 * Every refusal in the game ends up as a `role="alert"` node appearing on screen (42 sites at the
 * time of writing, all of them errors: success uses `role="status"`), so the arrival of one *is*
 * the event. It also catches client-side refusals that never reach the server, which a mutation
 * hook would miss.
 */
export function installSoundLayer(
  doc: Document = document,
  /** The engine's `play`, replaceable so a test can hear the layer without an AudioContext. */
  play: (kind: SoundKind) => void = (kind) => engine.play(kind),
): () => void {
  const unlock = () => {
    engine.unlock();
    if (engine.unlocked()) doc.documentElement.setAttribute(READY_ATTRIBUTE, '');
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const kind = kindForTarget(target);
    if (kind !== null) play(kind);
  };

  /*
   * All three capture, and the click is the one that matters.
   *
   * `Modal`'s panel stops click propagation so a press inside it does not close it through the
   * backdrop, which is right, and it meant a bubbling listener here never saw a press inside any
   * window: the faction book, the badge swatches, the member file, the bidding window, the deploy
   * and build dialogs were all silent. Capture runs before any handler in the tree can stop the
   * event, so the sound is a fact about the press rather than about who else was listening.
   */
  doc.addEventListener('pointerdown', unlock, { capture: true });
  doc.addEventListener('keydown', unlock, { capture: true });
  doc.addEventListener('click', onClick, { capture: true });

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        // The alert may be the added node or may be inside a panel that was added around it.
        if (node.matches('[role="alert"]') || node.querySelector('[role="alert"]') !== null) {
          engine.play('refuse');
          return;
        }
      }
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  return () => {
    doc.removeEventListener('pointerdown', unlock, { capture: true });
    doc.removeEventListener('keydown', unlock, { capture: true });
    doc.removeEventListener('click', onClick, { capture: true });
    observer.disconnect();
    doc.documentElement.removeAttribute(READY_ATTRIBUTE);
  };
}

/**
 * Mounts the layer for as long as the app is, and keeps it at the account's volume.
 *
 * Called once, from `App`. The server's number is applied on the render it changes on rather than
 * on every render: `/me` is polled, and re-applying the stored value on each poll would yank the
 * slider back mid-drag while a player was still choosing.
 */
export function useSoundLayer(): void {
  const stored = useMe().data?.user.soundVolume;

  useEffect(() => installSoundLayer(), []);

  useEffect(() => {
    if (stored !== undefined) setSoundVolume(stored);
  }, [stored]);
}
