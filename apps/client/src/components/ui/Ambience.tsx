/**
 * One sheet of dirty glass over the whole frame.
 *
 * This module used to hold a second layer as well: three drawn sprites tucked into the dead corners
 * of the screen, a dead robot arm at the lower left, a hanging conduit at the upper right and a
 * mechanical fly at the lower right, with a small store letting one screen suppress them. The
 * maintainer had them taken off the game on 2026-09-25 and they went with their store, their two
 * keyframe animations in `index.css` and the specs that measured them.
 *
 * The glass stays, and it was always the separate half: the sprites sat **under** the chrome, and
 * this sits **over** it, because running across the panel edges is the entire reason it exists.
 * Without it the screen is a stack of separate widgets with a texture inside each one.
 */
export function Patina() {
  return <div aria-hidden className="patina pointer-events-none absolute inset-0" />;
}
