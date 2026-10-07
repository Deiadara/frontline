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
  steelbelt: { x: 0.27, y: 0.79 },
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
  annexes: { x: 0.425, y: 0.83 },
  // Glasshouse Fields' timber gate and watch post close the bottom edge, labelled "Wooden District
  // Gate" on the board's copy. The sign stands on the road above the beam, left of the watch post,
  // so it names the gate without sitting on the gateway.
  'glasshouse-fields': { x: 0.41, y: 0.685 },
  // The Blacksite has no gate on its bottom edge: the way in is the great gate of the fortified
  // compound at upper left, under the red banners. The sign stands on the road at its foot.
  blacksite: { x: 0.245, y: 0.415 },
  // The CCS's gatehouse closes the bottom of the painting, left of centre. The sign stands on
  // the road under its arch rather than on the arch, and no lower: the plate is 2.098:1, so at
  // the worst band the bottom tenth is under the nav and a shut gate's plate stands 26px.
  ccs: { x: 0.43, y: 0.838 },
  // Coldwater Halt's gatehouse is the stone block in the middle of the frame, the one with the
  // barred iron gate and the red signal lamps burning either side of it. The sign stands on the
  // stone wall to the left of the gate rather than across the bars, so it names the gate without
  // covering the thing that tells a player whether it is shut.
  'coldwater-halt': { x: 0.55, y: 0.3 },
  // Ironmouth's way in is the tunnel mouth itself: the arched portal at top centre, closed by a
  // red barred gate with signal lamps burning either side of it. The sign stands on the timber
  // deck below the bars rather than across them, so it names the gate without covering the thing
  // that tells a player whether it is shut.
  ironmouth: { x: 0.525, y: 0.22 },
  // Telemetry Hill's gatehouse closes the bottom centre of the painting, two towers and a barred
  // gate with a truck stopped at it. The sign stands on the wet road below the bars, right of the
  // truck, rather than across the gate.
  'telemetry-hill': { x: 0.6, y: 0.79 },
  // The Last Platform is painted from inside, so its way in is the row of barrier gates and
  // guards closing the concourse under the statue. The sign stands on the concourse floor right
  // of the barriers, clear of the statue's plinth.
  'last-platform': { x: 0.64, y: 0.585 },
  // The Blockhouse's way in is the green-lit arch at the left that the train runs under. The sign
  // stands on the wall to its right rather than over the arch.
  blockhouse: { x: 0.26, y: 0.655 },
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
  'steelbelt-press': { x: 0.16, y: 0.395 },
  'steelbelt-bonefield': { x: 0.545, y: 0.36 },
  // Up and to the left of the shop, on the open ground inside the palisade, so it stands clear of
  // the District Gate sign below it rather than sitting on the gate arch.
  'steelbelt-pawn': { x: 0.245, y: 0.6 },
  // Inside the bowl, on its floor, between the people standing in it rather than on one of them.
  // Read off a gridded crop of the plate: the people in the bowl stand at about (0.45, 0.65),
  // (0.56, 0.70) and (0.50, 0.75); this band of floor between them is the one nobody is on.
  'steelbelt-ramp': { x: 0.52, y: 0.605 },
  // On the road at the row's left end rather than under it: the plate room crops the bottom tenth
  // of the painting at 1024x768, and a sign at 0.94 was not on screen there at all.
  'steelbelt-pumps': { x: 0.7, y: 0.86 },
  'steelbelt-kennels': { x: 0.885, y: 0.66, side: 'left' },
  'steelbelt-canteen': { x: 0.87, y: 0.31, side: 'left' },

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
  'annexes-uplink': { x: 0.215, y: 0.195 },
  'annexes-ward': { x: 0.39, y: 0.335 },
  'annexes-orrery': { x: 0.55, y: 0.29 },
  'annexes-coldrow': { x: 0.725, y: 0.35 },
  'annexes-faculty': { x: 0.275, y: 0.635 },
  'annexes-loft': { x: 0.585, y: 0.615 },
  'annexes-scaffold': { x: 0.77, y: 0.73 },

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
  'blacksite-outer': { x: 0.14, y: 0.6 },
  'blacksite-watchtower': { x: 0.415, y: 0.335 },
  'blacksite-drill': { x: 0.685, y: 0.35 },
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
  'blacksite-blackward': { x: 0.955, y: 0.415, side: 'left' },
  'blacksite-armory': { x: 0.43, y: 0.705 },
  'blacksite-motorpool': { x: 0.655, y: 0.745 },
  'blacksite-pile': { x: 0.9, y: 0.715 },
  'blacksite-pit17': { x: 0.2, y: 0.745 },

  /*
   * The CCS (`plate-district-ccs`, 1817x866, 2026-09-20). Read off the maintainer's
   * mark-up of a 1380x602 cover-fitted band, then converted to plate fractions: that band shows
   * the plate with 4.25% cropped off the top and the bottom, so a band `y` is `0.0425 + 0.915 y`
   * on the plate. Each sign sits just under the thing it names, on open ground: the road under
   * the uplink dish, the plaza in front of the chapel's door, the terrace under the green dome,
   * the wall under the red mast, the paving under the statue, the yard in front of the armoury,
   * the ground at the crane's foot (grows left: it stands at the right edge), the road below the
   * barricade wall. Then checked at 1024x768, 1280x720 and 1920x1080 and moved where a sign
   * sat on a building or on another sign.
   *
   * The chapel, the armoury and the barricade were moved again on 2026-09-20, off a second
   * mark-up: three callouts drawn straight onto a 1320x648 grab of the painting. Converted by
   * fitting the seven signs already in that grab against the fractions below, which gives
   * `x_px = 1783.0 x - 134.3` and `y_px = 846.7 y - 85.5`; every one of the seven reproduces to
   * within a pixel, so the three new figures are read off the same ruler rather than guessed.
   * The callout's top edge is the sign's top edge, which is what `Mark.y` means.
   */
  'ccs-uplink': { x: 0.16, y: 0.29 },
  'ccs-chapel': { x: 0.439, y: 0.285 },
  'ccs-ascension': { x: 0.6, y: 0.395 },
  'ccs-broadcast': { x: 0.822, y: 0.455 },
  'ccs-martyrs': { x: 0.467, y: 0.532 },
  'ccs-armory': { x: 0.649, y: 0.491 },
  'ccs-scaffold': { x: 0.94, y: 0.701, side: 'left' },
  'ccs-household': { x: 0.222, y: 0.481 },

  /*
   * Coldwater Halt (`plate-district-coldwater-halt`, 3780x1800, 2026-09-24), the first painted
   * district of the second city.
   *
   * These are the maintainer's own anchors, read off a mock-up of the painting, with one moved:
   * the Distant Signal was marked at y 0.113, which put it under the ground box's toggle at
   * 1280x720. The toggle floats over the plate's top-right corner at `z-20` and takes the pointer,
   * so a sign there is drawn and unclickable, which is the failure `plateFit.test.ts` was written
   * for after Chrome Row's Overlook sat in the same corner. It has come down the tower to the
   * walkway under the lit signal cabin, which is the first band of the painting clear of the
   * toggle, and it grows left because it stands at the right edge.
   *
   * The rest stand where they were marked: the canopy's left end for the platform, the arcade's
   * awnings for the market, the tents for Tent Row, the cookhouse counter for the kitchens, and
   * the open yard under the tank for the standpipe and the fuelling point below it.
   */
  // Down onto the platform deck from the maintainer's y 0.138, which was on the canopy's roof and
  // underneath the screen's own header strip. That strip carries the back link, the district's
  // plaque and, on gated ground, the gate's state and the spy control, and it is
  // `pointer-events-auto`: measured at 1280x720 it runs to x 565 and covers the plate down to
  // y 0.184, so the sign was drawn, unreadable and unclickable. `plateFit.test.ts` measures that
  // corner now, the way it already measured the ground box's.
  'coldwater-halt-platform': { x: 0.3, y: 0.215 },
  'coldwater-halt-market': { x: 0.117, y: 0.355 },
  'coldwater-halt-kitchens': { x: 0.432, y: 0.622 },
  'coldwater-halt-standpipe': { x: 0.153, y: 0.663 },
  'coldwater-halt-fuelling': { x: 0.116, y: 0.744 },
  'coldwater-halt-tentrow': { x: 0.739, y: 0.154 },
  'coldwater-halt-signal': { x: 0.931, y: 0.195, side: 'left' },

  /*
   * Ironmouth (`plate-district-ironmouth`, 3780x1800, 2026-09-24), the second painted district
   * of Terminus and the densest painting in the game: a tunnel mouth in a ridge with a town on the
   * terraces either side of it.
   *
   * No labelled copy came with it, so these are placed by eye against a twentieth grid, the way
   * Chrome Row's and the Blacksite's were, and then checked at 1280x720 and 1920x1080. There is
   * almost no open ground in this picture, so each sign hangs on the quietest surface under the
   * feature it names: wet rock below a terrace, the platform's own paving, the deck under the
   * portal.
   *
   * Two were moved off the feature itself for the floating controls `plateFit.test.ts` measures.
   * The Spoil Heap sits under the tip's own terrace rather than on it, because the screen's header
   * strip runs to x 565 and covers the plate down to y 0.184 at 1280x720. The Tunnel Chapel hangs
   * on the walkway below the chapel rather than beside its window, which keeps it clear of the
   * ground box's toggle in the top-right corner and off the stained glass that identifies it.
   */
  // The lit platform paving beside the standing train, at the near end of the canopy.
  'ironmouth-halt': { x: 0.495, y: 0.605 },
  // The stacks run from y 0.24 to the foot of the frame at the far left, and the only ground under
  // them that is not pipework is the dark rock at the bottom. It grows right because it stands at
  // the left edge.
  'ironmouth-shafts': { x: 0.015, y: 0.835, side: 'right' },
  // The rock below the arch row's front walkway, under the middle of the three bricked arches.
  'ironmouth-arches': { x: 0.73, y: 0.545 },
  // Under the green-lit vats, on the steam at the works' lower right corner.
  'ironmouth-shaftnine': { x: 0.185, y: 0.735 },
  'ironmouth-spoil': { x: 0.185, y: 0.225 },
  'ironmouth-chapel': { x: 0.765, y: 0.235 },
  // The wet street at the foot of the shopfront row, rather than over the lit windows themselves.
  'ironmouth-lampman': { x: 0.675, y: 0.845 },

  /*
   * The Marshalling Yards (`plate-district-marshalling-yards`, 3780x1800, 2026-09-25), the third
   * painted district of Terminus: sixty miles of siding seen across the whole frame.
   *
   * Placed by eye against a twentieth grid and then against quarter-tenth crops of each quarter,
   * the way Ironmouth's were. The painting is wide and shallow, so the quiet ground is the track
   * apron rather than a street: most of these hang on ballast or wet concrete under the thing they
   * name, and none is above y 0.184, which is how far the screen's header strip covers the plate
   * at 1280x720 (`plateFit.test.ts`).
   *
   * Box Nine is the exception to "on open ground": it is a signal box on stilts and the only thing
   * under it is its own tower, so the sign hangs on the tower under the lit cabin, the way the
   * Distant Signal does at Coldwater.
   */
  // The pale track apron between the hump's gantry and the first rank of parked wagons.
  'marshalling-yards-hump': { x: 0.265, y: 0.215 },
  // On the tower, under the three teal screens that identify the cabin.
  'marshalling-yards-signalbox': { x: 0.185, y: 0.335 },
  // The open ground to the right of the coal bunkers, under the fuel tanks above them.
  'marshalling-yards-coalstage': { x: 0.185, y: 0.505 },
  // The yard floor between the stripped wheelsets and the cut frames behind them.
  'marshalling-yards-breakers': { x: 0.22, y: 0.735 },
  // The wet street in front of the mess room, left of its awnings and the tables under them.
  'marshalling-yards-messroom': { x: 0.45, y: 0.8 },
  // The road along the front of the sheds, below the open doors and the furnaces burning in them.
  'marshalling-yards-sheds': { x: 0.765, y: 0.375 },
  // The wet apron below the arched shed, clear of the platform deck and its lamps.
  'marshalling-yards-platformfour': { x: 0.785, y: 0.815 },

  /*
   * Bonded Row (`plate-district-bonded-row`, 3780x1800, 2026-09-25), the fourth painted district of
   * Terminus and the one the maintainer sent a labelled copy of.
   *
   * The labelled copy is a crop rather than the delivered frame, so its anchors do not transfer as
   * fractions: what it settled is *which* feature each name belongs to, and each sign is then
   * placed against the delivered painting itself. Crates are stacked to the roofline across most
   * of this picture, so as at Ironmouth the quiet surface is wet concrete under the feature rather
   * than beside it.
   */
  // The open floor to the right of the crate hanging off the gantry, clear of the stacks behind it.
  'bonded-row-crated': { x: 0.2, y: 0.295 },
  // The floor in front of the market shed, below the lit trestles rather than across them.
  'bonded-row-longbond': { x: 0.28, y: 0.42 },
  // The wet road below the office's corner, between it and the two figures standing on the track.
  'bonded-row-seized': { x: 0.435, y: 0.625 },
  // The ring's own floor, between the rope above it and the two fighters below.
  'bonded-row-ring': { x: 0.508, y: 0.742 },
  // The ground in front of the goods shed, below the standing train and clear of the signal post.
  'bonded-row-halt': { x: 0.68, y: 0.415 },
  // The apron in front of the cutting floor, left of the trays and under the hanging carcasses.
  'bonded-row-rendering': { x: 0.7, y: 0.625 },
  // The kennel floor above the handlers and their dogs, inside the run rather than outside it.
  'bonded-row-kennels': { x: 0.15, y: 0.705 },
  // The wet ground below the clinic's curtained front, clear of the trolleys standing on it. Up
  // from y 0.88, which put the plate's bottom edge at 0.910 against a visible band that ends at
  // 0.897 in the worst viewport the plate room measures (`plateFit.test.ts`, 1280x484).
  'bonded-row-coldstore': { x: 0.725, y: 0.855 },

  /*
   * The four Combine districts of Terminus (`plate-district-telemetry-hill`, `-viaduct`,
   * `-last-platform`, `-blockhouse`, all 3780x1800, 2026-09-29), delivered together with no
   * labelled copies.
   *
   * Placed by eye against each painting, the way Ironmouth's and the Yards' were, and then checked
   * in the browser. The rule is the one every plate above keeps: each sign hangs just under the
   * thing it names, on the quietest ground there, and none stands above y 0.2, which keeps them
   * clear of the screen's header strip and the ground box's toggle (`plateFit.test.ts`).
   */
  // The roof deck under the three dishes at the upper left.
  'telemetry-hill-uplink': { x: 0.2, y: 0.215 },
  // The deck at the foot of the red lattice mast, top centre.
  'telemetry-hill-repeater': { x: 0.545, y: 0.26 },
  // The courtyard in front of the green-roofed hall with the banners.
  'telemetry-hill-quiet': { x: 0.3, y: 0.54 },
  // The lane between the small houses with the wire aerials, in the middle of the frame.
  'telemetry-hill-pirate': { x: 0.53, y: 0.56 },
  // The terrace below the copper dome, upper right.
  'telemetry-hill-dome': { x: 0.765, y: 0.36 },
  // The ground in front of the tanks and transformers at the right.
  'telemetry-hill-array': { x: 0.8, y: 0.62 },
  // The path through the tent town, lower left.
  'telemetry-hill-bunkroom': { x: 0.15, y: 0.73 },

  // The platform apron under the glass halt, upper left.
  'viaduct-halt': { x: 0.13, y: 0.32 },
  // The approach below the sandbagged gun position at the left.
  'viaduct-battery': { x: 0.2, y: 0.66 },
  // The bridge deck below the standing train, on the stone of the parapet.
  'viaduct-parapet': { x: 0.46, y: 0.335 },
  // The walkway below the arch with the washing lines and lit rooms, centre.
  'viaduct-undercroft': { x: 0.45, y: 0.52 },
  // The floor of the lab down the stair, lower left, below its screens.
  'viaduct-archnineteen': { x: 0.235, y: 0.8 },
  // The pier below the two furnaces burning at the right.
  'viaduct-pierworks': { x: 0.74, y: 0.66 },
  // The yard in front of the blue-lit armoury, lower centre.
  'viaduct-sappers': { x: 0.39, y: 0.84 },
  // The depot floor above the trams on their roads, lower right.
  'viaduct-gantry': { x: 0.86, y: 0.76 },

  // The platform apron in front of the standing trains, left of the statue.
  'last-platform-platform': { x: 0.42, y: 0.47 },
  // The trading floor below the counters and lamps at the left.
  'last-platform-customs': { x: 0.17, y: 0.53 },
  // The compound floor inside the fenced cages, lower left.
  'last-platform-holding': { x: 0.2, y: 0.72 },
  // The gallery rail under the glazed clinic, top left. Down from the clinic itself, which sits
  // in the header strip's corner.
  'last-platform-transit': { x: 0.14, y: 0.27 },
  // The floor in front of the racks at the lower right.
  'last-platform-armoury': { x: 0.87, y: 0.78 },
  // The foot of the plinth, left of the barrier gates.
  'last-platform-stationmaster': { x: 0.47, y: 0.6 },
  // The bay floor under the dead armour and its gantries, upper right.
  'last-platform-sidings': { x: 0.86, y: 0.5 },
  // The deck of the iron footbridge over the pit, bottom centre.
  'last-platform-footbridge': { x: 0.6, y: 0.77 },

  // The platform deck left of the locomotive, lower left.
  'blockhouse-officershalt': { x: 0.15, y: 0.8 },
  // The floor of the lit control room of desks and screens, left.
  'blockhouse-panel': { x: 0.19, y: 0.42 },
  // The terrace below the glass vault, top centre.
  'blockhouse-chapel': { x: 0.465, y: 0.3 },
  // The yard among the pipes and tanks, bottom centre.
  'blockhouse-interlocking': { x: 0.6, y: 0.8 },
  // The road below the lit library's shelves, centre right.
  'blockhouse-records': { x: 0.6, y: 0.52 },
  // The parade ground itself, below the ranks.
  'blockhouse-parade': { x: 0.35, y: 0.56 },
  // The ground under the two cooling towers, lower right.
  'blockhouse-reactor': { x: 0.72, y: 0.77 },
  // On the lattice tower under its lit cabin, at the right edge, growing left.
  'blockhouse-towerbox': { x: 0.93, y: 0.5, side: 'left' },
};

/**
 * The paintings whose "Held by" plaque hangs at the bottom right rather than the bottom left.
 *
 * Bottom left is the maintainer's corner (2026-09-30) and holds on every other plate. On these two
 * a sign already stands in it: Ironmouth's Shafts at x 0.015 and the Blockhouse's Officers' Halt at
 * x 0.15, both under the plaque at 1280x720. `painting.spec.ts` sweeps every plate at 1024 and 1280
 * for the plaque over a sign, so a new plate that needs this is found there.
 */
export const HELD_BY_ON_THE_RIGHT: ReadonlySet<string> = new Set(['ironmouth', 'blockhouse']);
