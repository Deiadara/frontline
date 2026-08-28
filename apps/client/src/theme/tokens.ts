/**
 * Cyberpunk design tokens: the single source for tailwind.config.ts and any
 * JS-side rendering (the procedural art in `render/`). Keep tailwind.config.ts
 * free of literal colors; add tokens here instead.
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
 * ART-BIBLE §2.1: the eight five-stop ramps, `950` deepest shadow → `100` highlight.
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
  /** Skin midtones: the warm anchor in portraits. */
  flesh: { 950: '#1a0f0d', 700: '#2b1a17', 500: '#5a352c', 300: '#8f5744', 100: '#e8b494' },
} as const;

/**
 * The **chrome** palette: everything the app draws that is not artwork.
 *
 * Separate from `ramps` on purpose. The ramps are the ART-BIBLE's description of the *paintings*,
 * and the board's masters are made against them; retuning those to change the interface would be
 * repainting the game to restyle a button. These are the surfaces, rules and type colours the UI
 * itself is built from, and they answer to the art rather than the other way round.
 *
 * The direction is the district's own: warm near-black rather than blue-black, bone rather than
 * cool grey, and sodium brass as the interactive colour instead of a cyan hairline. The plate
 * measures a warm neutral (rgb 65,57,56) lit by sodium lamps with teal signage, so brass leads,
 * verdigris answers it, and oxblood is the only loud colour left, which is what makes danger read.
 */
export const chrome = {
  /**
   * Surfaces, deepest first. Slate violet, warmed and lifted.
   *
   * Painted panels, not screens. The values sit high enough that a panel reads as a *thing on a
   * table* rather than a hole in the page, and the hue is pushed off neutral so that nothing in the
   * interface is ever plain grey. Grey is what a form is made of.
   */
  surface: {
    950: '#171320',
    900: '#221d2f',
    800: '#2f283f',
    700: '#3e3551',
    600: '#524766',
    500: '#6a5d80',
  },
  /** Type. `100` is the reading colour, `500` is spent. Warm bone, like cheap paper. */
  ink: {
    100: '#f8f2e6',
    200: '#e2d9c8',
    300: '#bcb2a2',
    400: '#948b96',
    500: '#726a80',
  },
  /**
   * Sodium light off wet ground. The only warm thing in the chrome, and the colour of every
   * decision a player is being asked to make.
   */
  brass: { 100: '#ffe4ae', 300: '#f0ad4c', 500: '#c1832a', 700: '#77500f' },
  /**
   * The pale blue violet the shadows are made of.
   *
   * Carries selection, links, and anything the interface wants to point at without shouting. Brass
   * says act, iris says this one.
   */
  iris: { 100: '#ded7ff', 300: '#a99ef0', 500: '#7a6cc8', 700: '#4c4189' },
  /** Aged copper and the green in the pipes. Growth, supply, ground you hold. */
  verdigris: { 100: '#c2f0e6', 300: '#5fbcaf', 500: '#38847c', 700: '#1f504c' },
  /** Danger, hostile, loss. The only loud colour, so it stays rare. */
  oxblood: { 100: '#ffbca8', 300: '#e05a4a', 500: '#9c362a', 700: '#5d1c16' },
  /**
   * The Black Market's two colours, and nowhere else's.
   *
   * The back room used to be the front of the market wearing a red badge, which is exactly wrong:
   * it is not a shop, nothing in it is priced in caps, and walking through the door is supposed to
   * feel like walking somewhere you should not be. Black and orange is the board's own call and it
   * is a good one. It is the colour language of a hazard placard, and it is the one combination
   * nothing else in the interface uses.
   *
   * `soot` goes *under* `surface-950`, which is the darkest the rest of the game gets. That is what
   * makes the room read as unlit rather than as another panel.
   */
  soot: { 950: '#08070b', 900: '#0f0d13', 800: '#17141d', 700: '#221d2a' },
  /**
   * And the orange on it. Deliberately hotter and more saturated than `brass`: brass is the colour
   * of a decision the game is inviting, and this is the colour of a decision it is not.
   */
  tangerine: { 100: '#ffd9a6', 300: '#ff8c1a', 500: '#cc6608', 700: '#7d3c03' },
} as const;

export type RampName = keyof typeof ramps;
export type RampStop = keyof (typeof ramps)['abyss'];

/** `'#22d3ee'` → `0x22d3ee`: the form PixiJS wants colours in. */
export const hex = (value: string): number => Number.parseInt(value.replace('#', ''), 16);

/**
 * Two families set this whole interface: `Roboto Condensed` and `Special Elite`.
 *
 * Roboto Condensed is a genuine condensed grotesque, and condensed is the point. This game's
 * screens are dense tables of labels, tags, counters and tracking-heavy eyebrows, and a condensed
 * face buys back the horizontal room those need without dropping the type size to get it. Four
 * weights, even strokes, open counters at 10px.
 *
 * It replaced a three-family arrangement (Rajdhani for labels, Inter for prose, Orbitron behind
 * both) that had no reason to be three. The useful thing about Roboto Condensed is how close it
 * lands to Rajdhani, which is what the 429 `font-display` call sites were sized against: measured
 * at the same nominal size it sets uppercase at 1.05x Rajdhani's width and 0.99x on a mixed-case
 * name, on an x-height 1.04x its own. Nothing needed resizing to take it.
 *
 * `stamp` (Special Elite) is the exception, and it is deliberately a small one. It is a struck
 * typewriter, for the lettering a player reads one line at a time rather than scans: a note, a
 * quotation, a line of dialogue, the name of a person, the label on a dropdown. It is a
 * *distressed* face, drawn with the ink-spread and misalignment of a real ribbon, with no weight
 * axis and no italic. That is texture on a name and a legibility tax across a table, so it stays
 * off the dense work: an earlier pass put it there and the board's note was blunt and correct, the
 * game was harder to read than it needed to be.
 *
 * ### Sizing the stamp
 *
 * Special Elite runs 1.34x the x-height of the pen face it took these sites from, and 1.43x the
 * width on a name. Call sites that moved from `hand` to `stamp` had their px sizes scaled by ~0.75
 * to hold the optical size the layout was designed around. A new `font-stamp` site wants roughly
 * three quarters of the number a sans would take: against Roboto Condensed specifically, Special
 * Elite is 0.91x the x-height but 1.23x the width on a name, so it buys height and spends width.
 */
export const fontStacks = {
  stamp: ['Special Elite', 'Roboto Condensed', 'ui-sans-serif', 'sans-serif'],
  display: ['Roboto Condensed', 'ui-sans-serif', 'sans-serif'],
  body: ['Roboto Condensed', 'ui-sans-serif', 'system-ui', 'sans-serif'],
};
