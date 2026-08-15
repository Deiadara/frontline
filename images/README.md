# `images/` — the inbox

Drop new art here in whatever the tool named it. Nothing in this directory is read by the game.

To get a file into the build it has to be **renamed to its manifest key** and moved to `art-src/`,
which is what the pipeline opens:

```bash
cp images/whatever-you-called-it.png art-src/building-commons.png
pnpm --filter @frontline/scripts encode-art --landed   # encodes everything that has arrived
```

`encode-art` crops, keys and compresses it into `assets/`, and the client picks it up from there
with no code change. A file whose name is not a manifest key is silently ignored at every stage —
that is the one failure mode to watch for.

`docs/ART-ORDER.md` (regenerate with `pnpm art:order`) lists every key, the exact filename to save
it as, the minimum size, and the prompt. It is the authoritative list; this note only explains the
two-step.

Sizes matter and are not negotiable upward: `encode-art` centre-crops a larger file to the declared
aspect and resamples it down, but it never upscales — a file under the minimum is rejected by name.
