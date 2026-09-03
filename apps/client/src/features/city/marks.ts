/**
 * Where each contested location stands in its district's painting.
 *
 * Fractions of the painting, never of the viewport: the scene sizes a box to the plate's own
 * aspect and positions the plates inside *that*, so the marks hold at every window width. This is
 * the same arrangement `plots.ts` uses for the twelve structures on the home district's ground,
 * and it is here rather than in `@frontline/shared` for the same reason that file is: a mark is a
 * fact about a picture, and the server has no picture.
 *
 * Both districts' sevens come off the board's own labelled copy of the plate, read at the tip of
 * each leader line rather than at the label box, so a sign sits on the thing it names rather than
 * beside it. The tips are not eyeballed: the labelled and unlabelled masters differ only where the
 * board drew, so differencing the pair isolates the label pixels exactly, and the tip is the point
 * of each cluster furthest from its own glyph run.
 *
 * A location with no mark is not an error and is not dropped: {@link ContestedScene} lists it
 * under the painting instead. Better a location the player can still reach than a plate pinned to
 * a guess.
 */

/** A point on the painting, `0..1` from its top-left corner. */
export interface Mark {
  readonly x: number;
  readonly y: number;
  /**
   * Which side of the point the plate hangs on, so a plate near an edge stays on the picture.
   *
   * Authored rather than computed from `x`: the useful side is about what the plate would *cover*,
   * not about which half of the frame it is in. The Breaker's Yard sits mid-frame and hangs left
   * because the gantry it names is to the right of its point.
   */
  readonly side: 'left' | 'right';
  /**
   * Where the plate hangs, when it cannot hang beside the point without covering the thing it names.
   *
   * Fractions of the painting, like `x` and `y`, and the plate hangs from *this* point on {@link
   * Mark.side}. Omitted means beside the point, which is what every mark did until the paintings
   * were measured: a plate is 144px wide, which is 425 pixels of the Docks' 3780-wide master, and
   * the only part of that picture quiet enough to take a box that size is the open water on the far
   * left. Every sign was therefore sitting on a roof, an awning or a hull.
   *
   * The point keeps its dot and a line runs out to the plate, which is how the board's own labelled
   * copies of both plates do it, and how a map has always done it.
   */
  readonly plate?: { readonly x: number; readonly y: number };
}

/**
 * The district gate, on the districts that draw one.
 *
 * Not a location: it is the way in, and it is the only plate on the painting whose state comes
 * from somewhere other than the location list. Given a mark here so the picture can show it in the
 * wall rather than only as a panel underneath.
 */
export const GATE_MARK: Readonly<Record<string, Mark>> = {
  'neon-docks': { x: 0.76, y: 0.248, side: 'right', plate: { x: 0.738, y: 0.181 } },
  // The timber gate in the palisade, on the Steelbelt's south-west run of fence. Hangs left, over
  // the fence line and the empty ground outside it: hanging right would put the plate on the near
  // rim of the Slag Bowl, which is a location of its own with its own sign.
  rustyard: { x: 0.319, y: 0.707, side: 'left', plate: { x: 0.265, y: 0.786 } },
};

export const LOCATION_MARKS: Readonly<Record<string, Mark>> = {
  /*
   * Neon Docks, read off the board's labelled copy of the 3780x1800 redelivery.
   *
   * These moved wholesale when the plate was repainted at 21:10: the old marks were fractions of a
   * 16:9 picture, and the same fraction lands somewhere else entirely once the frame is wider. The
   * anchor is the tip of each leader line in `images/neon-docks-3780x1800-labeled.jpg`, not the
   * label box, so a sign sits on the thing it names rather than beside it.
   */
  'neon-docks-cranegate': { x: 0.202, y: 0.372, side: 'right', plate: { x: 0.272, y: 0.368 } },
  'neon-docks-tideline': { x: 0.474, y: 0.142, side: 'right', plate: { x: 0.471, y: 0.12 } },
  'neon-docks-runners': { x: 0.676, y: 0.186, side: 'right', plate: { x: 0.746, y: 0.128 } },
  // Hangs left, which is the side the board's own label is on, and it has to be: the Galley sits
  // at the same height a sixth of the frame away and hangs left too, so a right-hanging pumphouse
  // grows straight into it. The two collided at every width below 1600 before this.
  'neon-docks-pumphouse': { x: 0.568, y: 0.506, side: 'right', plate: { x: 0.622, y: 0.453 } },
  'neon-docks-galley': { x: 0.734, y: 0.508, side: 'right', plate: { x: 0.737, y: 0.499 } },
  'neon-docks-barges': { x: 0.262, y: 0.862, side: 'left', plate: { x: 0.265, y: 0.88 } },
  'neon-docks-chandler': { x: 0.918, y: 0.462, side: 'right', plate: { x: 0.88, y: 0.435 } },

  /*
   * Steelbelt, read off `images/belt-portrait-label-3780x1800.png`.
   *
   * These moved wholesale when the plate was repainted, for the same reason the Docks' did: the old
   * marks were fractions of a 16:9 picture and this one is 2.36:1, so the same fraction lands
   * somewhere else entirely. The file name says 3780x1800 and the file is 1584x672; the fractions
   * below are of the picture, so they hold either way, but see the manifest on what the size costs.
   *
   * The two on the right edge hang left. The board's own labels all sit to the right of their
   * anchors, which works in a still picture with no frame to run off: in the client a 144px plate
   * hung right from x=0.878 leaves the painting on any screen narrower than about 1250px.
   */
  'rustyard-press': { x: 0.153, y: 0.39, side: 'left', plate: { x: 0.145, y: 0.386 } },
  'rustyard-bonefield': { x: 0.537, y: 0.135, side: 'right', plate: { x: 0.506, y: 0.035 } },
  'rustyard-pawn': { x: 0.327, y: 0.409, side: 'left', plate: { x: 0.266, y: 0.428 } },
  'rustyard-ramp': { x: 0.456, y: 0.784, side: 'right', plate: { x: 0.471, y: 0.863 } },
  'rustyard-pumps': { x: 0.718, y: 0.842, side: 'right', plate: { x: 0.74, y: 0.873 } },
  'rustyard-kennels': { x: 0.878, y: 0.56, side: 'right', plate: { x: 0.877, y: 0.567 } },
  'rustyard-bones': { x: 0.849, y: 0.143, side: 'right', plate: { x: 0.879, y: 0.15 } },
};
