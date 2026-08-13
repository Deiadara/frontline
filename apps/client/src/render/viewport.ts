/**
 * pixi-viewport factory — ADR 0001 §5.1 / §5.2.
 *
 * Returns a configured Viewport ready to be added to `app.stage`. The caller is responsible for
 * attaching parallax planes as children and updating their positions on the `moved` event.
 */
import { Viewport } from 'pixi-viewport';
import type { Application } from 'pixi.js';

/**
 * ADR 0001 §5.1, amended by §8.1 — zoom range: 1.0 (whole city) to 2.4 (district detail).
 *
 * The floor is 1.0 rather than the original 0.6 because the world is built at frame size (see
 * `CityMap.tsx`, which passes `worldWidth: width, worldHeight: height`), so 1.0 already shows every
 * district. Below 1.0 the world no longer covers the screen, `clamp()` centres the shortfall, and
 * the frame edges show bare page ground. The invariant to preserve is `ZOOM_MIN * world >= screen`
 * — a future change that grows the world past the frame may lower this floor to match.
 */
export const ZOOM_MIN = 1.0;
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
 * Syncs the viewport after a container resize. Call from the `ResizeObserver` callback in
 * `CityMap.tsx` alongside `app.renderer.resize()`.
 *
 * The world is repainted at the new screen size, so the world bounds move with it — leaving them
 * at the old size would make `clamp()` refuse to pan into freshly painted area, or let it pan
 * past the painted edge into empty space.
 */
export function resizeViewport(
  viewport: Viewport,
  screenWidth: number,
  screenHeight: number,
): void {
  viewport.resize(screenWidth, screenHeight, screenWidth, screenHeight);
}
