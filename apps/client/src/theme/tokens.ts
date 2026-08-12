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

export const fontStacks = {
  display: ['Orbitron', 'Rajdhani', 'ui-sans-serif', 'sans-serif'],
  body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
};
