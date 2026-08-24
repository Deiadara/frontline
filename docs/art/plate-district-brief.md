# `plate-district` — what shipped, and what a revision would change

**The delivered plate is in the game.** `art-src/plate-district.png` → `assets/plate-district.webp`,
1672 × 941, and it is the whole district screen: the painting _is_ the buildings.

## 1. The model changed with this delivery

The plate used to be **ground**: an empty terrace with lots in it, onto which the client pasted
twelve cutout masters at fixed points, graded and hazed to make them sit down into the picture. The
delivered plate is a finished district with its buildings already painted, so there is nothing left
to paste.

What the client adds instead is an **interaction layer**: one polygon traced around each building's
own silhouette (`apps/client/src/features/base/plots.ts`). Hovering one washes light over that
building's pixels; clicking it opens that structure's window. The browser hit-tests the outline, so
each building answers for exactly its own shape.

Two consequences for anybody revising the art:

- **A re-render at a different framing is a re-layout.** Every one of the twelve outlines is a
  position on _this_ image. A crop, a pan, or a rebuilt street plan moves all twelve at once, and
  they have to be re-traced by hand against the new file.
- **A re-render at the same framing and a larger size is free.** 3344 × 1882 would drop straight in:
  the outlines are percentages, and the scene is fitted to the plate's aspect from the manifest.

## 2. The building masters are still used

`art-src/building-*.png` did not become dead. They are the **portrait** in a structure's window —
the one place a player sees the building itself rather than the building in its street — so a
redelivered master still shows up, and `scripts/district-masters.test.ts` still gates them.

The grade table in `apps/client/src/features/base/masters.ts` is what stops a portrait glowing
against the chrome.

## 3. What the renderer does, so the painting does not have to

Do **not** bake any of this in — it is applied at draw time and doing it twice looks like a mistake:

- **Hover and selection**: a warm `screen`-blended wash inside the building's outline, plus a glow.
- **Unbuilt structures**: a dark scrim with a dashed edge over the outline. The painting draws every
  building whether or not the player has built it, so "not yet" is drawn by the client.

So the plate should stay **flat**: no vignette, no grain, no bloom.

## 4. What a revision should change

In rough order of value:

1. **No text.** The painting carries baked-in lettering — the greenhouse reads `WE WANT APPLES!`,
   the lab `MAKING COOL STUFF`. It cannot be localised and it does not survive scaling. This is an
   ART-BIBLE §6 rule.
2. **Two buildings, one label.** The reference sheet labels two glasshouses and no garage; the
   second glasshouse (mid-right, the container-like shed at roughly x 65–76%, y 51–67%) is being
   used as the Garage. A revision should make that building read as a garage.
3. **Give the small structures more room.** The Cistern is one tank about 5% of the frame wide,
   which is the smallest thing a player has to be able to point at.

## 5. Things to keep exactly as they are

- The camera angle — high and slightly forward.
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

If the size changes, update `DISTRICT_PLATE_DELIVERY` in `packages/shared/src/art/manifest.ts` to
match. The scene takes its shape from that entry, and `plots.test.ts` fails if the two disagree.
