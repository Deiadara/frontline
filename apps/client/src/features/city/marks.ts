/**
 * Where each contested location's sign stands in its district's painting.
 *
 * Fractions of the painting, never of the viewport: the scene sizes a box to the plate's own
 * aspect and positions the signs inside *that*, so they hold at every window width. This is the
 * same arrangement `plots.ts` uses for the twelve structures on the home district's ground, and
 * the signs follow the same rule as those plot labels: a plate hung just under the thing it names,
 * on open ground, with no dot and no leader line. The lines went at the maintainer's request; a sign
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
  // The Undergrid's timber gate and watch platform close the bottom edge. The sign stands on the
  // wet stone *above* the beam rather than over the gateway, so it names the gate without sitting
  // on it or on the two figures walking through it (board mark-up, 2026-09-11).
  undergrid: { x: 0.515, y: 0.715 },
  // The Annexes' stone gate and its two towers close the bottom of the square. Down and to the
  // left of the arch, on the lit road, so it covers the gate as little as it can and still reads
  // as its sign. Not lower: the plate room crops the bottom tenth at 1024x768.
  'datavault-sigma': { x: 0.425, y: 0.83 },
  // Glasshouse Fields' timber gate and watch post close the bottom edge, labelled "Wooden District
  // Gate" on the board's copy. The sign stands on the road above the beam, left of the watch post,
  // so it names the gate without sitting on the gateway.
  'glasshouse-fields': { x: 0.41, y: 0.685 },
  // The Blacksite has no gate on its bottom edge: the way in is the great gate of the fortified
  // compound at upper left, under the red banners. The sign stands on the road at its foot.
  'blacksite-7': { x: 0.245, y: 0.415 },
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
  // Up from y 0.89 (2026-09-15): the plate now fills the band between the bars, which crops the
  // bottom tenth, and an 18.5px sign at 0.89 ended 13px under the nav at 1280x720
  // (`plateFit.test.ts`). Same water at the barges' lower-left corner, three hundredths higher.
  'neon-docks-barges': { x: 0.22, y: 0.86 },
  /*
   * Down the quay from the gate rather than level with it (2026-09-11).
   *
   * It sat at y 0.43 against the gate's 0.40, which was clear only while a sign could wrap: once
   * every plate became a single line this one grew left into the gate's right-hand corner.
   * Measured at 1024x768, the two overlapped across x 0.823 to 0.837.
   */
  'neon-docks-chandler': { x: 0.92, y: 0.49, side: 'left' },

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
  // On the roof at the tower's foot rather than on its deck (y 0.12): at 1280x720 the deck sat
  // under the ground box's toggle, which floats over the plate's top-right corner and took the
  // click. `plateFit.test.ts` now measures that corner for every mark.
  'chrome-row-overlook': { x: 0.91, y: 0.19 },
  'chrome-row-ferrous': { x: 0.815, y: 0.56 },
  'chrome-row-statue': { x: 0.435, y: 0.565 },
  'chrome-row-regal': { x: 0.58, y: 0.47 },
  'chrome-row-anvil': { x: 0.885, y: 0.64 },
  'chrome-row-coinop': { x: 0.7, y: 0.62 },

  /*
   * The Undergrid, read off the board's labelled copy (`images/undergrid-portrait-labels.png`,
   * 2026-09-11). Each sign sits on the platform or the floor under the thing it names, on open
   * ground: the substation's scaffold deck, the walkway below the customs tunnel, the vault's
   * platform, the junction's footbridge, the depot's forecourt, the stair tower's foot, and the
   * floor in front of the reagent tanks. The stair is the one that would run off the right edge.
   */
  'undergrid-substation': { x: 0.245, y: 0.5 },
  'undergrid-customs': { x: 0.53, y: 0.215 },
  // Both of these were moved at the board's mark-up (2026-09-11). The vault's sign sat on the
  // walkway below and left of the structure, where it read as a label for the bridge; it stands on
  // the vault's own deck now, at the right-hand end of the housing. The depot's sat under the
  // reagent tanks rather than under the tram, and has come back up the steps to the platform it
  // names.
  'undergrid-vault9': { x: 0.8, y: 0.205 },
  'undergrid-junction': { x: 0.49, y: 0.51 },
  'undergrid-depot': { x: 0.715, y: 0.49 },
  'undergrid-lair': { x: 0.935, y: 0.5, side: 'left' },
  'undergrid-reagent': { x: 0.855, y: 0.78 },

  /*
   * The Annexes, read off the plate against a twentieth grid (2026-09-11). The board's labelled
   * copy names the buildings and these follow it: each sign sits at the foot of the thing it names
   * or on its own roof where the ground in front of it is people, trees or steps somebody is on.
   * The square in the middle is left clear, because it is the one part of this painting a player
   * reads the whole shape of.
   */
  'datavault-sigma-uplink': { x: 0.215, y: 0.195 },
  'datavault-sigma-ward': { x: 0.39, y: 0.335 },
  'datavault-sigma-orrery': { x: 0.55, y: 0.29 },
  'datavault-sigma-coldrow': { x: 0.725, y: 0.35 },
  'datavault-sigma-faculty': { x: 0.275, y: 0.635 },
  'datavault-sigma-loft': { x: 0.585, y: 0.615 },
  'datavault-sigma-scaffold': { x: 0.77, y: 0.73 },

  /*
   * Glasshouse Fields, read off the board's labelled copy (`images/labels-glasshouse.jpg`,
   * 2026-09-15): each leader tip, then moved down onto the ground at the foot of the thing it
   * names where the tip landed on a roof, or onto the roof where the ground in front is people.
   * The intake's sign is under its guarded pipe gate, the berm's on the grass slope below the
   * sandbags, the hauler yard's on the dirt in front of its crane shed, the Long Ladle's on its
   * own roof (the ground in front of it is diners at tables), the market's on the road above its
   * awnings, the chapel's on its roof right of the bell tower, and the camp's on the fence line.
   */
  'glasshouse-fields-intake': { x: 0.21, y: 0.395 },
  'glasshouse-fields-berm': { x: 0.44, y: 0.375 },
  'glasshouse-fields-haulers': { x: 0.81, y: 0.46 },
  'glasshouse-fields-ladle': { x: 0.56, y: 0.505 },
  'glasshouse-fields-fieldgate': { x: 0.16, y: 0.575 },
  'glasshouse-fields-fieldchapel': { x: 0.76, y: 0.6 },
  'glasshouse-fields-fence': { x: 0.985, y: 0.505, side: 'left' },
  // The Glasshouses (added 2026-09-15): the three glass houses run along the top of the plate
  // from x 0.46 to 0.84, their nearest edge coming down to y 0.30 at the right. The sign stands
  // on the beds in front of the middle house rather than on its glass, left of the third house's
  // corner at (0.70, 0.29), so it covers vegetables and not panes.
  'glasshouse-fields-glasshouses': { x: 0.63, y: 0.3 },

  /*
   * The Blacksite, read off the plate against a twentieth grid (2026-09-15). No labelled copy was
   * delivered. The fortified compound with the great gate at upper left is the Outer Berm: it is
   * the perimeter, with layered berm walls running down the left edge, and the sign stands on
   * those walls. The armoury is the central hardened bunker with the orange-lit interior under
   * the watchtower, the one building in the picture with something stored inside it; its sign is
   * on the concrete at its foot. The watchtower's sign is on the tower's shaft under its banner,
   * because the tower stands straight out of the armoury's roof and has no ground of its own.
   */
  'blacksite-7-outer': { x: 0.14, y: 0.6 },
  'blacksite-7-watchtower': { x: 0.415, y: 0.335 },
  'blacksite-7-drill': { x: 0.685, y: 0.35 },
  /*
   * Above the glass, not below it (maintainer, 2026-09-15).
   *
   * The Psychic Ward is the cyan-lit room set into the high wall on the right, and the room is the
   * whole point of the sign, so the sign must not cover it. Measured on the plate, the room spans
   * x 0.865 to 0.95 and y 0.46 to 0.585; the old mark at y 0.565 stood inside it. A sign is 18.5px
   * tall at every width, which is 0.038 of the plate at 1024 wide and 0.02 at 1920, so y 0.415
   * puts its bottom edge at 0.453 on the shortest viewport, just clear of the room's top, and
   * within a sign's height of it on the widest. `x` is the sign's right edge (it grows left),
   * placed so the plate is centred over the room.
   */
  'blacksite-7-blackward': { x: 0.955, y: 0.415, side: 'left' },
  'blacksite-7-armory': { x: 0.43, y: 0.705 },
  'blacksite-7-motorpool': { x: 0.655, y: 0.745 },
  'blacksite-7-pile': { x: 0.9, y: 0.715 },
  'blacksite-7-pit17': { x: 0.2, y: 0.745 },
};
