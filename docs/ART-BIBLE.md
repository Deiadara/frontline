# Frontline — Art Bible

**The style contract.** Every asset — generated, hand-painted, procedural, or third-party — must
satisfy this document. If an asset and this document disagree, the asset is wrong.

Target register: **Arcane-esque** — hand-painted, sitting between cartoony and photoreal — applied
to a **Zaun-like undercity**: cyberpunk technology bolted onto a broken-down, post-war society
(GDD §A2). Beautiful, occasionally haunting. Never sterile, never neon-soup, never "vector flat",
and never clean chrome-and-neon futurism — that register is the thing we are not.

Companion docs: [`adr/0001-graphics-stack.md`](adr/0001-graphics-stack.md) (how it renders),
[`ART-PROMPTS.md`](ART-PROMPTS.md) (how it gets made).

---

## 1. The five rules

Everything below is elaboration. If you remember nothing else:

1. **Value before colour.** A correct greyscale read comes first. Squint: the silhouette must be
   legible with all hue removed.
2. **Split lighting, always.** Cold key, warm bounce (or the reverse). Never a single neutral light.
3. **Desaturated mids, saturated accents.** Saturation is a currency — spend it only on emissives,
   loot, and story beats. ≤15% of any canvas may exceed 60% saturation.
4. **Edges carry the paint.** Lost-and-found edges. A uniformly crisp asset reads as vector; a
   uniformly soft one reads as mush.
5. **The city is scrap, and it lost the war.** Nothing was planned; everything was salvaged,
   jury-rigged and bolted onto something older. Old, wrecked and newly-built stand side by side in
   the same frame — a working machine next to the gutted one it was cannibalised from. Every
   surface shows use, repair or decay; nothing is factory-new, nothing is symmetrical by accident,
   and nothing is finished.

---

## 2. Palette

### 2.1 Ramps

Each ramp is five stops: `950` deepest shadow → `100` highlight. Paint **within** ramps; do not
invent intermediate hues. `theme/tokens.ts` is the machine-readable mirror of this table and is the
only place code reads colour from.

| Ramp        | Role                                           | 950       | 700       | 500       | 300       | 100       |
| ----------- | ---------------------------------------------- | --------- | --------- | --------- | --------- | --------- |
| **abyss**   | night sky, base surfaces, deepest occlusion    | `#05070d` | `#0a0e17` | `#0f1524` | `#141b2e` | `#1c2740` |
| **smog**    | atmospheric haze, far planes, depth falloff    | `#1b2233` | `#2a3348` | `#3d4761` | `#55617e` | `#74809c` |
| **ferrite** | concrete, steel, architecture, chrome          | `#0b111c` | `#1e293b` | `#475569` | `#94a3b8` | `#e2e8f0` |
| **hextech** | primary interactive, cold key light, player    | `#063845` | `#0b5f72` | `#12a2bd` | `#22d3ee` | `#7ff0ff` |
| **sear**    | hostile, enemy, danger, shimmer-corruption     | `#2c0620` | `#4a0a30` | `#8a0f56` | `#e11d8f` | `#ff6cc0` |
| **ember**   | sodium streetlight, warm bounce, loot, warning | `#2a1703` | `#4a2a05` | `#8a5209` | `#f59e0b` | `#ffd166` |
| **bile**    | undercity toxicity, pollution, mutated growth  | `#0a1c12` | `#12301f` | `#2f8551` | `#43b56e` | `#86e6a8` |
| **flesh**   | skin midtones — the warm anchor in portraits   | `#1a0f0d` | `#2b1a17` | `#5a352c` | `#8f5744` | `#e8b494` |

The four legacy tokens already in the code map onto this: `night → abyss`, `steel → ferrite`,
`neon.cyan → hextech.300`, `neon.magenta → sear.300`, `warning → ember.300`. Existing code keeps
working; the ramps are additive.

### 2.2 Faction / semantic colour

| Meaning                                                 | Ramp                                    | Never use for                                    |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| The player, their base, anything interactive & friendly | **hextech**                             | enemies, decay                                   |
| Enemy bases, NPC strongholds, threat, corruption        | **sear**                                | anything the player owns                         |
| Loot, rewards, resource gain, "you may act here"        | **ember**                               | ambient architecture lighting at full saturation |
| Undercity districts, pollution, biohazard               | **bile**                                | UI chrome                                        |
| Markets and neutral districts                           | **ferrite** + a single **ember** accent | —                                                |

**One accent per asset.** A district illustration is `abyss`+`ferrite`+`smog` structurally, with
_one_ dominant accent ramp. Two competing accents is the single most common way to break this style.

### 2.3 Saturation and value discipline

- Structural mass sits between **value 15% and 55%**. Nothing structural touches pure black or
  pure white.
- **Only emissives may exceed 75% value**: windows, signs, screens, muzzle flash, hextech glow.
- Pure `#000000` and `#ffffff` are **banned** in source art. Deepest black is `abyss.950`
  (`#05070d`); brightest white is `ferrite.100` (`#e2e8f0`) — emissive cores may bloom past this in
  the _renderer_, never in the _file_.
- Atmospheric perspective is mandatory: every 25% further into depth, shift 20% toward `smog.500`
  and lose 15% contrast.

---

## 3. Lighting

### 3.1 The two-light system (non-negotiable)

Every asset is lit by exactly two sources, opposed in temperature:

- **Key — cold.** `hextech.300 → hextech.500`. Comes from **upper-left**, ~35° elevation. This is
  the city's screen-light, signage, and hextech glow. It defines form.
- **Bounce — warm.** `ember.500 → ember.700`. Comes from **lower-right**, low and weak (≈40% of key
  intensity). This is sodium streetlight and fire. It rescues shadows from going dead.

Shadows are therefore never neutral grey — they are **`abyss` tinted toward whichever light does
_not_ reach them**. A shadow away from the key leans warm; a shadow away from the bounce leans cold.

Interior/undercity scenes may swap the temperatures (warm key from a furnace, cold `bile` bounce
from a sump) but must keep the **opposition**.

### 3.2 Rim light

The signature of the look. Rules:

- Every foreground subject gets a rim on the **key side** (upper-left) in `hextech.100`, and,
  where it separates from the background, a secondary rim on the opposite side in `ember.300`.
- Rim width at 1024px canvas: **2–4 px** on hard surfaces, **4–8 px** feathered on hair, fabric,
  smoke.
- Rim value must sit **at least two ramp stops above** the silhouette edge it runs along. If the
  background is already bright there, the rim is _removed_, not dimmed — that is a found edge
  becoming a lost edge, and it is correct.
- **Never rim the whole outline.** Rim runs about 40–60% of the contour, broken where forms turn
  away. A fully rimmed subject reads as a sticker.

### 3.3 Emissives and bloom

- Emissive sources are painted at **their own colour, not white-hot**. A cyan sign is
  `hextech.100`, not `#ffffff`. Bloom is added by the renderer's `AdvancedBloomFilter`, not baked
  into the file.
- Emissives cast **coloured light onto nearby surfaces** at 2–3 ramp stops down, falling off within
  ~1.5× the emitter's own width.
- Wet ground, glass and chrome reflect emissives as **vertical smeared streaks**, not mirrored
  copies. This single trick does most of the cyberpunk work.

---

## 4. Brushwork and edges

- **Visible brush economy.** Broad confident strokes on large planes; detail concentrated where the
  eye lands (the focal 20%). Do not distribute detail evenly — that is the photoreal failure mode.
- **Lost and found edges.** Roughly: 30% hard (focal contours, silhouette against sky), 45% medium,
  25% lost (shadow-into-shadow, form dissolving into haze). Enforce it by squinting.
- **Texture through value, not through noise.** Rust, grime and wear are _value variation with
  edges_, not overlay noise. Renderer grain is a separate, uniform pass — do not double it in-file.
- **No linework as outline.** This is painted, not cel-shaded. Dark contours may exist as _occlusion
  shadow_, never as a uniform stroke around a shape.
- **No gradients as a substitute for form.** A linear gradient across a wall is a bug. Walls have
  ambient occlusion, bounce, dirt and a light falloff curve.
- Chromatic aberration and lens flare: **renderer only**, never painted in.

---

## 5. Silhouette

- **The read test:** filled solid black at 25% scale, the asset must remain identifiable and
  distinct from its siblings. All 11 districts must be mutually distinguishable as black shapes.
- **Big–medium–small rhythm.** One dominant mass, 2–3 secondary forms, a scatter of small
  interrupts (antennae, cables, signage, laundry lines). Never three equal masses.
- **Break the box.** Something must pierce the bounding rectangle's implied edges — a crane arm, a
  skybridge, a pipe. Perfectly contained rectangles read as stock art.
- **Verticality is the city's character.** Prefer tall, stacked, overhung, accreted. The city grew
  by accretion, not by plan.
- **No intact roof lines.** A flat horizontal top edge is the chrome-futurism tell. Roofs sag,
  slump, shear off or are missing outright; the top of a mass is where it broke, not where it was
  finished.
- **Accretion steps out, not just in.** A planned tower tapers as it rises. This city does the
  opposite as often as not — added storeys overhang the ones below, lean off true, and cantilever
  on props. Uniform inward setbacks read as a zoning code nobody here ever had.
- **Scrap is structure.** Lean-tos, shanty add-ons and shacks pile against the base of every large
  mass; gantries, catwalks and slung cable bridges tie masses together at random heights. These are
  not decoration — they are half the silhouette.
- **Old and new in the same frame (GDD §A2).** Some masses stand; others are gutted, collapsed or
  burnt out. Never a skyline of equally-healthy buildings — the contrast between the two is what
  says "post-war" rather than "grimy".
- **The lights are half out.** An undercity is unevenly powered: whole floors and whole blocks dark,
  a few windows blazing, no continuous regular grid of lit panels anywhere.
- **Human scale markers are mandatory** in every environment asset: a door, a walkway, a figure, a
  vehicle. Without one, scale collapses and the image reads as a model kit.

---

## 6. Per-asset-class specifications

Aspect ratios are **fixed** — they are baked into the layout and changing one is a code change.

| Class                             | Source resolution | Aspect   | Delivery              | Transparency                   | Notes                                                                                            |
| --------------------------------- | ----------------- | -------- | --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Overseer portrait                 | 1024 × 1536       | **3:4**  | WebP q90 + PNG master | opaque                         | Head-and-shoulders, eyes on the upper-third line. Matches `OverseerPortrait`'s `aspect-[3/4]`.   |
| Overseer avatar (derived)         | 512 × 512         | **1:1**  | WebP q88              | opaque                         | Centre-crop of the portrait, **not** a separate generation.                                      |
| District illustration             | 1024 × 1024       | **1:1**  | WebP q90              | opaque                         | Shown in the context panel. Oblique 3/4 view, horizon at 40% height.                             |
| City map base plate               | 2048 × 1152       | **16:9** | WebP q92              | opaque                         | Plane 2. Districts sit on it at normalised coords.                                               |
| District ground plate             | 2048 × 1152       | **16:9** | WebP q92              | opaque                         | `plate-district` — the §A1 compound seen from above. **Ground only.** See §6.1.                  |
| Parallax plane (sky / far / fore) | 2048 × 1152       | **16:9** | WebP q90              | sky opaque, far/fore **alpha** | Fore plane must be ≥55% transparent or it smothers the map; far plane ≥30% — see the note below. |
| Base building sprite              | 1024 × 1024       | **1:1**  | WebP q90              | **alpha**, keyed from white    | Ground contact at the bottom-centre 20%; drop shadow **not** baked in. See §6.3 on the field.    |
| Unit roster portrait              | 768 × 1024        | **3:4**  | WebP q90              | opaque                         | Half-length figure, cropped mid-thigh. Twenty-seven of these render in one grid.                 |
| UI frame / HUD element            | 1024 × 1024       | **1:1**  | PNG (9-slice)         | **alpha**                      | Corners must survive 9-slice: no detail in the stretchable middle bands.                         |
| Icon                              | 512 × 512         | **1:1**  | WebP q88              | **alpha**                      | Must read at 24 px. Two values + one accent, maximum.                                            |
| Splash / auth backdrop            | 2048 × 1152       | **16:9** | WebP q90              | opaque                         | Centre 40% must stay low-contrast — the login form sits there.                                   |
| LUT / colour grade                | 512 × 512         | **1:1**  | **PNG, lossless**     | opaque                         | 64×64×64 strip. Never lossy-compress a LUT.                                                      |

**Every raster asset ships at 1× and 2×.** The 1× variant is generated by the pipeline, never
authored. Masters (PNG, full resolution, layered where applicable) live outside the app bundle in
`art-src/` and are **not** shipped.

**What the far plane's ≥30% floor is actually for.** Not "or it hides the sky" — that reasoning stops
at plane 1 and never reaches plane 2. The base plate sits _in front of_ both sky and far and is opaque
by this very table, so once it is delivered as a file there is no sky left behind the far plane to
hide: sky and far are covered outright, and no transparency floor on far could change that. The floor
guards the stack as it stands **today**, where `plate-city` is still procedural — there sky and far are
the map's only depth, and a far plane that arrived nearly solid would flatten it. So the floor is a
pre-delivery guarantee with a defined end, not an invariant of the finished stack. `plane-city-sky` and
`plane-city-far` are consequently **not ordered** — `isOccludedBackdropAsset`
(`packages/shared/src/art/backdrop.ts`) files them out of the order sheet's active sections, and
re-admits them automatically if the plate ever stops being opaque.

### 6.1 Safe areas

| Surface               | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overseer portrait     | Face inside the central **70%**; nothing load-bearing in the bottom **18%** (the archetype tag overlays there).                                                                                                                                                                                                                                                                                                                                                                                                            |
| District illustration | Focal subject inside the central **80%**; outer 10% may be cropped by the panel at narrow widths.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| City map base plate   | All 11 district anchor points fall inside **x ∈ [0.08, 0.92], y ∈ [0.06, 0.94]** — verified against `CITY_DISTRICTS` in `@frontline/shared`. Nothing narratively essential outside that box.                                                                                                                                                                                                                                                                                                                               |
| District ground plate | **No sky and no horizon — the whole frame is ground**, seen from above; the top edge is the compound's back wall. The painting carries the twelve structures itself: the client traces a polygon around each one and lights it on hover, so the buildings must be **separable** — visible gaps of road, fence or water between them, and no two sharing a roofline. A re-render at a different framing is a re-layout, not a re-render: every outline is a position on this image. See `docs/art/plate-district-brief.md`. |
| Splash backdrop       | Central **40% × 50%** kept under 25% contrast and free of detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| UI 9-slice frame      | Outer **96 px** is the corner/edge region; the inner region must be a flat tileable field.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Text baked into art   | **Allowed as scenery.** Painted signage, shop hoardings and graffiti are part of the setting and stay. What must never be baked in is text the app is responsible for — a structure's name, its level, a resource figure, a button label — because that is data, it changes, and it has to be localisable. Type that carries meaning is rendered by the app; type that is part of the picture belongs to the picture.                                                                                                      |

### 6.2 Minimum stroke weight

**No part of a keyed asset's silhouette may be thinner than 3 px at its source resolution** — that
is, any structure that meets the transparent region: no hairline cables, wires, rims, antennas or
spire tips. Interior detail is unaffected at any width, but by two different mechanisms: a
_sky-coloured_ window light does match the seed, and survives because its region is below
`MIN_KEYED_REGION`; a _dark_ panel line never matches the seed at all, so it is not a region under
that constant — it survives because it is attached to kept artwork and the island sweep only ever
sees whole detached pieces.

**The same floor applies to the _gaps_: no channel of transparent background narrower than 3 px.** The
median seals a 1-px slot shut, and unlike an erased stroke nothing measures it — the slot keeps the
master's background colour at full alpha and ships as a bright seam inside the silhouette. On a dense
skyline this is the natural failure: 1-px slivers of sky between adjacent towers seal, the towers read
as one merged blob, and each sealed sliver draws a bright vertical line over whatever parallaxes
behind it.

**A _detached_ element must be drawn at least 68 opaque pixels** — 4×17, 9×8, or any solid shape with
that much area. `MIN_OPAQUE_ISLAND` clears every unattached opaque island under 64 px² along with the
background, but it measures the island the median has already run on, and the median clears a solid
outline's convex corners while filling its concave ones — for any solid rectilinear shape that nets
out to exactly 4 px lost. So the drawn floor is 68, and a solid 8×8 is the trap it looks least like:
64 px² drawn measures 60 and goes, as does a 6×6 drone or a floating antenna. It is a
connected-component _area_ test, not a bounding box: a detached 8×8 open strut of 3-px members is
60 px² drawn and is swept, while a 4×20 pipe segment is 80 px² and survives with 76.

Keyed means the master arrives opaque and the encode step cuts the background out of it: today that
is `plane-city-far`, `plane-city-fore` and **the thirteen `building-*` sprites**, and in general any
asset whose `postProcess` includes `matte`. An asset that arrives carrying its own alpha never meets
the keyer — `matte` returns it untouched above `HUMAN_MATTE_FLOOR` — so §3.2's 2–4 px rim stands
unchanged there, and on a 2048-wide plane that same rim is 4–8 px, already clear of this floor.

The building class is keyed because that is the form the art actually arrives in: an illustrator
hands over a structure painted on a flat white field, and so does every backend asked for a
transparent background. Declaring the class source opaque makes that the normal path rather than a
per-file exception, and costs a master that _does_ carry alpha nothing. At 1024² a building's rim is
2–4 px — half a plane's, and the reason the 3 px floor is stated at source resolution rather than as
a fraction of the frame.

The keyer that cuts the transparent background out of a master (`scripts/encode-art.ts`) decides the
mask on a 3×3 median, and a median cannot represent a structure thinner than its own window: a 1-px
line is 3 of the 9 samples in every window it touches, so the median returns the field colour, the
line joins the background region and its alpha is cleared. Measured on 2048×1152 fore-plane layouts,
hard-edged and antialiased, with and without grain, the threshold is sharp — **≤1 px is destroyed,
≥2 px is intact**. A 1-px rim on the key side lost all 700 of its pixels; a 1-px cable kept 8%. The
floor is 3 px rather than 2 px so it still holds when the backend renders an element slightly
thinner than asked.

The window has no idea which side of the mask is artwork, so the threshold is the same for a slot of
background, at the opposite polarity. Measured on the same `median(3)`, two dark towers separated by a
vertical sky slot: at 1 px the centre of the slot reads as tower, so no column of it joins the
background region and all of it stays opaque; at 2 px and 3 px every column keys open. That is why the
floor is stated in both directions.

`MAX_ERASED_ARTWORK` refuses a master that breaks this, so a dashed cable fails the encode step
instead of shipping — but it fails _after_ the generation is paid for, and there are four cases it
cannot see. It cannot see a 1-px rim painted onto a kept mass, because every erased pixel there is
adjacent to surviving artwork. It cannot see a _short_ erasure: it counts only pixels that join up
into a run of at least 16, which is what keeps a grainy field from reading as erased artwork, and
nothing bounds how many shorter ones a master may carry. Measured on 2048×1152, a 1-px antenna 14 px
tall leaves a 12-px run, so 150 of them erase 2,100 px of structure and `erased` reads **0**; the
same antennae drawn 18 px tall read 640 for 40 of them and are refused. A swept detached island is
counted only once what the sweep takes clears that run floor — a detached 4×4 counts, a 3×3 reads 0
however many there are (300 of them are 2,700 px drawn and read 0) — and for the ones that do count,
`erased` counts those pixels as _drawn_ and the largest island the sweep can take is 67 px drawn, so
it takes four of them before the 256 budget notices. And a sealed gap clears nothing at all,
so `erased` reads 0 — while sealing gaps _merges_ pieces, which moves the island count down and away
from `MAX_KEYED_ISLANDS`, and a handful of 1-px slots is a rounding error against the §6 transparency
floor. All three gates move the wrong way on the gap case, which is the one that ships silently. This
rule is the only thing that covers any of the four, which is why the `plane-city-far` and
`plane-city-fore` prompts carry it (§3.3, §3.4 of ART-PROMPTS).

### 6.3 Minimum artwork-to-field separation

§6.2 governs how _thin_ a keyed asset may be. This governs how _close in colour_ it may come to the
background it is keyed out of, and it is the other half of the same precondition.

**No part of a keyed asset's artwork may sit within 80 levels of the field colour on all three
channels** — at least one of R, G, B must differ from the flat background by **≥ 80**. That is a
per-channel (Chebyshev) distance, because it is the keyer's own test, not a perceptual one: two
colours 79 apart on every channel are "the same colour" to the encoder no matter how different they
look.

80 is **4 × `--matte-tolerance`** at the default 18. An operator who widens the tolerance to key a
grainier field raises this floor with it — `--matte-tolerance 30` needs 120 levels of separation, and
a master authored against the default stops satisfying the rule.

**Satisfy it on the field side, not the artwork side.** The image backend cannot emit alpha, so
"transparent background" is always delivered as some painted field of the model's choosing — and for
`plane-city-fore`, whose artwork is specified at `#05070d`–`#1e293b`, a model that paints that field
as night sky lands within a handful of levels of the artwork and no separation rule is satisfiable at
all. So the two keyed **plane** prompts name the field: a flat unshaded magenta `#ff00ff` chroma-key,
removed before anything composites.

The building sprites key against **white**, because that is what a hand-delivered master is painted
on and asking an illustrator for a magenta field would be asking them to work in a colour they
cannot judge the artwork against. White is the weaker field of the two: a sunlit render surface or a
bleached wall can sit inside 80 levels of it, where nothing in the palette comes near `#ff00ff`. It
is therefore the one keyed class where §6.3 has to be _measured_ rather than assumed. Measured
across the ten delivered building masters — cleared pixels classified by their distance from the
field in the master — the key took between 0 and 185 pixels that sit ≥80 levels off white, against
280k–560k pixels of field, i.e. edge antialiasing and nothing else. A master that fails this shows
up as a hole in a pale wall, so re-run that measurement on any building master with large white or
near-white surfaces before shipping it. The §2.3 ban on channel extremes is about _art_; the key field is
not art, and never survives the encode step. `#ff00ff` is not free of the palette — **sear** is a
magenta ramp, and its brightest stop `sear.100` (`#ff6cc0`) sits 108 levels off it. That clears the
floor, but it is the margin to check first if a third asset is ever keyed: neither of these two planes
uses `sear` at all, so the question does not arise for them.

**Why 80 and not 36.** `MAX_ERASED_ARTWORK` only counts a cleared pixel as artwork when the master
puts it past 2 × the tolerance — 36 levels — so below that the gate stops discriminating in **both**
directions and a §6.2 violation ships silently. Measured on 2048×1152 fore-plane layouts, artwork at
a uniform separation from the field, clean and under both grain generators (`erased`, budget 256):

| separation | 1 px hard | 1 px antialiased, off-grid  | 2 px (legal)       | 3 px (§6.2) |
| ---------- | --------- | --------------------------- | ------------------ | ----------- |
| 30         | **0**     | **0**                       | 0–69, 9–10 islands | 0           |
| 40         | 1506–2032 | **0**                       | 0                  | 0           |
| 60         | 2032–2059 | **0–59**                    | 0                  | 0           |
| 72         | 2032–2059 | **0** clean, 586–589 grainy | 0                  | 0           |
| 80         | 2032–2059 | 1506–2032                   | 0                  | 0           |

The hard-edged threshold is the expected 36, but a 1-px line whose edges land off the pixel grid
splits its colour across two rows at ~50% coverage each, so it needs **twice** that before any of its
pixels reads as artwork — and a §6.2 violation delivered by a diffusion backend is antialiased by
construction. 72 is the arithmetic boundary and still ships on a clean master; 80 is the first value
that refuses under every generator. The relationship to the measured threshold is the same one §6.2
takes: 3 px declared over a 2 px threshold, 80 declared over a 72 boundary.

Below the floor the gate also fires the _wrong_ way — at separation 30 a legal 2-px element reads up
to 69 erased pixels and fragments to 10 islands under grain, so a plane that is fine gets refused.
Both failures are the same missing precondition.

Unlike §6.2 nothing enforces this: it is the assumption every erasure measurement is made under. A
master that breaks it does not fail loudly, it goes quiet.

---

## 7. File naming

```
<class>-<subject>[-<variant>][@2x].<ext>
```

- `class` ∈ `portrait` | `district` | `plate` | `plane` | `building` | `unit` | `ui` | `icon` | `splash` | `lut`
- `subject` is the **domain id**, kebab-case, and must match `@frontline/shared` exactly:
  `portraitId` for portraits, `District.id` for districts, `BuildingKind` for buildings,
  `UnitSpec.id` for unit portraits, `Resources` keys for resource icons.
- `variant` ∈ `damaged` | `selected` | `night` | `alt1..n` — omit for the default.

Examples:

```
portrait-overseer-1.webp            portrait-overseer-1@2x.webp
district-neon-docks.webp            district-combine-spire.webp
plate-city.webp                     plane-city-sky.webp   plane-city-fore.webp
building-command-center.webp        building-reactor-damaged.webp
icon-caps.webp   icon-oil.webp   icon-high-quality-metal.webp
icon-archetype-netrunner.webp       icon-kind-npc-stronghold.webp
ui-frame-panel.png                  ui-frame-modal.png
splash-auth.webp                    lut-frontline-grade.png
```

Rules: lower-kebab only; no spaces, no uppercase, no version suffixes (`-v2`, `-final`) — the file
is versioned by git, not by its name. A file whose `subject` does not resolve to a domain id is a
**build failure**, not a warning. Both `scripts/gen-art.ts --dry-run` and the shared manifest test
enforce this.

---

## 8. Motion and feel

Motion is part of the style contract; a static asset animated wrongly stops looking painted.

- **Parallax** is the primary depth cue — scroll factors are fixed in ADR 0001 §5.2.
- **Grain boils at 12 Hz**, not 60 — matching hand-drawn animation. Smooth 60 Hz grain reads as
  video noise, not paint.
- **Emissive flicker** is irregular and subtle: ±8% brightness, Perlin-driven, ~0.5–2 Hz. Uniform
  sine pulsing looks cheap.
- **Smog drifts** at 2–6 px/s with independent per-layer speeds.
- **Hover** = rim brightens one ramp stop over 120 ms `ease-out`. **Selection** = a held glow, not a
  pulse. Never bounce or overshoot; this world is heavy.
- Reduced-motion preference disables drift, flicker and boil, and keeps the static grade.

---

## 9. Licensing register

**Every third-party file in `assets/` or `art-src/` has a row here. No row, no ship.**
`scripts/gen-art.ts` writes `<key>.provenance.json` alongside the **master** it generates in
`art-src/`; this table is the human-readable index, the one a lawyer would be shown, and the only
record that covers a file dropped straight into `assets/` by hand.

"No row, no ship" is checked, not just asked for. `pnpm --filter @frontline/scripts test` reads every
`.webp` and `.png` sitting in `assets/` and fails naming any whose row is missing, or whose **Source**,
**Author** or **Licence** cell is blank (`auditProvenance`, `scripts/encode-art.ts`). `@2x` resolves to
the 1× row — two densities of one artwork are one licence. A row is the only way past it: the sibling
`<key>.provenance.json` does carry a `licence`, but it is the backend's blanket terms — with output
ownership itself unresolved (ADR 0001 §6.4) — and not a grant for that file, and §9.1 wants a row for
generated art too.

| File                           | Source                                 | Author          | Licence             | Commercial OK | Attribution required | Added      | Notes                                                                                                                                                                   |
| ------------------------------ | -------------------------------------- | --------------- | ------------------- | ------------- | -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `building-apothecary.webp`     | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-cistern.webp`        | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-garage.webp`         | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-gate.webp`           | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-gauntlet.webp`       | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-generator.webp`      | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-greenhouse.webp`     | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-infirmary.webp`      | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-lab.webp`            | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-nexus.webp`          | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-quarters.webp`       | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `building-scrapyard.webp`      | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Keyed from a flat white field by `encode-art`; `contain` fit, so it keeps its own aspect.                                                                               |
| `icon-caps.webp`               | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Downscaled to the 512² delivery.                                                                                                                                        |
| `plate-district.webp`          | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-15 | The district ground. Ships at the painted 1376×768 rather than the 2048×1152 plate size — the twelve sites are positions on this image, so a crop moves all twelve.     |
| `icon-food.webp`               | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Downscaled to the 512² delivery.                                                                                                                                        |
| `icon-high-quality-metal.webp` | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Downscaled to the 512² delivery.                                                                                                                                        |
| `icon-oil.webp`                | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Upscaled from a 256² master at the board’s instruction; re-export at 512² to sharpen.                                                                                   |
| `icon-scrap.webp`              | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Upscaled from a 128² master at the board’s instruction; re-export at 512² to sharpen.                                                                                   |
| `unit-scrapers.webp`           | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Cropped 928×1152 → 3:4, no key.                                                                                                                                         |
| `unit-breakers.webp`           | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1024 → 3:4, no key.                                                                                              |
| `unit-demolishers.webp`        | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-ghosts.webp`             | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-juggernauts.webp`        | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1280 → 3:4, no key.                                                                                              |
| `unit-netrunners.webp`         | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-razors.webp`             | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-road-reavers.webp`       | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-sleepers.webp`           | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1280 → 3:4, no key.                                                                                              |
| `unit-snipers.webp`            | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-sparks.webp`             | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1024 → 3:4, no key.                                                                                              |
| `unit-the-abomination.webp`    | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1024 → 3:4, no key.                                                                                              |
| `unit-the-colossus.webp`       | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1024 → 3:4, no key.                                                                                              |
| `unit-the-condemned.webp`      | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-the-saint.webp`          | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `unit-the-specter.webp`        | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 1024×1024 → 3:4, no key.                                                                                              |
| `unit-wardens.webp`            | Board delivery, `art-src/`             | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-16 | Board portrait drop, `images/portrait-*`. Cropped 928×1152 → 3:4, no key.                                                                                               |
| `portrait-apothecary.webp`     | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-cistern.webp`        | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-garage.webp`         | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-gate.webp`           | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-gauntlet.webp`       | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-generator.webp`      | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-greenhouse.webp`     | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-infirmary.webp`      | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-lab.webp`            | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-nexus.webp`          | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-quarters.webp`       | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `portrait-scrapyard.webp`      | Derived from `plate-district`          | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-17 | Cut out of the board's own district painting by `scripts/building-portraits.ts`, using the structure's traced outline as a feathered alpha mask. No third-party pixels. |
| `wordmark.webp`                | Board delivery, `images/frontline.png` | Frontline board | Proprietary — owned | Yes           | No                   | 2026-08-14 | Brand plate; ships from `apps/client/src/brand/`, not `assets/`.                                                                                                        |

### 9.1 Rules for adding a row

- **CC0 / public-domain preferred** (OpenGameArt CC0, Kenney, ambientCG). CC-BY is acceptable with
  an attribution entry shipped in-app. **CC-BY-SA, CC-NC and "free for personal use" are banned** —
  they are incompatible with a commercial game.
- Record the **direct URL** and the licence **as stated on the page the file came from**, not as
  remembered. Screenshot or archive the licence page for anything load-bearing.
- Generated art gets a row too, with the model, the backend, and the seed, so it is reproducible.
- **AI-generated images may not be copyrightable in the US** absent substantial human authorship
  (see ADR 0001 §6.4 — flagged for board/legal review, not verified against a primary legal
  source). Mark hero assets `humanEdited: true` only when a human genuinely overpainted them.

---

## 10. Rejection checklist

Reject any asset that trips one of these. This list is the review gate.

- [ ] Reads as flat vector / clean-tech — no visible paint, no wear.
- [ ] Single neutral light source, or shadows that are plain grey.
- [ ] Neon-soup: more than one accent ramp competing, or saturation above 60% on >15% of pixels.
- [ ] Pure `#000000` or `#ffffff` present in the file.
- [ ] Uniform edge treatment — everything crisp, or everything soft.
- [ ] Silhouette fails the 25%-scale black-fill read, or is confusable with a sibling asset.
- [ ] Clean chrome-and-neon futurism: intact flat roof lines, uniform curtain-wall façades, regular
      grids of lit windows, or a skyline where every mass is equally healthy (§1.5, §5).
- [ ] No human-scale marker in an environment asset.
- [ ] Text baked into the image.
- [ ] Wrong aspect ratio or resolution for its class (§6).
- [ ] A keyed asset's silhouette carries a structure thinner than 3 px, or a gap of background
      narrower than 3 px, or a detached element drawn smaller than 68 opaque pixels — the key
      cannot hold any of the three (§6.2).
- [ ] Filename does not resolve to a `@frontline/shared` domain id (§7).
- [ ] Third-party and not in the register (§9).
- [ ] Grain, bloom, vignette, chromatic aberration or lens flare baked in — those belong to the
      renderer, and baking them double-applies.
