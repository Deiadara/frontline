/**
 * The prose half of the art pipeline: the shared style anchor, the shared negative prompt, the
 * per-class framing blocks and the per-asset subject blocks.
 *
 * Every string here is transcribed from `docs/ART-PROMPTS.md` and is the **only** copy: neither
 * the manifest nor `scripts/gen-art.ts` may restate or paraphrase one. Whitespace is collapsed so
 * the hard wrapping in the doc (and in this file) never reaches a backend.
 */
import type { VehicleId } from '../building/index.js';
import type { DistrictKind, LocationKind } from '../city/index.js';
import type { OverseerArchetype } from '../overseer.js';
import type { ResourceKey } from '../resources.js';

/** Collapses authoring whitespace into a single-line prose block. */
const block = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** ART-PROMPTS §0.1: prepended verbatim to every prompt. */
export const STYLE_ANCHOR = block(`
  Hand-painted digital illustration in the style of Arcane (Fortiche): painterly oil-and-gouache
  brushwork over solid draughtsmanship, between stylised and photoreal, never cel-shaded, never
  vector-flat. A Zaun-like undercity: cyberpunk machinery bolted onto a broken-down post-war
  society, never a clean future. Scrap and salvage are the building material: corrugated iron,
  patched brick, mismatched timber, cannibalised plating, jury-rigged pipework and cabling slung
  between structures nobody planned. Old, wrecked and newly-bolted-on machines stand side by side;
  nothing matches, nothing is finished, much of it is still broken. Split lighting: cold cyan key
  light (#22d3ee) from upper-left at 35 degrees, weak warm sodium bounce (#f59e0b) from lower-right
  at 40 percent intensity; shadows tinted, never neutral grey. Desaturated structural midtones in
  slate and ferrite (#1e293b, #475569, #94a3b8) against deep blue-black (#0a0e17, #05070d) and
  drifting smog (#3d4761, #55617e); saturation reserved for emissives only. Broken rim light along
  40-60 percent of the contour, two ramp stops brighter than the edge it runs along. Lost-and-found
  edges: crisp at the focal point, dissolving into atmospheric haze at depth. Visible brush
  economy: detail concentrated in the focal twenty percent, broad confident strokes elsewhere.
  Every surface shows wear, repair or decay; rust, soot, water-staining and improvised patching are
  the default finish and polished chrome is not. Emissives painted at their own hue rather than
  white-hot: sodium bulbs, cracked signage, exposed filament, lit unevenly with whole sections
  gone dark. Cinematic, moody, beautiful and quietly haunting.
`);

/** ART-PROMPTS §0.2: applied to every prompt. */
export const NEGATIVE = block(`
  watermark, signature, ui overlay, hud, frame, border, caption,
  flat vector art, cel shading, hard black outlines, comic book inking, anime linework, clip art,
  3d render, octane render, unreal engine screenshot, cgi plastic, clay render, low poly,
  photograph, photorealistic skin pores, stock photo,
  oversaturated neon soup, rainbow lighting, every surface glowing, hdr bloom baked in,
  lens flare, chromatic aberration, film grain, vignette, jpeg artifacts, noise overlay,
  pure black #000000, pure white #ffffff, blown highlights, crushed blacks,
  symmetrical, tidy, pristine, brand new, corporate stock illustration, empty sterile plaza,
  clean chrome futurism, polished chrome, gleaming glass skyscrapers, curtain-wall towers,
  utopian sci-fi metropolis, showroom finish, orderly planned street grid, intact undamaged city,
  flat even lighting, single neutral light source, grey shadows,
  uniform detail, busy cluttered composition without focal point, three equal masses,
  extra limbs, deformed hands, mangled anatomy, duplicated faces, blurry, out of focus, lowres
`);

/** ART-PROMPTS §0.3: the settings a backend adapter applies to every request. */
export const GENERATION_SETTINGS = {
  /** FLUX guidance. gpt-image-1 has no CFG knob and uses `quality: 'high'` instead. */
  guidanceScale: 4.5,
  steps: 40,
} as const;

/** Per-class framing, appended after the subject. ART-PROMPTS §1-§6. */
export const FRAMING = {
  portrait: block(`
    Head-and-shoulders portrait, three-quarter view, eyes on the upper-third line, subject facing
    slightly left into the key light. Shallow implied depth: background is an out-of-focus city
    interior reduced to smog and two or three emissive smears. Vertical 3:4 composition. Face within
    the central seventy percent; nothing essential in the bottom eighteen percent.
  `),
  district: block(`
    Oblique three-quarter aerial view looking down at roughly 40 degrees, horizon at forty percent
    height. Square 1:1 composition, focal subject within the central eighty percent. One dominant
    mass, two or three secondary forms, a scatter of small interrupts: antennae, cables, signage,
    laundry lines. Something breaks the frame edge. Human-scale markers visible: doorways, walkways,
    a figure, a parked vehicle. Atmospheric perspective: every quarter of the depth shifts twenty
    percent toward #3d4761 and loses fifteen percent contrast.
  `),
  plate: block(`
    Wide 16:9 cinematic composition, high oblique view at roughly 35 degrees. Rendered
    as a single continuous painted illustration, not a tiled texture. No focal subject. This is a
    stage, and the readable action sits on top of it.
  `),
  building: block(`
    Single isolated structure on a fully transparent background, three-quarter oblique view from
    slightly above, consistent 35-degree camera across all thirteen so they sit together on one
    ground plane. Ground contact in the bottom-centre twenty percent. No cast shadow, no ground, no
    base plate: the renderer adds those. Square 1:1. Silhouette must be distinguishable from the
    other twelve at twenty-five percent scale filled solid black.
  `),
  ui: block(`
    Game UI element on transparent background, painted rather than vector: hammered and etched
    metal plate with wear at the corners and edges, subtly asymmetric so it does not read as a
    template. Square 1:1, 1024px. The outer 96 pixels are the 9-slice corner and edge region; the
    inner region must be a flat, quiet, tileable field with no detail. Absolutely no text, no
    glyphs, no numerals. Cold #22d3ee key catching the top and left bevels, warm #f59e0b bounce on
    the bottom and right.
  `),
  icon: block(`
    Single centred icon on a fully transparent background, painted with visible brushwork but
    radically simplified. It must read cleanly at 24 pixels. Maximum two values plus one accent
    hue. No text, no outline stroke, no drop shadow, no background plate. Square 1:1, subject
    filling the central seventy percent. Consistent implied light from upper-left across the whole
    set.
  `),
  /**
   * §C1: a machine, painted whole, the way the Garage draws it.
   *
   * Not the icon framing beside it. A vehicle card shows one picture at card width, so what it
   * wants is a portrait of the machine with its own ground under it, not a two-value silhouette
   * keyed to transparency and legible at 24 pixels.
   */
  vehicle: block(`
    A single machine in three-quarter view, side-on to slightly front, standing still on wet
    ground in a workshop or a yard. Painted whole, with its own shallow background: the room is
    light and grime rather than architecture. Square 1:1, the machine filling the central seventy
    percent, wheels or skids on the ground line. Consistent implied light from upper-left. Salvage
    build throughout, welds and mismatched panels visible, one cool accent light on the
    machine itself. No people, no text, no logos.
  `),
  officer: block(`
    Head-and-shoulders portrait, three-quarter view, eyes on the upper-third line, the subject
    looking at or just past the viewer. Painted on a shallow, unreadable interior: the room is
    light and colour rather than architecture. Vertical 4:5 composition, face within the central
    seventy percent. One person, no insignia the player has not earned, no text. These are the
    people a crew hires, so they read as *people*: ordinary faces, worn clothes, an age range and a
    range of builds, and expressions that are doing something other than posing.
  `),
  unit: block(`
    Half-length figure study of one representative fighter, three-quarter view, weight on the back
    foot, weapon or tool held rather than posed with. Vertical 3:4 composition, head in the upper
    quarter, cropped mid-thigh. Painted on an abstracted plaster-and-soot ground with no readable
    architecture: the card behind it carries the information, so the frame must stay quiet.
    Unhelmeted or visor-up wherever the unit's own description allows it, so the roster reads as
    people. No group shots, no insignia the player has not earned, no text.
  `),
} as const;

/**
 * ART-PROMPTS §1b: the officer pool, keyed by `OFFICER_PORTRAIT_IDS`.
 *
 * A hundred and sixty-four faces the crew's officers are drawn from. Written as descriptions of
 * paintings that already exist rather than as directions for ones that do not: the maintainer delivered
 * these, and what these lines are for is the record of *which* painting each key is, so a re-encode
 * or a re-order can be checked against something.
 *
 * One shared instruction runs under all of them (`FRAMING.officer`); each line here is only what
 * makes that face different from the other hundred and sixty-three.
 *
 * `34` to `43` were delivered later, off the ten administrative portraits sitting unused in the
 * inbox. Appended rather than filed among the others: `officerPortraitId` indexes
 * `OFFICER_PORTRAIT_IDS` by hash, so inserting in the middle would move every face after it onto a
 * different officer.
 *
 * `100` to `139` are the maintainer's 2026-09-11 drop (`images/officers/resident-156-*` through
 * `resident-195-*`), appended for the same reason and in resident order, so `resident-156` is
 * `officer-100` and `resident-195` is `officer-139`. Each is named by the trade the maintainer painted
 * them at, because that is what the filename records and it is the one thing about the picture
 * that cannot be read off the face.
 *
 * `140` to `164` are the 2026-09-15 drop, appended in `character-196-*` to `character-235-*` file
 * order with fifteen of that block held back: those fifteen and the fifteen `leader-*` paintings
 * went to {@link PORTRAIT_SUBJECTS} as the overseer's own thirty faces, and a face on that list is
 * never on this one. The same drop's `resident-*` files are not here twice; they are already
 * `100` to `139`, which is what the signature sweep in `roles.ts` found when it was re-run.
 */
export const OFFICER_SUBJECTS: Readonly<Record<string, string>> = {
  '01': block(`
    A woman in her forties, dark hair cropped close, faint knowing smile, in a cramped office wall
    of clocks and paper behind her under violet light.
  `),
  '02': block(`
    A man in his forties with a heavy moustache and a worn leather coat, standing in a doorway with
    red sign-light on the wet street behind him.
  `),
  '03': block(`
    A young woman with a blunt black bob and a high-collared coat, unsmiling, cold blue harbour
    lights and moored hulls out of focus behind her.
  `),
  '04': block(`
    A heavy-set bald man in his sixties with a close grey beard, in a lamplit workshop with a brass
    fitting and a hanging cable behind his shoulder.
  `),
  '05': block(`
    A woman in her thirties with long locs pulled back, half smiling, teal and magenta signage
    smeared out of focus behind her.
  `),
  '06': block(`
    A young woman with a black fringed bob and a buttoned uniform collar, expression flat and
    unimpressed, deep blue night behind.
  `),
  '07': block(`
    A man in his fifties, grey-streaked curls and a short beard, laughing, backlit by the teal glow
    of a bar's bottle shelf.
  `),
  '08': block(`
    A wiry man standing small in a wide green-lit alley of stacked machinery, coat too big for him,
    the city crowding in over his head.
  `),
  '09': block(`
    A woman in her sixties, white hair cropped short, a heavy brown coat beaded with rain, standing
    on a street at dusk with figures behind her.
  `),
  '10': block(`
    A man in his forties, fair hair going grey, grinning, in a room whose walls are lit green by
    banks of screens.
  `),
  '11': block(`
    An older woman in spectacles bent over a desk of papers under a single lamp, glancing up, the
    room dark behind her.
  `),
  '12': block(`
    A woman with dark red hair pinned up and a scarred jaw, looking off frame, hard red light on one
    side of her face.
  `),
  '13': block(`
    A woman in her thirties with cropped platinum hair, smiling, a cyan console glow washing across
    her from below.
  `),
  '14': block(`
    A man in his fifties with a dark eyepatch and a heavy coat, seated beside an oil lamp in a
    violet-lit archive.
  `),
  '15': block(`
    A big man in his sixties, grey beard, head back mid-laugh, in front of a wall papered over many
    times with notices.
  `),
  '16': block(`
    A man in his sixties with swept grey hair and a long coat, expression closed, a grey harbour and
    a hailer horn behind him.
  `),
  '17': block(`
    A young man with dark curls and an eye-badged collar, half smiling, pink neon lettering out of
    focus over his shoulder.
  `),
  '18': block(`
    A bald man in his fifties in a dark coat with a green medical cross at the breast, standing
    square, a dim ward behind him.
  `),
  '19': block(`
    A woman in her sixties with a blonde bob and a severe set to her mouth, in a vaulted hall lit
    warm from one side.
  `),
  '20': block(`
    A young man with untidy brown hair and an open face, violet and pink city light behind him.
  `),
  '21': block(`
    A woman in her forties with dark hair pinned up and a badged uniform, standing before a wall of
    pigeonholes and ledgers.
  `),
  '22': block(`
    A heavy man in his fifties with a curled moustache, beaming, in a covered market of lanterns
    with a set of brass scales hanging beside him.
  `),
  '23': block(`
    A bald man in his forties with heavy stubble and a canvas jacket, teal water and lights behind
    him.
  `),
  '24': block(`
    A man in his sixties, white hair swept back, deep-set eyes, a great clock face and warm lamps
    behind him.
  `),
  '25': block(`
    A man in his thirties with dark curls and a tired, patient expression, green industrial light
    behind him.
  `),
  '26': block(`
    A man in his fifties with a greying beard and a worn coat, blue-lit shelving stacked behind him.
  `),
  '27': block(`
    A man in his thirties with a thin moustache and an open collar, faintly amused, hanging lanterns
    behind him.
  `),
  '28': block(`
    A man in his forties with a black beard and a red-lined coat, unsmiling, green light on the wall
    behind.
  `),
  '29': block(`
    An elegant man in his sixties, white hair and a trimmed moustache, high collar, violet gloom
    behind him.
  `),
  '30': block(`
    A man in his thirties with dark curls, grinning, a strapped work harness across his chest and
    teal lanterns behind him.
  `),
  '31': block(`
    A man in his fifties with a grey beard and a fur-collared coat, warm lamplight on one cheek.
  `),
  '32': block(`
    A thin man with round spectacles and a stained work apron, standing in a cluttered workshop.
  `),
  '33': block(`
    A woman in her forties with dark hair tied up and a scarf at her throat, an apron over her
    clothes, violet light behind her.
  `),
  '34': block(`
    A woman in her forties with dark curly hair pinned back, looking off to one side, in a lamplit
    logistics office: a wall of routing charts, a hanging bulb, a pressure gauge, rank bars on the
    shoulder of a dark coat.
  `),
  '35': block(`
    A man with a close-cropped grey beard in a heavy supply-issue coat, standing among stacked
    crates under a single warm lamp, cold green light off a ledger screen behind him.
  `),
  '36': block(`
    A younger woman with dark hair and a headset collar, half-lit by the amber glow of a radio set,
    patch cables and a valve rack out of focus behind her shoulder.
  `),
  '37': block(`
    A woman in her fifties with a black bob and a high-collared burgundy coat over a white shirt,
    unsmiling, a wall of card-index drawers and a green banker's lamp behind her.
  `),
  '38': block(`
    A man in his forties in shirtsleeves and a canvas apron, sleeves rolled, a drawing board and a
    theodolite behind him under a work lamp.
  `),
  '39': block(`
    A broad man in his fifties with a shaved head and a quartermaster's tabard, standing at a issue
    counter with tallies chalked on the board behind him.
  `),
  '40': block(`
    A woman in her thirties in a medical coat with the collar turned up, a trolley of instruments
    and a curtained bay behind her in cold clinical light.
  `),
  '41': block(`
    An older man with wire spectacles and a cardigan under a coat, standing between two tall shelves
    of bound records, dust in the lamp beam.
  `),
  '42': block(`
    A man in his forties in a checkpoint greatcoat with a whistle on a cord, a striped barrier and a
    guard hut light behind him in the rain.
  `),
  '43': block(`
    A woman in her thirties with her hair covered, a clipboard held against her chest, a queue of
    figures and a chain-link fence out of focus behind her.
  `),
  '44': block(`
    A woman in her forties with dark curls pinned up, layered work coat, a wall of ledgers and files behind her.
  `),
  '45': block(`
    A bald man in his sixties with a heavy jaw and a red-brown work jacket, a lit machine shop behind him.
  `),
  '46': block(`
    A woman in her sixties with silver curls and a deep red coat, warm lamplight on brass fittings behind her.
  `),
  '47': block(`
    A man in his fifties with slicked hair and a moustache, high collar, green bottle-lamps down the wall behind.
  `),
  '48': block(`
    A woman in her sixties with close-cropped grey hair in a braided dark uniform, violet machine light behind.
  `),
  '49': block(`
    A pale woman in her fifties with short platinum hair, a red coat over a check shirt, dim workshop behind.
  `),
  '50': block(`
    A thin smiling man in his fifties with receding red hair, waistcoat and tie, warm interior light.
  `),
  '51': block(`
    A woman in her sixties with a grey bob and a dark collar, a neon window on the wet street behind her.
  `),
  '52': block(`
    A bald man in his sixties with a grey beard and a green work jacket, teal machine light behind him.
  `),
  '53': block(`
    A man in his sixties with a grey beard, mustard coat over blue, a dim corridor behind.
  `),
  '54': block(`
    A young woman with a black bob and a dark jacket, standing in a lamplit alley.
  `),
  '55': block(`
    A man in his seventies with a white beard and a heavy dark coat, grey daylight behind him.
  `),
  '56': block(`
    A thin pale man in his forties with sparse hair and a grey coat, standing in a doorway.
  `),
  '57': block(`
    A woman in her thirties with dark curls and an oxblood leather jacket, warm street light behind.
  `),
  '58': block(`
    A woman in her fifties with grey curls and a brown coat, violet dusk over the rooftops behind her.
  `),
  '59': block(`
    A young man with black hair and a blue work coat, a rain-slick bridge behind him.
  `),
  '60': block(`
    A woman in her fifties with grey hair tied back, plain coat, a street of shutters behind her.
  `),
  '61': block(`
    A man in his fifties with a lined face and a green coat, heavy pipework behind him.
  `),
  '62': block(`
    A man in his seventies with white hair and a brown coat, a quiet pale interior behind him.
  `),
  '63': block(`
    A woman in her thirties with dark hair pinned up and a red-brown coat, chimneys and smoke behind.
  `),
  '64': block(`
    A young man with dark hair and a teal-lined coat, a dim brick passage behind him.
  `),
  '65': block(`
    A woman in her forties with dark curls and a plum scarf, a lit doorway on a night street behind.
  `),
  '66': block(`
    A young man with dark curls and a heavy coat, a rusted stairwell behind him.
  `),
  '67': block(`
    A woman in her fifties with short grey hair and a work coat, blue-lit machinery behind her.
  `),
  '68': block(`
    A man in his fifties with a grey beard and an open collar, bunting over a night street behind him.
  `),
  '69': block(`
    A woman in her forties with dark curls and a brown coat, a weathered wall behind her.
  `),
  '70': block(`
    A young man with short fair hair and a dark coat, a pale courtyard behind him.
  `),
  '71': block(`
    A woman in her thirties with cropped blonde hair and a heavy coat, a bright empty street behind.
  `),
  '72': block(`
    A woman in her forties with dark hair and a brown coat, a canal and a bridge behind her.
  `),
  '73': block(`
    A man in his thirties with a red beard and a heavy coat, a waterway and stonework behind him.
  `),
  '74': block(`
    A man in his forties with dark hair and a moustache, worn jacket, lamplit alley behind him.
  `),
  '75': block(`
    A woman in her forties with fair hair loose, a leather coat, hanging lanterns behind her.
  `),
  '76': block(`
    A man in his forties with dark hair, collar turned up, a narrow lamplit street behind him.
  `),
  '77': block(`
    A woman in her forties with dark curly hair and a long coat, iron railings behind her.
  `),
  '78': block(`
    A man in his forties with short fair hair and a grey coat, a wet street at dusk behind him.
  `),
  '79': block(`
    A woman in her thirties with dark cropped hair and an open coat, pale stone behind her.
  `),
  '80': block(`
    A man in his thirties with short dark hair, shirt and tie under a coat, a dim street behind.
  `),
  '81': block(`
    A man in his fifties with long dark hair and a worn coat, a lamplit lane behind him.
  `),
  '82': block(`
    A woman in her thirties with a dark bob and a work jacket, a stairwell and a lantern behind her.
  `),
  '83': block(`
    A man in his forties with dark hair and a moustache, heavy coat, green-lit alley behind him.
  `),
  '84': block(`
    A person in their thirties with short dark hair and a plain coat, a shuttered street behind them.
  `),
  '85': block(`
    A woman in her thirties with dark wavy hair and a strapped coat, a stone wall behind her.
  `),
  '86': block(`
    A man in his forties with short dark hair and a brown collar, a dim room behind him.
  `),
  '87': block(`
    A man in his forties with black hair and a heavy coat, a lit shopfront behind him.
  `),
  '88': block(`
    A woman in her forties with a long dark braid and a high collar, a bare interior behind her.
  `),
  '89': block(`
    A bald man in his fifties with facial implants and a purple coat, teal machine light behind him.
  `),
  '90': block(`
    A thin man in his thirties with red hair and a buttoned coat, a grey overpass behind him.
  `),
  '91': block(`
    A woman in her forties with dark curls and a red coat with a crest, warm lamps behind her.
  `),
  '92': block(`
    A man in his fifties with fair hair and a tan coat, a green glass dome behind him.
  `),
  '93': block(`
    A gaunt man in his forties with a green coat and a crest, a pale crowded street behind him.
  `),
  '94': block(`
    A woman in her sixties with long grey hair, a yellow coat and a blue scarf, a bright street behind.
  `),
  '95': block(`
    A woman in her thirties with red hair and a dark red coat with a crest, lit shelves behind her.
  `),
  '96': block(`
    A man in his forties with a beard and a patched brown coat, a lamplit quay behind him.
  `),
  '97': block(`
    A heavy-set man in his sixties in a blue coat and red tie, a grey waterfront behind him.
  `),
  '98': block(`
    A man in his thirties with short black hair and a dark leather coat, a dim interior behind him.
  `),
  '99': block(`
    A young woman with cropped fair hair and a pale lilac coat, a bleached-out street behind her.
  `),
  '100': block(`
    An apothecary's clerk in her forties, dark hair cut short with a red streak, a purple coat
    over a green work apron, shelves of glass herb jars and a copper still behind her.
  `),
  '101': block(`
    A lift mechanic in his sixties, grey beard under a flat cap, an oil-soaked leather apron,
    hoist chains and a lit cage descending behind him.
  `),
  '102': block(`
    A message courier in their twenties, cropped black hair and an earpiece, a satchel strap
    across the chest, wet iron catwalks and green lamps behind.
  `),
  '103': block(`
    A bathhouse attendant in her fifties, a greying auburn braid over one shoulder, towels across
    her arm, steam and a tiled arch behind her.
  `),
  '104': block(`
    A pawnshop appraiser in his forties, black curls and a trimmed beard, a jeweller's loupe
    pushed up on his brow, clocks and gilded cases behind him.
  `),
  '105': block(`
    A teahouse proprietor in her sixties, silver hair pinned up, a flowered jacket under a dark
    apron, brass urns, a red lantern and steam behind her.
  `),
  '106': block(`
    A ventilation inspector in his forties, dark curls shaved at the sides, a respirator hanging
    at his throat, a great fan and steaming ducts behind him.
  `),
  '107': block(`
    A tram conductor in her forties, short curls under a peaked cap, a brass-buttoned coat and a
    red scarf, a lit tram on wet rails behind her.
  `),
  '108': block(`
    A foundry bookkeeper in his seventies, bald with a white moustache, ledgers open across his
    desk, the furnace floor glowing orange behind him.
  `),
  '109': block(`
    A salvage-market broker in her forties, dark curls under a plum shawl, brass chains at her
    collar, a rainy arcade of lit stalls behind her.
  `),
  '110': block(`
    A neighbourhood baker in his forties, sandy hair and a short beard, flour over a canvas apron,
    grinning, loaves and an open oven behind him.
  `),
  '111': block(`
    A water-quality technician in her forties, short dark curls, a sample tube held up to the
    light, a green canal and a weir behind her.
  `),
  '112': block(`
    A radio repairer in his thirties, locs tied back under a headset, a bench of valve sets around
    him and a dusk skyline through the glass.
  `),
  '113': block(`
    A boarding-house keeper in her sixties, a grey braid and an embroidered shawl, a ring of keys
    at her belt, a lamplit corridor of doors behind her.
  `),
  '114': block(`
    A printshop compositor in her forties, head shaved, small inked marks on her cheek, type cases
    and a press behind her.
  `),
  '115': block(`
    A canal messenger in her twenties, black hair shaved at one side, freckles, a satchel on her
    back, wet steps and a canal under a pink sign behind.
  `),
  '116': block(`
    A boiler tender in his fifties, bald with a grizzled beard, a towel over one shoulder, a
    copper boiler with its firebox open behind him.
  `),
  '117': block(`
    A tailor in her fifties, fair hair pinned loose, a brass forearm on her right arm, a sewing
    machine and dress forms behind her.
  `),
  '118': block(`
    A dockside cook in his forties, black curls and a tattooed forearm over a stained apron, pots
    steaming and a misty wharf behind him.
  `),
  '119': block(`
    An oral historian in her seventies, silver braids and brass rings, a purple brocade robe, a
    lamplit room of photographs behind her.
  `),
  '120': block(`
    A transit trainee in her twenties, short natural curls, an orange and blue rain jacket with an
    ID card clipped to it, a tram and a lit route map behind.
  `),
  '121': block(`
    A drone-repair apprentice in his twenties, untidy brown hair and a magnifier over one eye,
    half-built drones and teal screens behind him.
  `),
  '122': block(`
    A hydroponics technician in her thirties, an undercut and a dark topknot, an oilcloth apron,
    glass grow-columns under violet lamps behind her.
  `),
  '123': block(`
    A night-market courier in her twenties, beaded braids and an earpiece, a red and yellow
    jacket, wet stalls and signage behind her.
  `),
  '124': block(`
    An energy monitor in his thirties, black curls and a short beard, a scarf at his throat,
    stacked cells and a lit charge readout behind him.
  `),
  '125': block(`
    A clinic intake worker in her thirties, a silver-white bob, a coat with a card clipped to it,
    lit cabinets and beds behind her.
  `),
  '126': block(`
    A projection scavenger in his twenties, short locs and a scavenged jacket, salvaged projectors
    throwing violet light across cracked glass behind him.
  `),
  '127': block(`
    A filtration mapper in her thirties, a long dark braid, a slate strapped to her chest, a
    flooded arcade of arches and cyan water behind her.
  `),
  '128': block(`
    A capsule-housing attendant in his twenties, fair hair and freckles, a yellow and grey jacket,
    a wall of berths and a lit floor plan behind him.
  `),
  '129': block(`
    A synthetic-fabric cutter in her thirties, head shaved, a plum scarf, looms of patterned cloth
    and jointed arms working behind her.
  `),
  '130': block(`
    A recycler sorter in his thirties, long wet hair and goggles at his throat, belts of sorted
    scrap and a lit crane claw behind him.
  `),
  '131': block(`
    A data-kiosk attendant in her twenties, red curls and a dark red waistcoat, a glass screen
    open on the counter, a pale hall behind her.
  `),
  '132': block(`
    An atmospheric-sensor maintainer in her twenties, braids and an undercut, a yellow-striped
    work coat, sensor masts and chimneys behind her.
  `),
  '133': block(`
    A ferry dispatcher in her thirties, dark curls tied back, half smiling, a chart screen at her
    elbow and a ferry on green water behind her.
  `),
  '134': block(`
    An archive digitiser in his thirties, shaved head and a canvas apron, stacked paper and a lit
    scanning case behind him.
  `),
  '135': block(`
    A battery tester in her thirties, dark curls and goggles at her collar, racks of glowing cells
    and a violet street behind her.
  `),
  '136': block(`
    A pump operator in his twenties, wet black hair, grinning in a work harness, a sluice pouring
    and a gantry behind him.
  `),
  '137': block(`
    A communications rigger in her thirties, long black curls shaved at one side, a dish behind
    her and magenta aerial diagrams at dusk.
  `),
  '138': block(`
    A machine-school tutor in his forties, round glasses and a work apron, a chalked machine
    diagram and benches of students behind him.
  `),
  '139': block(`
    A greenhouse worker in her twenties, a black fringe and a green scarf over a wet apron, rows
    of planting under warm lamps behind her.
  `),
  '140': block(`
    A tavern bookkeeper in her forties, dark curls and gold earrings, a leather apron over a red
    coat, bottles and a hanging lamp behind her.
  `),
  '141': block(`
    A neighbourhood mediator in his sixties, grey beard and a patterned blue robe, a folded blanket
    and a lit lantern on the shelf behind him.
  `),
  '142': block(`
    A junior civic officer in her twenties, cropped black hair and a grey work jacket, rusted filing
    cabinets in teal light behind her.
  `),
  '143': block(`
    A district council delegate in his fifties, silver hair and a pointed beard, a crimson-trimmed
    navy robe, a panelled chamber behind him.
  `),
  '144': block(`
    A printshop compositor with a shaved head and a maroon scarf, an ink-stained apron, the wheel of
    a hand press at her shoulder.
  `),
  '145': block(`
    A street food cook in his thirties, dark curls and a thin moustache, grinning in a smeared
    apron, a copper pot over a lit burner behind him.
  `),
  '146': block(`
    A utilities clerk in his forties, one eye clouded white, an olive coat over a loose tie, a brass
    standpipe behind him.
  `),
  '147': block(`
    A radio apprentice in his twenties, tousled blond hair and freckles, a scavenged headset at his
    neck, a green trace on a scope behind him.
  `),
  '148': block(`
    A residents' council elder in his seventies, white curls and beard, a blue shawl over an open
    shirt, a cracked marble wall behind him.
  `),
  '149': block(`
    A mechanical archivist in his forties, bald and black-bearded, a brass instrument on its stand
    at his elbow, shelves of ledgers behind him.
  `),
  '150': block(`
    A kitchen volunteer in his twenties, broad-shouldered in a stained apron with a towel over one
    shoulder, a steaming pot on green tiles behind him.
  `),
  '151': block(`
    A bar owner in his fifties, bald with a grey beard, a red brocade waistcoat over rolled sleeves,
    a violet lamp and bottles behind him.
  `),
  '152': block(`
    A maintenance courier in her thirties, locs tied back under safety glasses, a harness of tools,
    a blue strip light on a steel door behind her.
  `),
  '153': block(`
    A district oral historian in his seventies, white hair and a wispy beard, a green patterned
    robe, faded wallpaper and a framed print behind him.
  `),
  '154': block(`
    A logistics chief in his fifties, grey hair and a heavy leather coat over a blue scarf, stacked
    shelving and rolled cloth behind him.
  `),
  '155': block(`
    A delegate in his forties, grey-black curls and a full beard, a blue coat over a rust waistcoat
    with a brass badge, bare plaster behind him.
  `),
  '156': block(`
    A tram clerk in his forties, a thin moustache and a navy uniform coat with a service medallion,
    an amber lamp on a wet street behind him.
  `),
  '157': block(`
    A surveyor in her twenties, fair hair pinned up and freckles, a yellow-collared work coat,
    painted pipework and peeling steel behind her.
  `),
  '158': block(`
    An arbitrator in his sixties, white hair and moustache, a dark red coat over a scarlet scarf,
    panelled wood behind him.
  `),
  '159': block(`
    A waterworks inspector in his twenties, fair hair and a scar at his lip, a blue work coat, a
    pressure gauge and standpipes behind him.
  `),
  '160': block(`
    An archive magistrate in his fifties, round glasses and thinning hair, a grey coat, a wall of
    card-index drawers under a green lamp behind him.
  `),
  '161': block(`
    A night supervisor in his fifties, grey beard and a dark knitted collar, a riveted iron door and
    one amber lamp behind him.
  `),
  '162': block(`
    A grid coordinator in his thirties, brown hair and a grey scarf over a work coat, a blue
    indicator light on a ribbed wall behind him.
  `),
  '163': block(`
    A health inspector in his fifties, a dark moustache and a teal coat with a brass medallion,
    white tiling and a brass pipe behind him.
  `),
  '164': block(`
    An assembly elder in his seventies, a white moustache and a red-brown coat over a dark red
    scarf, a lantern and a heavy curtain behind him.
  `),
};

/**
 * ART-PROMPTS §1: keyed by `OverseerPreset.portraitId`, which is also what the client passes to
 * `deliveredUrl({ type: 'portrait', portraitId })`.
 *
 * Two generations in one table. `overseer-1` to `overseer-4` are the original four heroes, written
 * as directions for paintings that did not exist yet, down to the hex values the light was to be
 * mixed from. `overseer-01` to `overseer-30` are {@link OVERSEER_PORTRAIT_IDS}, the maintainer's
 * 2026-09-15 drop, and they are written the way {@link OFFICER_SUBJECTS} is: as the record of
 * *which* painting each key is, so a re-encode or a re-order can be checked against something.
 * The zero padding is the whole of what keeps the two sets apart, so do not drop it.
 */
export const PORTRAIT_SUBJECTS: Readonly<Record<string, string>> = {
  'overseer-1': block(`
    A broad-shouldered man in his early fifties, ex-corporate security chief turned warlord.
    Shaved head, heavy jaw, a healed burn scar climbing the left side of his neck into a grey-flecked
    stubble beard. Skin in warm ochre midtones (#8f5744, #5a352c) against the cold key. Scuffed matte
    riot armour over a high collar, chest plate cracked and field-welded, unit insignia sanded off.
    One dead eye replaced by a scratched steel ocular that catches the cyan key as a hard specular
    point. Expression: flat, patient, unimpressed: a man who has already decided. Amber #f59e0b
    bounce from below rakes the underside of his jaw and armour ridges. Behind him, a barricade line
    dissolving into smog.
  `),
  'overseer-01': block(`
    A man in his fifties, dark grey-streaked waves and a red-lined black coat, half smiling, the
    tiered green benches of an assembly chamber lit by desk lamps behind him.
  `),
  'overseer-02': block(`
    A gaunt man in his fifties, slicked grey-black hair and a deep red coat over navy, unsmiling, a
    tall cracked committee-room window behind him.
  `),
  'overseer-03': block(`
    A heavy-jawed man in his fifties, close grey hair and a black high-collared coat, a scaffolded
    plenary hall and one amber lamp behind him.
  `),
  'overseer-04': block(`
    A man in his fifties with grey curls and a grey-green jacket, the white colonnade of a rotunda
    in cold daylight behind him.
  `),
  'overseer-05': block(`
    A man in his fifties, hair receding at the temples, a navy tunic with copper piping, the red-
    brown tiers of an archive gallery behind him.
  `),
  'overseer-06': block(`
    A fair-haired man in his fifties with a faint smile and a green coat, the glazed dome and book
    stacks of a parliamentary library behind him.
  `),
  'overseer-07': block(`
    A man in his fifties, grey waves and a teal coat over a dark stock, a gilded assembly corridor
    with a hanging lantern behind him.
  `),
  'overseer-08': block(`
    A man in his fifties with dark hair, a moustache and a short beard, a plum coat over a red
    scarf, an unlit debating floor behind him.
  `),
  'overseer-09': block(`
    A tall pale man in his fifties, fair grey hair and a black coat with a rust sash, the steel and
    glass of a rebuilt chamber behind him.
  `),
  'overseer-10': block(`
    A man in his fifties with silver hair and a high-collared dark tunic, faintly amused, rows of
    blue benches in pale northern light behind him.
  `),
  'overseer-11': block(`
    A man in his fifties with black curls and a purple brocade coat, a red and gold constitutional
    chamber behind him.
  `),
  'overseer-12': block(`
    A man in his sixties, grey hair and a teal coat lined in rust, a stone parliamentary balcony
    over an empty floor behind him.
  `),
  'overseer-13': block(`
    A man in his fifties, grey-brown hair and a plain navy coat, the lamplit tiers of a restored
    congress hall behind him.
  `),
  'overseer-14': block(`
    A bearded man in his fifties in an olive coat over a dark red waistcoat, half smiling, a gilded
    federal committee room behind him.
  `),
  'overseer-15': block(`
    A lean man in his fifties, close silver hair and a black coat over a high white collar, rows of
    desk consoles under pale windows behind him.
  `),
  'overseer-16': block(`
    A woman in her sixties, grey hair pinned up, a heavy coat with a service disc and a red scarf,
    rain and a red signal lamp behind her.
  `),
  'overseer-17': block(`
    A woman in her fifties in a blue headwrap and a denim apron over a work coat, a shelter's crates
    and hanging canvas behind her.
  `),
  'overseer-18': block(`
    A woman in her thirties, dark curls over a shaved side, a scarf and a brass dispatcher's disc,
    green canal water under an arch behind her.
  `),
  'overseer-19': block(`
    A woman in her forties with a wine-dark birthmark across one cheek, a red and green robe over a
    stethoscope, a clinic's glass cabinet behind her.
  `),
  'overseer-20': block(`
    A woman in her thirties with cropped red hair and a red tie under a green coat, a ledger under
    her arm, a leaded window behind her.
  `),
  'overseer-21': block(`
    A woman in her sixties, a long grey-streaked braid and a red shawl over an embroidered coat, a
    brass desk lamp and papers behind her.
  `),
  'overseer-22': block(`
    A woman in her forties with a dark curly bob, a crimson coat over a green waistcoat, a brass
    lamp and a records desk behind her.
  `),
  'overseer-23': block(`
    A woman in her forties with a black pixie cut and a red cravat under a dark coat, a rain-
    streaked window and a brass bell behind her.
  `),
  'overseer-24': block(`
    A woman in her fifties, red hair going grey, a green coat over an apron, unsmiling, bottles and
    a panelled bar behind her.
  `),
  'overseer-25': block(`
    A woman in her forties, dark hair pinned up, a dark red coat with a brass brooch, the tiled
    shelves of a clinic behind her.
  `),
  'overseer-26': block(`
    A woman in her fifties, dark hair loose, a purple scarf over a leather apron, a stacked ration
    crate behind her.
  `),
  'overseer-27': block(`
    A woman in her forties with dark curls and a green-blue coat, a harbour at night with lit towers
    behind her.
  `),
  'overseer-28': block(`
    A woman in her forties, red curls and a purple scarf under a green vest, a patterned wall of
    pinned notices behind her.
  `),
  'overseer-29': block(`
    A woman in her fifties, silver hair pinned up, a black embroidered jacket over a white ruffled
    collar, a stone arch behind her.
  `),
  'overseer-30': block(`
    A woman in her twenties, fair bobbed hair and a black coat with a shoulder radio, a lit transit
    diagram behind her.
  `),
};

/** ART-PROMPTS §2: keyed by `District.id`. */
export const DISTRICT_SUBJECTS: Readonly<Record<string, string>> = {
  'neon-docks': block(`
    A working freight dock built into a flooded canal trench under a raised motorway. Stacked
    container housing welded into terraces, corrugated shutters, a gantry crane leaning past its safe
    angle. Black water below throwing vertical smeared cyan #22d3ee reflections from a wall of hanging
    shop signs. Washing lines strung between containers. This is home: worn, cramped, defended, warm
    with life at the small scale even as the structure fails. One tug boat moored, one figure on the
    quay.
  `),
  'ashen-terraces': block(`
    A hillside of stepped concrete tenements under a permanent fall of pale ash, terraces
    planted with dead and dying greenery. Amber #f59e0b sodium lamps burning through the ashfall in
    soft haloes; laundry grey with fallout. Retaining walls buttressed with scavenged steel. A
    funicular track climbs the slope. Quiet, elegiac, almost beautiful: a place that used to be
    desirable. Two figures on separate terraces, not looking at each other.
  `),
  rustyard: block(`
    A ship-breaking yard of beached hulls half-dismantled in orange mud, ribs of vessels
    standing like cathedral vaulting. Cutting torches throwing small hot #ffd166 pools against the
    enormous cold mass of the hulls. Slag heaps, chained dogs, a crane made from three other cranes.
    Rust in every value from #4a2a05 to #c47c0d. Scale enforced by tiny figures walking a hull's spine.
  `),
  'chrome-row': block(`
    A narrow canyon street of clinic frontages and body-modification parlours, every window a
    cold #22d3ee vitrine glowing into wet asphalt. Overhead a dense mat of cabling and cantilevered
    signage boards blocks the sky. Queues under awnings. Chrome and glass are the dominant materials
    and they are all scratched, taped and patched. Vertical smeared reflections down the whole street.
    Predatory, clinical, expensive.
  `),
  undergrid: block(`
    A vast subterranean utility cavern below the city: the old power grid, still live.
    Bundled conduit running the walls like roots, transformer housings the size of buildings, standing
    water skinned with iridescent chemical film. The only light is toxic green #43b56e leaking from
    coolant seams and inspection ports, with the cyan key entering as a single distant shaft from a
    grate far above. Catwalks at three levels. Oppressive, immense, wet, humming.
  `),
  'datavault-sigma': block(`
    A windowless black monolith of a data fortress, its face broken only by cooling louvres
    exhaling white vapour lit cold #22d3ee from within. Set in a cleared exclusion zone of cracked
    concrete and dead lighting columns. A single armoured entry ramp. Fibre trunking as thick as
    tree roots enters the ground at its base. Absolutely no human warmth: the one human-scale marker
    is a lone sentry booth dwarfed at the ramp foot.
  `),
  'glasshouse-fields': block(`
    Kilometres of cracked hydroponic glasshouses on a rooftop plateau, half their panes gone,
    mutated green #2f8551 growth spilling out and climbing the frames. Grow-lamps still running inside
    a few intact bays, throwing a sick green glow up into the smog ceiling. Irrigation pipework leaking
    into rust runs. A collapsed section reveals the city drop below. Overgrown, abandoned, strangely
    serene.
  `),
  'upper-roofs': block(`
    A shanty of stacked rooftops above a slab retaining wall, dwellings built on top of dwellings
    and lashed to the parapet with cable. Bolted-on ladders and plank walkways instead of stairs,
    each landing lit by one amber #f59e0b bulb on a hooked flex. Water butts, aerials, a goat.
    Inhabited and improvised rather than derelict: the wall below is the Combine's and everything
    above the coping is not. Two figures on a walkway, one hauling a bucket up on a rope.
  `),
  'south-quay': block(`
    The tail end of a covered market where the awnings stop and a canal cut comes back up to meet
    the street. Stalls converted into homes, tarpaulins over the gaps, one row of shutters still
    painted with a trader's name nobody uses. Standing water reflecting hanging bulbs in warm
    #f59e0b and a single cold cyan #22d3ee sign further down. Damp, cheap and out of the way, with
    the noise of the market audible one arch away. Three figures under an awning, out of the rain.
  `),
  'kettle-row': block(`
    A long residential terrace along a southern cut, boiler houses venting between every third
    building so the whole street sits under drifting warm-lit steam. Washing strung across the gap at
    three storeys. Front steps in constant use. This is the one district rendered as *inhabited*
    rather than as infrastructure: figures on the steps, a game in the road, a repaired door standing
    open. Warm #f59e0b sodium led, the cyan key arriving only down the length of the cut.
  `),
  'blacksite-7': block(`
    A hardened military compound sunk into a bomb crater: sloped ferrocrete revetments,
    staggered blast walls, a squat command bunker with slit apertures leaking hostile magenta #e11d8f
    light. Automated turret masts on the perimeter. Vehicle ramps descending out of sight. No signage,
    no windows, no invitation. Searchlight beams sweeping the crater walls. The magenta is the only
    saturated colour in frame and it reads as a warning.
  `),
  'combine-spire': block(`
    The single tallest structure in the city: a corporate megaspire punching through the smog
    ceiling into clear air, its lower two thirds lost in haze so only the crowning arcology is legible.
    Buttressed, ribbed, cathedral-like, deliberately intimidating. Magenta #e11d8f beacon light bleeding
    down the ribs; the summit catches an ambient dawn that never reaches the streets. Skybridges
    radiate outward and end in nothing. Seen from below and far away. The most beautiful and the most
    hostile image in the set.
  `),
};

/** ART-PROMPTS §3: map plates, parallax planes and the auth splash, keyed by asset key. */
export const PLATE_SUBJECTS = {
  'plate-city': block(`
    The mid-ground of a dense cyberpunk city interior seen from above and at an angle: a
    continuous carpet of stacked roofs, canal trenches, elevated roadways, courtyards and light wells,
    with clear negative-space clearings distributed across the frame for interactive markers to sit in.
    Value kept deliberately in the middle range (#1e293b to #55617e) so bright interactive nodes will
    read on top of it. Emissives are small, numerous and low-saturation at this distance. Roughly eleven
    distinguishable neighbourhood characters across the frame, separated by canals, walls and roadways.
    Keep the outer eight percent of the frame quiet.
  `),
  'plate-bar': block(`
    The inside of an undercity dive bar, seen square on from the customer side of the counter: a
    long scarred counter running the full width of the frame, a barman behind it drying a tin cup, a
    back bar of mismatched bottles lit from beneath in magenta, three enamel pendant lamps hanging
    low over the counter, and corrugated iron and patched brick behind. Four regulars sit on stools
    with their backs to the viewer, two to the left and two to the right, and **the stool in the
    dead centre of the frame is empty**, lit by the lamp above it: that empty seat is the subject of
    the painting and nothing may occupy or overlap it. Floor of cracked tile and steel plate.
  `),
  'plate-district': block(`
    A crew's own walled compound seen from directly above and slightly forward, a town-view camera
    with **no sky and no horizon**: the whole frame is ground. Drawn as the ground *only*: the
    structures are painted separately and dropped on top, so every place one would stand is an
    empty, flat, quiet pad. Thirteen such pads in three staggered rows of four, five and four,
    spread wide apart, with broad dirt roads and duckboard walkways running between them in both
    directions and off all four edges: the lanes between the pads are the whole composition, and
    they must read as somewhere people walk. Ground is packed dirt, cracked slab, gravel and
    puddled standing water, patched with steel plate and old rail. The top edge of the frame is the
    compound's back wall: gabion baskets, sheet pile, stacked containers and a lit guard post, not
    open country. Scatter lives beside the roads and never on a pad: spoil heaps, oil drums,
    pallet stacks, a burnt-out chassis, cable runs pinned along the wall, drying laundry strung
    between poles. Value kept in the middle range (#1e293b to #55617e), the ground reading a step
    warmer and darker as it comes toward the viewer. Cold #22d3ee key from upper left, weak sodium
    #f59e0b bounce. Emissives are small, sparse and at ground level: a strung bulb line, a marker
    lamp, a brazier. No buildings. Nothing on the pads. Painted signage, hoardings and graffiti are
    part of the street and welcome; nothing that reads as a label for a game object.
  `),
  'plate-district-neon-docks': block(`
    The Neon Docks from above and slightly forward, the same town-view camera as the compound
    plate and **no sky**: a wet quay running the width of the frame, a flooded dock basin cut into
    it on the left, and a container wall closing the top edge with the stacked city behind it. Seven
    places a player can stand, spread apart and each recognisable at a glance from the others: a
    red gantry crane on the far left quay, a row of striped market awnings along the top, an arched
    service tunnel in the wall, a pumphouse of clustered pipework with a lit magenta window, a lit
    chandler's shed at lower right, moored barges strung with laundry at lower left, and a covered
    gallery over the water. Value in the middle range, cold reflected light off standing water,
    small sodium lamps at head height. Painted signage is part of the street; nothing that reads as
    a label for a game object.
  `),
  'plate-district-chrome-row': block(`
    Chrome Row from above and slightly forward, the same camera as the other contested plates and
    **no sky**: what is left of downtown, a wet plaza round a statue on a plinth with a barrel fire
    at its foot, closed on every side. Eight places a player can stand, each recognisable at a
    glance: a columned bank hall turned market at upper left with tents and stalls spilling down
    its steps, a lattice transmitter mast with red lamps, a picture house with a lit marquee at
    upper right, a hospital block with a red cross on its face at the right, a lookout platform of
    scaffold on that block's roof, a pawn shop with a lit window at lower left, a row of arcade
    booths glowing magenta and cyan at lower right, and a tavern with tables in its lit corner. A
    timber gate with two guards closes the bottom edge. Magenta and sodium light on wet stone.
    Painted signage is part of the street; nothing that reads as a label for a game object.
  `),
  'plate-faction-room': block(`
    The faction's back room, seen from across the table and **no sky**: a round table under a
    hanging lamp with a city map, mugs, a bottle and a radio set on it, and five people round it,
    one standing and leaning in mid-sentence. A faction banner hangs on the wall behind, a
    pinboard of photographs and red string covers the wall at the left, and lit screens, a
    gantry and figures at consoles fill the hall beyond. Cold #22d3ee monitor light against warm
    sodium lamps. Nothing that reads as a label for a game object.
  `),
  'plate-district-undergrid': block(`
    The Undergrid from above and slightly forward, the same camera as the other contested plates
    and **no sky**: a vast utility cavern under the city, rock walls hung with bundled conduit,
    lit by toxic green coolant seams and sodium lamps. Seven places a player can stand, each
    recognisable at a glance: a transformer substation on a scaffold platform at upper left with
    lightning arcing off its insulators, a second transformer vault on its own platform at upper
    right, a brick tunnel mouth with a customs booth at top centre, a flooded junction of arched
    culverts and a footbridge in the middle, a tram depot with a stranded tram at right, a lattice
    stair tower climbing off the right edge with a lit lamp room at its top, and a reagent works of
    tanks and pipework at lower right venting steam. A shanty of huts at lower left, and a timber
    gate with a watch platform closes the bottom edge. Wet stone, standing water, green and amber
    light. Painted signage is part of the street; nothing that reads as a label for a game object.
  `),
  'plate-district-datavault-sigma': block(`
    The Annexes from above and slightly forward, the same camera as the other contested plates and
    **no sky**: a fogged faculty quarter of wet stone under cold grey-green light. Eight places a
    player can stand, each recognisable at a glance: a satellite dish bolted to the roof of a
    stone faculty building at upper left, a glass-fronted hall lit green from inside next along, a
    copper-domed observatory with a brass orrery turning under the dome at top centre, a foundry
    of smokestacks and teal cooling tanks at upper right, a scaffolded half-built tower under a
    yellow crane at the right, a mansion roofed with a thicket of antenna spikes in the centre, a
    huge columned faculty building with grand steps at the left, and a stone gate between two
    towers closing the bottom edge. Fog between the roofs, standing water on the flagstones, lit
    windows the only warm notes. Painted signage is part of the street; nothing that reads as a
    label for a game object.
  `),
  'plate-district-glasshouse-fields': block(`
    Glasshouse Fields from above and slightly forward, the same camera as the other contested
    plates and **no sky**: state hydroponics behind a fence, furrowed beds and mud roads under a
    grey overcast. Seven places a player can stand, each recognisable at a glance: a water intake of
    silos, tanks and a guarded pipe gate at upper left, a grassed berm with a watch hut and sandbags
    on its crown at centre left, a row of glasshouses along the top, a hauler yard of rail carts
    under a timber crane at the right, a long kitchen shed with a chimney and trestle tables of
    diners in the middle, a market of awnings and produce crates at lower left, a chapel with a bell
    tower at lower right, and a camp of tents against the fence at the right edge. A timber gate
    with a watch post closes the bottom edge. Wet earth, green beds, a few lit windows. Painted
    signage is part of the street; nothing that reads as a label for a game object.
  `),
  'plate-district-blacksite-7': block(`
    The Blacksite from above and slightly forward, the same camera as the other contested plates
    and **no sky**: a hardened ferrocrete garrison closed on every side by sheer walls. Eight
    places a player can stand, each recognisable at a glance: a fortified compound with a great gate
    and red diamond banners at upper left with layered berm walls running down the left edge, a
    tall watchtower with a searchlight at the centre, a drill hall bunker with troops in formation
    in front of it at upper right, a surgical room lit cyan high in the right wall, a central
    armoury bunker with an orange-lit interior, trucks and tracked vehicles at lower right of
    centre, reactor drums and a cooling tower at the far lower right, and a lit fighting ring at
    lower left. Sodium lamps on wet concrete, the searchlight the only cold note. Painted signage is
    part of the street; nothing that reads as a label for a game object.
  `),
  'plate-district-combine-spire': block(`
    The CCS from above and slightly forward, the same camera as the other contested plates and
    **no sky**: the Combine's civic spire at night, a walled cathedral precinct of grey stone and
    gold-lit windows on a rock above the rest of the city. Eight places a player can stand, each
    recognisable at a glance: a huge satellite dish on a stone hall at upper left, a gothic chapel
    with a lit rose window and a spire at top centre, a green glass dome on a colonnaded clinic at
    upper right of centre, a red-lit broadcast mast at the far upper right, a bronze statue on a
    plinth in a paved plaza at the centre, a squat armoury block behind the walls at lower right, a
    yellow crane over an unfinished wing at the far right, and a barricaded gatehouse in the outer
    wall at the bottom centre. Warm gold light in every window against cold blue stone, smoke over
    the city beyond. Painted signage is part of the street; nothing that reads as a label for a
    game object.
  `),
  'plate-district-rustyard': block(`
    The Steelbelt from above and slightly forward, same camera, no sky: a working yard of press
    houses and furnace rows closing on all four sides, a hoarding fence along the lower left, and
    the city stacked beyond the top edge. Seven distinguishable places: a long glass-roofed press
    house at upper left, a breaker's yard of stripped machines under a gantry in the middle, a
    covered market of trestles at upper right, a lit pawn shop with an outside stair at mid left, a
    kennel run at mid right, a drained slag pit in the lower middle, and a pump row of fuel stands
    at lower right. Warm furnace light against cold wet stone, emissives small and at ground level.
    Painted signage is part of the street; nothing that reads as a label for a game object.
  `),
  'plane-city-sky': block(`
    Sky and distant arcology silhouettes only. Heavy smog ceiling in #1b2233 to #3d4761
    graduating upward, a diffuse cold light source behind it, and the flat blue-grey silhouettes of
    enormous far towers reduced almost entirely to value with no detail. Nearly abstract. No ground,
    no foreground, no legible structure.
  `),
  'plane-city-far': block(`
    A band of mid-distance city blocks and towers standing against a flat unshaded magenta
    #ff00ff background: everything above the skyline, the top forty percent of the canvas, is that
    magenta and nothing else, with no gradient, glow, haze or shading in it. Silhouettes are
    simplified, values compressed toward #2a3348 to #55617e, with sparse tiny window lights. No
    magenta, pink or violet appears anywhere in the towers themselves. Nothing that breaks the
    skyline may be thinner than three pixels at 2048 wide: antenna masts and spire tips stay blunt
    and stubby, never hairlines, and there are no wires or cables, and the towers are separated by
    open magenta at least three pixels wide, never a hairline slot. Detail suppressed: this sits
    behind everything and must never compete.
  `),
  'plane-city-fore': block(`
    Foreground occluding elements only, on a flat unshaded magenta #ff00ff background, arranged
    around the frame edges and corners: a cantilevered pipe run entering from the upper left, a heavy
    sagging cable trunk across the top, a signage gantry in the lower right, a crane arm cutting the
    upper right corner. Near-silhouette, values #05070d to #1e293b, with a cold rim on the key side,
    and no magenta, pink or violet anywhere in the elements themselves. Nothing may
    be thinner than three pixels at 2048 wide: the cable trunk is one heavy sagging mass, the rim a
    broad band, and the gantry and crane arm are built from chunky box members rather than open
    lattice or truss work, with no hairline wires and no single-pixel rims or edges, and every gap of
    open magenta these elements leave against the frame is at least three pixels wide, never a
    hairline slot. The central sixty percent of the canvas must be flat magenta and nothing else.
  `),
  'splash-auth': block(`
    A lone figure seen from behind, small in frame, standing at a railing overlooking the
    whole city at night in rain. The city fills the lower two thirds as a field of tiny warm and cold
    lights under smog; the Combine Spire is a dark presence far right. Keep the central forty percent
    by fifty percent of the canvas low-contrast, quiet and free of detail: a login form sits there.
    The most romantic and most haunting image in the game.
  `),
} as const;

/** ART-PROMPTS §5: UI frames and HUD plates, keyed by asset key. */
export const UI_SUBJECTS = {
  'ui-frame-panel': block(`
    A rectangular equipment-panel frame of dark #1e293b brushed steel with a thin inset
    channel, four hex-socket bolts recessed at the corners, and a hairline of cyan #22d3ee light in the
    inner channel as though lit from behind. One corner shows a chipped edge and a paint scuff.
  `),
  'ui-frame-modal': block(`
    A heavier armoured hatch frame: thicker bezel than the panel, chamfered outer edge,
    two recessed handle lugs top and bottom, faint radial scoring across the plate, and a warning-stripe
    remnant worn nearly away along the lower edge. Cyan channel light, slightly brighter than
    the panel frame.
  `),
  'ui-frame-hud': block(`
    A wide horizontal instrument plate spanning the full width, with a raised rail along the
    bottom edge, six evenly spaced blank recessed instrument bays across the middle band, and mounting
    brackets at both ends. The bays are empty sockets: no dials, no readouts, no text.
  `),
  'ui-plate-button': block(`
    A single rectangular pressable key plate: slightly domed face, chamfered edge, worn
    brighter in the centre where a thumb has rubbed it for years, a thin cyan #22d3ee underglow escaping
    from the seam beneath. Quiet and dark; this must not compete with the label the app renders on top.
  `),
  'ui-plate-nav': block(`
    A tall narrow vertical rail plate with a repeating ladder of blank recessed mounting slots
    down its length, a cable channel along one side, and a cyan #22d3ee light strip running the full
    height in a recessed groove. The slots are empty: no icons.
  `),
  'ui-divider': block(`
    A thin horizontal trim strip: a machined groove with a single cyan #22d3ee filament in
    it, terminating at both ends in a small bolted end-cap. Extreme aspect: the element occupies only
    the central horizontal eighth of the canvas; the rest is fully transparent.
  `),
} as const;

/**
 * ART-PROMPTS §6.1: keyed by `ResourceKey`, so a resource added to `ResourcesSchema` cannot ship
 * without an icon prompt. The asset id is the kebab-cased key (`highQualityMetal` →
 * `icon-high-quality-metal`), which `art/manifest.ts` derives; never hand-write one.
 */
export const RESOURCE_ICON_SUBJECTS: Readonly<Record<ResourceKey, string>> = {
  caps: block(`
    A loose handful of crimped bottle caps, painted faces scratched back to bare steel, one
    standing on edge against the pile, warm amber #f59e0b catching the ridged rims.
  `),
  supplies: block(`
    A dented ration tin with its lid peeled half back on a torn hinge of metal, a scorched crust
    of pressed protein inside, the paper label stripped to a pale ghost, warm amber #ffd166
    glancing off the peeled edge.
  `),
  oil: block(`
    A squat riveted fuel drum with a hand-cranked spigot, a black bead swelling at the nozzle and
    a thin slick pooling beneath it, seams weeping rust, cyan #22d3ee iridescence riding the
    surface of the slick.
  `),
  scrap: block(`
    A bundle of salvaged offcuts wired together at the middle, bent rebar, a torn hull plate, a
    coiled length of stripped cable, cold #94a3b8 light along the freshly broken edges, dull and
    powdery everywhere else.
  `),
  highQualityMetal: block(`
    Three stacked machined ingots with clean milled faces and a cast foundry stamp still legible
    on the top one, a cold #22d3ee temper sheen along the top edges, one corner cracked away to
    show bright grain.
  `),
  planks: block(`
    A short stack of sawn boards bound with wire, ends rough-cut and splintered, one board
    warped away from the others, weathered grey timber with warm tan #b98a52 showing where the
    saw went through.
  `),
};

/** ART-PROMPTS §6.2: keyed by `OverseerArchetype`. */
export const ARCHETYPE_ICON_SUBJECTS: Readonly<Record<OverseerArchetype, string>> = {
  enforcer: block(`
    A battered riot shield seen at a slight angle, one corner deformed by impact, a single
    magenta #e11d8f warning band across it.
  `),
  netrunner: block(`
    A dermal interface jack plug trailing a coiled lead, contact pins catching cyan #22d3ee
    light, lead disappearing off the lower edge.
  `),
  fixer: block(`
    An old brass-bodied key card held between the implied thumb and finger of no visible hand,
    worn to a shine, warm amber #f59e0b edge light.
  `),
  technocrat: block(`
    A machined gear-and-caliper pairing, teeth worn unevenly, a green #43b56e calibration
    filament between the caliper jaws.
  `),
};

/** ART-PROMPTS §6.3: keyed by `DistrictKind`. */
export const DISTRICT_KIND_ICON_SUBJECTS: Readonly<Record<DistrictKind, string>> = {
  residential: block(`
    A small fortified compound seen from above: a walled square with a central drum and a gate
    notch, cyan #22d3ee light in the courtyard.
  `),
  contested: block(`
    Four small blocks around a crossroads seen from above, one of them breached and spilling
    rubble, a single magenta #e11d8f ember at the break.
  `),
};

/** ART-PROMPTS §6.4: keyed by `LocationKind`. The map markers inside a contested district. */
/**
 * §C1: one icon per machine the Garage builds.
 *
 * Icons rather than full plates. A vehicle card is a row on a list beside its cost and its
 * capacity, not a hero image, and an icon is the class the rest of the interface's small pictures
 * already come from: a delivered `icon-vehicle-<id>.webp` drops straight in with no code change.
 */
export const VEHICLE_ICON_SUBJECTS: Readonly<Record<VehicleId, string>> = {
  motorcycle: block(`
    A stripped street bike in three-quarter view, no fairing, welded rack over the tail, warm
    #f59e0b highlight along the tank.
  `),
  dirt_runner: block(`
    A reinforced pickup in side view, bolted plate over the doors and bed, a bull bar across the
    grille, oversized tyres, "OFFIE" sprayed on the door, cyan and magenta light bars under the
    sills.
  `),
  scrap_car: block(`
    A boxy saloon welded out of three donor bodies, mismatched panels, one headlamp lit
    #ffd166.
  `),
  armoured_car: block(`
    A school bus in three-quarter view, riveted plate over every window, a ram plough under the
    grille, a roof rack and a ragged flag on a mast, "CHEESE WAGON" painted across the front above
    the windscreen, oversized tyres.
  `),
  gas_balloon: block(`
    A patched gas envelope over a slung basket, mooring lines trailing, pale #7ff0ff sky behind.
  `),
  rotorcraft: block(`
    A home-built helicopter in three-quarter view, an open lattice tail boom, a bubble canopy
    glazed in mismatched panels, skids welded out of scaffold tube, one rotor blade a different
    colour from the others, oil streaks down the boom.
  `),
  heli_porter: block(`
    A heavy transport helicopter in three-quarter view on a cracked pad, wide sliding cabin door
    open on bench seats, twin engines above the roof, five-blade rotor turning, landing gear rather
    than skids, warm #f59e0b light along the flank and a cold #22d3ee glow in the cockpit.
  `),
};

export const LOCATION_ICON_SUBJECTS: Readonly<Record<LocationKind, string>> = {
  scrap_press: block(`
    A baling press seen from above with a squared bale on the outfeed and a scatter of loose
    swarf, warm #f59e0b rust tones.
  `),
  chemical_plant: block(`
    Three cracking towers of descending height joined by a pipe run, one venting a pale
    #86e6a8 plume.
  `),
  power_station: block(`
    A transformer bank of four ribbed cylinders behind a mesh fence, cold #22d3ee arc light
    between two of them.
  `),
  water_works: block(`
    Two circular settling beds seen from above with a radial sweep arm on each, water reading
    as flat #12a2bd.
  `),
  foundry: block(`
    A cupola furnace with a tapping spout, the pour glowing #ffd166 across the floor plate
    beneath it.
  `),
  market: block(`
    A cluster of three market awnings seen from above, tarpaulins sagging, a single warm lamp
    point between them.
  `),
  pawn_shop: block(`
    A barred serving hatch in a blank wall with three hanging balls above it, one warm
    #f59e0b lamp inside the bars.
  `),
  high_ground: block(`
    A water tower on lattice legs above a rooftop parapet, seen at a low angle, cold rim light
    along the tank.
  `),
  barricade: block(`
    A staggered line of sea containers and rubble with rebar teeth, seen from above, one
    narrow gap left through it.
  `),
  armory: block(`
    A heavy vault door standing ajar in a blank concrete face, weapon racks visible as
    silhouettes in the #f59e0b light beyond.
  `),
  war_machine_graveyard: block(`
    Three dead armoured hulls half sunk in mud, tracks shed, one turret canted skyward, cold
    smog between them.
  `),
  university: block(`
    A colonnaded facade with a broken pediment, one lit window in an upper storey, cyan
    #22d3ee light behind the glass.
  `),
  satellite_uplink: block(`
    A parabolic dish on a guyed mast, hand-aligned and slightly off true, cold #7ff0ff light
    at the feed horn.
  `),
  gene_clinic: block(`
    A sealed theatre door with a porthole and a cold-storage cabinet beside it, sterile white
    light through the port.
  `),
  fight_pit: block(`
    A sunken circular ring seen from above with a standing crowd ringing it, warm #f59e0b
    lamps on poles around the rim.
  `),
  skate_ground: block(`
    A drained reservoir bowl seen from above, its curved transitions marked with tyre and
    board scuffs, one graffiti sweep across the floor.
  `),
  hospital: block(`
    A four-bay ambulance canopy with a repainted cross panel above it, warm light spilling
    from the entrance.
  `),
  rail_yard: block(`
    Converging sidings around a turntable seen from above, two flatbeds parked off-centre,
    cold light along the rail heads.
  `),
  broadcast_tower: block(`
    A lattice transmitter mast with three stacked dipole arrays, a single #e11d8f obstruction
    light at the top.
  `),
  sewer_junction: block(`
    A brick chamber where six storm drains meet, seen from above, standing water reading as
    dark #12a2bd with one shaft of light.
  `),

  gas_station: block(`
    A forecourt canopy seen from above on four thin posts, two pump islands beneath it, a warm
    #f59e0b spill reading as fuel on the apron.
  `),
  nuclear_plant: block(`
    Two hyperboloid cooling towers with a low turbine hall between them, a cold #86e6a8 glow in
    the reactor block.
  `),
  soup_kitchen: block(`
    A long trestle table seen from above with two steaming vats at one end and a queue of small
    marks along it, warm #f59e0b light.
  `),
  refugee_camp: block(`
    A cluster of lean-to shelters against a chain-link fence seen from above, tarpaulins in muted
    #94a3b8, two small cook fires in warm #f59e0b.
  `),
  downtown_market: block(`
    An exchange floor seen from above, a ring of desks around an open pit with a price board on
    the far wall in #22d3ee.
  `),
  bone_market: block(`
    A row of low stalls under a bare frame, pale #cbd5e1 sorted remains laid out on the boards.
  `),
  revolutionist_statue: block(`
    A bronze figure on a tall plinth with one arm raised, seen three-quarter from above, warm
    #f59e0b rim light down one side.
  `),
  watchtower: block(`
    A lattice mast with a small glazed cabin at the top, a cold #22d3ee lamp in the cabin.
  `),
  smugglers_tunnel: block(`
    A timbered tunnel mouth cut into a retaining wall, rails running out of it, unlit interior in
    deep #0b1020.
  `),
  construction_site: block(`
    A tower crane over a poured concrete raft with rebar stubs, seen from above, warm #f59e0b
    hazard marks on the base.
  `),
  gym: block(`
    A barbell on a rack with two stacked plate trees beside it, seen three-quarter, worn
    #cbd5e1 iron.
  `),
  doghouse: block(`
    A row of three kennels under a low roof with a wire run in front, a single #22d3ee augment
    light at one door.
  `),
  tram_depot: block(`
    A depot shed with three parallel roads running into it, one tram nose showing, overhead line
    in cold #22d3ee.
  `),
  planetarium: block(`
    A ribbed dome with a slit at the apex, a projector silhouette inside it, cold #22d3ee light
    escaping.
  `),
  broadcast_station: block(`
    A studio console seen from above with two microphone booms and a lit ON AIR panel in
    #e11d8f.
  `),
  pirate_radio: block(`
    A wire aerial strung between two rooftop poles with a small transmitter case beneath it, a
    single #e11d8f indicator.
  `),
  black_clinic: block(`
    A steel trolley with a locked cabinet above it and three syringes laid in a row, cold
    #22d3ee lamp overhead.
  `),
  mad_scientist_lair: block(`
    A cylindrical specimen tank with cabling running to an operating table beside it, sick
    #86e6a8 light inside the tank.
  `),
  tavern: block(`
    A long bar seen three-quarter from above with four stools and hanging glasses, warm
    #f59e0b light pooling on it.
  `),
  cinema: block(`
    A projector on a stand throwing a cone of pale #cbd5e1 light towards a small bright screen.
  `),
  arcade: block(`
    Three upright cabinets side by side seen three-quarter, screens reading as #e11d8f and
    #22d3ee glow.
  `),
  chapel: block(`
    A small pitched roof with a bell in an open cote at the gable, warm #f59e0b light from one
    narrow window.
  `),
  graveyard: block(`
    Six headstones in two staggered rows on a terraced slope seen from above, cold #94a3b8
    stone, one lamp at the gate in #f59e0b.
  `),
  revolutionary_statue: block(`
    A long-coated figure, one fist raised, on a plinth in a paved plaza seen three-quarter from
    above, cold #22d3ee floodlight up the front.
  `),
  glasshouse: block(`
    A gabled glass house seen from above, beds of #86e6a8 growth showing through the panes, one
    grow-lamp inside reading warm #f59e0b.
  `),
  combine_chapel: block(`
    A steel-and-glass chapel at the top of a tower seen three-quarter from above, a long table
    under a vaulted roof where the pews would be, one cold #22d3ee light down the length of it.
  `),
};

/**
 * ART-PROMPTS §7: keyed by `UnitSpec.id`, so a unit added to `UNIT_CATALOG` cannot ship without a
 * portrait prompt. The asset id is the kebab-cased unit id (`road_reavers` → `unit-road-reavers`),
 * which `art/manifest.ts` derives; never hand-write one.
 *
 * Written against the tier ladder rather than one at a time: rabble are unarmoured and improvising,
 * regulars have one good piece of kit each, specialists are defined by the equipment they carry
 * instead of by what they wear, heavies have lost the human silhouette, and the legendaries each
 * break the frame in a way none of the others do.
 */
export const UNIT_SUBJECTS: Readonly<Record<string, string>> = {
  scavengers: block(`
    A wiry salvager in a patched coat with a canvas satchel across the chest and a coil of copper
    wire over one shoulder. Fingerless gloves black to the second knuckle, a headlamp pushed up
    onto the forehead, a short pry bar hanging from the belt where a weapon would be on anybody
    else. Reading a wall rather than watching a door.
  `),
  haulers: block(`
    A broad-shouldered porter in a leather harness braced against the weight of a loaded barrow,
    the strap worn shiny across one shoulder. Boots wrapped against the wet, a folded tarpaulin
    lashed over the load, both hands on the shafts. Nothing on them that could be called a weapon.
  `),
  razors: block(`
    A lean street fighter in a cut-down jacket over bare arms, holding a ground-down machete low
    and away from the body. Cloth wrapped from knuckle to elbow in place of armour, one shoulder
    taped. Expression flat and unbothered; cold #22d3ee key along the blade edge, warm #f59e0b
    bounce off the wrapped forearm.
  `),
  anodics: block(`
    A short, densely built figure in a stretched cardigan over a stained shirt, sleeves shoved to
    the elbow, forearms thick. A narrow strip of hair, no more than two fingers wide, stiff and
    short: the rest of the scalp shaved down. One hand around the neck of a small brown bottle
    with a hand-lettered label, held like a tool rather than a drink; the other loose and open at
    the hip. Reading glasses pushed up into the mohawk. Pupils blown wide, jaw set, entirely calm
    in a way that is not restful. Warm #f59e0b key from below as if from a floor lamp, cold
    #22d3ee rim along the shoulders.
  `),
  sparks: block(`
    A teenager holding a home-made electrical lance: a scaffold pole with a capacitor bank taped
    along it and two bare contacts at the tip. Welding goggles pushed up on the forehead, hands
    gloved in mismatched rubber. A single #7ff0ff arc crawling between the contacts is the
    brightest thing in frame, and it lights the face from below.
  `),
  scrapers: block(`
    A wiry scavenger in a patched canvas coat with a salvage hook over one shoulder and a strap of
    pouches across the chest, goggles up on the brow. Light plate lashed to one shoulder with rope.
    Half-turned as if already leaving, warm ochre midtones against a cold rim.
  `),
  breakers: block(`
    A heavyset door-breacher braced behind a scuffed steel ram held two-handed across the body,
    forearms and shins plated in bolted scrap. Face guard hinged up to show a broken nose and a
    jaw set for the next one. Hard cold key across the ram face, warm bounce under the plates.
  `),
  wardens: block(`
    A defender behind a tall salvaged shield planted on the ground, one hand on its rim and a short
    spear upright in the other. Layered plate over a padded coat, everything scuffed at the front
    and clean at the back. Composed, unhurried, watching past the viewer.
  `),
  ghosts: block(`
    A slight figure in a matte grey wrap suit with a soft hood and a scarf over the mouth, holding
    a suppressed carbine down along the leg. No hard edges and no shine anywhere on the fabric:
    the only speculars are the eyes and a thin #22d3ee line along the optic.
  `),
  road_reavers: block(`
    A rider in a studded leather cut over a fuel-stained undersuit, one arm through a scavenged
    fairing used as a shield, a length of chain looped at the belt. Riding goggles down, hair and
    scarf still moving. Warm #f59e0b headlamp glare from below and behind the shoulder.
  `),
  ironsides: block(`
    A soldier encased front-on in overlapping salvaged plate, road sign, hull steel, a car door
    panel, strapped over a padded frame, with a slit visor and a short blade held close. Wide,
    immovable stance. Cold light rakes across the mismatched plates and finds a different colour
    in each.
  `),
  ash_walkers: block(`
    A trooper in a taped chemical suit and full-face respirator with two round filter drums at the
    cheeks, one gloved hand steadying a hose that runs into the pack. Suit fabric bleached and
    stiffened by exposure. Lens glass takes a flat #12a2bd reflection and shows nothing behind it.
  `),
  snipers: block(`
    A marksman kneeling with a long bolt-action rifle across the raised knee, wrapped in a ghillie
    of shredded grey rag, hood down and hair flattened by it. Face bare and very still. One narrow
    cold highlight down the barrel; everything else sinks into the ground tone.
  `),
  stitchers: block(`
    A field medic in a rolled-sleeve coat with a heavy satchel across the body and a strip of
    surgical tape on the forearm holding a spare line in place. Both hands busy: one clamping a
    dressing, one reaching. Warm #ffd166 light from a headband lamp turned down onto the work.
  `),
  demolishers: block(`
    A sapper in a heavy apron over reinforced overalls, a bandolier of shaped charges across the
    chest and a spool of det cord hooked at the hip. Ear defenders around the neck, hands blackened
    to the wrist. Amber #f59e0b light and a haze of masonry dust in the air around the shoulders.
  `),
  kite_crews: block(`
    A drone pilot crouched over a hinged control slate held at chest height, a rotor craft hovering
    just off the shoulder at the frame edge. Padded vest, cable running from slate to belt, eyes on
    the screen. Cold #22d3ee screen light fills the face from below.
  `),
  netrunners: block(`
    A combat hacker with a deck strapped along the forearm and three fibre leads run from a dermal
    port behind the ear into a shoulder loom. Coat open over a mesh underlayer, one hand raised
    mid-gesture. Cyan #7ff0ff runs along the leads and reflects in a wet-looking eye.
  `),
  sleepers: block(`
    An unremarkable person in ordinary work clothes, coveralls, a laminated pass on a lanyard, a
    canvas bag, standing squarely and looking directly at the viewer. No visible weapon. The only
    thing wrong is the stillness, and one hand already inside the bag.
  `),
  cyber_dogs: block(`
    Two lean working dogs in profile, one a half-step ahead. Cropped harnesses with a low-profile
    spine plate and a socketed collar; one animal's muzzle and jaw partly replaced with matte
    dark alloy. No visible weapons. Ears forward, weight on the front paws, mid-stride. Cold
    #22d3ee sensor glint at the collar sockets, warm #f59e0b ground bounce along the flanks.
  `),
  juggernauts: block(`
    A fully augmented heavy assault trooper: a human silhouette only at the head, with the arms
    and torso replaced by armoured actuator housings and the legs by reversed hydraulic struts.
    A small scarred face remains behind an open faceplate. Cold key finds machined edges; warm
    #8a5209 leaks from the joint seams.
  `),
  hollow_men: block(`
    A shock trooper standing too straight in matte assault plate, faceplate open on an expression
    of complete calm, pupils blown wide. Surgical scarring in a neat arc above one temple. Blood on
    the gauntlets, none anywhere else. Even flat light, almost no shadow: nothing to read.
  `),
  the_condemned: block(`
    A convict fighter in a stripped prison coverall with the sleeves torn away, a welded collar at
    the throat and a heavy chain-wrapped blade held in both hands. Fresh brand on the shoulder,
    older scars beneath it. Head lifted, grinning; harsh cold key from directly above.
  `),
  the_specter: block(`
    A figure caught mid-decloak: the outline is complete but the body is only present in patches,
    the rest refracting the plaster ground behind it in smeared cyan #22d3ee bands. What is solid
    is a matte infiltration suit and one long knife. No face resolves.
  `),
  the_abomination: block(`
    A failed experiment: a mass of grafted muscle and salvaged plate on a frame that no longer
    agrees on how many limbs it has, restraint bolts still through the shoulders and one trailing
    cable. Half a human face is set into the upper mass at the wrong angle. Sickly #86e6a8 fluid
    light from within the seams.
  `),
  the_colossus: block(`
    A walking fortress seen from the ground looking up, so only its lower hull, one tread-footed
    leg and the underside of a gun sponson fit the frame. Rivet lines the size of a person, hatch
    ladders, and a tiny crew figure on a walkway for scale. Cold sky behind, warm exhaust glow
    beneath.
  `),
  the_saint: block(`
    An older fighter in a long weathered coat over plain plate, unarmed hands open at the sides, a
    sheathed sword slung across the back. Grey cropped hair, deep-lined face, entirely calm. The
    one portrait lit warmly from the front: amber #ffd166 across the face, cold #22d3ee only as a
    thin rim.
  `),
  the_cartographer: block(`
    A traveller in a layered dust coat hung with rolled charts, a brass sighting compass on a
    thong and a chalk stub behind the ear, one hand flat on a map board marked over many times in
    different hands. Eyes on the viewer rather than the map. Warm lamp light on the paper, cold
    light on everything else.
  `),
  the_twins: block(`
    A riveted automaton standing square in a workshop, one torso carrying two bald heads set back
    to back, so one face is toward the viewer and the other is turned away. Plate over a leather
    harness, long jointed hands hanging open, no weapon anywhere on it. Warm bulb light from two
    hanging lamps, drawings pinned on the wall behind.
  `),
  sluggers: block(`
    A broad, heavyset fighter standing square in scavenged plate over a sleeveless work vest, both
    hands across a short double-barrelled slug gun held low at the waist. Bracers to the elbow,
    heavy boots, hair braided back off a scarred face. Calm rather than braced. Warm furnace light
    from the right, cold fill on the plate.
  `),
  the_crimson_dancer: block(`
    A dancer balanced on the point of a bladed prosthetic leg in a ruined ballroom, both legs and
    both forearms jointed steel, a torn crimson coat thrown out by the turn. Chin up, arms carried
    high and wide as if mid-figure rather than mid-fight. Deep red light from a broken window
    behind, cold rim on the steel, thrown blades streaking past out of focus.
  `),
  the_loose_end: block(`
    A lean swordsman low in a turning crouch under a flooded overpass, black scale-plate wrapped
    up both forearms and one shoulder, ragged dark hair, a long segmented chain-blade swung out
    low and lit violet along its edge. Tracer rounds streak past above and behind, missing, one
    shooter half in silhouette firing from the far dark. Cold purple key from the blade, warm
    muzzle spark opposite, wet ground taking both.
  `),
  // --- the Combine (2026-09-19): the regime's own units, never the player's. Same ladder as the
  // roster above: the Levy improvising, the Greycoats issued one thing each, the Enforcers
  // defined by their kit, the Suppressor no longer a human silhouette, and the three legendaries
  // each breaking the frame their own way.
  civic_levy: block(`
    A conscript in a civilian coat with a Combine armband stitched on crooked, a surplus machete
    held wrong in both hands, a paper number pinned to the chest. Thin, young, badly fed, looking
    somewhere off frame as if for orders. No armour of any kind.
  `),
  greycoat: block(`
    A government infantryman in a long grey wool greatcoat buttoned to the throat, a pressed-steel
    helmet with a unit number stencilled on the front, a bolt rifle held at port arms. Face set,
    eyes on the viewer, the coat's shoulders damp from standing in the rain a long time.
  `),
  street_enforcers: block(`
    A riot officer in matt-black plate over a grey uniform, a full visored helmet with a single
    horizontal #22d3ee visor slit, a shock baton crackling faintly in one gauntlet and a transparent
    riot shield in the other. Stance square, feet planted, more machine than man in the outline.
  `),
  suppressor: block(`
    A two-man heavy weapons crew behind a belt-fed automatic gun on a tripod, sandbags and a
    stack of ammunition cans, both men in grey with helmets and hearing protection, one feeding
    the belt and one on the grips. Spent brass on the ground. The gun is the subject.
  `),
  syndic: block(`
    A middle-aged government liaison in an immaculate charcoal suit and a Combine lapel pin,
    standing in a factory yard with a clipboard under one arm and a holstered sidearm on the belt,
    two private guards blurred behind him. Calm, well fed, faintly amused. The only clean thing in
    the frame.
  `),
  executioner: block(`
    A tall figure in black tactical armour with no insignia, a heavy hooked blade held low in one
    hand, the face hidden behind a blank matt-black mask with no eye slits. Standing over the
    edge of the frame as if the viewer is on the ground. Blood on the blade, none on the armour.
  `),
  directive_xero: block(`
    An old man in a plain grey high-collared uniform seated at the head of a long steel table
    under a vaulted glass roof, hands folded, a single #22d3ee light from above. No weapon visible.
    Everything in the room is arranged around him, and he is looking straight at the viewer.
  `),
};
