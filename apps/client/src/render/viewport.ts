/**
 * pixi-viewport factory — ADR 0001 §5.1 / §5.2.
 *
 * Returns a configured Viewport ready to be added to `app.stage`. The caller is responsible for
 * attaching parallax planes as children and updating their positions on the `moved` event.
 */
import { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';

/** ADR §5.2 — zoom range: 0.6 (city overview) to 2.4 (district detail). */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;

export interface ViewportOptions {
  /** Width of the Pixi renderer's screen. */
  screenWidth: number;
  /** Height of the Pixi renderer's screen. */
  screenHeight: number;
  /** Width of the scrollable world in world-pixels. */
  worldWidth: number;
  /** Height of the scrollable world in world-pixels. */
  worldHeight: number;
}

/**
 * Creates and returns a {@link Viewport} with the interaction plugins the city map needs:
 * drag (with deceleration), mouse-wheel zoom, pinch-to-zoom, clamped to world bounds, and
 * clamped to the ADR zoom range.
 *
 * The returned viewport is NOT added to any stage — the caller does that so the viewport's
 * z-order relative to screen-space overlays (grade plane, vignette) remains the caller's
 * responsibility.
 */
export function createViewport(app: Application, options: ViewportOptions): Viewport {
  const { screenWidth, screenHeight, worldWidth, worldHeight } = options;

  const viewport = new Viewport({
    screenWidth,
    screenHeight,
    worldWidth,
    worldHeight,
    events: app.renderer.events,
  });

  viewport
    .drag({ mouseButtons: 'left' })
    .pinch()
    .wheel({ smooth: 5 })
    .decelerate({ friction: 0.93 })
    .clamp({ direction: 'all' })
    .clampZoom({ minScale: ZOOM_MIN, maxScale: ZOOM_MAX });

  return viewport;
}

/**
 * Syncs the viewport's screen dimensions after a container resize. Call from the
 * `ResizeObserver` callback in `CityMap.tsx` alongside `app.renderer.resize()`.
 */
export function resizeViewport(
  viewport: Viewport,
  screenWidth: number,
  screenHeight: number,
): void {
  viewport.resize(screenWidth, screenHeight);
}
