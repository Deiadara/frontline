/**
 * Where each contested location's sign stands in its district's painting.
 *
 * Fractions of the painting, never of the viewport: the scene sizes a box to the plate's own
 * aspect and positions the signs inside *that*, so they hold at every window width. This is the
 * same arrangement `plots.ts` uses for the twelve structures on the home district's ground, and
 * the signs follow the same rule as those plot labels: a plate hung just under the thing it names,
 * on open ground, with no dot and no leader line. The lines went at the board's request; a sign
 * that has to be joined to its subject by a thread is a sign standing in the wrong place.
 *
 * A location with no mark is not an error and is not dropped: {@link ContestedScene} lists it
 * under the painting instead. Better a location the player can still reach than a plate pinned to
 * a guess.
 */

/** Where a sign stands on the painting, `0..1` from its top-left corner. */
export interface Mark {
  /** The sign's centre line. */
  readonly x: number;
  /** The sign's top edge: just under the thing it names, on open ground, the way a plot label sits. */
  readonly y: number;
  /**
   * Which way the sign grows from `x`. `centre` for nearly all of them. `left` for a sign that
   * would otherwise run off the right edge of the frame, and `right` for the mirror case: the
   * frame is `overflow-hidden`, and a sign clipped by it is a sign the player cannot read.
   */
  readonly side?: 'left' | 'right';
}

/**
 * The district gate, on the districts that draw one.
 *
 * Not a location: it is the way in, and it is the only plate on the painting whose state comes
 * from somewhere other than the location list. Given a mark here so the picture can show it in the
 * wall rather than only as a panel underneath.
 */
export const GATE_MARK: Readonly<Record<string, Mark>> = {
  // The Docks' gate tower: the plate stands at its foot, on the quay.
  'neon-docks': { x: 0.78, y: 0.4 },
  // The timber gate in the Steelbelt's palisade: on the road outside it, where a sign would be.
  rustyard: { x: 0.27, y: 0.79 },
  // Chrome Row's timber gate closes the bottom of the plaza; the sign stands on the stone just
  // above its beam, clear of the two guards under it.
  'chrome-row': { x: 0.53, y: 0.705 },
};

export const LOCATION_MARKS: Readonly<Record<string, Mark>> = {
  /*
   * Neon Docks. Each sign sits under the feature it names, on water or open quay, never on a roof
   * or an awning. Read off the 3780x1800 plate with the signs drawn at 1440 wide, which is where
   * a 9rem plate is a tenth of the frame: the width the right-edge clamps are sized for.
   */
  'neon-docks-cranegate': { x: 0.24, y: 0.43 },
  'neon-docks-tideline': { x: 0.48, y: 0.27 },
  'neon-docks-runners': { x: 0.68, y: 0.33 },
  'neon-docks-pumphouse': { x: 0.595, y: 0.585 },
  'neon-docks-galley': { x: 0.74, y: 0.76 },
  'neon-docks-barges': { x: 0.22, y: 0.89 },
  'neon-docks-chandler': { x: 0.92, y: 0.43, side: 'left' },

  /*
   * Steelbelt, the same way. The Breaker's Yard sign stands on the dirt between the gantry and
   * the Slag Bowl rather than under the gantry, because everything under the gantry is a machine.
   */
  'rustyard-press': { x: 0.16, y: 0.395 },
  'rustyard-bonefield': { x: 0.545, y: 0.36 },
  // Up and to the left of the shop, on the open ground inside the palisade, so it stands clear of
  // the District Gate sign below it rather than sitting on the gate arch.
  'rustyard-pawn': { x: 0.245, y: 0.6 },
  // Inside the bowl, on its floor, between the people standing in it rather than on one of them.
  // Read off a gridded crop of the plate: the people in the bowl stand at about (0.45, 0.65),
  // (0.56, 0.70) and (0.50, 0.75); this band of floor between them is the one nobody is on.
  'rustyard-ramp': { x: 0.52, y: 0.605 },
  // On the road at the row's left end rather than under it: the plate room crops the bottom tenth
  // of the painting at 1024x768, and a sign at 0.94 was not on screen there at all.
  'rustyard-pumps': { x: 0.7, y: 0.86 },
  'rustyard-kennels': { x: 0.885, y: 0.66, side: 'left' },
  'rustyard-bones': { x: 0.87, y: 0.31, side: 'left' },

  /*
   * Chrome Row, read off the 3780x1800 delivery against a twentieth grid. No labelled copy was
   * delivered, so these are placed by eye at the foot of each feature on open stone, or on a
   * roof where the ground in front is people: the market steps, the mast's foot, the theatre's
   * forecourt, the hospital's lower wall, the lookout platform, the pawn shop's front, the arcade
   * row's roof, the tavern's roof.
   */
  'chrome-row-exchange': { x: 0.222, y: 0.25 },
  'chrome-row-cathode': { x: 0.405, y: 0.46 },
  'chrome-row-overlook': { x: 0.91, y: 0.12 },
  'chrome-row-ferrous': { x: 0.815, y: 0.56 },
  'chrome-row-statue': { x: 0.435, y: 0.565 },
  'chrome-row-regal': { x: 0.58, y: 0.47 },
  'chrome-row-anvil': { x: 0.885, y: 0.64 },
  'chrome-row-coinop': { x: 0.7, y: 0.62 },
};
