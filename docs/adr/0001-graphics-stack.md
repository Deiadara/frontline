# ADR 0001 — Graphics stack for the Frontline city map and base view

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** CTO (author), CEO (backend-cost decision is a board gate)
- **Supersedes:** nothing
- **Related:** [`docs/ART-BIBLE.md`](../ART-BIBLE.md), [`docs/ART-PROMPTS.md`](../ART-PROMPTS.md), MOU-114

---

## 1. Context

Frontline is a browser strategy game. The board's directive (MOU-112 → MOU-114) is that the game
must look **comparable to top games of the genre**, in an **Arcane-esque** register: hand-painted,
between cartoony and photoreal, cyberpunk-dystopian. The two hero surfaces are:

- **City map** — a Grepolis/Ikariam-style clickable strategic map, but rendered as a dense city
  _interior_ seen at an oblique angle: layered depth, parallax, atmospheric haze, 11 clickable
  district nodes over a painted base plate.
- **Base view** — a smaller, denser scene of the player's own compound.

Today (commit `5b29fa8`) the client renders the map with **PixiJS v8.14** driving flat `Graphics`
circles on a 48px grid ([`apps/client/src/features/game/CityMap.tsx`](../../apps/client/src/features/game/CityMap.tsx)).
There is no viewport/pan/zoom, no texture pipeline, no post-processing, and no asset manifest.
Portraits are CSS gradients ([`OverseerPortrait.tsx`](../../apps/client/src/features/overseer/OverseerPortrait.tsx)).

### Hard constraint, verified 2026-08-12

**There is no image-generation model or credential in this environment.** No local
mflux/ComfyUI/SD/InvokeAI; no OpenAI / Stability / Replicate / fal / Imagen key in env or shell
profiles. Claude cannot render raster images. Therefore this ADR must:

1. pick a stack whose **final-art drop-in requires zero code changes**, and
2. hand the CEO **one costed decision** rather than a generated result.

---

## 2. Decision

**Stay on PixiJS v8 and build the painterly look out of its filter/asset ecosystem.**
Concretely, the stack is:

| Layer                         | Choice                               | Version                     | Licence |
| ----------------------------- | ------------------------------------ | --------------------------- | ------- |
| Renderer                      | `pixi.js` (WebGPU→WebGL fallback)    | `^8.14` (already installed) | MIT     |
| Camera / pan / zoom / clamp   | `pixi-viewport`                      | `^6` (targets Pixi v8+)     | MIT     |
| Post-processing               | `pixi-filters`                       | `^6` (the v8-aligned line)  | MIT     |
| Build-time atlases + manifest | `@assetpack/core` (PixiJS AssetPack) | latest                      | MIT     |
| Asset manifest types          | `@frontline/shared` (ours, Zod)      | —                           | —       |

**Rejected:** Phaser 3, Three.js, Excalibur. Reasoning in §4.

**Image backend recommendation (for the board):** **fal.ai FLUX.2 [pro]**, with **OpenAI
gpt-image-1 (high)** as the fallback for the four overseer portraits if faces need more direction.
Full costing in §6 — **the entire MVP asset set costs under $25 on the most expensive option
considered**, so this should be decided on quality, not price.

---

## 3. Why the look, not the library, is the risk

The critical insight driving this ADR: **no 2D web renderer is the bottleneck for a painterly
look.** Arcane's look is 90% _art direction_ (palette discipline, warm/cool split lighting, edge
control, silhouette) and 10% _compositing_ (grain, bloom on emissives, colour grade, vignette,
depth haze, parallax). Every candidate library can composite. So the library choice should be
made on:

1. **Compositing control** — can I stack arbitrary shaders on arbitrary sub-trees, cheaply?
2. **Asset pipeline** — atlas + manifest + lazy loading, so final art drops in with no code change.
3. **Migration cost from what we already have.**
4. **Not paying for a 3D engine we do not need.**

PixiJS wins on all four. The map is a 2.5D _painted-layer_ scene — parallax planes, not geometry.
We do not need a scene graph with cameras, lights, materials, or a physics engine.

---

## 4. Options considered

### 4.1 PixiJS v8 + pixi-viewport + pixi-filters + AssetPack — **CHOSEN**

**Evidence.** `pixi-filters` ships **40+ filters** and versions in lockstep with the renderer
(PixiJS v8.x → pixi-filters v6.x). The ones that literally are our painterly chain:

| Effect we need                 | Filter                                               | Notes                                                                |
| ------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Bloom on neon/emissive         | `AdvancedBloomFilter`                                | threshold-gated, so only sign/window pixels bloom                    |
| Colour grade (the Arcane LUT)  | `ColorMapFilter`                                     | takes a LUT PNG — the grade becomes an _asset_, tunable without code |
| Secondary grade / channel push | `ColorMatrixFilter`, `AdjustmentFilter`              | built-in; contrast/saturation/gamma                                  |
| Film grain                     | `NoiseFilter` (+ `OldFilmFilter` for heavier passes) | animated per-frame seed                                              |
| Volumetric shafts through smog | `GodrayFilter`                                       | for the map's upper haze plane                                       |
| Depth-of-field on far plane    | `KawaseBlurFilter` / `TiltShiftFilter`               | cheap multi-pass blur                                                |
| Painted edge separation        | `OutlineFilter`, `GlowFilter`                        | rim-light on hover/selection                                         |
| Damage / glitch states         | `GlitchFilter`, `RGBSplitFilter`, `CRTFilter`        | HUD and battle feedback                                              |

Vignette is a single `Graphics` radial-gradient plane in multiply blend — no filter needed.

`pixi-viewport` is **MIT**, `v6.0.0` targets **pixi.js v8+**, and ships exactly the interactions a
Grepolis-style map needs out of the box: _dragging, pinch-to-zoom, mouse-wheel zoom, decelerated
dragging, follow target, animate, snap-to-point, snap-to-zoom, clamping, bounce-on-edges,
move-on-mouse-edges_ — all individually configurable and removable.

**AssetPack** ("a configurable asset pipeline for the web", from the PixiJS org) is the build-time
half: it packs loose PNGs into atlases, emits mipmap/compressed variants, and generates the
manifest that `Assets.init({ manifest })` consumes. That is precisely the "final art drops in with
zero code changes" mechanism — artists add files to `assets/`, the pipeline re-packs, the typed
manifest in `@frontline/shared` names the same keys.

**Open-source reference projects.** The PixiJS org maintains
[`pixijs/open-games`](https://github.com/pixijs/open-games) — a collection of complete
open-source games (_Bubbo Bubbo_, _Puzzling Potions_) explicitly published "to learn how to make
professional games, built using PixiJS and its ecosystem of plugins and tools." These are the
structural reference for our scene/asset/screen wiring.

> **Honesty note.** I fetched the `open-games` root README; it links each game's own README for
> per-game licence and plugin detail, which I did **not** individually fetch. Treat "which exact
> plugins each game uses" as unverified. The collection's existence, purpose and membership are
> verified. We are using it as an architecture reference, not vendoring its code, so its per-game
> licence is not a blocker — but if we ever copy code from it, check that repo's licence first.

**Migration cost from today's setup: LOW — roughly a day of work, additive not destructive.**

- `pixi.js@8` is already a dependency; no renderer swap.
- `CityMap.tsx`'s mount/ResizeObserver/destroy lifecycle (lines 175–232) is sound and is kept
  verbatim. What changes is the _content_ of `redraw()`: `app.stage` gains a `Viewport` root, and
  the flat `drawBackground` grid is replaced by N parallax `Container`s.
- `drawDistrictNode` / `drawBaseMarker` keep their signature and hit-testing; only their visual
  body changes from `Graphics` circles to `Sprite`-or-procedural-painted nodes.
- The `hex()` + `palette` token bridge in `theme/tokens.ts` already exists and stays the single
  source of colour. The art bible extends it with ramps; it does not replace it.
- **No server, shared-schema, or routing change is required.**

**Costs.** ~+180 KB gzipped for `pixi-viewport` + `pixi-filters` (tree-shakeable — we import named
filters, not the barrel). Filters cost render-target ping-pongs; the mitigation is in §5.

### 4.2 Phaser 3 — rejected

A complete game framework: scenes, input, audio, tweens, Arcade/Matter physics, tilemaps. That is
the problem. We would be adopting ~1.2 MB and a whole lifecycle model to get a _renderer_ we
already have, and we would still hand-roll the painterly compositing. Its tilemap system — the one
genuine advantage for strategy maps — is the wrong primitive for us: our map is a **painted
illustration with hotspots**, not a tile grid. Migration cost: HIGH (full rewrite of the client's
game layer, plus reconciling Phaser's scene loop with React Router). Rejected on cost/benefit.

### 4.3 Three.js (+ `postprocessing`) — rejected

Three.js with the `postprocessing` library (`EffectComposer`, and effects like bloom/DoF/SMAA) is
the strongest _compositing_ option on this list, and if we wanted true 3D parallax with real depth,
lights and normal maps, this would win. But:

- Our brief is a **painted 2.5D** map. Faking that in Three means orthographic camera + textured
  quads — i.e. reimplementing Pixi's sprite batcher with more ceremony.
- Text/HUD/hit-testing ergonomics are markedly worse than Pixi's for a UI-dense strategy screen.
- Migration cost: HIGH, and it drags in a mental model (materials, lights, render passes) that
  every future contributor must learn to change a button.

Reconsider **only** if we later want true per-pixel relighting of the city (normal/height maps with
moving light sources). That is a post-MVP call, and Pixi's `SimpleLightmapFilter` covers the cheap
version of it in the meantime.

### 4.4 Excalibur — rejected

TypeScript-first and pleasant, with a good ECS. But its filter/post-processing ecosystem is far
thinner than `pixi-filters`' 40+ maintained shaders, and its community/plugin surface is
substantially smaller. For a project whose entire differentiator is _post-processing quality_, the
shader library is the deciding factor. Rejected.

### 4.5 Do nothing (flat `Graphics`) — rejected

Explicitly ruled out by the board: "Placeholder-looking flat rectangles are not acceptable."

---

## 5. Consequences

### 5.1 Architecture that falls out of this decision

```
packages/shared/src/art/
  manifest.ts     ArtManifest + AssetKey Zod schemas — single source of asset-key truth
  atlas.ts        bundle definitions (splash / city / base / ui) for lazy loading
apps/client/src/render/
  viewport.ts     pixi-viewport factory: clamp to map bounds, zoom 0.6–2.4, decelerate
  grade.ts        the post FX chain, built once, applied to the scene root
  layers.ts       parallax plane registry (§5.2)
  paint/          procedural painterly generators — the interim look (§5.3)
apps/client/src/assets/
  useAssetBundle.ts  React hook: lazy `Assets.loadBundle` + progress state
scripts/gen-art.ts   pluggable ImageBackend + manifest-driven runner + --dry-run
```

**Zero-code-change drop-in works like this:** every visual is addressed by an `AssetKey` from the
shared manifest. `resolveArt(key)` returns a real `Texture` if the bundle contains one, else it
returns the **procedural painted fallback** for that key's asset class. Dropping a correctly-named
PNG into `assets/` and re-running AssetPack flips every consumer of that key from procedural to
painted, with no TypeScript edit anywhere.

### 5.2 The parallax stack (map)

Back → front, each on its own `Container` with an independent viewport scroll factor:

| #   | Plane                                         | Scroll factor | Treatment                                               |
| --- | --------------------------------------------- | ------------- | ------------------------------------------------------- |
| 0   | Sky / arcology silhouette                     | 0.15          | heavy `KawaseBlur`, desaturated to `smog` ramp          |
| 1   | Far city block mass                           | 0.35          | `KawaseBlur` light, +haze overlay                       |
| 2   | Mid city (the base plate)                     | 1.00          | sharp; this is where districts live                     |
| 3   | District nodes + base markers                 | 1.00          | interactive layer; `GlowFilter` on hover/select         |
| 4   | Foreground occluders (cables, pipes, signage) | 1.35          | sharp, high-contrast silhouettes                        |
| 5   | Atmosphere                                    | —             | `GodrayFilter` + drifting smog sprites, additive        |
| 6   | Grade                                         | —             | `ColorMap` → `AdvancedBloom` → `Noise` → vignette plane |

Only plane 6 filters the **whole** scene. Planes 0/1 filter once at build of the layer (cached via
`cacheAsTexture`), not per frame.

### 5.3 Interim look without generated art (what ships now)

Since we cannot generate art in this environment, the interim map is **procedurally painted**, not
flat: seeded (deterministic) building-mass silhouettes with value-ramped façades, window-light
scatter on the `ember`/`hextech` ramps, smog gradients, and the full §5.2 filter chain over the
top. Combined with the grade, this reads as _stylised painted concept art_, not as placeholder
boxes. Every procedural generator is keyed to the same `AssetKey` it will one day be replaced by.

Third-party CC0 assets (OpenGameArt / Kenney / ambientCG) may be used **only** where they genuinely
help (grain plates, LUT textures, cable/pipe silhouettes). Every such file gets an entry in the
licensing register in `docs/ART-BIBLE.md` §9 — no exceptions, no un-registered files in `assets/`.

### 5.4 Performance guardrails

- Filters allocate render targets. Cap the whole-scene chain at **4 passes**; measure with
  `renderer.renderGroup` stats before adding a 5th.
- Static planes use `cacheAsTexture` and are invalidated only on resize.
- `AdvancedBloom` runs at half resolution (`quality: 4`, `pixelSize: 2`) — visually identical at
  our scale, ~4× cheaper.
- Budget: **60 fps at 1920×1080 on integrated graphics.** If a filter breaks it, it is cut, not
  optimised.
- `NoiseFilter` seed animates at 12 Hz, not per-frame — matches hand-drawn "boil" and costs less.

### 5.5 Risks

| Risk                                                                         | Mitigation                                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Filter chain tanks fps on low-end GPUs                                       | Quality tier: `low` drops bloom+godrays, keeps grade+grain. Detect via `renderer.type` + a first-frame timing probe. |
| Generated art arrives in a style that fights the procedural fallback         | The art bible palette is the contract for **both**; prompts in `ART-PROMPTS.md` embed the same hex ramps.            |
| AI-generated images may not be copyrightable in the US (no human authorship) | See §6.4. Register it; do not build brand identity on an unprotectable asset without legal review.                   |
| `pixi-viewport` is a single-maintainer package                               | MIT-licensed and vendorable (~2k LOC). If it stalls, we fork. Low blast radius.                                      |

---

## 6. Image-generation backends — the board decision

**None of these are activated. No account created, no key requested, nothing spent.**
`scripts/gen-art.ts` selects a backend from `FRONTLINE_ART_BACKEND` and reads its key from env; with
neither set it runs `--dry-run` only, which is what CI exercises.

### 6.1 Keyed routes (recommended class)

| Backend                  | Price per 1024×1024                                                        | Verified?         | Commercial use                                           | Quality notes                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **fal.ai FLUX.2 [pro]**  | **$0.03** for the first megapixel of output, **+$0.015** per extra MP      | ✅ primary source | ✅ page states "Commercial use"                          | Best-in-class prompt adherence and painterly texture; strongest for environments/illustration. Per-request billing (no per-second surprises). |
| **OpenAI gpt-image-1**   | **$0.011** (low) / **$0.042** (medium) / **$0.167** (high)                 | ✅ primary source | ⚠️ see §6.4                                              | Best instruction-following and text-in-image; strongest for _faces with specific direction_ and for UI elements containing legible type.      |
| Google Imagen            | not verified                                                               | ❌                | ❌ not verified                                          | Excluded from the recommendation on evidence grounds — see §6.3.                                                                              |
| Stability (Ultra / Core) | not verified from primary source                                           | ❌                | Community License reported free under $1M annual revenue | Solid, generally a step behind FLUX.2 on painterly detail.                                                                                    |
| Replicate                | per-second GPU billing; effective per-image varies with model and hardware | ❌                | model-dependent (each model carries its own licence)     | Widest model catalogue; worst cost predictability. Reported to be 1.4–2.9× more expensive than fal for equivalent image work.                 |

### 6.2 No-key routes — **not recommended**

Public "free Flux" proxies exist. Do not use them:

- **Reliability:** unversioned, rate-limited, and they disappear without notice — an art pipeline
  that cannot be re-run is not a pipeline.
- **Licensing:** the proxy's terms, not Black Forest Labs', govern the output, and they are
  routinely silent or non-commercial. We would be shipping assets of unknown provenance in a
  commercial product.
- **Provenance:** we could not honestly fill in the licence column of the register in §9 of the
  art bible.

`gen-art.ts` deliberately ships **no** no-key backend. Adding one must be a conscious, reviewed PR.

### 6.3 What I could not verify — stated plainly

Per company rule 8, these are **not** presented as fact:

- Stability's per-image price and the exact current terms of the Community License: the primary
  pricing page returned no usable content to me. The "$1M annual revenue" threshold comes from
  secondary sources only.
- Replicate's effective per-image cost: only secondary sources.
- Google Imagen pricing and terms: not fetched from a primary source at all.
- Whether `gpt-image-1` has a stated deprecation date: the OpenAI model page I fetched calls it
  "our previous image generation model" but states **no** deprecation timeline. Secondary sources
  claim October 2026 and newer models; treat that as unconfirmed.
- Per-game licences inside `pixijs/open-games` (see §4.1 honesty note).

If the board wants Stability or Imagen seriously considered, that is a 20-minute follow-up to read
their primary pricing and terms pages — worth doing **before** signing anything, not before
deciding, given §6.5.

### 6.4 Ownership of the output — flag for the board

Multiple sources report that under current US law, **purely AI-generated images are not
copyrightable** because they lack human authorship; copyright may attach only to substantial human
creative contribution (detailed direction, img2img, inpainting, compositing). This is **not legal
advice and I have not verified it against a primary legal source.**

Practical consequence for us: hero brand assets (logo, the four overseer portraits) should get a
human pass — overpaint, composite, colour-correct — both because it improves them and because it
strengthens any rights claim. `gen-art.ts` records `provenance.humanEdited` per file for exactly
this reason. **Recommend the CEO route this to the board before any public launch.**

### 6.5 Total cost to generate the full MVP asset list

| Asset class                                            |  Count | Target size |   MP | Unit @ fal FLUX.2 pro |  Subtotal |
| ------------------------------------------------------ | -----: | ----------- | ---: | --------------------: | --------: |
| Overseer portraits                                     |      4 | 1024×1536   | 1.57 |                $0.039 |     $0.16 |
| District illustrations                                 |     11 | 1024×1024   | 1.00 |                $0.030 |     $0.33 |
| City map base plate                                    |      1 | 2048×1152   | 2.36 |                $0.050 |     $0.05 |
| Parallax planes (sky, far, fore)                       |      3 | 2048×1152   | 2.36 |                $0.050 |     $0.15 |
| Base building sprites                                  |      6 | 1024×1024   | 1.00 |                $0.030 |     $0.18 |
| UI frame / HUD elements                                |      6 | 1024×1024   | 1.00 |                $0.030 |     $0.18 |
| Icons (4 resource, 4 archetype, 4 district-kind)       |     12 | 512×512     | 0.25 |                $0.030 |     $0.36 |
| Auth / splash backdrop                                 |      1 | 2048×1152   | 2.36 |                $0.050 |     $0.05 |
| **Total, single pass**                                 | **44** |             |      |                       | **$1.46** |
| **With 3 candidates per asset** (realistic)            |    132 |             |      |                       | **$4.38** |
| **With 5 candidates on the 4 portraits + 3 elsewhere** |    140 |             |      |                       | **$4.69** |

Same list on **gpt-image-1 (high)**: 44 × $0.167 = **$7.35** single pass, **$22.04** at three
candidates.

> Sizes below 1 MP still bill the 1 MP minimum on fal — hence icons at $0.030.
> All figures are list price, exclusive of tax, and assume no free tier.

### 6.6 Recommendation

**The total cost of the entire MVP art set is under $25 on the most expensive option considered.
Cost must not drive this decision — quality must.**

Recommended: **fal.ai FLUX.2 [pro]** as the default backend (`FRONTLINE_ART_BACKEND=fal`), because
it is the only option where I verified _both_ the price and an explicit commercial-use statement
from a primary source, it has the strongest painterly-environment output, and per-request billing
makes the run cost knowable in advance.

Recommended addition: budget **~$25** rather than ~$5, and use **gpt-image-1 (high)** for the four
overseer portraits and any UI element containing legible text — those are the two jobs where
instruction-following beats texture quality. Dual-backend is already supported; `gen-art.ts` takes
a per-asset `backend` override in the manifest.

**One decision for the board:** approve a **$25 art-generation budget on fal.ai (+ optional OpenAI
for portraits)**, or direct us to generate the assets elsewhere by pasting
[`docs/ART-PROMPTS.md`](../ART-PROMPTS.md) into a tool the board already pays for. Either path
drops into the same asset tree with zero code change.

---

## 7. Sources

- [pixijs/filters — filter catalogue and PixiJS version alignment](https://github.com/pixijs/filters)
- [davidfig/pixi-viewport — MIT, v6 targets PixiJS v8+, feature list](https://github.com/davidfig/pixi-viewport)
- [pixijs/open-games — open-source reference games](https://github.com/pixijs/open-games)
- [PixiJS AssetPack — configurable asset pipeline for the web](https://pixijs.io/assetpack/)
- [PixiJS filters & blend modes guide](https://pixijs.com/8.x/guides/components/filters)
- [OpenAI — gpt-image-1 model page (per-image pricing)](https://developers.openai.com/api/docs/models/gpt-image-1)
- [fal.ai — FLUX.2 [pro] text-to-image (pricing, commercial use)](https://fal.ai/models/fal-ai/flux-2-pro)
- [Stability AI — Community License](https://stability.ai/news-updates/license-update) _(secondary reading only; primary pricing page not retrievable)_
