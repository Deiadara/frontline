/**
 * The prose half of the art pipeline: the shared style anchor, the shared negative prompt, the
 * per-class framing blocks and the per-asset subject blocks.
 *
 * Every string here is transcribed from `docs/ART-PROMPTS.md` and is the **only** copy — neither
 * the manifest nor `scripts/gen-art.ts` may restate or paraphrase one. Whitespace is collapsed so
 * the hard wrapping in the doc (and in this file) never reaches a backend.
 */
import type { BuildingKind } from '../building.js';
import type { DistrictKind } from '../city.js';
import type { OverseerArchetype } from '../overseer.js';
import type { Resources } from '../resources.js';

/** Collapses authoring whitespace into a single-line prose block. */
const block = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** ART-PROMPTS §0.1 — prepended verbatim to every prompt. */
export const STYLE_ANCHOR = block(`
  Hand-painted digital illustration in the style of Arcane (Fortiche) — painterly oil-and-gouache
  brushwork over solid draughtsmanship, between stylised and photoreal, never cel-shaded, never
  vector-flat. Cyberpunk-dystopian, lived-in and decaying. Split lighting: cold cyan key light
  (#22d3ee) from upper-left at 35 degrees, weak warm sodium bounce (#f59e0b) from lower-right at 40
  percent intensity; shadows tinted, never neutral grey. Desaturated structural midtones in slate and
  ferrite (#1e293b, #475569, #94a3b8) against deep blue-black (#0a0e17, #05070d) and drifting smog
  (#3d4761, #55617e); saturation reserved for emissives only. Broken rim light along 40-60 percent of
  the contour, two ramp stops brighter than the edge it runs along. Lost-and-found edges — crisp at
  the focal point, dissolving into atmospheric haze at depth. Visible brush economy: detail
  concentrated in the focal twenty percent, broad confident strokes elsewhere. Every surface shows
  wear, repair or decay. Emissives painted at their own hue rather than white-hot. Cinematic, moody,
  beautiful and quietly haunting.
`);

/** ART-PROMPTS §0.2 — applied to every prompt. */
export const NEGATIVE = block(`
  text, letters, words, watermark, signature, logo, ui overlay, hud, frame, border, caption,
  flat vector art, cel shading, hard black outlines, comic book inking, anime linework, clip art,
  3d render, octane render, unreal engine screenshot, cgi plastic, clay render, low poly,
  photograph, photorealistic skin pores, stock photo,
  oversaturated neon soup, rainbow lighting, every surface glowing, hdr bloom baked in,
  lens flare, chromatic aberration, film grain, vignette, jpeg artifacts, noise overlay,
  pure black #000000, pure white #ffffff, blown highlights, crushed blacks,
  symmetrical, tidy, pristine, brand new, corporate stock illustration, empty sterile plaza,
  flat even lighting, single neutral light source, grey shadows,
  uniform detail, busy cluttered composition without focal point, three equal masses,
  extra limbs, deformed hands, mangled anatomy, duplicated faces, blurry, out of focus, lowres
`);

/** ART-PROMPTS §0.3 — the settings a backend adapter applies to every request. */
export const GENERATION_SETTINGS = {
  /** FLUX guidance. gpt-image-1 has no CFG knob and uses `quality: 'high'` instead. */
  guidanceScale: 4.5,
  steps: 40,
} as const;

/** Per-class framing, appended after the subject. ART-PROMPTS §1–§6. */
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
    mass, two or three secondary forms, a scatter of small interrupts — antennae, cables, signage,
    laundry lines. Something breaks the frame edge. Human-scale markers visible: doorways, walkways,
    a figure, a parked vehicle. Atmospheric perspective: every quarter of the depth shifts twenty
    percent toward #3d4761 and loses fifteen percent contrast.
  `),
  plate: block(`
    Wide 16:9 cinematic composition, high oblique view over the city at roughly 35 degrees. Rendered
    as a single continuous painted illustration, not a tiled texture. No focal subject — this is a
    stage, and the readable action sits on top of it.
  `),
  building: block(`
    Single isolated structure on a fully transparent background, three-quarter oblique view from
    slightly above, consistent 35-degree camera across all six so they sit together on one ground
    plane. Ground contact in the bottom-centre twenty percent. No cast shadow, no ground, no base
    plate — the renderer adds those. Square 1:1. Silhouette must be distinguishable from the other
    five at twenty-five percent scale filled solid black.
  `),
  ui: block(`
    Game UI element on transparent background, painted rather than vector — hammered and etched
    metal plate with wear at the corners and edges, subtly asymmetric so it does not read as a
    template. Square 1:1, 1024px. The outer 96 pixels are the 9-slice corner and edge region; the
    inner region must be a flat, quiet, tileable field with no detail. Absolutely no text, no
    glyphs, no numerals. Cold #22d3ee key catching the top and left bevels, warm #f59e0b bounce on
    the bottom and right.
  `),
  icon: block(`
    Single centred icon on a fully transparent background, painted with visible brushwork but
    radically simplified — it must read cleanly at 24 pixels. Maximum two values plus one accent
    hue. No text, no outline stroke, no drop shadow, no background plate. Square 1:1, subject
    filling the central seventy percent. Consistent implied light from upper-left across the whole
    set.
  `),
} as const;

/** ART-PROMPTS §1 — keyed by `OverseerPreset.portraitId`. */
export const PORTRAIT_SUBJECTS: Readonly<Record<string, string>> = {
  'overseer-1': block(`
    A broad-shouldered man in his early fifties, ex-corporate security chief turned warlord.
    Shaved head, heavy jaw, a healed burn scar climbing the left side of his neck into a grey-flecked
    stubble beard. Skin in warm ochre midtones (#8f5744, #5a352c) against the cold key. Scuffed matte
    riot armour over a high collar, chest plate cracked and field-welded, unit insignia sanded off.
    One dead eye replaced by a scratched steel ocular that catches the cyan key as a hard specular
    point. Expression: flat, patient, unimpressed — a man who has already decided. Amber #f59e0b
    bounce from below rakes the underside of his jaw and armour ridges. Behind him, a barricade line
    dissolving into smog.
  `),
  'overseer-2': block(`
    A wiry woman in her late twenties, legendary intrusion specialist. Undercut black hair
    with a bleached streak, damp with sweat and stuck to her temple. Pale cool-toned skin taking the
    cyan key almost fully, warmed only along the jaw by the sodium bounce. Four dermal interface ports
    in a neat surgical row behind her right ear, one leaking a hairline of cyan #7ff0ff light. Layered
    technical jacket over a mesh underlayer, cuffs frayed, forearm sleeve pushed up over a splice
    bruise. Expression: mid-thought, focused past the viewer, faintly amused. Her own face is the
    brightest cool value in frame; the background is near-black with two dim #12a2bd server-rack
    glows far behind.
  `),
  'overseer-3': block(`
    A lean man of indeterminate age, forties, a broker of favours and contraband. Slicked
    dark hair going silver at the temples, sharp cheekbones, a fine old blade scar through one eyebrow.
    Deep olive skin, warmly lit — he is the one portrait where the amber #f59e0b bounce leads and the
    cyan key is the rim. Immaculate but decades-out-of-date tailoring: a long charcoal coat over a
    mandarin collar, one gold-toned ring, everything else deliberately unremarkable. Expression: a
    courteous half-smile that does not reach the eyes. Behind him, a market arcade at night reduced to
    warm hanging-lamp smears and one cold sign.
  `),
  'overseer-4': block(`
    A composed Black woman in her forties, former arcology infrastructure director. Close-cropped
    natural hair, strong brow, deep rich skin holding both lights cleanly — cyan along the
    cheekbone and brow, amber under the jaw. Practical engineer's coat over a utility harness, sleeves
    rolled, a smear of conduit grease on one forearm she has not noticed. A slim monocular data lens
    folded up against her temple, its edge catching a thin #7ff0ff line. Expression: tired, certain,
    already three steps into a plan. Behind her, the ribbed interior of a reactor gallery falling away
    into #1b2233 haze with one warm #8a5209 inspection lamp.
  `),
};

/** ART-PROMPTS §2 — keyed by `District.id`. */
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
    funicular track climbs the slope. Quiet, elegiac, almost beautiful — a place that used to be
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
    A vast subterranean utility cavern below the city — the old power grid, still live.
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
  'sprawl-exchange': block(`
    A chaotic covered bazaar filling a collapsed transit interchange — stalls built into the
    carcasses of train carriages, tarpaulins strung across the ruined vaulted roof, warm #f59e0b lamp
    strings threading the whole volume. Dense crowd rendered as suggestion, not detail: values and
    silhouettes only. Smoke from cooking fires catching the light shafts. The one genuinely alive place
    in the city. Warm-led, with the cyan key entering only through the broken roof.
  `),
  'halcyon-plaza': block(`
    A former civic plaza of pale stone colonnades, now an upmarket night market under strings
    of warm #ffd166 lanterns. A monumental fountain long dry, its basin used for stalls. Elegant
    proportions gone slightly shabby: chipped stone, cable runs stapled to columns, a corporate banner
    sun-bleached to illegibility. Better dressed crowd, wider spacing than Sprawl Exchange. Nostalgic,
    faded, faintly sad.
  `),
  'blacksite-7': block(`
    A hardened military compound sunk into a bomb crater — sloped ferrocrete revetments,
    staggered blast walls, a squat command bunker with slit apertures leaking hostile magenta #e11d8f
    light. Automated turret masts on the perimeter. Vehicle ramps descending out of sight. No signage,
    no windows, no invitation. Searchlight beams sweeping the crater walls. The magenta is the only
    saturated colour in frame and it reads as a warning.
  `),
  'combine-spire': block(`
    The single tallest structure in the city — a corporate megaspire punching through the smog
    ceiling into clear air, its lower two thirds lost in haze so only the crowning arcology is legible.
    Buttressed, ribbed, cathedral-like, deliberately intimidating. Magenta #e11d8f beacon light bleeding
    down the ribs; the summit catches an ambient dawn that never reaches the streets. Skybridges
    radiate outward and end in nothing. Seen from below and far away. The most beautiful and the most
    hostile image in the set.
  `),
};

/** ART-PROMPTS §3 — map plates, parallax planes and the auth splash, keyed by asset key. */
export const PLATE_SUBJECTS = {
  'plate-city': block(`
    The mid-ground of a dense cyberpunk city interior seen from above and at an angle — a
    continuous carpet of stacked roofs, canal trenches, elevated roadways, courtyards and light wells,
    with clear negative-space clearings distributed across the frame for interactive markers to sit in.
    Value kept deliberately in the middle range (#1e293b to #55617e) so bright interactive nodes will
    read on top of it. Emissives are small, numerous and low-saturation at this distance. Roughly eleven
    distinguishable neighbourhood characters across the frame, separated by canals, walls and roadways.
    Keep the outer eight percent of the frame quiet.
  `),
  'plane-city-sky': block(`
    Sky and distant arcology silhouettes only. Heavy smog ceiling in #1b2233 to #3d4761
    graduating upward, a diffuse cold light source behind it, and the flat blue-grey silhouettes of
    enormous far towers reduced almost entirely to value with no detail. Nearly abstract. No ground,
    no foreground, no legible structure.
  `),
  'plane-city-far': block(`
    A band of mid-distance city blocks and towers, painted with alpha above the skyline —
    the top forty percent of the canvas is fully transparent. Silhouettes are simplified, values
    compressed toward #2a3348 to #55617e, with sparse tiny window lights. Nothing that breaks the
    skyline may be thinner than three pixels at 2048 wide — antenna masts and spire tips stay blunt
    and stubby, never hairlines, and there are no wires or cables, and the towers are separated by
    open sky at least three pixels wide, never a hairline slot. Detail suppressed: this sits
    behind everything and must never compete.
  `),
  'plane-city-fore': block(`
    Foreground occluding elements only, on transparent background, arranged around the frame
    edges and corners — a cantilevered pipe run entering from the upper left, a heavy sagging cable
    trunk across the top, a signage gantry in the lower right, a crane arm cutting the upper right
    corner. Near-silhouette, values #05070d to #1e293b, with a cold rim on the key side. Nothing may
    be thinner than three pixels at 2048 wide — the cable trunk is one heavy sagging mass, the rim a
    broad band, and the gantry and crane arm are built from chunky box members rather than open
    lattice or truss work, with no hairline wires and no single-pixel rims or edges, and every gap of
    open background these elements leave against the frame is at least three pixels wide, never a
    hairline slot. The central sixty percent of the canvas must be fully transparent.
  `),
  'splash-auth': block(`
    A lone figure seen from behind, small in frame, standing at a railing overlooking the
    whole city at night in rain. The city fills the lower two thirds as a field of tiny warm and cold
    lights under smog; the Combine Spire is a dark presence far right. Keep the central forty percent
    by fifty percent of the canvas low-contrast, quiet and free of detail — a login form sits there.
    The most romantic and most haunting image in the game.
  `),
} as const;

/** ART-PROMPTS §4 — keyed by `BuildingKind`. */
export const BUILDING_SUBJECTS: Readonly<Record<BuildingKind, string>> = {
  command_center: block(`
    A fortified command post — a low armoured drum with a canted upper observation ring of
    slit windows glowing cold #22d3ee, a cluster of antenna masts and a dish offset to one side, and an
    external stair spiralling to a roof hatch. Sandbagged at the base, cabling bundled down one flank.
    Authoritative, squat, the tallest silhouette by a small margin.
  `),
  reactor: block(`
    A fusion reactor housing — a fat containment torus in a scaffold cradle, ribbed cooling
    fins, three exhaust stacks venting white vapour. Seams and inspection ports leak hot #f59e0b light;
    one warning-striped panel is missing and field-patched. The only warm-dominant building of the six.
    Heavy, industrial, faintly menacing.
  `),
  data_hub: block(`
    A slim windowless server stack — a vertical black slab of racked modules behind a louvred
    skin, cold #12a2bd status light bleeding through the louvres in horizontal bands. A dense fan of
    fibre trunking sweeps out of its base and off the ground contact. Thermal shimmer above. The
    tallest and thinnest silhouette.
  `),
  foundry: block(`
    A smelting works — an angled furnace body with a pour spout, a raised charging deck, a
    crooked flue stack trailing dark smoke, and a scrap heap fused into its flank. The pour glows
    #ffd166 through the spout gap and lights the underside of the deck. Widest, lowest, most cluttered
    silhouette. Grimiest of the six.
  `),
  barracks: block(`
    A troop block — a long two-storey prefab hall with a covered arcade, shuttered bunk
    windows, an external kit rack, a drying line, and a small sandbagged muster yard fused to the
    front edge. Warm #f59e0b interior light in two windows only; the rest dark. The most obviously
    inhabited of the six: personal clutter, a chair, boots.
  `),
  wall: block(`
    A perimeter wall section — a ferrocrete slab wall with a razorwire crown, one buttressed
    pier, a firing step behind, and a single armoured gate leaf hung slightly out of true. Impact
    scarring and hasty patch-plates across the face. Lowest and widest silhouette; must read as
    horizontal against the other five.
  `),
};

/** ART-PROMPTS §5 — UI frames and HUD plates, keyed by asset key. */
export const UI_SUBJECTS = {
  'ui-frame-panel': block(`
    A rectangular equipment-panel frame of dark #1e293b brushed steel with a thin inset
    channel, four hex-socket bolts recessed at the corners, and a hairline of cyan #22d3ee light in the
    inner channel as though lit from behind. One corner shows a chipped edge and a paint scuff.
  `),
  'ui-frame-modal': block(`
    A heavier armoured hatch frame — thicker bezel than the panel, chamfered outer edge,
    two recessed handle lugs top and bottom, faint radial scoring across the plate, and a warning-stripe
    remnant worn nearly away along the lower edge. Cyan channel light, slightly brighter than
    the panel frame.
  `),
  'ui-frame-hud': block(`
    A wide horizontal instrument plate spanning the full width, with a raised rail along the
    bottom edge, six evenly spaced blank recessed instrument bays across the middle band, and mounting
    brackets at both ends. The bays are empty sockets — no dials, no readouts, no text.
  `),
  'ui-plate-button': block(`
    A single rectangular pressable key plate — slightly domed face, chamfered edge, worn
    brighter in the centre where a thumb has rubbed it for years, a thin cyan #22d3ee underglow escaping
    from the seam beneath. Quiet and dark; this must not compete with the label the app renders on top.
  `),
  'ui-plate-nav': block(`
    A tall narrow vertical rail plate with a repeating ladder of blank recessed mounting slots
    down its length, a cable channel along one side, and a cyan #22d3ee light strip running the full
    height in a recessed groove. The slots are empty — no icons.
  `),
  'ui-divider': block(`
    A thin horizontal trim strip — a machined groove with a single cyan #22d3ee filament in
    it, terminating at both ends in a small bolted end-cap. Extreme aspect: the element occupies only
    the central horizontal eighth of the canvas; the rest is fully transparent.
  `),
} as const;

/** ART-PROMPTS §6.1 — keyed by `Resources` key. */
export const RESOURCE_ICON_SUBJECTS: Readonly<Record<keyof Resources, string>> = {
  credits: block(`
    A short stack of worn hexagonal transaction chits, top one tilted, edges nicked, a faint
    amber #f59e0b glyph-glow along the rim of the top chit.
  `),
  power: block(`
    A heavy industrial cell canister with a ribbed body and two terminal lugs, an amber #ffd166
    charge window glowing down one side.
  `),
  data: block(`
    A solid-state data slug — a small dark wedge with a gold contact comb along one edge and a
    cyan #22d3ee status filament across its face.
  `),
  alloy: block(`
    Three stacked rough-cast metal ingots with hammered faces and scale still on them, cold
    #94a3b8 specular on the top edges, one cracked corner.
  `),
};

/** ART-PROMPTS §6.2 — keyed by `OverseerArchetype`. */
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

/** ART-PROMPTS §6.3 — keyed by `DistrictKind`. */
export const DISTRICT_KIND_ICON_SUBJECTS: Readonly<Record<DistrictKind, string>> = {
  player_base: block(`
    A small fortified compound seen from above — a walled square with a central drum and a gate
    notch, cyan #22d3ee light in the courtyard.
  `),
  raid: block(`
    A breached wall segment with rubble spilling through the gap and one amber #f59e0b ember
    glow at the break.
  `),
  market: block(`
    A cluster of three market awnings seen from above, tarpaulins sagging, a single warm lamp
    point between them.
  `),
  npc_stronghold: block(`
    A blunt hexagonal bunker seen from above with sloped revetments on every face and a magenta
    #e11d8f slit aperture at the centre.
  `),
};
