/**
 * Cyberpunk design tokens — the single source for tailwind.config.ts and any
 * JS-side rendering (e.g. Pixi map colors). Keep tailwind.config.ts free of
 * literal colors; add tokens here instead.
 */

export const palette = {
  /** Dark base surfaces, darkest first. */
  night: {
    DEFAULT: '#0a0e17',
    raised: '#0f1524',
    overlay: '#141b2e',
  },
  /** Accent neons. Cyan = primary/interactive, magenta = hostile/danger. */
  neon: {
    cyan: '#22d3ee',
    magenta: '#e11d8f',
  },
  /** Muted steel grays for text and chrome. */
  steel: {
    100: '#e2e8f0',
    200: '#cbd5e1',
    300: '#94a3b8',
    400: '#64748b',
    500: '#475569',
    600: '#334155',
    700: '#1e293b',
    800: '#16202f',
    900: '#0b111c',
  },
  /** Warnings, caution states, loot highlights. */
  warning: '#f59e0b',
};

/**
 * ART-BIBLE §2.1 — the eight five-stop ramps, `950` deepest shadow → `100` highlight.
 * Paint **within** a ramp; never invent an intermediate hue. The legacy tokens above are
 * aliases into these stops (`night → abyss`, `steel → ferrite`, `neon.cyan → hextech.300`,
 * `neon.magenta → sear.300`, `warning → ember.300`) and `tokens.test.ts` pins that.
 */
export const ramps = {
  /** Night sky, base surfaces, deepest occlusion. */
  abyss: { 950: '#05070d', 700: '#0a0e17', 500: '#0f1524', 300: '#141b2e', 100: '#1c2740' },
  /** Atmospheric haze, far planes, depth falloff. */
  smog: { 950: '#1b2233', 700: '#2a3348', 500: '#3d4761', 300: '#55617e', 100: '#74809c' },
  /** Concrete, steel, architecture, chrome. */
  ferrite: { 950: '#0b111c', 700: '#1e293b', 500: '#475569', 300: '#94a3b8', 100: '#e2e8f0' },
  /** Primary interactive, cold key light, the player. */
  hextech: { 950: '#063845', 700: '#0b5f72', 500: '#12a2bd', 300: '#22d3ee', 100: '#7ff0ff' },
  /** Hostile, enemy, danger, shimmer-corruption. */
  sear: { 950: '#2c0620', 700: '#4a0a30', 500: '#8a0f56', 300: '#e11d8f', 100: '#ff6cc0' },
  /** Sodium streetlight, warm bounce, loot, warning. */
  ember: { 950: '#2a1703', 700: '#4a2a05', 500: '#8a5209', 300: '#f59e0b', 100: '#ffd166' },
  /** Undercity toxicity, pollution, mutated growth. */
  bile: { 950: '#0a1c12', 700: '#12301f', 500: '#2f8551', 300: '#43b56e', 100: '#86e6a8' },
  /** Skin midtones — the warm anchor in portraits. */
  flesh: { 950: '#1a0f0d', 700: '#2b1a17', 500: '#5a352c', 300: '#8f5744', 100: '#e8b494' },
} as const;

export type RampName = keyof typeof ramps;
export type RampStop = keyof (typeof ramps)['abyss'];

/** `'#22d3ee'` → `0x22d3ee` — the form PixiJS wants colours in. */
export const hex = (value: string): number => Number.parseInt(value.replace('#', ''), 16);

export const fontStacks = {
  display: ['Orbitron', 'Rajdhani', 'ui-sans-serif', 'sans-serif'],
  body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
};
