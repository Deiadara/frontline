# Frontline: project instructions

Cyberpunk/dystopian multiplayer base-building strategy game. pnpm TypeScript monorepo.
See `docs/ARCHITECTURE.md`, `docs/SPEC-server.md`, `docs/SPEC-client.md`.

## Writing style (project rule, applies to every file in this repo)

**No em dashes. No en dashes. No double hyphens used as punctuation.** Not in code comments, not in
doc blocks, not in user-facing copy, not in commit messages, not in Markdown. Use a comma, a colon,
a full stop, or brackets. This is a hard rule and it is checked: `pnpm --filter @frontline/scripts
test` fails on any `\u2014` or `\u2013` in a tracked source or docs file. Command-line flags such as
`--dry-run` are not punctuation and are fine.

**No AI-tell phrasing.** Write the way a working engineer writes a note to the next one:

- Say the thing. Do not announce that you are about to say it ("it is worth noting that", "it is
  important to understand", "let us explore").
- No throat-clearing openers: "Furthermore", "Moreover", "Additionally", "In conclusion",
  "Overall", "Ultimately".
- No inflated register: "delve", "leverage", "utilise", "robust", "seamless", "comprehensive",
  "meticulous", "elevate", "unlock the power of", "game-changing", "at its core".
- Do not lean on the "not X, but Y" seesaw, or on rule-of-three lists, as a default rhythm. Once in
  a while is prose; every paragraph is a tic.
- No summarising sign-off paragraph that repeats what the section already said.
- Prefer concrete nouns and real numbers to hedged abstractions.

Comments still explain _why_, at whatever length the reason needs. The rule is about register and
punctuation, not about being terse.

## Quality bar

- Senior-level, idiomatic, DRY TypeScript. Shared domain types and Zod schemas in `@frontline/shared` are the
  single source of truth: do not redeclare them per app.
- Real tests alongside the code. Gates before handing work back: `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`.
- **Zero visual bugs.** No cut text or images, no overflow, no overlapping elements. Verify with screenshots
  before declaring anything ready.

## Shared working tree: commit discipline

All agents share **one** working tree, and more than one run is often writing to it at the same time.
`git status` therefore shows other agents' in-flight work alongside your own.

- **Stage explicit paths. Never `git add -A`, never `git commit -a`.** Run `git status` after staging and
  confirm nothing outside your issue is staged.
- **Never commit files you did not edit**, even to "clean up" the tree. You will capture a half-written
  state from a live run and squash two issues into one unreviewable commit.
- **Re-check `git status` before claiming a file.** A tree that was clean at the start of your heartbeat
  may not be clean now; do not state ownership you have not just verified.
- If your work needs another issue's changes, **rebase onto them after they land**: do not commit them
  yourself.
