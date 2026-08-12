# Frontline — Art Bible

**The style contract.** Every asset — generated, hand-painted, procedural, or third-party — must
satisfy this document. If an asset and this document disagree, the asset is wrong.

Target register: **Arcane-esque** — hand-painted, sitting between cartoony and photoreal — applied
to a **cyberpunk-dystopian city interior**. Beautiful, occasionally haunting. Never sterile, never
neon-soup, never "vector flat".

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
5. **The city is inhabited and it is failing.** Every surface shows use, repair, or decay. Nothing
   is factory-new. Nothing is symmetrical by accident.

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
- **Human scale markers are mandatory** in every environment asset: a door, a walkway, a figure, a
  vehicle. Without one, scale collapses and the image reads as a model kit.

---

## 6. Per-asset-class specifications

Aspect ratios are **fixed** — they are baked into the layout and changing one is a code change.

| Class                             | Source resolution | Aspect   | Delivery              | Transparency                   | Notes                                                                                           |
| --------------------------------- | ----------------- | -------- | --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Overseer portrait                 | 1024 × 1536       | **3:4**  | WebP q90 + PNG master | opaque                         | Head-and-shoulders, eyes on the upper-third line. Matches `OverseerPortrait`'s `aspect-[3/4]`.  |
| Overseer avatar (derived)         | 512 × 512         | **1:1**  | WebP q88              | opaque                         | Centre-crop of the portrait, **not** a separate generation.                                     |
| District illustration             | 1024 × 1024       | **1:1**  | WebP q90              | opaque                         | Shown in the context panel. Oblique 3/4 view, horizon at 40% height.                            |
| City map base plate               | 2048 × 1152       | **16:9** | WebP q92              | opaque                         | Plane 2. Districts sit on it at normalised coords.                                              |
| Parallax plane (sky / far / fore) | 2048 × 1152       | **16:9** | WebP q90              | sky opaque, far/fore **alpha** | Fore plane must be ≥55% transparent or it smothers the map; far plane ≥30% or it hides the sky. |
| Base building sprite              | 1024 × 1024       | **1:1**  | WebP q90              | **alpha**                      | Ground contact at the bottom-centre 20%; drop shadow **not** baked in.                          |
| UI frame / HUD element            | 1024 × 1024       | **1:1**  | PNG (9-slice)         | **alpha**                      | Corners must survive 9-slice: no detail in the stretchable middle bands.                        |
| Icon                              | 512 × 512         | **1:1**  | WebP q88              | **alpha**                      | Must read at 24 px. Two values + one accent, maximum.                                           |
| Splash / auth backdrop            | 2048 × 1152       | **16:9** | WebP q90              | opaque                         | Centre 40% must stay low-contrast — the login form sits there.                                  |
| LUT / colour grade                | 512 × 512         | **1:1**  | **PNG, lossless**     | opaque                         | 64×64×64 strip. Never lossy-compress a LUT.                                                     |

**Every raster asset ships at 1× and 2×.** The 1× variant is generated by the pipeline, never
authored. Masters (PNG, full resolution, layered where applicable) live outside the app bundle in
`art-src/` and are **not** shipped.

### 6.1 Safe areas

| Surface                 | Rule                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overseer portrait       | Face inside the central **70%**; nothing load-bearing in the bottom **18%** (the archetype tag overlays there).                                                                              |
| District illustration   | Focal subject inside the central **80%**; outer 10% may be cropped by the panel at narrow widths.                                                                                            |
| City map base plate     | All 11 district anchor points fall inside **x ∈ [0.08, 0.92], y ∈ [0.06, 0.94]** — verified against `CITY_DISTRICTS` in `@frontline/shared`. Nothing narratively essential outside that box. |
| Splash backdrop         | Central **40% × 50%** kept under 25% contrast and free of detail.                                                                                                                            |
| UI 9-slice frame        | Outer **96 px** is the corner/edge region; the inner region must be a flat tileable field.                                                                                                   |
| All text baked into art | **None.** Never bake text into an asset — it cannot be localised and it will not survive scaling. Type is rendered by the app.                                                               |

---

## 7. File naming

```
<class>-<subject>[-<variant>][@2x].<ext>
```

- `class` ∈ `portrait` | `district` | `plate` | `plane` | `building` | `ui` | `icon` | `splash` | `lut`
- `subject` is the **domain id**, kebab-case, and must match `@frontline/shared` exactly:
  `portraitId` for portraits, `District.id` for districts, `BuildingKind` for buildings,
  `Resources` keys for resource icons.
- `variant` ∈ `damaged` | `selected` | `night` | `alt1..n` — omit for the default.

Examples:

```
portrait-overseer-1.webp            portrait-overseer-1@2x.webp
district-neon-docks.webp            district-combine-spire.webp
plate-city.webp                     plane-city-sky.webp   plane-city-fore.webp
building-command-center.webp        building-reactor-damaged.webp
icon-credits.webp   icon-power.webp   icon-data.webp   icon-alloy.webp
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
`scripts/gen-art.ts` writes `provenance.json` alongside generated files; this table is the
human-readable index and is the one a lawyer would be shown.

| File         | Source | Author | Licence | Commercial OK | Attribution required | Added | Notes                                                 |
| ------------ | ------ | ------ | ------- | ------------- | -------------------- | ----- | ----------------------------------------------------- |
| _(none yet)_ |        |        |         |               |                      |       | The current build is 100% procedural + code-authored. |

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
- [ ] No human-scale marker in an environment asset.
- [ ] Text baked into the image.
- [ ] Wrong aspect ratio or resolution for its class (§6).
- [ ] Filename does not resolve to a `@frontline/shared` domain id (§7).
- [ ] Third-party and not in the register (§9).
- [ ] Grain, bloom, vignette, chromatic aberration or lens flare baked in — those belong to the
      renderer, and baking them double-applies.
