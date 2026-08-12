import type { Config } from 'tailwindcss';
import { fontStacks, palette } from './src/theme/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: palette,
      fontFamily: fontStacks,
      boxShadow: {
        'neon-cyan': '0 0 12px rgba(34, 211, 238, 0.35), 0 0 32px rgba(34, 211, 238, 0.15)',
        'neon-magenta': '0 0 12px rgba(225, 29, 143, 0.35), 0 0 32px rgba(225, 29, 143, 0.15)',
      },
    },
  },
  plugins: [],
} satisfies Config;
