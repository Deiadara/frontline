import { DEFAULT_SOUND_VOLUME } from '@frontline/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  KIND_GAIN,
  MIN_GAP_MS,
  SOUND_KINDS,
  VOLUME_STORAGE_KEY,
  createSoundEngine,
  isSoundKind,
  installSoundLayer,
  kindForTarget,
  masterGain,
  readStoredVolume,
  type SoundEnvironment,
  type SoundKind,
} from './sound';

/**
 * The parts of the audio engine that can be measured without a speaker.
 *
 * The `AudioContext` here is a fake that records what was built rather than a partial mock of the
 * real one: what these tests are actually asserting is *how many sounds were started and at what
 * gain*, which is the whole observable behaviour of this module. Whether Chrome made a noise is
 * not a thing a unit test can know, and a test that stubbed `decodeAudioData` and then asserted it
 * was called would be asserting against its own stub.
 */

interface StartedSound {
  buffer: unknown;
  gain: number;
}

interface Fake {
  env: SoundEnvironment;
  started: StartedSound[];
  master: () => number;
  advance: (ms: number) => void;
  resumed: () => number;
  contexts: () => number;
}

function fakeEnvironment(options: { audio?: boolean; stored?: string | null } = {}): Fake {
  const started: StartedSound[] = [];
  let masterGainValue = 0;
  let clock = 1_000;
  let resumes = 0;
  let contexts = 0;
  let store = options.stored === undefined ? null : options.stored;

  const makeGain = (register: (node: { gain: { value: number } }) => void) => {
    const node = {
      gain: { value: 1 },
      connect: () => undefined,
    };
    register(node);
    return node;
  };

  const createContext = () => {
    contexts += 1;
    let masterNode: { gain: { value: number } } | null = null;
    const ctx = {
      destination: {},
      createGain: () =>
        makeGain((node) => {
          // The first gain the engine builds is the master; every later one shapes one sound.
          if (masterNode === null) {
            masterNode = node;
            Object.defineProperty(node.gain, 'value', {
              get: () => masterGainValue,
              set: (next: number) => {
                masterGainValue = next;
              },
            });
          }
        }),
      createBufferSource: () => {
        const source = {
          buffer: null as unknown,
          connect: (target: { gain: { value: number } }) => {
            source.shaper = target;
          },
          start: () => {
            started.push({ buffer: source.buffer, gain: source.shaper?.gain.value ?? 0 });
          },
          shaper: null as { gain: { value: number } } | null,
        };
        return source;
      },
      decodeAudioData: (bytes: ArrayBuffer) => Promise.resolve({ bytes } as unknown as AudioBuffer),
      resume: () => {
        resumes += 1;
        return Promise.resolve();
      },
    };
    return ctx as unknown as AudioContext;
  };

  return {
    started,
    master: () => masterGainValue,
    advance: (ms) => {
      clock += ms;
    },
    resumed: () => resumes,
    contexts: () => contexts,
    env: {
      createContext: options.audio === false ? undefined : createContext,
      fetchBytes: (url) => Promise.resolve(new TextEncoder().encode(url).buffer),
      now: () => clock,
      storage: {
        getItem: () => store,
        setItem: (_key: string, value: string) => {
          store = value;
        },
      },
    },
  };
}

/** Lets the six `fetchBytes().then(decode).then(set)` chains settle. */
const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));

async function readyEngine(options?: { audio?: boolean; stored?: string | null }) {
  const fake = fakeEnvironment(options);
  const engine = createSoundEngine(fake.env);
  engine.unlock();
  await loaded();
  return { fake, engine };
}

describe('masterGain', () => {
  it('is silent at 0 and unity at 100', () => {
    expect(masterGain(0)).toBe(0);
    expect(masterGain(100)).toBe(1);
  });

  it('puts the middle of the bar at about half the loudness, not a quarter of the amplitude', () => {
    // Loudness halves for roughly every 10dB, so half as loud is 10 ** (-10 / 20) amplitude. The
    // squared curve this replaced landed at 0.25, which is a slider that lies about its own middle.
    expect(masterGain(50)).toBeCloseTo(0.316, 2);
    expect(masterGain(50)).toBeGreaterThan(0.25);
  });

  it('rises without a step and clamps outside the bar', () => {
    for (let volume = 1; volume <= 100; volume += 1) {
      expect(masterGain(volume)).toBeGreaterThan(masterGain(volume - 1));
    }
    expect(masterGain(-30)).toBe(0);
    expect(masterGain(400)).toBe(1);
  });
});

describe('readStoredVolume', () => {
  it('falls back to the default when nothing is stored, or the storage throws', () => {
    expect(readStoredVolume(undefined)).toBe(DEFAULT_SOUND_VOLUME);
    expect(readStoredVolume({ getItem: () => null })).toBe(DEFAULT_SOUND_VOLUME);
    expect(readStoredVolume({ getItem: () => 'loud' })).toBe(DEFAULT_SOUND_VOLUME);
    expect(
      readStoredVolume({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(DEFAULT_SOUND_VOLUME);
  });

  it('reads and clamps a stored value', () => {
    expect(readStoredVolume({ getItem: () => '35' })).toBe(35);
    expect(readStoredVolume({ getItem: () => '-5' })).toBe(0);
    expect(readStoredVolume({ getItem: () => '5000' })).toBe(100);
  });
});

describe('the engine', () => {
  it('plays one sound per kind at that kind’s own gain', async () => {
    const { fake, engine } = await readyEngine();
    for (const kind of SOUND_KINDS) {
      engine.play(kind);
      // Past every gap, so this measures the gains and not the rate limiter.
      fake.advance(5_000);
    }
    expect(fake.started).toHaveLength(SOUND_KINDS.length);
    expect(fake.started.map((sound) => sound.gain)).toEqual(
      SOUND_KINDS.map((kind) => KIND_GAIN[kind]),
    );
  });

  it('keeps the interface quieter than the events', () => {
    // The point of six sounds rather than one. Measured on the source material's RMS, so this is
    // the ordering of what a player hears and not of the numbers in the table.
    // Re-measured on 2026-09-08 when the board picked switch9, scratch_005 and error_001.
    const rms: Record<SoundKind, number> = {
      click: 0.063,
      confirm: 0.265,
      page: 0.049,
      done: 0.258,
      call: 0.168,
      refuse: 0.089,
    };
    const level = (kind: SoundKind) => KIND_GAIN[kind] * rms[kind];
    for (const ui of ['click', 'page', 'confirm'] as const) {
      for (const event of ['done', 'call'] as const) {
        expect(level(ui), `${ui} is not quieter than ${event}`).toBeLessThan(level(event));
      }
    }
  });

  it('holds the interface sounds apart by tens of ms and the event sounds by seconds', () => {
    /*
     * Anchored against numbers written here rather than against the table itself.
     *
     * Every other assertion in this block derives its timings from `MIN_GAP_MS`, so setting the
     * whole table to zero would leave them all green while every click in the game rasped. What
     * the design actually requires is a band: short enough that two deliberate clicks are two
     * sounds, long enough that a double-click is one, and long enough on the event sounds that a
     * burst of settles is a single chime.
     */
    for (const kind of ['click', 'confirm', 'page'] as const) {
      expect(MIN_GAP_MS[kind], `${kind} is outside the interface band`).toBeGreaterThanOrEqual(40);
      expect(MIN_GAP_MS[kind], `${kind} is outside the interface band`).toBeLessThanOrEqual(120);
    }
    expect(MIN_GAP_MS.refuse).toBeGreaterThanOrEqual(150);
    expect(MIN_GAP_MS.refuse).toBeLessThanOrEqual(500);
    for (const kind of ['done', 'call'] as const) {
      expect(MIN_GAP_MS[kind], `${kind} would fire twice for one burst`).toBeGreaterThanOrEqual(
        1_000,
      );
    }
  });

  it('refuses to play the same kind twice inside its gap, and allows it after', async () => {
    const { fake, engine } = await readyEngine();

    engine.play('click');
    fake.advance(MIN_GAP_MS.click - 1);
    engine.play('click');
    expect(fake.started).toHaveLength(1);

    fake.advance(2);
    engine.play('click');
    expect(fake.started).toHaveLength(2);
  });

  it('rate-limits each kind on its own clock', async () => {
    const { fake, engine } = await readyEngine();
    engine.play('click');
    engine.play('confirm');
    // Two different kinds in the same millisecond are two different sounds.
    expect(fake.started).toHaveLength(2);

    // A burst of settles is one chime: `done` holds for more than a second.
    fake.advance(MIN_GAP_MS.click + 1);
    engine.play('done');
    engine.play('done');
    fake.advance(MIN_GAP_MS.done - 1);
    engine.play('done');
    expect(fake.started.filter((sound) => sound.gain === KIND_GAIN.done)).toHaveLength(1);
  });

  it('is silent at 0 and audible again when the bar comes back up', async () => {
    const { fake, engine } = await readyEngine();

    engine.setVolume(0);
    engine.play('click');
    fake.advance(5_000);
    engine.play('call');
    expect(fake.started).toHaveLength(0);
    expect(fake.master()).toBe(0);

    engine.setVolume(70);
    engine.play('click');
    expect(fake.started).toHaveLength(1);
    expect(fake.master()).toBeCloseTo(masterGain(70), 6);
  });

  it('clamps and rounds what the bar hands it, and mirrors it into storage', async () => {
    const { engine } = await readyEngine();
    engine.setVolume(42.7);
    expect(engine.volume()).toBe(43);
    engine.setVolume(-10);
    expect(engine.volume()).toBe(0);
    engine.setVolume(180);
    expect(engine.volume()).toBe(100);

    const stored = vi.fn();
    const fake = fakeEnvironment();
    const withSpy = createSoundEngine({
      ...fake.env,
      storage: { getItem: () => null, setItem: stored },
    });
    withSpy.setVolume(25);
    expect(stored).toHaveBeenCalledWith(VOLUME_STORAGE_KEY, '25');
  });

  it('starts at the volume this browser last saw', () => {
    const fake = fakeEnvironment({ stored: '15' });
    expect(createSoundEngine(fake.env).volume()).toBe(15);
    expect(createSoundEngine(fakeEnvironment().env).volume()).toBe(DEFAULT_SOUND_VOLUME);
  });

  it('plays nothing before the gesture unlock, whatever the volume says', async () => {
    const fake = fakeEnvironment();
    const engine = createSoundEngine(fake.env);
    engine.setVolume(100);
    engine.play('click');
    await loaded();
    expect(fake.started).toHaveLength(0);
    expect(engine.unlocked()).toBe(false);
    // Nothing was even built: the autoplay policy means a context made here starts suspended.
    expect(fake.contexts()).toBe(0);
  });

  it('builds and resumes exactly one context however many gestures arrive', async () => {
    const { fake, engine } = await readyEngine();
    engine.unlock();
    engine.unlock();
    expect(fake.contexts()).toBe(1);
    expect(fake.resumed()).toBe(1);
    expect(engine.unlocked()).toBe(true);
  });

  it('is a no-op game with no sound where the browser has no Web Audio', async () => {
    const { fake, engine } = await readyEngine({ audio: false });
    engine.play('click');
    expect(engine.unlocked()).toBe(false);
    expect(fake.started).toHaveLength(0);
    // And the volume still moves, so a settings screen rendered there is not broken.
    engine.setVolume(80);
    expect(engine.volume()).toBe(80);
  });
});

describe('isSoundKind', () => {
  it('accepts every kind and nothing else', () => {
    for (const kind of SOUND_KINDS) expect(isSoundKind(kind)).toBe(true);
    for (const other of ['none', '', 'CLICK', null, undefined]) {
      expect(isSoundKind(other)).toBe(false);
    }
  });
});

describe('kindForTarget', () => {
  const mount = (html: string): HTMLElement => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };
  const at = (selector: string) => document.querySelector(selector)!;

  it('gives a bare button the click and a link the page swish', () => {
    mount('<div><button id="b">go</button><a id="a" href="/game">go</a></div>');
    expect(kindForTarget(at('#b'))).toBe('click');
    expect(kindForTarget(at('#a'))).toBe('page');
  });

  it('reads a declared kind off the control', () => {
    mount('<button id="b" data-sound="call">call it</button>');
    expect(kindForTarget(at('#b'))).toBe('call');
  });

  it('reads a declared kind off an ancestor, and the nearest one wins', () => {
    mount(
      '<div data-sound="confirm"><div data-sound="refuse"><button id="b"><span id="s">x</span></button></div></div>',
    );
    expect(kindForTarget(at('#s'))).toBe('refuse');
  });

  it('silences a subtree marked none', () => {
    mount('<div data-sound="none"><button id="b">quiet</button></div>');
    expect(kindForTarget(at('#b'))).toBeNull();
  });

  it('ignores a value that is not a kind and falls back to the tag', () => {
    mount('<button id="b" data-sound="clack">x</button>');
    expect(kindForTarget(at('#b'))).toBe('click');
  });

  it('says nothing about a click that landed on neither a button nor a link', () => {
    mount('<div id="d" data-sound="confirm"><p id="p">prose</p></div>');
    expect(kindForTarget(at('#p'))).toBeNull();
  });

  it('sounds an anchor only when it goes somewhere', () => {
    mount('<a id="a">no href</a>');
    expect(kindForTarget(at('#a'))).toBeNull();
  });
});

describe('the layer', () => {
  /**
   * `Modal`'s panel stops click propagation so a press inside it does not fall through to the
   * backdrop, and a bubbling listener never heard a press inside any window. The layer captures.
   */
  it('hears a press inside a panel that stops propagation', () => {
    const heard: string[] = [];
    const panel = document.createElement('div');
    panel.addEventListener('click', (event) => event.stopPropagation());
    const button = document.createElement('button');
    button.textContent = 'Save name and badge';
    panel.append(button);
    document.body.append(panel);
    const teardown = installSoundLayer(document, (kind) => heard.push(kind));

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(heard).toEqual(['click']);

    teardown();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(heard).toEqual(['click']);
    panel.remove();
  });

  it('counts a switch, a radio, a picker option and a role=button as presses, and a field as none', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<label><input type="checkbox" id="tick"></label>' +
      '<input type="radio" id="pick">' +
      '<ul role="listbox"><li role="option" id="opt">Razors</li></ul>' +
      '<span role="button" id="fake">Go</span>' +
      '<input type="text" id="name">' +
      '<div id="plain">nothing</div>';
    document.body.append(host);
    const at = (id: string) => host.querySelector('#' + id) as Element;
    expect(kindForTarget(at('tick'))).toBe('click');
    expect(kindForTarget(at('pick'))).toBe('click');
    expect(kindForTarget(at('opt'))).toBe('click');
    expect(kindForTarget(at('fake'))).toBe('click');
    expect(kindForTarget(at('name'))).toBeNull();
    expect(kindForTarget(at('plain'))).toBeNull();
    host.remove();
  });
});
