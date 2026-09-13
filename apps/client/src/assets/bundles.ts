/**
 * Lazy-loading bundles: ADR 0001 §5.1. One bundle per screen, so a player who never opens the
 * base view never downloads the building sprites.
 *
 * The partition is derived from `ART_MANIFEST`, never hand-listed: a new manifest entry lands in
 * a bundle automatically, and `bundles.test.ts` pins that every key lands in exactly one.
 */
import { ART_MANIFEST, type AssetKey, type AssetSpec } from '@frontline/shared';

export const ASSET_BUNDLES = ['splash', 'overseer', 'crew', 'city', 'base', 'units', 'ui'] as const;
export type AssetBundleName = (typeof ASSET_BUNDLES)[number];

function iconBundle(key: AssetKey): AssetBundleName {
  if (key.startsWith('icon-archetype-')) return 'overseer';
  if (key.startsWith('icon-kind-')) return 'city';
  // §A4: place markers are drawn inside a district, which is reached from the city screen.
  if (key.startsWith('icon-location-')) return 'city';
  return 'ui';
}

/**
 * The screen a spec belongs to. Portraits get their own bundle rather than riding with the UI
 * chrome: four 1024×1536 heroes are the heaviest thing in the manifest and only the character
 * select screen needs them.
 */
export function bundleFor(spec: AssetSpec): AssetBundleName {
  switch (spec.class) {
    case 'splash':
      return 'splash';
    case 'portrait':
      return 'overseer';
    // The officer pool belongs to the crew and training screens, not to character select:
    // bundling it with the four overseer heroes would put the whole roster's art in front of a
    // player who has not chosen a character yet.
    //
    // It is **139 faces and 30MB** since the maintainer's 2026-09-11 delivery, measured off `assets/`,
    // against the "5MB" this comment used to claim, which was already stale at ninety-nine.
    //
    // Latent rather than live: `ensure` fetches every key in a bundle on its first call
    // (`loader.ts`), and **nothing on any screen calls it yet**, so a face is fetched today by the
    // `<img>` that shows it and a crew only ever shows nineteen plus the Bar's eight. The day this
    // loader is wired up, that is 30MB in front of the crew screen, and splitting the pool or
    // fetching per face is the call to make then.
    case 'officer':
      return 'crew';
    case 'district':
    case 'plate':
    case 'plane':
    case 'lut':
      return 'city';
    case 'building':
      return 'base';
    // Twenty-seven 768×1024 roster portraits, reached only from the units screen.
    case 'unit':
      return 'units';
    // §C1: the Garage's machines ride with the roster rather than in a bundle of their own. They
    // are eight square pictures reached from a screen a player opens in the same breath as the
    // units page, and a bundle per screen would cost a request to save a few hundred kilobytes on
    // a route almost nobody lands on cold.
    case 'vehicle':
      return 'units';
    case 'ui':
      return 'ui';
    case 'icon':
      return iconBundle(spec.key);
  }
}

function partition(): Readonly<Record<AssetBundleName, readonly AssetSpec[]>> {
  const buckets = Object.fromEntries(
    ASSET_BUNDLES.map((name) => [name, [] as AssetSpec[]]),
  ) as Record<AssetBundleName, AssetSpec[]>;
  for (const spec of ART_MANIFEST) buckets[bundleFor(spec)].push(spec);
  return buckets;
}

export const BUNDLE_SPECS: Readonly<Record<AssetBundleName, readonly AssetSpec[]>> = partition();
