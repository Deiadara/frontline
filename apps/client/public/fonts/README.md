# Vendored webfonts

Self-hosted so typography is not a runtime third-party fetch. The hosted `<link>` these replace
failed roughly 1 load in 8, which took every geometry gate down with it (MOU-197) and left players
on a bad connection rendering fallback metrics that no gate has ever measured.

All three families are licensed under the **SIL Open Font License 1.1**, which permits
redistribution. The full licence for each is alongside the files as `OFL-<family>.txt`.

| Family   | Source                                     | Version | Licence            | Files                                           |
| -------- | ------------------------------------------ | ------- | ------------------ | ----------------------------------------------- |
| Orbitron | https://fonts.google.com/specimen/Orbitron | v35     | `OFL-orbitron.txt` | `orbitron-latin.woff2`                          |
| Rajdhani | https://fonts.google.com/specimen/Rajdhani | v17     | `OFL-rajdhani.txt` | `rajdhani-latin{,-ext}-{400,500,600,700}.woff2` |
| Inter    | https://fonts.google.com/specimen/Inter    | v20     | `OFL-inter.txt`    | `inter-latin.woff2`, `inter-latin-ext.woff2`    |

The `.woff2` files are Google's own subsetted builds, taken from the `fonts.gstatic.com` URLs that
this stylesheet request resolves to:

```
https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap
```

Only the `latin` and `latin-ext` subsets are vendored — Orbitron publishes `latin` only. Rajdhani
ships a static file per weight; Orbitron and Inter are variable, so one file serves every weight of
a subset. The `@font-face` rules live in `apps/client/src/fonts.css`, which explains why the weights
are enumerated instead of declared as a variable range.

To refresh, re-request the stylesheet above with a woff2-capable `User-Agent`, download the `latin`
and `latin-ext` `src` URLs, and update the version column.
