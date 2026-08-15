# `plate-district` — what shipped, and what a revision would change

**The delivered plate is in the game.** `art-src/plate-district.png` → `assets/plate-district.webp`,
1376 × 768, and the twelve structures stand on lots in it. `docs/art/district-template.png` is the
current composite — the delivered plate with every master drawn where the client draws it, graded
the way the client grades it. Regenerate it with:

```
pnpm --filter @frontline/scripts district-template -- --clean
```

Drop `--clean` to get the pad outlines and labels over the top.

---

## 1. Size — settled, and not 16:9

The plate ships at **1376 × 768 (aspect 43:24, 1.7917)**, which is the size it was painted at. This
is the only asset in the manifest that overrides the ART-BIBLE §6 class size, and the override is
deliberate: the plate is a **map**, not a backdrop. Twelve building sites are positions on _this_
image, so centre-cropping 11 pixels to reach 16:9 would move all twelve at once for no gain.

A future revision may be **larger at the same aspect** — 2752 × 1536 would give room for a zoom —
but it must be the same framing, or every site moves. Anything at a different aspect is a re-layout,
not a re-render.

## 2. Lots — eleven, plus the perimeter

Eleven structures stand on lots the painting already has. The twelfth, the **Gate**, stands on the
timber perimeter wall across the bottom-left, over the gap painted into it — it is the way in and
out of the compound, so a plot in the middle of the district would have been the one placement that
makes no sense.

Lot sizes were read off the painting rather than imposed on it, and they vary from 11.6% to 18.8% of
the frame width. Every one of them clears the readability floor.

## 3. What the renderer does, so the painting does not have to

Do **not** bake any of this in — it is applied at draw time and doing it twice looks like a mistake:

- **Grade.** Each structure is pulled 85% of the way to the plate's own mean luminance and 60% of
  the way to its saturation (`apps/client/src/features/base/masters.ts`). Ungraded, the twelve
  masters ran from a mean luminance of 40 to 108 against a plate at 59.5 — which is what "pasted on"
  looks like. The table is re-derived from the delivered files by
  `scripts/district-masters.test.ts`, so a redelivered master fails a gate rather than glowing.
- **Contact shadows.** A soft pool at each structure's ground line. No drop shadows in the painting.
- **Depth haze.** Tinted into the sprite by depth.

So the plate should stay **flat**: no vignette, no grain, no bloom, no baked shadows for buildings
that are not there.

## 4. What a revision should change

In rough order of value:

1. **No text.** Three delivered masters carry baked-in lettering — the Lab reads `MAKING COOL
STUFF`, the Greenhouse `W E WANT APPLES`, the Garage `GARAGE`. It cannot be localised and it does
   not survive scaling. This is an ART-BIBLE §6 rule and these three break it.
2. **Clear the two lots that still have furniture in them.** The canalside lot (the Quarters) has an
   open-sided shelter at its back-left and a container at its front; the far-right lot (the Garage)
   has an awning. Buildings are drawn on top, so today they read as a building standing on a crate.
3. **A third clean lot in the middle band** would let the layout breathe; the centre is the tightest
   part of the frame.

## 5. Things to keep exactly as they are

- The camera angle — high and slightly forward, and it matches how the buildings are drawn.
- No sky, no horizon. The whole frame is ground.
- Night, with the cold key and the sodium lamps.
- The wet ground and the puddled reflections.
- The canal, the perimeter wall, and the shanty band around the edges — they are what make the
  compound read as embedded rather than floating.

## 6. Delivering it

Name the file exactly and drop it in:

```
art-src/plate-district.png
```

Then `pnpm --filter @frontline/scripts encode-art --landed` ships it. A file with any other name is
silently ignored at every stage — that is the one failure mode to watch for. Record the licence and
source in ART-BIBLE §9 at the same time; `auditProvenance` fails the build without a row.
