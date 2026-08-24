/**
 * Where each manifest key's pixels come from **today**.
 *
 * This is the MOU-114 acceptance seam: nothing in the app names a file path. A key resolves to a
 * delivered file when one exists in the repo's `assets/` drop directory, and to the procedural
 * painted fallback for its asset class when one does not. Dropping `plate-city.webp` into
 * `assets/` flips the plate from procedural to painted with **no TypeScript edit anywhere**
 * (ADR 0001 §5.1).
 */
import type { AssetClass, AssetKey, AssetSpec } from '@frontline/shared';

export type AssetSource =
  | { kind: 'file'; key: AssetKey; url: string }
  /** ADR §5.3: the interim look. Seeded so the same key paints the same way every run. */
  | { kind: 'procedural'; key: AssetKey; class: AssetClass; seed: number };

/**
 * Delivery files present at build time, keyed by bare file name. The one impure line in this
 * module; swapping it for an AssetPack-generated manifest later changes nothing downstream.
 */
export const DELIVERED_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob<string>('../../../../assets/**/*.{webp,png}', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
);

/** ART-BIBLE §6: every raster ships at 1× and 2×; `plate-city.webp` → `plate-city@2x.webp`. */
export function retinaName(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? `${file}@2x` : `${file.slice(0, dot)}@2x${file.slice(dot)}`;
}

/**
 * Resolves one spec. `retina` asks for the 2× delivery; it falls back to 1× when only that has
 * been delivered, so a half-populated `assets/` directory still renders.
 */
export function resolveAssetSource(
  spec: AssetSpec,
  delivered: ReadonlyMap<string, string> = DELIVERED_ART,
  retina = false,
): AssetSource {
  const url =
    (retina ? delivered.get(retinaName(spec.file)) : undefined) ?? delivered.get(spec.file);
  return url === undefined
    ? { kind: 'procedural', key: spec.key, class: spec.class, seed: spec.seed }
    : { kind: 'file', key: spec.key, url };
}

export function resolveAssetSources(
  specs: readonly AssetSpec[],
  delivered: ReadonlyMap<string, string> = DELIVERED_ART,
  retina = false,
): ReadonlyMap<AssetKey, AssetSource> {
  return new Map(specs.map((spec) => [spec.key, resolveAssetSource(spec, delivered, retina)]));
}

/** True when the display can actually show the 2× delivery. Kept out of the pure resolvers. */
export function prefersRetina(): boolean {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1.5;
}
