/**
 * What is drawn on a blueprint's cover and on each of its pages (§D8).
 *
 * Every document and every page in `catalog.ts` names one of these by hand. A motif is the
 * *subject* of the drawing, not a style: `rifle` means the sheet shows a long rifle with a scope on
 * it, and `bore` means it shows a rifled bore in section. The client turns each id into line art in
 * a 12 by 12 box (`BlueprintGlyph.tsx`); this module is the vocabulary and the labels, and it lives
 * in shared so the catalogue can be type-checked against it rather than checked by eye.
 *
 * ## Why the ids are authored rather than derived
 *
 * They used to be. A document picked a motif off its target kind, so every unit drew a body and
 * every vehicle drew a chassis, and each page drew the family motif plus a seeded second one from a
 * pool of eleven. That gave one picture per page and told a player almost nothing: four Colossus
 * pages were four copies of a walking body with a different smudge on each.
 * A sheet called Ghillie Patterns should draw a fringed net. There is no rule that gets you from
 * "vehicle" to "a swashplate seen from above", so the catalogue says it.
 *
 * ## The rules the catalogue keeps, and `motifs.test.ts` checks
 *
 * - Every document and every page names an id in this set.
 * - **Two documents never share a cover.** Sixty-nine covers, sixty-nine different drawings,
 *   because a cover is the thing a player recognises a document by in a row of them.
 * - **A document's pages never repeat, and never draw their own cover.** Where two pages of one
 *   document are close, they take different views of it: the Colossus draws its hull as a
 *   `section`, its legs as a `piston` and its armour as a `table`.
 *
 * Two pages of *different* documents may share, and often should: the Heli Porter's Hydraulics and
 * anything else with a hydraulic block are both a `manifold`, and drawing them differently would be
 * a lie about the part. That is the whole reason a hundred and eleven ids carry three hundred
 * and twenty-seven assignments: 69 covers and 258 pages.
 */

/**
 * Every motif, with what it draws.
 *
 * The label is the drawing in one phrase, and it is what the client's art is written against: if
 * the two ever disagree, the label is the specification and the art is the bug.
 */
export const BLUEPRINT_MOTIFS = {
  // -------------------------------------------------------------- forty-one of the cover objects
  // The other thirty-one covers were promoted out of the sections below, which is what those
  // sections are for: a motif is the subject of a drawing, and nothing about a subject says it cannot
  // carry a document as well as a page.
  rifle: 'A long rifle with a scope on it',
  breach: 'A wall with a hole blown through it',
  kite: 'A kite on a line above its winch',
  hound: 'A four-legged hound in profile',
  twin_figures: 'Two mirrored bodies joined by a cord',
  cuirass: 'A torso plate, front and shoulders',
  exoframe: 'A powered frame with a body inside it',
  husk: 'An empty shell standing upright',
  shroud: 'A hooded figure going out at the edges',
  blade: 'A curved blade with a bound grip',
  frayed_end: 'A rope end coming apart',
  graft_body: 'A body grafted together out of parts',
  walking_hull: 'A huge hull on two legs',
  motorcycle: 'A motorcycle in profile',
  pickup: 'A pickup with a plated bed',
  car: 'A car body cut from three others',
  bus: 'A school bus in plate',
  balloon: 'An envelope over a basket',
  rotor_head: 'A rotor head over a lattice tail',
  helicopter: 'A cabin helicopter with a tail rotor',
  laminate: 'Plate laminated in layers, in section',
  cartridge: 'A cartridge, case and bullet',
  implant: 'A socket set into a limb',
  switchboard: 'A patch panel with cords in it',
  hut: 'A small block with a chimney on it',
  greenhouse: 'A pitched glass house',
  generator_set: 'An engine and dynamo on one bed',
  scrap_heap: 'A heap of plate and tube',
  retort: 'A flask over a burner',
  gate: 'A gate leaf in its gateway',
  microscope: 'A microscope on its stand',
  hurdles: 'A run of hurdles across a yard',
  bed: 'A ward bed with a chart on the end',
  hoist: 'A two-post hoist holding a car up',
  plating: 'A plate with rivets round its edge',
  charge: 'A cone charge with a fuse in it',
  frontage: 'A row of shop fronts with their doors',
  can: 'A fuel can with a spout',
  pressure_plate: 'A board on a plunger, in section',
  buried_shell: 'A round under the ground, wired',
  collapse: 'A building coming down',

  // ------------------------------------------------------------------------- machinery and fittings
  bore: 'A rifled bore in section',
  piston: 'A piston pair at full stroke',
  gear_train: 'Two meshed wheels',
  swashplate: 'A swashplate with its linkages',
  horn: 'A horn speaker in section, throat to mouth',
  turbine: 'A turbine wheel in its case',
  shaft: 'A shaft on spaced bearings',
  coil: 'Windings on a former',
  circuit: 'A trace running between two pads',
  cable_run: 'A cable bundle with numbered taps',
  manifold: 'A block with two circuits through it',
  governor: 'A speed linkage with its stops',
  winch: 'A drum with a cable and a pawl',
  engine: 'An engine opened across the sheet',
  mount: 'A bracket receiving a part, with its load path',
  optics: 'A lens stack in its housing',
  burner: 'A burner head with the flame path on it',
  spring: 'A coil spring with its spacers',
  press: 'A press with tooling under it',
  belt: 'A conveyor with hands over it',
  crane: 'A gantry crane on its footings',
  hopper: 'A hopper feeding a chute',
  column: 'A packed column in section',
  vessel: 'A drum with a level line and a tap',
  core_vessel: 'A vessel with a core and shielding',
  loop: 'A pipe loop off a tank',
  flue: 'A flue with one bend, in section',
  hood: 'An extraction hood and its duct',
  plough: 'A plough blade on its frame',
  tools: 'A tool board with the tools outlined',

  // --------------------------------------------------------------------------- structure and fabric
  frame: 'A frame with its members numbered',
  mast: 'A mast on its guys',
  rack: 'Racking with its shelves loaded',
  bunk: 'Bunks three high',
  seat: 'A bench seat across a body',
  door: 'A door leaf with its swing',
  board: 'A project ruled into columns',
  weave: 'A woven grid, close up',
  net: 'A net with a fringe on it',
  pattern: 'Panels flattened out to cut',
  cut_list: 'A sheet marked up with cut lines',
  boot: 'A boot sole in layers',
  strap: 'A strap over its anchor',
  braid: 'Strands braided into one',
  lace: 'Lacing through an eyelet run',
  bolts: 'A bolt pattern on a bracket',
  mould: 'A casting mould in two halves',
  fuse: 'A coil of cord, lit',
  shell: 'A round with a crack down it',
  key: 'Key blanks with their cuts',
  knot: 'One knot, drawn large',

  // ------------------------------------------------------------------------ bodies, and what is on one
  figure: 'A body in elevation on a ground line',
  face: 'A face in three views',
  mirrored_pair: 'One part drawn twice and mirrored',
  footprints: 'Footprints on a numbered grid',
  speaker: 'A speaker cavity in section',
  ballast: 'A weight hung on a cable',
  balance: 'A beam on a fulcrum with a pan',
  mortar_pestle: 'A mortar and pestle',

  // ------------------------------------------------------------------------------ what a drawing is
  plan: 'A room from above, with a door swing',
  elevation: 'A boxed elevation with a centre line',
  section: 'A cut through something, hatched',
  exploded: 'Parts pulled apart along one axis',
  dimension: 'A dimension run with its witness lines',
  line_run: 'A line anchored at both ends, with slack',
  table: 'A ruled table with figures in it',
  card: 'A ruled card, figures on it, one row struck out',
  chart: 'A curve plotted on two axes',
  list: 'Numbered items down a sheet',
  prose: 'Lines of handwriting, and no drawing',
} as const satisfies Record<string, string>;

export type BlueprintMotif = keyof typeof BLUEPRINT_MOTIFS;

/** Every motif id, in the order they are written above. */
export const BLUEPRINT_MOTIF_IDS = Object.keys(BLUEPRINT_MOTIFS) as readonly BlueprintMotif[];

/** Whether a string names a motif. For the tests and for anything reading a stored id. */
export function isBlueprintMotif(value: string): value is BlueprintMotif {
  return value in BLUEPRINT_MOTIFS;
}
