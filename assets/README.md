# `assets/` — the art drop directory

Delivery files land here. Nothing in the app names a path into this directory: the client globs it
and matches each file against `spec.file` from `ART_MANIFEST` in `@frontline/shared`
(`apps/client/src/assets/source.ts`).

**Dropping a correctly-named file here flips that key from the procedural fallback to painted art
with no TypeScript edit anywhere** — the MOU-114 acceptance bar, ADR 0001 §5.1.

## Rules

- Name files by the ART-BIBLE §7 grammar, `<class>-<subject>[-<variant>][@2x].<ext>`. The manifest
  already knows every legal name; a file that does not match one is simply ignored.
- Ship 1× and 2×. The client takes `@2x` on retina displays and falls back to 1× when only that
  exists (ART-BIBLE §6).
- PNG masters live in `art-src/`, **not** here — they are not shipped.
- Every third-party file needs a row in the ART-BIBLE §9 licensing register. No row, no ship.

## Background planes fit **cover**

The four full-screen map keys — `plate-city`, `plane-city-sky`, `plane-city-far`, `plane-city-fore` —
are drawn at the live frame size, which no fixed-size master matches at every viewport. The client
fits them **cover**: scaled uniformly until both axes are filled, then centred, so the surplus is
cropped off the longer axis (`coverSprite` in `apps/client/src/features/game/CityMap.tsx`).

Practically: **keep the load-bearing composition away from the edges.** The manifest's 16:9 delivery
is safe at 16:9 and trims the sides at 4:3 and the top and bottom at 21:9. Nothing is letterboxed and
nothing is stretched, so a master is never distorted — it is only ever cropped.

Until a plane's master finishes downloading — and if the fetch fails outright — that plane holds its
procedural skyline rather than going blank.

### …and only `far` and `fore` carry alpha

The four are not interchangeable. They stack back to front — `plane-city-sky`, `plane-city-far`,
`plate-city`, the district nodes, `plane-city-fore` — over a transparent stage, so:

- **`plane-city-sky` must be fully opaque.** It is the backdrop; whatever it does not cover is the
  page showing through, not art. That reason has a shelf life — see the note below.
- **`plane-city-far` and `plane-city-fore` must carry alpha.** They composite over the sky, and
  `plane-city-fore` draws _in front of the district nodes_ — an opaque foreground master blankets
  the whole map, nodes included.
- **`plate-city` is opaque** — ART-BIBLE §6, `plate` class `alpha: false`, and `encode-art` strips
  any alpha it arrives with. It is the ground, not a glaze.

**Do not draw `plane-city-sky` or `plane-city-far`.** The plate is opaque and sits in front of both,
so the moment it lands as a real file it covers them completely and neither puts a pixel on screen
again — including the "page showing through" the first bullet is worried about, which the plate
covers instead. The two rules above still describe the stack correctly; they just stop mattering
there. This is why the order sheet lists sky and far under _Occluded backdrop — nothing to draw_
rather than in a section the board works from, and it is derived (`isOccludedBackdropAsset`,
`packages/shared/src/art/backdrop.ts`), so if the plate ever stops being opaque they come back on
their own.

Until the plate is delivered it is **procedural**, and while that is true sky and far are doing real
work — they carry the whole map's depth. Deleting them is not the follow-up; delivering the plate is.

The alpha rule is checked, not just asked for: `plane-city-far` and `plane-city-fore` declare an
ART-BIBLE §6 transparency floor (30% and 55%), and `pnpm --filter @frontline/scripts test` audits
whatever is sitting in this directory against it — 1× and `@2x` alike, subdirectories included. A
delivery that fails the floor names itself: `encode-art` refuses to encode it, and one dropped
straight in here fails the test suite and is named again by the contact sheet below. Note that a red
test does not block `pnpm build` — the failing art still reaches the browser until it is replaced.

The plate and the sky are the exceptions. `encode-art` guarantees the opacity of both by stripping
alpha on the way through, but neither declares a floor, so a `plate-city` or `plane-city-sky` file
dropped straight in here is skipped by `auditDeliveries` and nothing opens its pixels — the one rule
above cannot catch either of them on the hand-drop route. The bullets above say what each one costs:
a see-through plate glazes the art behind it, a see-through sky leaves the page showing through.

## Seeing what has landed

The art arrives in hand-pasted batches, so most of the manifest is legitimately absent between them.

```sh
pnpm --filter @frontline/scripts contact-sheet   # → docs/art/contact-sheet.png
```

The contact sheet draws every delivery in this directory next to its asset key, with an empty slot
for each hero-set key still outstanding, and prints the painted-vs-procedural split. Filenames answer
whether a file exists; only the sheet answers whether the art is any good.

## Dev-server caveat

This directory sits outside the client's Vite root, so Vite's watcher does not invalidate the glob
when a file is added. **Restart `pnpm dev` after dropping art in.** Production builds re-glob from
scratch and need no restart. (Files under Vite's 4 kB inline limit are emitted as data URLs rather
than hashed files; either form loads identically.)
