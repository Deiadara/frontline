/**
 * The single source of asset-key truth.
 *
 * Keys, filenames and seeds are **derived** from the domain constants (`CITY_DISTRICTS`,
 * `BUILDING_CATALOG`, `OVERSEER_PRESETS`, `RESOURCE_ICON_SUBJECTS`, `OVERSEER_ARCHETYPES`,
 * `DISTRICT_KINDS`) so the `docs/ART-BIBLE.md` §7 naming rule cannot drift from the game model.
 * Resolutions and aspects come from the ART-BIBLE §6 table; prompts come from `./prompts.js`.
 */
import { z } from 'zod';
import { BUILDING_KINDS, type BuildingKind } from '../building/index.js';
import {
  CITY_DISTRICTS,
  DISTRICT_KINDS,
  LOCATION_KINDS,
  type DistrictKind,
} from '../city/index.js';
import { OVERSEER_ARCHETYPES, OVERSEER_PRESETS, type OverseerArchetype } from '../overseer.js';
import { RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { UNIT_CATALOG, UNIT_IDS } from '../units/index.js';
import {
  ARCHETYPE_ICON_SUBJECTS,
  BUILDING_SUBJECTS,
  DISTRICT_KIND_ICON_SUBJECTS,
  LOCATION_ICON_SUBJECTS,
  DISTRICT_SUBJECTS,
  FRAMING,
  PLATE_SUBJECTS,
  PORTRAIT_SUBJECTS,
  RESOURCE_ICON_SUBJECTS,
  UI_SUBJECTS,
  UNIT_SUBJECTS,
} from './prompts.js';

/** ART-BIBLE §7: the `class` segment of every filename. */
export const ASSET_CLASSES = [
  'portrait',
  'district',
  'plate',
  'plane',
  'building',
  'unit',
  'ui',
  'icon',
  'splash',
  'lut',
] as const;
export const AssetClassSchema = z.enum(ASSET_CLASSES);
export type AssetClass = z.infer<typeof AssetClassSchema>;

/**
 * ART-BIBLE §6: aspect ratios are fixed; changing one is a layout change.
 *
 * `1672:941` (1.7768) is the district plate's, and it exists because the delivered painting is that
 * shape. The district scene reads its aspect from the plate rather than the other way round, so
 * cropping to reach 16:9 would buy nothing and cost a strip of the compound. It replaced `43:24`
 * when the board repainted the district, which is exactly the kind of change this enum is meant to
 * make visible: the twelve building sites are positions on that painting, so its shape changing is
 * a layout change and not a detail.
 */
export const AssetAspectSchema = z.enum(['3:4', '1:1', '16:9', '1672:941', '1264:848']);
export type AssetAspect = z.infer<typeof AssetAspectSchema>;

/** ADR 0001 §6.1: the backends `scripts/gen-art.ts` knows how to drive. */
export const ImageBackendNameSchema = z.enum(['fal', 'openai']);
export type ImageBackendName = z.infer<typeof ImageBackendNameSchema>;

/** What a backend is actually asked to render: see {@link AssetSpec.source}. */
export const AssetSourceSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alpha: z.boolean(),
});
export type AssetSource = z.infer<typeof AssetSourceSchema>;

/**
 * A declared master→delivery step the AssetPack encode stage (ADR 0001 §4.1) must apply.
 *
 * - `downscale`: resample the master to the ART-BIBLE §6 delivery resolution.
 * - `matte`: cut an alpha channel out of an opaque master.
 * - `trim`: crop a keyed master to its own alpha bounding box.
 *
 * The first two exist because no text-to-image parameter delivers the result directly. Declaring
 * them makes the substitution deliberate and auditable rather than something a backend does
 * silently.
 *
 * `trim` exists because a cutout's *file* is not its artwork. The delivered structures carry
 * between 11 and 105 px of empty canvas under their feet, and a scene that stands them on a ground
 * line has no way to know which, so a bottom-aligned row of them stands at eleven different
 * heights. Cropping to the alpha box makes the file mean the building, which is what every consumer
 * of a cutout already assumes.
 */
export const POST_PROCESS_STEPS = ['downscale', 'matte', 'trim'] as const;

/**
 * How a master that is not already the delivery shape is brought to it.
 *
 * - `crop`: the delivery is exactly `width × height`. A master of another aspect is centre-cropped
 *   to it, losing whatever sat outside the frame. Right for anything the layout gives a fixed box:
 *   an icon, a portrait, a full-bleed plate.
 * - `contain`: `width × height` is a *bounding box*. The master keeps its own aspect and is scaled
 *   until its longest side meets the bound, so nothing is ever cut. Right for a cutout that the
 *   scene positions rather than fills: a wide greenhouse and a tall tower are both correct, and
 *   cropping either to a square would be the pipeline overruling the drawing.
 */
export const ASSET_FITS = ['crop', 'contain'] as const;
export const AssetFitSchema = z.enum(ASSET_FITS);
export type AssetFit = z.infer<typeof AssetFitSchema>;
export const PostProcessStepSchema = z.enum(POST_PROCESS_STEPS);
export type PostProcessStep = z.infer<typeof PostProcessStepSchema>;

export interface BackendCapabilities {
  /** The resolutions the backend accepts, or `null` when it takes an arbitrary size. */
  sizes: readonly (readonly [width: number, height: number])[] | null;
  /** ART-BIBLE §6: whether it can return a master with a real alpha channel. */
  alpha: boolean;
}

/**
 * ADR 0001 §6.1: what each backend can actually be asked for. This is capability data, not a
 * preference: prose in the FRAMING block is neither a size nor a transparency parameter, so an
 * asset whose {@link AssetSpec.source} no backend satisfies cannot be generated at all.
 */
export const BACKEND_CAPABILITIES: Readonly<Record<ImageBackendName, BackendCapabilities>> = {
  // FLUX.2 [pro] documents no transparency parameter of any kind (verified, ADR §6.1.1).
  // `null` is an approximation: `image_size` is not arbitrary but bounded: 256-2560 per side,
  // both divisible by 16, area ≤ 4194304. Every source size the manifest produces today clears
  // all four, so widening it to `null` moves no routing; a source outside those bounds would.
  fal: { sizes: null, alpha: false },
  // gpt-image-1 documents `background: transparent` and exactly three sizes.
  openai: {
    sizes: [
      [1024, 1024],
      [1024, 1536],
      [1536, 1024],
    ],
    alpha: true,
  },
};

export function backendCanProduce(backend: ImageBackendName, source: AssetSource): boolean {
  const caps = BACKEND_CAPABILITIES[backend];
  if (source.alpha && !caps.alpha) return false;
  return (
    caps.sizes === null ||
    caps.sizes.some(([width, height]) => width === source.width && height === source.height)
  );
}

/** Every backend that could render `source`. Empty means the asset has no producible path. */
export function backendsForSource(source: AssetSource): readonly ImageBackendName[] {
  return ImageBackendNameSchema.options.filter((name) => backendCanProduce(name, source));
}

/** Lower-kebab identifier. Never string-concatenated by hand: see {@link resolveAssetKey}. */
export const AssetKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type AssetKey = z.infer<typeof AssetKeySchema>;

export const AssetPromptSchema = z.object({
  /** The per-asset SUBJECT block. */
  subject: z.string().min(1),
  /** The per-class framing block, appended after the subject. */
  framing: z.string().min(1),
});
export type AssetPrompt = z.infer<typeof AssetPromptSchema>;

/**
 * ART-BIBLE §7: `variant` ∈ `damaged` | `selected` | `night` | `alt1..n`. Matched against the
 * filename tail, so a future domain id ending in one of these words (a district `halcyon-night`)
 * would parse as subject `halcyon` + variant `night` and fail as an unresolvable subject.
 */
const VARIANT_PATTERN = '(?:damaged|selected|night|alt[1-9][0-9]*)';
const SUBJECT_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*?';

/** `<class>-<subject>[-<variant>][@2x].<ext>` (ART-BIBLE §7). */
export const ASSET_FILE_PATTERN = new RegExp(
  `^(${ASSET_CLASSES.join('|')})-(${SUBJECT_PATTERN})(?:-(${VARIANT_PATTERN}))?(@2x)?\\.(webp|png)$`,
);

/** Version suffixes are banned: the file is versioned by git, not by its name (ART-BIBLE §7). */
const BANNED_SUFFIX_PATTERN = /-(?:v\d+|final|latest|new|old|copy|fixed)(?=[-@.]|$)/;

export const AssetSpecSchema = z.object({
  key: AssetKeySchema,
  class: AssetClassSchema,
  file: z.string().regex(ASSET_FILE_PATTERN),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspect: AssetAspectSchema,
  alpha: z.boolean(),
  /**
   * What the backend is asked to render. Equals the delivery spec above unless no backend can
   * produce that directly (512×512 alpha icons, 16:9 alpha planes), then it is the nearest thing
   * one *can* produce, and {@link AssetSpec.postProcess} says how to get from here to there.
   */
  source: AssetSourceSchema,
  /** The declared master→delivery steps. Empty when the master already is the delivery image. */
  postProcess: z.array(PostProcessStepSchema),
  /** Whether {@link AssetSpec.width}×{@link AssetSpec.height} is an exact size or a bound. */
  fit: AssetFitSchema,
  /**
   * ART-BIBLE §6: the fraction of the delivery that must end up transparent. Declared only where
   * the bible states a floor, and enforced by the encode step: a fore plane that fails it smothers
   * the map, and neither a text-to-image prompt nor an automatic matte can be trusted to hit it.
   */
  minTransparency: z.number().min(0).max(1).optional(),
  seed: z.number().int().nonnegative(),
  prompt: AssetPromptSchema,
  /** Reference images passed to the backend for style consistency (ART-PROMPTS §8.3). */
  styleRefs: z.array(AssetKeySchema),
  /** Per-asset backend override; absent means "whatever `FRONTLINE_ART_BACKEND` selects". */
  backend: ImageBackendNameSchema.optional(),
});
export type AssetSpec = z.infer<typeof AssetSpecSchema>;

export interface AssetClassSpec {
  width: number;
  height: number;
  aspect: AssetAspect;
  /** ART-BIBLE §6 delivery format. 9-slice frames and LUTs must stay lossless. */
  ext: 'webp' | 'png';
  /** WebP encoder quality for the delivery file; `null` for the lossless PNG classes. */
  quality: number | null;
  alpha: boolean;
  /** Class-wide {@link AssetSpec.source} override; absent means "render it at delivery size". */
  source?: AssetSource;
  /** Defaults to `crop`: the delivery is exactly `width × height`. See {@link AssetFit}. */
  fit?: AssetFit;
}

/** ART-BIBLE §6: source resolution, aspect, delivery format and default transparency per class. */
export const ASSET_CLASS_SPECS: Readonly<Record<AssetClass, AssetClassSpec>> = {
  portrait: { width: 1024, height: 1536, aspect: '3:4', ext: 'webp', quality: 90, alpha: false },
  district: { width: 1024, height: 1024, aspect: '1:1', ext: 'webp', quality: 90, alpha: false },
  plate: { width: 2048, height: 1152, aspect: '16:9', ext: 'webp', quality: 92, alpha: false },
  // Sky is opaque, far/fore carry alpha: the manifest overrides per plane.
  plane: { width: 2048, height: 1152, aspect: '16:9', ext: 'webp', quality: 90, alpha: true },
  // A structure has to sit on the district's ground plane, so it ships with alpha, but every
  // master that has actually arrived is painted on a flat white field instead, which is what an
  // illustrator hands over and what the backends produce when asked for transparency. Declaring an
  // opaque source makes `matte` the encode step for the class rather than a per-key exception, and
  // costs a master that *does* carry alpha nothing: `matte` passes an already-keyed image straight
  // through (`HUMAN_MATTE_FLOOR`).
  building: {
    width: 1024,
    height: 1024,
    aspect: '1:1',
    ext: 'webp',
    quality: 90,
    alpha: true,
    source: { width: 1024, height: 1024, alpha: false },
    // A structure is a cutout the district *places*, not a picture that fills a box, so 1024² is a
    // ceiling rather than a shape: a long greenhouse and a narrow tower each keep their own
    // proportions and the scene sizes them. Cropping them square lost the ends of the greenhouse.
    fit: 'contain',
  },
  // A roster card, not a hero shot: half the linear resolution of an overseer portrait, because
  // twenty-seven of these render in one grid and none of them is ever shown full-bleed.
  unit: { width: 768, height: 1024, aspect: '3:4', ext: 'webp', quality: 90, alpha: false },
  ui: { width: 1024, height: 1024, aspect: '1:1', ext: 'png', quality: null, alpha: true },
  // No backend does 512×512 with alpha (fal has no alpha, gpt-image-1 has no size below 1024), so
  // icons are rendered transparent at 1024² and downscaled by the encode step.
  icon: {
    width: 512,
    height: 512,
    aspect: '1:1',
    ext: 'webp',
    quality: 88,
    alpha: true,
    source: { width: 1024, height: 1024, alpha: true },
  },
  splash: { width: 2048, height: 1152, aspect: '16:9', ext: 'webp', quality: 90, alpha: false },
  lut: { width: 512, height: 512, aspect: '1:1', ext: 'png', quality: null, alpha: false },
};

/**
 * The two assets approved first and then passed to every later generation as style references
 * (ART-PROMPTS §8.2-§8.3).
 */
export const STYLE_REFERENCE_KEYS = ['district-neon-docks', 'portrait-overseer-1'] as const;

/** Generated before the references exist, so they carry none (ART-PROMPTS §8.1). */
const UNREFERENCED_KEYS: readonly AssetKey[] = [
  'plate-city',
  'plane-city-sky',
  'plane-city-far',
  'plane-city-fore',
  ...STYLE_REFERENCE_KEYS,
];

/** ART-PROMPTS §0.3: `<class-base> + index`, so any asset can be regenerated without a log. */
const SEED_BASE = {
  portrait: 110000,
  district: 120000,
  plate: 130000,
  building: 140000,
  unit: 145000,
  ui: 150000,
  resourceIcon: 160000,
  archetypeIcon: 160010,
  kindIcon: 160020,
  locationIcon: 160030,
} as const;

const toKebab = (id: string): string => id.replaceAll('_', '-');
const toSnake = (subject: string): string => subject.replaceAll('-', '_');

/** Resource keys are the one camelCase domain id; asset ids are lower-kebab (ART-BIBLE §7). */
const kebabFromCamel = (id: string): string =>
  id.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase();

/** The icon ids, in `RESOURCE_KEYS` order: that order fixes the seeds. */
const RESOURCE_ICON_IDS: readonly string[] = RESOURCE_KEYS.map(kebabFromCamel);

/** The delivery half of a spec: what ships, as opposed to what the backend renders. */
type Delivery = Pick<AssetSpec, 'width' | 'height' | 'alpha'>;

/**
 * The steps that turn `source` into `delivery`, **in application order**. Derived rather than
 * declared, so a manifest entry cannot claim a post-process it does not need or omit one it does.
 *
 * `matte` comes first: cutting alpha out of an already-downscaled master keys edge pixels that have
 * been blended with the background, which bakes fringing into the alpha edge and does it with a
 * quarter of the information. Matte at master resolution, then downscale with premultiplied alpha.
 */
export function postProcessFor(
  source: AssetSource,
  delivery: Delivery,
  fit: AssetFit,
): PostProcessStep[] {
  const steps: PostProcessStep[] = [];
  if (delivery.alpha && !source.alpha) steps.push('matte');
  // After the key, so there is an alpha channel to measure, and before the downscale, so the
  // bound is applied to the artwork rather than to the artwork plus its margin.
  if (fit === 'contain' && delivery.alpha) steps.push('trim');
  if (source.width !== delivery.width || source.height !== delivery.height) steps.push('downscale');
  return steps;
}

/** Pins the backend when exactly one can render `source`; otherwise `FRONTLINE_ART_BACKEND` picks. */
function soleCapableBackend(source: AssetSource): ImageBackendName | undefined {
  const capable = backendsForSource(source);
  return capable.length === 1 ? capable[0] : undefined;
}

type DraftSpec = Omit<
  AssetSpec,
  'styleRefs' | 'file' | 'width' | 'height' | 'aspect' | 'alpha' | 'source' | 'postProcess' | 'fit'
> &
  Partial<Pick<AssetSpec, 'alpha' | 'source' | 'width' | 'height' | 'aspect'>>;

function draft(spec: DraftSpec): Omit<AssetSpec, 'styleRefs'> {
  const classSpec = ASSET_CLASS_SPECS[spec.class];
  const delivery: Delivery = {
    width: spec.width ?? classSpec.width,
    height: spec.height ?? classSpec.height,
    alpha: spec.alpha ?? classSpec.alpha,
  };
  const source = spec.source ?? classSpec.source ?? delivery;
  const fit = classSpec.fit ?? 'crop';
  return {
    ...spec,
    ...delivery,
    file: `${spec.key}.${classSpec.ext}`,
    aspect: spec.aspect ?? classSpec.aspect,
    source,
    postProcess: postProcessFor(source, delivery, fit),
    fit,
    // A capability-pinned backend is not a preference: the other one physically cannot deliver.
    backend: spec.backend ?? soleCapableBackend(source),
  };
}

/** Fails loudly at import: a domain id with no prompt is a build failure (ART-BIBLE §7). */
function subjectFor(table: Readonly<Record<string, string>>, id: string, label: string): string {
  const subject = table[id];
  if (subject === undefined) throw new Error(`No ${label} art prompt for "${id}"`);
  return subject;
}

const portraitDrafts = OVERSEER_PRESETS.map((preset, index) =>
  draft({
    key: `portrait-${preset.portraitId}`,
    class: 'portrait',
    seed: SEED_BASE.portrait + index + 1,
    prompt: {
      subject: subjectFor(PORTRAIT_SUBJECTS, preset.portraitId, 'portrait'),
      framing: FRAMING.portrait,
    },
    // ADR 0001 §6.6: gpt-image-1 leads on faces with specific direction.
    backend: 'openai',
  }),
);

const districtDrafts = CITY_DISTRICTS.map((district, index) =>
  draft({
    key: `district-${district.id}`,
    class: 'district',
    seed: SEED_BASE.district + index + 1,
    prompt: {
      subject: subjectFor(DISTRICT_SUBJECTS, district.id, 'district'),
      framing: FRAMING.district,
    },
  }),
);

/**
 * The far and fore planes ship transparent, but nothing renders 16:9 with alpha: gpt-image-1 has
 * no 16:9 size at all and FLUX.2 has no alpha. ART-BIBLE §6 also wants the fore plane ≥55%
 * transparent, which no text-to-image parameter delivers, so the cut was always a post-process.
 */
const OPAQUE_PLANE_SOURCE: AssetSource = { width: 2048, height: 1152, alpha: false };

/**
 * The district plate ships at the size it was painted, not at the plate class's 2048×1152.
 *
 * Every other plate is a backdrop that a layout crops to taste, so one class size is right for
 * them. This one is a *map*: twelve building sites are positioned against features in the painting,
 * and a crop or an upscale moves the ground out from under all twelve at once. The class size would
 * have forced exactly that, so the key overrides it and the district scene takes its aspect from
 * here.
 */
const DISTRICT_PLATE_DELIVERY = {
  width: 1672,
  height: 941,
  aspect: '1672:941',
} as const satisfies Partial<AssetSpec>;

/**
 * The Bar's room, at the size it was painted, and for the same reason as the district's ground.
 *
 * It is a *place with a seat in it*: the empty stool in the middle of the frame is where the Sit
 * Down control is positioned, in fractions of this image. A crop moves the stool out from under the
 * control, and the class's 2048 width would have rejected a 1264px master by name rather than
 * cropping it.
 */
const BAR_PLATE_DELIVERY = {
  width: 1264,
  height: 848,
  aspect: '1264:848',
} as const satisfies Partial<AssetSpec>;

/**
 * The keys allowed to differ from their class's §6 size, and what they must be instead.
 *
 * A table rather than a skip: an asset off its class size is still checked, just against a number
 * written down here. Adding a key is the deliberate act: a second asset drifting off the class
 * table without an entry still fails {@link validateAssetSpec}.
 */
const SIZE_EXCEPTIONS: Readonly<
  Partial<Record<AssetKey, Pick<AssetSpec, 'width' | 'height' | 'aspect'>>>
> = { 'plate-district': DISTRICT_PLATE_DELIVERY, 'plate-bar': BAR_PLATE_DELIVERY };

/** ART-BIBLE §6: "the fore plane must be ≥55% transparent or it smothers the map". */
const FORE_PLANE_MIN_TRANSPARENCY = 0.55;

/**
 * ART-BIBLE §6: "far plane ≥30% or it hides the sky". Its prompt paints the top forty percent of
 * the canvas fully transparent, so the floor sits under that ask: enough slack for a skyline drawn
 * high in frame, still far above a matte that only cut a sliver and left the sky plane covered.
 */
const FAR_PLANE_MIN_TRANSPARENCY = 0.3;

const plateDrafts = (
  [
    ['plate-city', 'plate'],
    ['plane-city-sky', 'plane'],
    ['plane-city-far', 'plane'],
    ['plane-city-fore', 'plane'],
    ['splash-auth', 'splash'],
    // Appended rather than filed beside `plate-city`: the seed is the index, so inserting one in
    // the middle would re-roll every plate after it.
    ['plate-district', 'plate'],
    ['plate-bar', 'plate'],
  ] as const
).map(([key, assetClass], index) =>
  draft({
    key,
    class: assetClass,
    seed: SEED_BASE.plate + index + 1,
    prompt: { subject: PLATE_SUBJECTS[key], framing: FRAMING.plate },
    // The sky plane sits behind everything and needs no transparency (ART-BIBLE §6).
    ...(key === 'plane-city-sky' ? { alpha: false } : {}),
    ...(key === 'plane-city-far' || key === 'plane-city-fore'
      ? { source: OPAQUE_PLANE_SOURCE }
      : {}),
    ...(key === 'plane-city-far' ? { minTransparency: FAR_PLANE_MIN_TRANSPARENCY } : {}),
    ...(key === 'plane-city-fore' ? { minTransparency: FORE_PLANE_MIN_TRANSPARENCY } : {}),
    ...(key === 'plate-district' ? DISTRICT_PLATE_DELIVERY : {}),
    ...(key === 'plate-bar' ? BAR_PLATE_DELIVERY : {}),
  }),
);

const buildingDrafts = BUILDING_KINDS.map((kind, index) =>
  draft({
    key: `building-${toKebab(kind)}`,
    class: 'building',
    seed: SEED_BASE.building + index + 1,
    prompt: { subject: BUILDING_SUBJECTS[kind], framing: FRAMING.building },
  }),
);

const unitDrafts = UNIT_CATALOG.map((unit, index) =>
  draft({
    key: `unit-${toKebab(unit.id)}`,
    class: 'unit',
    seed: SEED_BASE.unit + index + 1,
    prompt: { subject: subjectFor(UNIT_SUBJECTS, unit.id, 'unit'), framing: FRAMING.unit },
  }),
);

const uiDrafts = (Object.keys(UI_SUBJECTS) as (keyof typeof UI_SUBJECTS)[]).map((key, index) =>
  draft({
    key,
    class: 'ui',
    seed: SEED_BASE.ui + index + 1,
    prompt: { subject: UI_SUBJECTS[key], framing: FRAMING.ui },
  }),
);

const iconDrafts = [
  ...RESOURCE_KEYS.map((resource, index) =>
    draft({
      key: `icon-${kebabFromCamel(resource)}`,
      class: 'icon',
      seed: SEED_BASE.resourceIcon + index + 1,
      prompt: { subject: RESOURCE_ICON_SUBJECTS[resource], framing: FRAMING.icon },
    }),
  ),
  ...OVERSEER_ARCHETYPES.map((archetype, index) =>
    draft({
      key: `icon-archetype-${archetype}`,
      class: 'icon',
      seed: SEED_BASE.archetypeIcon + index + 1,
      prompt: { subject: ARCHETYPE_ICON_SUBJECTS[archetype], framing: FRAMING.icon },
    }),
  ),
  ...DISTRICT_KINDS.map((kind, index) =>
    draft({
      key: `icon-kind-${toKebab(kind)}`,
      class: 'icon',
      seed: SEED_BASE.kindIcon + index + 1,
      prompt: { subject: DISTRICT_KIND_ICON_SUBJECTS[kind], framing: FRAMING.icon },
    }),
  ),
  // §A4: one marker per *kind* of location rather than one per location. Forty-two locations on
  // the map share these, and a player reads the kind off the marker: two substations should look
  // like two substations.
  ...LOCATION_KINDS.map((kind, index) =>
    draft({
      key: `icon-location-${toKebab(kind)}`,
      class: 'icon',
      seed: SEED_BASE.locationIcon + index + 1,
      prompt: { subject: LOCATION_ICON_SUBJECTS[kind], framing: FRAMING.icon },
    }),
  ),
];

/** Every asset the MVP needs, in ART-PROMPTS §1-§7 order. */
export const ART_MANIFEST: readonly AssetSpec[] = [
  ...portraitDrafts,
  ...districtDrafts,
  ...plateDrafts,
  ...buildingDrafts,
  ...unitDrafts,
  ...uiDrafts,
  ...iconDrafts,
].map((spec) => ({
  ...spec,
  styleRefs: UNREFERENCED_KEYS.includes(spec.key) ? [] : [...STYLE_REFERENCE_KEYS],
}));

const ASSET_BY_KEY: ReadonlyMap<AssetKey, AssetSpec> = new Map(
  ART_MANIFEST.map((spec) => [spec.key, spec]),
);

export const ASSET_KEYS: readonly AssetKey[] = ART_MANIFEST.map((spec) => spec.key);

export function findAssetSpec(key: AssetKey): AssetSpec | undefined {
  return ASSET_BY_KEY.get(key);
}

/** A domain object addressed by art. Keeps callers out of the business of building keys. */
export type AssetRef =
  | { type: 'portrait'; portraitId: string }
  | { type: 'district'; districtId: string }
  | { type: 'building'; building: BuildingKind }
  | { type: 'unit'; unitId: string }
  | { type: 'plate'; plate: string }
  | { type: 'resource-icon'; resource: ResourceKey }
  | { type: 'archetype-icon'; archetype: OverseerArchetype }
  | { type: 'district-kind-icon'; districtKind: DistrictKind };

function assetKeyFor(ref: AssetRef): AssetKey {
  switch (ref.type) {
    case 'portrait':
      return `portrait-${ref.portraitId}`;
    case 'district':
      return `district-${ref.districtId}`;
    case 'building':
      return `building-${toKebab(ref.building)}`;
    case 'unit':
      return `unit-${toKebab(ref.unitId)}`;
    case 'plate':
      return `plate-${toKebab(ref.plate)}`;
    case 'resource-icon':
      return `icon-${kebabFromCamel(ref.resource)}`;
    case 'archetype-icon':
      return `icon-archetype-${ref.archetype}`;
    case 'district-kind-icon':
      return `icon-kind-${toKebab(ref.districtKind)}`;
  }
}

/**
 * The only supported way to turn a domain id into an `AssetKey`. Throws when the id has no
 * manifest entry: an unresolvable subject is a build failure, not a warning (ART-BIBLE §7).
 */
export function resolveAssetKey(ref: AssetRef): AssetKey {
  const key = tryResolveAssetKey(ref);
  if (key === undefined) {
    throw new Error(`No manifest entry for asset key "${assetKeyFor(ref)}" (${ref.type})`);
  }
  return key;
}

/**
 * The same resolution for ids that arrive at runtime rather than from a domain constant: a
 * `portraitId` or `districtId` off the wire is only `z.string()`, so a view asking it for art
 * must be able to get "no such asset" back instead of a thrown render.
 */
export function tryResolveAssetKey(ref: AssetRef): AssetKey | undefined {
  const key = assetKeyFor(ref);
  return ASSET_BY_KEY.has(key) ? key : undefined;
}

export interface ParsedAssetFile {
  class: AssetClass;
  subject: string;
  variant: string | undefined;
  retina: boolean;
  ext: string;
}

/** Parses the ART-BIBLE §7 grammar. Returns `null` for any name that violates it. */
export function parseAssetFileName(file: string): ParsedAssetFile | null {
  const match = ASSET_FILE_PATTERN.exec(file);
  if (!match) return null;
  const [, assetClass, subject, variant, retina, ext] = match;
  if (assetClass === undefined || subject === undefined || ext === undefined) return null;
  if (BANNED_SUFFIX_PATTERN.test(`-${subject}`)) return null;
  return {
    class: assetClass as AssetClass,
    subject,
    variant,
    retina: retina !== undefined,
    ext,
  };
}

/**
 * ART-BIBLE §7: for classes that carry a domain id, the subject must match `@frontline/shared`
 * exactly. Classes with no domain counterpart (plates, planes, UI, splash, LUT) always resolve.
 */
export function subjectResolvesToDomainId(assetClass: AssetClass, subject: string): boolean {
  switch (assetClass) {
    case 'portrait':
      return OVERSEER_PRESETS.some((preset) => preset.portraitId === subject);
    case 'district':
      return CITY_DISTRICTS.some((district) => district.id === subject);
    case 'building':
      return (BUILDING_KINDS as readonly string[]).includes(toSnake(subject));
    case 'unit':
      return UNIT_IDS.includes(toSnake(subject));
    case 'icon':
      return iconSubjectResolves(subject);
    default:
      return true;
  }
}

function iconSubjectResolves(subject: string): boolean {
  const archetype = stripPrefix(subject, 'archetype-');
  if (archetype !== null) return (OVERSEER_ARCHETYPES as readonly string[]).includes(archetype);

  const districtKind = stripPrefix(subject, 'kind-');
  if (districtKind !== null) {
    return (DISTRICT_KINDS as readonly string[]).includes(toSnake(districtKind));
  }

  const locationKind = stripPrefix(subject, 'location-');
  if (locationKind !== null) {
    return (LOCATION_KINDS as readonly string[]).includes(toSnake(locationKind));
  }

  return RESOURCE_ICON_IDS.includes(subject);
}

function stripPrefix(value: string, prefix: string): string | null {
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

/**
 * Every ART-BIBLE §6/§7 violation in `spec`. Empty means the entry is shippable. Used by both the
 * manifest test and `scripts/gen-art.ts --dry-run`, so the two can never disagree.
 */
export function validateAssetSpec(spec: AssetSpec): string[] {
  const problems: string[] = [];
  const classSpec = ASSET_CLASS_SPECS[spec.class];

  const parsed = parseAssetFileName(spec.file);
  if (!parsed) {
    problems.push(`file "${spec.file}" does not match the ART-BIBLE §7 naming grammar`);
  } else {
    if (parsed.class !== spec.class) {
      problems.push(
        `file "${spec.file}" declares class "${parsed.class}", spec says "${spec.class}"`,
      );
    }
    if (!subjectResolvesToDomainId(parsed.class, parsed.subject)) {
      problems.push(
        `subject "${parsed.subject}" of "${spec.file}" resolves to no ${parsed.class} id`,
      );
    }
    if (parsed.ext !== classSpec.ext) {
      problems.push(`file "${spec.file}" must be delivered as .${classSpec.ext}`);
    }
    if (spec.file !== `${spec.key}.${parsed.ext}`) {
      problems.push(`file "${spec.file}" does not match key "${spec.key}"`);
    }
  }

  const required = SIZE_EXCEPTIONS[spec.key] ?? classSpec;
  if (spec.width !== required.width || spec.height !== required.height) {
    problems.push(
      `${spec.key} is ${spec.width}×${spec.height}, ART-BIBLE §6 requires ${required.width}×${required.height}`,
    );
  }
  if (spec.aspect !== required.aspect) {
    problems.push(
      `${spec.key} declares aspect ${spec.aspect}, ART-BIBLE §6 requires ${required.aspect}`,
    );
  }
  problems.push(...sourceProblems(spec));

  for (const ref of spec.styleRefs) {
    if (!ASSET_BY_KEY.has(ref)) problems.push(`${spec.key} references unknown style ref "${ref}"`);
    if (ref === spec.key) problems.push(`${spec.key} references itself as a style ref`);
  }

  return problems;
}

/**
 * Everything that must hold between what a backend renders and what ships. The last check is the
 * one that matters most: an asset no backend can render is not a manifest entry, it is a plan to
 * discover the gap at the paywall.
 */
function sourceProblems(spec: AssetSpec): string[] {
  const problems: string[] = [];
  const { source } = spec;
  const delivery: Delivery = { width: spec.width, height: spec.height, alpha: spec.alpha };

  if (source.width < spec.width || source.height < spec.height) {
    problems.push(
      `${spec.key} renders at ${source.width}×${source.height}, smaller than its ${spec.width}×${spec.height} delivery: upscaling invents detail`,
    );
  }
  if (source.width * spec.height !== source.height * spec.width) {
    problems.push(
      `${spec.key} renders at ${source.width}×${source.height}, a different aspect than its ${spec.width}×${spec.height} delivery`,
    );
  }
  if (source.alpha && !spec.alpha) {
    problems.push(`${spec.key} renders with alpha but ships opaque: render it opaque instead`);
  }

  const expected = postProcessFor(source, delivery, spec.fit);
  if (spec.postProcess.join() !== expected.join()) {
    problems.push(
      `${spec.key} declares postProcess [${spec.postProcess.join(', ')}], its source implies [${expected.join(', ')}]`,
    );
  }

  const capable = backendsForSource(source);
  if (capable.length === 0) {
    problems.push(
      `${spec.key} has no producible backend path: nothing renders ${source.width}×${source.height}${source.alpha ? ' with alpha' : ''}`,
    );
  } else if (spec.backend !== undefined && !capable.includes(spec.backend)) {
    problems.push(
      `${spec.key} is pinned to "${spec.backend}", which cannot render ${source.width}×${source.height}${source.alpha ? ' with alpha' : ''}`,
    );
  }

  return problems;
}
