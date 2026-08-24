# Vendored webfonts

Self-hosted so typography is not a runtime third-party fetch. The hosted `<link>` these replace
failed roughly 1 load in 8, which took every geometry gate down with it (MOU-197) and left players
on a bad connection rendering fallback metrics that no gate has ever measured.

Roboto Condensed is under the **SIL Open Font License 1.1**; Special Elite is under the **Apache
License 2.0**. Both permit redistribution. The full licence for each is alongside the files.

| Family           | Source                                             | Version | Licence                     | Files                                 |
| ---------------- | -------------------------------------------------- | ------- | --------------------------- | ------------------------------------- |
| Roboto Condensed | https://fonts.google.com/specimen/Roboto+Condensed | v31     | `OFL-roboto-condensed.txt`  | `roboto-condensed-latin{,-ext}.woff2` |
| Special Elite    | https://fonts.google.com/specimen/Special+Elite    | v20     | `LICENSE-special-elite.txt` | `special-elite-latin{,-ext}.woff2`    |

Roboto Condensed sets the interface. Special Elite is the stamped face, used on the lettering a
player reads one line at a time: notes, quotations, dialogue, people's names, dropdown labels. See
the doc comment on `fontStacks` in `src/theme/tokens.ts` for why the split falls there, and for the
sizing rule a new `font-stamp` call site has to follow.

Roboto Condensed is one variable file per subset, so its four weights share a `src`. Special Elite
has one weight and no italic.

The `.woff2` files are Google's own subsetted builds, taken from the `fonts.gstatic.com` URLs that
this stylesheet request resolves to:

```
https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;600;700&family=Special+Elite&display=swap
```

Only the `latin` and `latin-ext` subsets are vendored. That drops five subsets the hosted
stylesheet does serve: Roboto Condensed's `cyrillic`, `cyrillic-ext`, `greek`, `greek-ext` and
`vietnamese`. Text in those scripts now renders in the system fallback instead of the brand face.
Nothing can produce such text today: every string is English, and the app's one free-text input is
`UsernameSchema` (`packages/shared/src/primitives.ts`), which is `^[a-zA-Z0-9_]+$`. **Widening that
regex, or adding localised copy, means re-vendoring the matching subsets**: the `unicode-range`
declarations will not reach for them.

The `@font-face` rules live in `apps/client/src/fonts.css`.

To refresh, re-request the stylesheet above with a woff2-capable `User-Agent`, download the `latin`
and `latin-ext` `src` URLs, and update the version column.
