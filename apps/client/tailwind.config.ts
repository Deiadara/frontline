import type { Config } from 'tailwindcss';
import { chrome, fontStacks, palette, ramps } from './src/theme/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ...palette, ...ramps, ...chrome },
      fontFamily: fontStacks,
      boxShadow: {
        'neon-cyan': '0 0 12px rgba(34, 211, 238, 0.35), 0 0 32px rgba(34, 211, 238, 0.15)',
        'neon-magenta': '0 0 12px rgba(225, 29, 143, 0.35), 0 0 32px rgba(225, 29, 143, 0.15)',
        // Chrome floats over artwork, so it casts rather than glows: a hard near-edge that lifts
        // the panel off the painting, and a long soft one that keeps it from looking cut out.
        panel: '0 1px 0 rgba(244,236,224,0.06) inset, 0 18px 40px -12px rgba(0,0,0,0.85)',
        lifted: '0 2px 0 rgba(0,0,0,0.5), 0 10px 24px -8px rgba(0,0,0,0.75)',
        brass: '0 0 0 1px rgba(224,162,74,0.45), 0 6px 18px -6px rgba(224,162,74,0.35)',
      },
    },
  },
  plugins: [],
} satisfies Config;
