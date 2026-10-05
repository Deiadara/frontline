import { DRAWN_GOOD_IDS, GoodIcon } from '../market/GoodIcon';

/**
 * A mark for each of the back room's five boosts (maintainer request, 2026-09-14).
 *
 * The Inventory tab drew all five with one `spark`, so the shelf was five rows of the same picture
 * and you read it by the labels, which makes the pictures decoration rather than a way of finding
 * anything.
 *
 * **Boosts only.** The six traps are drawn by `YardGlyph` in the Scrapyard, which already has a
 * mark per trap id, and the shelf uses those (maintainer request, 2026-09-15: use the icons we
 * have rather than redoing them).
 *
 * The drawings are the Black Market's own since 2026-10-05 (`GoodIcon`): the shelf got a drawn mark
 * per good, and a boost that looked like one thing on the shelf that sold it and another in the
 * stash it waits in would be two pictures of one object.
 */
export function StashGlyph({ id, className }: { id: string; className?: string }) {
  if ((DRAWN_GOOD_IDS as readonly string[]).includes(id)) {
    return <GoodIcon goodId={id} {...(className === undefined ? {} : { className })} />;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <circle
        cx="12"
        cy="12"
        r="7"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
