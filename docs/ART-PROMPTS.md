# Frontline — Prompt Pack

Ready-to-run generation prompts, one per required asset. Paste these into any image tool, or let
`scripts/gen-art.ts` run them against a configured backend.

**How to use.** Every prompt is `STYLE ANCHOR` + `SUBJECT` + `FRAMING`, sharing one `NEGATIVE`
prompt and a **fixed seed**. The anchor is what keeps 44 separately-generated assets looking like
one game — do not paraphrase it, do not drop hex codes, do not reorder it. Change only the subject
block.

**Style contract:** [`ART-BIBLE.md`](ART-BIBLE.md). Any prompt output that trips the §10 rejection
checklist is rejected regardless of how good it looks.

---

## 0. The shared blocks

### 0.1 STYLE ANCHOR — prepend verbatim to every prompt

```
Hand-painted digital illustration in the style of Arcane (Fortiche) — painterly oil-and-gouache
brushwork over solid draughtsmanship, between stylised and photoreal, never cel-shaded, never
vector-flat. A Zaun-like undercity: cyberpunk machinery bolted onto a broken-down post-war
society, never a clean future. Scrap and salvage are the building material — corrugated iron,
patched brick, mismatched timber, cannibalised plating, jury-rigged pipework and cabling slung
between structures nobody planned. Old, wrecked and newly-bolted-on machines stand side by side;
nothing matches, nothing is finished, much of it is still broken. Split lighting: cold cyan key
light (#22d3ee) from upper-left at 35 degrees, weak warm sodium bounce (#f59e0b) from lower-right
at 40 percent intensity; shadows tinted, never neutral grey. Desaturated structural midtones in
slate and ferrite (#1e293b, #475569, #94a3b8) against deep blue-black (#0a0e17, #05070d) and
drifting smog (#3d4761, #55617e); saturation reserved for emissives only. Broken rim light along
40-60 percent of the contour, two ramp stops brighter than the edge it runs along. Lost-and-found
edges — crisp at the focal point, dissolving into atmospheric haze at depth. Visible brush
economy: detail concentrated in the focal twenty percent, broad confident strokes elsewhere.
Every surface shows wear, repair or decay; rust, soot, water-staining and improvised patching are
the default finish and polished chrome is not. Emissives painted at their own hue rather than
white-hot — sodium bulbs, cracked signage, exposed filament, lit unevenly with whole sections
gone dark. Cinematic, moody, beautiful and quietly haunting.
```

### 0.2 NEGATIVE — apply to every prompt

```
text, letters, words, watermark, signature, logo, ui overlay, hud, frame, border, caption,
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
```

### 0.3 Global generation settings

| Setting        | Value                                      | Why                                                          |
| -------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Guidance / CFG | 4.5 (FLUX) · `quality: high` (gpt-image-1) | Higher over-bakes the anchor into mush                       |
| Steps          | 40                                         | Diminishing returns above; below 30 loses edge control       |
| Sampler        | default per backend                        | Not a differentiator at this scale                           |
| Candidates     | 3 per asset (5 for portraits)              | Budget in ADR 0001 §6.5                                      |
| Seed           | **fixed per asset, listed below**          | Re-runs must be reproducible; record it in `provenance.json` |

Seeds are deliberately fixed and boring (`<class-base> + index`) so a human can regenerate any
single asset without consulting a log. If an asset needs a different roll, record the _new_ seed in
the manifest — never leave it unrecorded.

---

## 1. Overseer portraits — 4 assets

**Class framing** (append to each, after the subject):

```
Head-and-shoulders portrait, three-quarter view, eyes on the upper-third line, subject facing
slightly left into the key light. Shallow implied depth: background is an out-of-focus city
interior reduced to smog and two or three emissive smears. Vertical 3:4 composition. Face within
the central seventy percent; nothing essential in the bottom eighteen percent.
```

| Key                   | File                       | Seed     |
| --------------------- | -------------------------- | -------- |
| `portrait-overseer-1` | `portrait-overseer-1.webp` | `110001` |
| `portrait-overseer-2` | `portrait-overseer-2.webp` | `110002` |
| `portrait-overseer-3` | `portrait-overseer-3.webp` | `110003` |
| `portrait-overseer-4` | `portrait-overseer-4.webp` | `110004` |

### 1.1 `portrait-overseer-1` — Marcus "Bulwark" Kane (enforcer)

```
SUBJECT: A broad-shouldered man in his early fifties, ex-corporate security chief turned warlord.
Shaved head, heavy jaw, a healed burn scar climbing the left side of his neck into a grey-flecked
stubble beard. Skin in warm ochre midtones (#8f5744, #5a352c) against the cold key. Scuffed matte
riot armour over a high collar, chest plate cracked and field-welded, unit insignia sanded off.
One dead eye replaced by a scratched steel ocular that catches the cyan key as a hard specular
point. Expression: flat, patient, unimpressed — a man who has already decided. Amber #f59e0b
bounce from below rakes the underside of his jaw and armour ridges. Behind him, a barricade line
dissolving into smog.
```

### 1.2 `portrait-overseer-2` — Yumi "Ghostwire" Tanaka (netrunner)

```
SUBJECT: A wiry woman in her late twenties, legendary intrusion specialist. Undercut black hair
with a bleached streak, damp with sweat and stuck to her temple. Pale cool-toned skin taking the
cyan key almost fully, warmed only along the jaw by the sodium bounce. Four dermal interface ports
in a neat surgical row behind her right ear, one leaking a hairline of cyan #7ff0ff light. Layered
technical jacket over a mesh underlayer, cuffs frayed, forearm sleeve pushed up over a splice
bruise. Expression: mid-thought, focused past the viewer, faintly amused. Her own face is the
brightest cool value in frame; the background is near-black with two dim #12a2bd server-rack
glows far behind.
```

### 1.3 `portrait-overseer-3` — Silas Vex (fixer)

```
SUBJECT: A lean man of indeterminate age, forties, a broker of favours and contraband. Slicked
dark hair going silver at the temples, sharp cheekbones, a fine old blade scar through one eyebrow.
Deep olive skin, warmly lit — he is the one portrait where the amber #f59e0b bounce leads and the
cyan key is the rim. Immaculate but decades-out-of-date tailoring: a long charcoal coat over a
mandarin collar, one gold-toned ring, everything else deliberately unremarkable. Expression: a
courteous half-smile that does not reach the eyes. Behind him, a market arcade at night reduced to
warm hanging-lamp smears and one cold sign.
```

### 1.4 `portrait-overseer-4` — Dr. Adaeze Okafor (technocrat)

```
SUBJECT: A composed Black woman in her forties, former arcology infrastructure director.
Close-cropped natural hair, strong brow, deep rich skin holding both lights cleanly — cyan along the
cheekbone and brow, amber under the jaw. Practical engineer's coat over a utility harness, sleeves
rolled, a smear of conduit grease on one forearm she has not noticed. A slim monocular data lens
folded up against her temple, its edge catching a thin #7ff0ff line. Expression: tired, certain,
already three steps into a plan. Behind her, the ribbed interior of a reactor gallery falling away
into #1b2233 haze with one warm #8a5209 inspection lamp.
```

---

## 2. District illustrations — 10 assets

**Class framing** (append to each):

```
Oblique three-quarter aerial view looking down at roughly 40 degrees, horizon at forty percent
height. Square 1:1 composition, focal subject within the central eighty percent. One dominant
mass, two or three secondary forms, a scatter of small interrupts — antennae, cables, signage,
laundry lines. Something breaks the frame edge. Human-scale markers visible: doorways, walkways, a
figure, a parked vehicle. Atmospheric perspective: every quarter of the depth shifts twenty
percent toward #3d4761 and loses fifteen percent contrast.
```

Ids match `District.id` in `@frontline/shared`.

| Key                          | District             | Kind        | Seed     |
| ---------------------------- | -------------------- | ----------- | -------- |
| `district-neon-docks`        | Neon Docks           | residential | `120001` |
| `district-ashen-terraces`    | Ashen Terraces       | residential | `120002` |
| `district-kettle-row`        | Kettle Row           | residential | `120003` |
| `district-rustyard`          | The Rustyard         | contested   | `120004` |
| `district-chrome-row`        | Chrome Row           | contested   | `120005` |
| `district-undergrid`         | The Undergrid        | contested   | `120006` |
| `district-datavault-sigma`   | Datavault Sigma      | contested   | `120007` |
| `district-glasshouse-fields` | Glasshouse Fields    | contested   | `120008` |
| `district-blacksite-7`       | Blacksite 7          | contested   | `120009` |
| `district-combine-spire`     | Spire of the Combine | contested   | `120010` |

### 2.1 `district-neon-docks` — residential, difficulty 1

```
SUBJECT: A working freight dock built into a flooded canal trench under a raised motorway. Stacked
container housing welded into terraces, corrugated shutters, a gantry crane leaning past its safe
angle. Black water below throwing vertical smeared cyan #22d3ee reflections from a wall of hanging
shop signs. Washing lines strung between containers. This is home: worn, cramped, defended, warm
with life at the small scale even as the structure fails. One tug boat moored, one figure on the
quay.
```

### 2.2 `district-ashen-terraces` — residential, difficulty 4

```
SUBJECT: A hillside of stepped concrete tenements under a permanent fall of pale ash, terraces
planted with dead and dying greenery. Amber #f59e0b sodium lamps burning through the ashfall in
soft haloes; laundry grey with fallout. Retaining walls buttressed with scavenged steel. A
funicular track climbs the slope. Quiet, elegiac, almost beautiful — a place that used to be
desirable. Two figures on separate terraces, not looking at each other.
```

### 2.3 `district-kettle-row` — residential, difficulty 2

```
SUBJECT: A long residential terrace along a southern cut, boiler houses venting between every
third building so the whole street sits under drifting warm-lit steam. Washing strung across the
gap at three storeys. Front steps in constant use — this is the one district rendered as
*inhabited* rather than as infrastructure: figures on the steps, a game in the road, a repaired
door standing open. Warm #f59e0b sodium led, the cyan key arriving only down the length of the
cut.
```

### 2.4 `district-rustyard` — contested, difficulty 2

```
SUBJECT: A ship-breaking yard of beached hulls half-dismantled in orange mud, ribs of vessels
standing like cathedral vaulting. Cutting torches throwing small hot #ffd166 pools against the
enormous cold mass of the hulls. Slag heaps, chained dogs, a crane made from three other cranes.
Rust in every value from #4a2a05 to #c47c0d. Scale enforced by tiny figures walking a hull's
spine.
```

### 2.5 `district-chrome-row` — contested, difficulty 4

```
SUBJECT: A narrow canyon street of clinic frontages and body-modification parlours, every window a
cold #22d3ee vitrine glowing into wet asphalt. Overhead a dense mat of cabling and cantilevered
signage boards blocks the sky. Queues under awnings. Chrome and glass are the dominant materials
and they are all scratched, taped and patched. Vertical smeared reflections down the whole street.
Predatory, clinical, expensive.
```

### 2.6 `district-undergrid` — contested, difficulty 5

```
SUBJECT: A vast subterranean utility cavern below the city — the old power grid, still live.
Bundled conduit running the walls like roots, transformer housings the size of buildings, standing
water skinned with iridescent chemical film. The only light is toxic green #43b56e leaking from
coolant seams and inspection ports, with the cyan key entering as a single distant shaft from a
grate far above. Catwalks at three levels. Oppressive, immense, wet, humming.
```

### 2.7 `district-datavault-sigma` — contested, difficulty 6

```
SUBJECT: A windowless black monolith of a data fortress, its face broken only by cooling louvres
exhaling white vapour lit cold #22d3ee from within. Set in a cleared exclusion zone of cracked
concrete and dead lighting columns. A single armoured entry ramp. Fibre trunking as thick as tree
roots enters the ground at its base. Absolutely no human warmth: the one human-scale marker is a
lone sentry booth dwarfed at the ramp foot.
```

### 2.8 `district-glasshouse-fields` — contested, difficulty 3

```
SUBJECT: Kilometres of cracked hydroponic glasshouses on a rooftop plateau, half their panes gone,
mutated green #2f8551 growth spilling out and climbing the frames. Grow-lamps still running inside
a few intact bays, throwing a sick green glow up into the smog ceiling. Irrigation pipework
leaking into rust runs. A collapsed section reveals the city drop below. Overgrown, abandoned,
strangely serene.
```

### 2.9 `district-blacksite-7` — contested, difficulty 8

```
SUBJECT: A hardened military compound sunk into a bomb crater — sloped ferrocrete revetments,
staggered blast walls, a squat command bunker with slit apertures leaking hostile magenta #e11d8f
light. Automated turret masts on the perimeter. Vehicle ramps descending out of sight. No signage,
no windows, no invitation. Searchlight beams sweeping the crater walls. The magenta is the only
saturated colour in frame and it reads as a warning.
```

### 2.10 `district-combine-spire` — contested, difficulty 10

```
SUBJECT: The single tallest structure in the city — a corporate megaspire punching through the
smog ceiling into clear air, its lower two thirds lost in haze so only the crowning arcology is
legible. Buttressed, ribbed, cathedral-like, deliberately intimidating. Magenta #e11d8f beacon
light bleeding down the ribs; the summit catches an ambient dawn that never reaches the streets.
Skybridges radiate outward and end in nothing. Seen from below and far away. The most beautiful
and the most hostile image in the set.
```

---

## 3. Map plates and parallax planes — 6 assets

**Class framing:**

```
Wide 16:9 cinematic composition, high oblique view at roughly 35 degrees. Rendered as
a single continuous painted illustration, not a tiled texture. No focal subject — this is a stage,
and the readable action sits on top of it.
```

| Key               | Seed     | Alpha                   |
| ----------------- | -------- | ----------------------- |
| `plate-city`      | `130001` | opaque                  |
| `plane-city-sky`  | `130002` | opaque                  |
| `plane-city-far`  | `130003` | alpha, ≥30% transparent |
| `plane-city-fore` | `130004` | alpha, ≥55% transparent |
| `splash-auth`     | `130005` | opaque                  |

### 3.1 `plate-city` — the map base plate (plane 2)

```
SUBJECT: The mid-ground of a dense cyberpunk city interior seen from above and at an angle — a
continuous carpet of stacked roofs, canal trenches, elevated roadways, courtyards and light wells,
with clear negative-space clearings distributed across the frame for interactive markers to sit in.
Value kept deliberately in the middle range (#1e293b to #55617e) so bright interactive nodes will
read on top of it. Emissives are small, numerous and low-saturation at this distance. Roughly eleven
distinguishable neighbourhood characters across the frame, separated by canals, walls and roadways.
Keep the outer eight percent of the frame quiet.
```

### 3.2 `plane-city-sky` — far background (plane 0)

```
SUBJECT: Sky and distant arcology silhouettes only. Heavy smog ceiling in #1b2233 to #3d4761
graduating upward, a diffuse cold light source behind it, and the flat blue-grey silhouettes of
enormous far towers reduced almost entirely to value with no detail. Nearly abstract. No ground,
no foreground, no legible structure.
```

### 3.3 `plane-city-far` — far city mass (plane 1)

```
SUBJECT: A band of mid-distance city blocks and towers standing against a flat unshaded magenta
#ff00ff background — everything above the skyline, the top forty percent of the canvas, is that
magenta and nothing else, with no gradient, glow, haze or shading in it. Silhouettes are simplified,
values compressed toward #2a3348 to #55617e, with sparse tiny window lights. No magenta, pink or
violet appears anywhere in the towers themselves. Nothing that breaks the skyline may be thinner than
three pixels at 2048 wide — antenna masts and spire tips stay blunt and stubby, never hairlines, and
there are no wires or cables, and the towers are separated by open magenta at least three pixels
wide, never a hairline slot. Detail suppressed: this sits behind everything and must never compete.
```

### 3.4 `plane-city-fore` — foreground occluders (plane 4)

```
SUBJECT: Foreground occluding elements only, on a flat unshaded magenta #ff00ff background, arranged
around the frame edges and corners — a cantilevered pipe run entering from the upper left, a heavy
sagging cable trunk across the top, a signage gantry in the lower right, a crane arm cutting the
upper right corner. Near-silhouette, values #05070d to #1e293b, with a cold rim on the key side, and
no magenta, pink or violet anywhere in the elements themselves. Nothing may be thinner than three
pixels at 2048 wide — the cable trunk is one heavy sagging mass, the rim a broad band, and the gantry
and crane arm are built from chunky box members rather than open lattice or truss work, with no
hairline wires and no single-pixel rims or edges, and every gap of open magenta these elements leave
against the frame is at least three pixels wide, never a hairline slot. The central sixty percent of
the canvas must be flat magenta and nothing else.
```

### 3.5 `splash-auth` — login backdrop

```
SUBJECT: A lone figure seen from behind, small in frame, standing at a railing overlooking the
whole city at night in rain. The city fills the lower two thirds as a field of tiny warm and cold
lights under smog; the Combine Spire is a dark presence far right. Keep the central forty percent
by fifty percent of the canvas low-contrast, quiet and free of detail — a login form sits there.
The most romantic and most haunting image in the game.
```

### 3.6 `plate-district` — the district ground (§A1)

```
SUBJECT: A crew's own walled compound seen from directly above and slightly forward, a town-view
camera with **no sky and no horizon** — the whole frame is ground. Drawn as the ground *only*:
the structures are painted separately and dropped on top, so every place one would stand is an
empty, flat, quiet pad. Thirteen such pads in three staggered rows of four, five and four,
spread wide apart, with broad dirt roads and duckboard walkways running between them in both
directions and off all four edges — the lanes between the pads are the whole composition, and
they must read as somewhere people walk. Ground is packed dirt, cracked slab, gravel and puddled
standing water, patched with steel plate and old rail. The top edge of the frame is the
compound's back wall: gabion baskets, sheet pile, stacked containers and a lit guard post, not
open country. Scatter lives beside the roads and never on a pad — spoil heaps, oil drums, pallet
stacks, a burnt-out chassis, cable runs pinned along the wall, drying laundry strung between
poles. Value kept in the middle range (#1e293b to #55617e), the ground reading a step warmer and
darker as it comes toward the viewer. Cold #22d3ee key from upper left, weak sodium #f59e0b
bounce. Emissives are small, sparse and at ground level: a strung bulb line, a marker lamp, a
brazier. No buildings. Nothing on the pads. No text.
```

---

## 4. District building sprites — 12 assets

**Class framing:**

```
Single isolated structure on a fully transparent background, three-quarter oblique view from
slightly above, consistent 35-degree camera across all thirteen so they sit together on one ground
plane. Ground contact in the bottom-centre twenty percent. No cast shadow, no ground, no base
plate — the renderer adds those. Square 1:1. Silhouette must be distinguishable from the other
twelve at twenty-five percent scale filled solid black.
```

Ids match `BuildingKind` in `@frontline/shared`.

| Key                   | Building       | Seed     |
| --------------------- | -------------- | -------- |
| `building-nexus`      | The Nexus      | `140001` |
| `building-quarters`   | The Quarters   | `140002` |
| `building-greenhouse` | The Greenhouse | `140003` |
| `building-generator`  | The Generator  | `140004` |
| `building-scrapyard`  | The Scrapyard  | `140005` |
| `building-cistern`    | The Cistern    | `140006` |
| `building-apothecary` | The Apothecary | `140007` |
| `building-gate`       | The Gate       | `140008` |
| `building-lab`        | The Lab        | `140010` |
| `building-gauntlet`   | The Gauntlet   | `140011` |
| `building-infirmary`  | The Infirmary  | `140012` |
| `building-garage`     | The Garage     | `140013` |

### 4.1 `building-nexus`

```
SUBJECT: A commandeered transit hub turned command post — a low armoured drum with a canted upper
observation ring of slit windows glowing cold #22d3ee, a cluster of antenna masts and a dish
offset to one side, an external stair spiralling to a roof hatch, and a faded transit chevron
still legible on the drum. Sandbagged at the base, cabling bundled down one flank. Authoritative,
squat, the tallest silhouette by a small margin.
```

### 4.2 `building-quarters`

```
SUBJECT: Stacked living containers — three tiers of shipping cans welded into a block, external
stairs zigzagging the face, a drying line strung between two tiers, window cutouts glowing warm
#f59e0b in an irregular scatter. A stove flue trails thin smoke from the top tier. The most
obviously inhabited silhouette: personal clutter, a chair, boots.
```

### 4.3 `building-greenhouse`

```
SUBJECT: A grow-house — a long low barrel-vault of mismatched salvaged glazing on a steel rib
frame, condensation fogging the panels, dense green foliage pressed against them from inside. Grow
lamps burn a flat magenta-white #f0abfc through the fog in even bands. A rainwater tank strapped
to one gable. Horizontal, softly glowing, the only green in the district.
```

### 4.4 `building-generator`

```
SUBJECT: A turbine block — a fat containment drum in a scaffold cradle, ribbed cooling fins, three
exhaust stacks venting white vapour, and a bunded fuel tank fused to one flank with a hose run to
the drum. Seams and inspection ports leak hot #f59e0b light; one warning-striped panel is missing
and field-patched. Heavy, industrial, faintly menacing.
```

### 4.5 `building-scrapyard`

```
SUBJECT: A salvage works — an angled press house with a torch bay open to the air, a raised
sorting deck, a crooked flue stack trailing dark smoke, a gantry crane over a scrap heap fused
into its flank. Cutting sparks throw #ffd166 light up under the deck. Widest and lowest of the
industrial group, and the most cluttered silhouette in the district.
```

### 4.6 `building-cistern`

```
SUBJECT: A water treatment stack — two riveted settling tanks of differing heights joined by an
external pipe bridge, a sand-filter housing at the base, and a UV stage bolted on last in
obviously newer metal. A cold #22d3ee inspection lamp over the outflow. Wet staining down the tank
flanks. Cylindrical, paired, immediately unlike anything else on the ground.
```

### 4.7 `building-apothecary`

```
SUBJECT: A dispensary-warehouse — a windowless block with one heavy roller shutter half raised,
deep racking visible in the gap, a small barred serving hatch beside it lit warm #f59e0b, and
hand-painted apothecary symbols weathering off the render. Crates stacked under an awning. Closed,
orderly, guarded — the only building that looks locked.
```

### 4.8 `building-gate`

```
SUBJECT: A perimeter gate — a ferrocrete slab wall with a razorwire crown, one buttressed pier, a
firing step behind, and a single armoured gate leaf hung slightly out of true. Impact scarring and
hasty patch-plates across the face. Lowest and widest silhouette; must read as horizontal against
everything else.
```

### 4.9 `building-lab`

```
SUBJECT: A research stack — a vertical black slab of racked datacores behind a louvred skin, cold
#12a2bd status light bleeding through the louvres in horizontal bands, a whiteboard wall visible
through one lit ground-floor window. A dense fan of fibre trunking sweeps out of its base. Thermal
shimmer above. The tallest and thinnest silhouette.
```

### 4.10 `building-gauntlet`

```
SUBJECT: A training ground — an open run of welded obstacles, a climbing frame of scaffold pipe, a
rope wall and a low crawl tunnel, with a single-storey equipment shed at one end and a flood lamp
on a pole throwing hard white light across the course. Mostly open ground: the one plot that reads
as an *area* rather than a structure.
```

### 4.11 `building-infirmary`

```
SUBJECT: A clinic — a small clean-walled prefab with a red-cross panel repainted over something
else, a wide entry ramp, a sealed vestibule with an interior lamp burning steady cold white, and a
stack of gas cylinders chained beside the door. An air handler grumbling on the roof. The tidiest
building on the ground, deliberately at odds with everything around it.
```

### 4.12 `building-garage`

```
SUBJECT: A motor pool — a deep-mouthed open bay tall enough for a mast, a gantry crane on rails
across the opening, an inspection pit with a stripped chassis over it, and a half-built rotor
assembly on trestles to one side under a tarpaulin. Work lamps on stands throw long shadows out of
the bay. The deepest silhouette: the only one that reads as an interior.
```

---

## 5. UI frames and HUD elements — 6 assets

**Class framing:**

```
Game UI element on transparent background, painted rather than vector — hammered and etched metal
plate with wear at the corners and edges, subtly asymmetric so it does not read as a template.
Square 1:1, 1024px. The outer 96 pixels are the 9-slice corner and edge region; the inner region
must be a flat, quiet, tileable field with no detail. Absolutely no text, no glyphs, no numerals.
Cold #22d3ee key catching the top and left bevels, warm #f59e0b bounce on the bottom and right.
```

| Key               | Element                   | Seed     |
| ----------------- | ------------------------- | -------- |
| `ui-frame-panel`  | Side/context panel frame  | `150001` |
| `ui-frame-modal`  | Modal dialogue frame      | `150002` |
| `ui-frame-hud`    | Top HUD bar plate         | `150003` |
| `ui-plate-button` | Button plate (rest state) | `150004` |
| `ui-plate-nav`    | Left-nav rail plate       | `150005` |
| `ui-divider`      | Section divider / rule    | `150006` |

### 5.1 `ui-frame-panel`

```
SUBJECT: A rectangular equipment-panel frame of dark #1e293b brushed steel with a thin inset
channel, four hex-socket bolts recessed at the corners, and a hairline of cyan #22d3ee light in the
inner channel as though lit from behind. One corner shows a chipped edge and a paint scuff.
```

### 5.2 `ui-frame-modal`

```
SUBJECT: A heavier armoured hatch frame — thicker bezel than the panel, chamfered outer edge,
two recessed handle lugs top and bottom, faint radial scoring across the plate, and a
warning-stripe remnant worn nearly away along the lower edge. Cyan channel light, slightly brighter
than the panel frame.
```

### 5.3 `ui-frame-hud`

```
SUBJECT: A wide horizontal instrument plate spanning the full width, with a raised rail along the
bottom edge, six evenly spaced blank recessed instrument bays across the middle band, and mounting
brackets at both ends. The bays are empty sockets — no dials, no readouts, no text.
```

### 5.4 `ui-plate-button`

```
SUBJECT: A single rectangular pressable key plate — slightly domed face, chamfered edge, worn
brighter in the centre where a thumb has rubbed it for years, a thin cyan #22d3ee underglow escaping
from the seam beneath. Quiet and dark; this must not compete with the label the app renders on top.
```

### 5.5 `ui-plate-nav`

```
SUBJECT: A tall narrow vertical rail plate with a repeating ladder of blank recessed mounting slots
down its length, a cable channel along one side, and a cyan #22d3ee light strip running the full
height in a recessed groove. The slots are empty — no icons.
```

### 5.6 `ui-divider`

```
SUBJECT: A thin horizontal trim strip — a machined groove with a single cyan #22d3ee filament in
it, terminating at both ends in a small bolted end-cap. Extreme aspect: the element occupies only
the central horizontal eighth of the canvas; the rest is fully transparent.
```

---

## 6. Icons — 31 assets

**Class framing:**

```
Single centred icon on a fully transparent background, painted with visible brushwork but
radically simplified — it must read cleanly at 24 pixels. Maximum two values plus one accent hue.
No text, no outline stroke, no drop shadow, no background plate. Square 1:1, subject filling the
central seventy percent. Consistent implied light from upper-left across the whole set.
```

### 6.1 Resource icons — ids are the kebab-cased `Resources` keys

| Key                       | Seed     | Subject                                                                                                                                                                                                                        |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icon-caps`               | `160001` | `SUBJECT: A loose handful of crimped bottle caps, painted faces scratched back to bare steel, one standing on edge against the pile, warm amber #f59e0b catching the ridged rims.`                                             |
| `icon-food`               | `160002` | `SUBJECT: A dented ration tin with its lid peeled half back on a torn hinge of metal, a scorched crust of pressed protein inside, the paper label stripped to a pale ghost, warm amber #ffd166 glancing off the peeled edge.`  |
| `icon-oil`                | `160003` | `SUBJECT: A squat riveted fuel drum with a hand-cranked spigot, a black bead swelling at the nozzle and a thin slick pooling beneath it, seams weeping rust, cyan #22d3ee iridescence riding the surface of the slick.`        |
| `icon-scrap`              | `160004` | `SUBJECT: A bundle of salvaged offcuts wired together at the middle — bent rebar, a torn hull plate, a coiled length of stripped cable — cold #94a3b8 light along the freshly broken edges, dull and powdery everywhere else.` |
| `icon-high-quality-metal` | `160005` | `SUBJECT: Three stacked machined ingots with clean milled faces and a cast foundry stamp still legible on the top one, a cold #22d3ee temper sheen along the top edges, one corner cracked away to show bright grain.`         |

### 6.2 Archetype icons — ids match `OverseerArchetype`

| Key                         | Seed     | Subject                                                                                                                                               |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon-archetype-enforcer`   | `160011` | `SUBJECT: A battered riot shield seen at a slight angle, one corner deformed by impact, a single magenta #e11d8f warning band across it.`             |
| `icon-archetype-netrunner`  | `160012` | `SUBJECT: A dermal interface jack plug trailing a coiled lead, contact pins catching cyan #22d3ee light, lead disappearing off the lower edge.`       |
| `icon-archetype-fixer`      | `160013` | `SUBJECT: An old brass-bodied key card held between the implied thumb and finger of no visible hand, worn to a shine, warm amber #f59e0b edge light.` |
| `icon-archetype-technocrat` | `160014` | `SUBJECT: A machined gear-and-caliper pairing, teeth worn unevenly, a green #43b56e calibration filament between the caliper jaws.`                   |

### 6.3 District-kind map icons — ids match `DistrictKind`

| Key                     | Seed     | Subject                                                                                                                                                  |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon-kind-residential` | `160021` | `SUBJECT: A small fortified compound seen from above — a walled square with a central drum and a gate notch, cyan #22d3ee light in the courtyard.`       |
| `icon-kind-contested`   | `160022` | `SUBJECT: Four small blocks around a crossroads seen from above, one of them breached and spilling rubble, a single magenta #e11d8f ember at the break.` |

### 6.4 Place map icons — ids match `PlaceKind`

One marker per _kind_ of place, not per place: thirty-one places share twenty kinds, and a player reads the kind off the map.

| Key                                | Seed     | Subject                                                                                                                                             |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon-place-scrap-press`           | `160031` | `SUBJECT: A baling press seen from above with a squared bale on the outfeed and a scatter of loose swarf, warm #f59e0b rust tones.`                 |
| `icon-place-chemical-plant`        | `160032` | `SUBJECT: Three cracking towers of descending height joined by a pipe run, one venting a pale #86e6a8 plume.`                                       |
| `icon-place-power-station`         | `160033` | `SUBJECT: A transformer bank of four ribbed cylinders behind a mesh fence, cold #22d3ee arc light between two of them.`                             |
| `icon-place-water-works`           | `160034` | `SUBJECT: Two circular settling beds seen from above with a radial sweep arm on each, water reading as flat #12a2bd.`                               |
| `icon-place-foundry`               | `160035` | `SUBJECT: A cupola furnace with a tapping spout, the pour glowing #ffd166 across the floor plate beneath it.`                                       |
| `icon-place-market`                | `160036` | `SUBJECT: A cluster of three market awnings seen from above, tarpaulins sagging, a single warm lamp point between them.`                            |
| `icon-place-pawn-shop`             | `160037` | `SUBJECT: A barred serving hatch in a blank wall with three hanging balls above it, one warm #f59e0b lamp inside the bars.`                         |
| `icon-place-high-ground`           | `160038` | `SUBJECT: A water tower on lattice legs above a rooftop parapet, seen at a low angle, cold rim light along the tank.`                               |
| `icon-place-barricade`             | `160039` | `SUBJECT: A staggered line of sea containers and rubble with rebar teeth, seen from above, one narrow gap left through it.`                         |
| `icon-place-armory`                | `160040` | `SUBJECT: A heavy vault door standing ajar in a blank concrete face, weapon racks visible as silhouettes in the #f59e0b light beyond.`              |
| `icon-place-war-machine-graveyard` | `160041` | `SUBJECT: Three dead armoured hulls half sunk in mud, tracks shed, one turret canted skyward, cold smog between them.`                              |
| `icon-place-university`            | `160042` | `SUBJECT: A colonnaded facade with a broken pediment, one lit window in an upper storey, cyan #22d3ee light behind the glass.`                      |
| `icon-place-satellite-uplink`      | `160043` | `SUBJECT: A parabolic dish on a guyed mast, hand-aligned and slightly off true, cold #7ff0ff light at the feed horn.`                               |
| `icon-place-gene-clinic`           | `160044` | `SUBJECT: A sealed theatre door with a porthole and a cold-storage cabinet beside it, sterile white light through the port.`                        |
| `icon-place-fight-pit`             | `160045` | `SUBJECT: A sunken circular ring seen from above with a standing crowd ringing it, warm #f59e0b lamps on poles around the rim.`                     |
| `icon-place-skate-ground`          | `160046` | `SUBJECT: A drained reservoir bowl seen from above, its curved transitions marked with tyre and board scuffs, one graffiti sweep across the floor.` |
| `icon-place-hospital`              | `160047` | `SUBJECT: A four-bay ambulance canopy with a repainted cross panel above it, warm light spilling from the entrance.`                                |
| `icon-place-rail-yard`             | `160048` | `SUBJECT: Converging sidings around a turntable seen from above, two flatbeds parked off-centre, cold light along the rail heads.`                  |
| `icon-place-broadcast-tower`       | `160049` | `SUBJECT: A lattice transmitter mast with three stacked dipole arrays, a single #e11d8f obstruction light at the top.`                              |
| `icon-place-sewer-junction`        | `160050` | `SUBJECT: A brick chamber where six storm drains meet, seen from above, standing water reading as dark #12a2bd with one shaft of light.`            |

---

## 7. Unit roster portraits — 27 assets

**Class framing:**

```
Half-length figure study of one representative fighter, three-quarter view, weight on the back
foot, weapon or tool held rather than posed with. Vertical 3:4 composition, head in the upper
quarter, cropped mid-thigh. Painted on an abstracted plaster-and-soot ground with no readable
architecture — the card behind it carries the information, so the frame must stay quiet.
Unhelmeted or visor-up wherever the unit's own description allows it, so the roster reads as
people. No group shots, no insignia the player has not earned, no text.
```

Ids are the kebab-cased `UnitSpec.id` in `@frontline/shared` (`road_reavers` →
`unit-road-reavers`).

| Key                     | Unit             | Tier        | Seed     |
| ----------------------- | ---------------- | ----------- | -------- |
| `unit-razors`           | Razors           | Rabble      | `145001` |
| `unit-sparks`           | Sparks           | Rabble      | `145002` |
| `unit-scrapers`         | Scrapers         | Rabble      | `145003` |
| `unit-muckrakers`       | Muckrakers       | Rabble      | `145004` |
| `unit-breakers`         | Breakers         | Regulars    | `145005` |
| `unit-wardens`          | Wardens          | Regulars    | `145006` |
| `unit-ghosts`           | Ghosts           | Regulars    | `145007` |
| `unit-road-reavers`     | Road Reavers     | Regulars    | `145008` |
| `unit-ironsides`        | Ironsides        | Regulars    | `145009` |
| `unit-ash-walkers`      | Ash Walkers      | Regulars    | `145010` |
| `unit-snipers`          | Snipers          | Specialists | `145011` |
| `unit-stitchers`        | Stitchers        | Specialists | `145012` |
| `unit-demolishers`      | Demolishers      | Specialists | `145013` |
| `unit-jammers`          | Jammers          | Specialists | `145014` |
| `unit-kite-crews`       | Kite Crews       | Specialists | `145015` |
| `unit-netrunners`       | Netrunners       | Specialists | `145016` |
| `unit-sleepers`         | Sleepers         | Specialists | `145017` |
| `unit-bell-ringers`     | Bell-Ringers     | Specialists | `145018` |
| `unit-wrecking-crew`    | Wrecking Crew    | Specialists | `145019` |
| `unit-juggernauts`      | Juggernauts      | Heavy       | `145020` |
| `unit-hollow-men`       | Hollow Men       | Heavy       | `145021` |
| `unit-the-condemned`    | The Condemned    | Heavy       | `145022` |
| `unit-the-specter`      | The Specter      | Legendary   | `145023` |
| `unit-the-abomination`  | The Abomination  | Legendary   | `145024` |
| `unit-the-colossus`     | The Colossus     | Legendary   | `145025` |
| `unit-the-saint`        | The Saint        | Legendary   | `145026` |
| `unit-the-cartographer` | The Cartographer | Legendary   | `145027` |

### 7.1 `unit-razors`

```
SUBJECT: A lean street fighter in a cut-down jacket over bare arms, holding a ground-down
machete low and away from the body. Cloth wrapped from knuckle to elbow in place of armour, one
shoulder taped. Expression flat and unbothered; cold #22d3ee key along the blade edge, warm
#f59e0b bounce off the wrapped forearm.
```

### 7.2 `unit-sparks`

```
SUBJECT: A teenager holding a home-made electrical lance — a scaffold pole with a capacitor bank
taped along it and two bare contacts at the tip. Welding goggles pushed up on the forehead,
hands gloved in mismatched rubber. A single #7ff0ff arc crawling between the contacts is the
brightest thing in frame, and it lights the face from below.
```

### 7.3 `unit-scrapers`

```
SUBJECT: A wiry scavenger in a patched canvas coat with a salvage hook over one shoulder and a
strap of pouches across the chest, goggles up on the brow. Light plate lashed to one shoulder
with rope. Half-turned as if already leaving, warm ochre midtones against a cold rim.
```

### 7.4 `unit-muckrakers`

```
SUBJECT: A stooped figure in a slick waders-and-oilcloth rig, hood back, carrying a bulging
drag-sack roped shut at the neck and a short gaff. Chest-high tide line of grey silt dried on
the rubber. Pale #86e6a8 light from a lamp clipped at the hip, everything above it in shadow.
```

### 7.5 `unit-breakers`

```
SUBJECT: A heavyset door-breacher braced behind a scuffed steel ram held two-handed across the
body, forearms and shins plated in bolted scrap. Face guard hinged up to show a broken nose and
a jaw set for the next one. Hard cold key across the ram face, warm bounce under the plates.
```

### 7.6 `unit-wardens`

```
SUBJECT: A defender behind a tall salvaged shield planted on the ground, one hand on its rim and
a short spear upright in the other. Layered plate over a padded coat, everything scuffed at the
front and clean at the back. Composed, unhurried, watching past the viewer.
```

### 7.7 `unit-ghosts`

```
SUBJECT: A slight figure in a matte grey wrap suit with a soft hood and a scarf over the mouth,
holding a suppressed carbine down along the leg. No hard edges and no shine anywhere on the
fabric — the only speculars are the eyes and a thin #22d3ee line along the optic.
```

### 7.8 `unit-road-reavers`

```
SUBJECT: A rider in a studded leather cut over a fuel-stained undersuit, one arm through a
scavenged fairing used as a shield, a length of chain looped at the belt. Riding goggles down,
hair and scarf still moving. Warm #f59e0b headlamp glare from below and behind the shoulder.
```

### 7.9 `unit-ironsides`

```
SUBJECT: A soldier encased front-on in overlapping salvaged plate — road sign, hull steel, a car
door panel — strapped over a padded frame, with a slit visor and a short blade held close. Wide,
immovable stance. Cold light rakes across the mismatched plates and finds a different colour in
each.
```

### 7.10 `unit-ash-walkers`

```
SUBJECT: A trooper in a taped chemical suit and full-face respirator with two round filter drums
at the cheeks, one gloved hand steadying a hose that runs into the pack. Suit fabric bleached
and stiffened by exposure. Lens glass takes a flat #12a2bd reflection and shows nothing behind
it.
```

### 7.11 `unit-snipers`

```
SUBJECT: A marksman kneeling with a long bolt-action rifle across the raised knee, wrapped in a
ghillie of shredded grey rag, hood down and hair flattened by it. Face bare and very still. One
narrow cold highlight down the barrel; everything else sinks into the ground tone.
```

### 7.12 `unit-stitchers`

```
SUBJECT: A field medic in a rolled-sleeve coat with a heavy satchel across the body and a strip
of surgical tape on the forearm holding a spare line in place. Both hands busy — one clamping a
dressing, one reaching. Warm #ffd166 light from a headband lamp turned down onto the work.
```

### 7.13 `unit-demolishers`

```
SUBJECT: A sapper in a heavy apron over reinforced overalls, a bandolier of shaped charges
across the chest and a spool of det cord hooked at the hip. Ear defenders around the neck, hands
blackened to the wrist. Amber #f59e0b light and a haze of masonry dust in the air around the
shoulders.
```

### 7.14 `unit-jammers`

```
SUBJECT: An operator with a backpack transmitter and a folding directional antenna raised in one
hand, the other on a dial at the chest harness. Headset over one ear only. Faint #e11d8f
indicator lamps down the pack's spine are the only saturated colour in frame.
```

### 7.15 `unit-kite-crews`

```
SUBJECT: A drone pilot crouched over a hinged control slate held at chest height, a rotor craft
hovering just off the shoulder at the frame edge. Padded vest, cable running from slate to belt,
eyes on the screen. Cold #22d3ee screen light fills the face from below.
```

### 7.16 `unit-netrunners`

```
SUBJECT: A combat hacker with a deck strapped along the forearm and three fibre leads run from a
dermal port behind the ear into a shoulder loom. Coat open over a mesh underlayer, one hand
raised mid-gesture. Cyan #7ff0ff runs along the leads and reflects in a wet-looking eye.
```

### 7.17 `unit-sleepers`

```
SUBJECT: An unremarkable person in ordinary work clothes — coveralls, a laminated pass on a
lanyard, a canvas bag — standing squarely and looking directly at the viewer. No visible weapon.
The only thing wrong is the stillness, and one hand already inside the bag.
```

### 7.18 `unit-bell-ringers`

```
SUBJECT: A crew hand beside a truck-bed sonic array, gripping a stanchion of the frame with one
arm and holding heavy ear defenders in the other. Four stacked horn drivers fill the frame
behind the shoulder. Air distorts in a visible ring; the ground tone smears where it passes.
```

### 7.19 `unit-wrecking-crew`

```
SUBJECT: A siege worker in a heavy harness with a wrecking chain over the shoulder and a spiked
pry bar grounded at the feet, hard hat scarred to bare metal. Behind the shoulder, the top of a
jack frame. Broad, planted, patient; warm bounce from a work lamp out of frame.
```

### 7.20 `unit-juggernauts`

```
SUBJECT: A fully augmented heavy assault trooper — a human silhouette only at the head, with the
arms and torso replaced by armoured actuator housings and the legs by reversed hydraulic struts.
A small scarred face remains behind an open faceplate. Cold key finds machined edges; warm
#8a5209 leaks from the joint seams.
```

### 7.21 `unit-hollow-men`

```
SUBJECT: A shock trooper standing too straight in matte assault plate, faceplate open on an
expression of complete calm, pupils blown wide. Surgical scarring in a neat arc above one
temple. Blood on the gauntlets, none anywhere else. Even flat light, almost no shadow — nothing
to read.
```

### 7.22 `unit-the-condemned`

```
SUBJECT: A convict fighter in a stripped prison coverall with the sleeves torn away, a welded
collar at the throat and a heavy chain-wrapped blade held in both hands. Fresh brand on the
shoulder, older scars beneath it. Head lifted, grinning; harsh cold key from directly above.
```

### 7.23 `unit-the-specter`

```
SUBJECT: A figure caught mid-decloak — the outline is complete but the body is only present in
patches, the rest refracting the plaster ground behind it in smeared cyan #22d3ee bands. What is
solid is a matte infiltration suit and one long knife. No face resolves.
```

### 7.24 `unit-the-abomination`

```
SUBJECT: A failed experiment: a mass of grafted muscle and salvaged plate on a frame that no
longer agrees on how many limbs it has, restraint bolts still through the shoulders and one
trailing cable. Half a human face is set into the upper mass at the wrong angle. Sickly #86e6a8
fluid light from within the seams.
```

### 7.25 `unit-the-colossus`

```
SUBJECT: A walking fortress seen from the ground looking up, so only its lower hull, one
tread-footed leg and the underside of a gun sponson fit the frame. Rivet lines the size of a
person, hatch ladders, and a tiny crew figure on a walkway for scale. Cold sky behind, warm
exhaust glow beneath.
```

### 7.26 `unit-the-saint`

```
SUBJECT: An older fighter in a long weathered coat over plain plate, unarmed hands open at the
sides, a sheathed sword slung across the back. Grey cropped hair, deep-lined face, entirely
calm. The one portrait lit warmly from the front — amber #ffd166 across the face, cold #22d3ee
only as a thin rim.
```

### 7.27 `unit-the-cartographer`

```
SUBJECT: A traveller in a layered dust coat hung with rolled charts, a brass sighting compass on
a thong and a chalk stub behind the ear, one hand flat on a map board marked over many times in
different hands. Eyes on the viewer rather than the map. Warm lamp light on the paper, cold
light on everything else.
```

---

## 8. Consistency protocol

Generating 96 assets independently will drift. Counter it in this order:

1. **Generate the four parallax/plate assets first** (§3). They set the world's value key. If the
   plate is wrong, everything downstream is wrong.
2. **Generate one district (`district-neon-docks`) and one portrait (`portrait-overseer-1`) next.**
   Approve them against the [`ART-BIBLE.md`](ART-BIBLE.md) §10 checklist. These two become the
   **reference images**.
3. **Every subsequent generation passes the two reference images** to the backend as style
   references where the backend supports it (FLUX.2 multi-reference, gpt-image-1 `images[]` edit
   input). `scripts/gen-art.ts` carries `styleRefs` per manifest entry for exactly this.
4. **Review in sets, not singly.** Lay all 11 districts side by side before approving any. Drift is
   invisible one-at-a-time and obvious in a grid.
5. **Never re-roll a seed to fix a style problem** — fix the prompt. A style problem that a re-roll
   cures will recur on the next asset.
6. **Final grade happens in the renderer, not in the files.** Assets are delivered ungraded; the
   `lut-frontline-grade.png` LUT unifies the last few percent across the whole set at runtime, and
   can be re-tuned without regenerating anything.
