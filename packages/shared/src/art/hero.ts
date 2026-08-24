/**
 * The **hero set**: the manifest entries a human can hand-generate in ChatGPT and drop straight into
 * `art-src/` with nothing else to do: no transparency to fake, no post-process to trust, and a
 * source resolution ChatGPT hands back as-is.
 *
 * Derived from `ART_MANIFEST`, never listed. A new district or overseer preset joins the set by
 * existing; an asset that grows an alpha channel or a post-process leaves it. The membership rule is
 * the whole definition: see {@link isHeroAsset}.
 */
import { ART_MANIFEST, type AssetKey, type AssetSource, type AssetSpec } from './manifest.js';

/**
 * The three sizes a `gpt-image-1` / `1.5` / `1-mini` render comes back at, per OpenAI's
 * image-generation guide.
 *
 * Deliberately **not** read from `BACKEND_CAPABILITIES.openai.sizes`: that table describes the
 * dormant API adapter and would move the moment someone points it at `gpt-image-2` (flexible sizes),
 * silently redefining what a human is asked to download. This list answers a different question:
 * what the board's browser tab actually produces, and only a human's observation may change it.
 */
export const CHATGPT_BASELINE_SIZES: readonly (readonly [width: number, height: number])[] = [
  [1024, 1024],
  [1024, 1536],
  [1536, 1024],
];

export function isChatGptBaselineSize({ width, height }: AssetSource): boolean {
  return CHATGPT_BASELINE_SIZES.some(([w, h]) => w === width && h === height);
}

/**
 * Whether `spec` can be satisfied by a plain ChatGPT download.
 *
 * All three conditions are load-bearing:
 * - **no alpha**: ChatGPT does not reliably return transparency, and nothing here can verify that
 *   claim without a session to test against;
 * - **no post-process**: the master *is* the delivery image, so no matte or downscale stands
 *   between what the board sees in the browser and what the game shows;
 * - **a baseline size**: the download already measures what the manifest asks for, so it is
 *   accepted whole: no crop, no downscale, no upscale.
 */
export function isHeroAsset(spec: AssetSpec): boolean {
  return !spec.alpha && spec.postProcess.length === 0 && isChatGptBaselineSize(spec.source);
}

/** Every hero asset, in manifest order. */
export const HERO_ASSETS: readonly AssetSpec[] = ART_MANIFEST.filter(isHeroAsset);

export const HERO_ASSET_KEYS: readonly AssetKey[] = HERO_ASSETS.map((spec) => spec.key);
