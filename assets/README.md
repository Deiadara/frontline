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

### …and only the sky is opaque

The four are not interchangeable. They stack back to front — `plane-city-sky`, `plane-city-far`,
`plate-city`, the district nodes, `plane-city-fore` — over a transparent stage, so:

- **`plane-city-sky` must be fully opaque.** It is the backdrop; whatever it does not cover is the
  page showing through, not art.
- **`plane-city-far`, `plate-city` and `plane-city-fore` must carry alpha.** They composite over the
  sky, and `plane-city-fore` draws _in front of the district nodes_ — an opaque foreground master
  blankets the whole map, nodes included, and nothing in the build will complain.

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
