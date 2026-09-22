# Frontline: project instructions

Cyberpunk/dystopian multiplayer base-building strategy game. pnpm TypeScript monorepo.
See `docs/ARCHITECTURE.md`, `docs/SPEC-server.md`, `docs/SPEC-client.md`.

## General Rules to always follow

- Before making changes, unless it is a request that needs no major assumptions (e.g. doing a bugpass or changing values), prompt the user with questions to make everything clear, especially concerning design decisions and major changes to game behavior. For this use AskUserQuestion tool and prompt them to click.
- When mentioning changes or bugs or design decision to the user, assume they have not read the code and thus need an explanation of how the mechanic or the behavior currently works for the topic in discussion (e.g. when mentioning a battle engine variable, explain what it does as well)
- When a new prompt is given while owrking on something else, prioritize them as you see fit (unless stated to prioritize something specific) but do not drop the rest of the items. The job is done when all requests are done not when the new one is.
- Make sure the game can always be stopped by Ctrl + C in the console

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

## Finish the work, then ask

**Do not stop to report progress.** A batch of ten items is done when ten items are done, not when
six are done and there is a tidy summary of the six. Stopping early to say "here is where I got to,
say the word and I will continue" spends a round trip to deliver nothing, and the work that is left
is exactly the work that was hardest, which is why it got left.

The one thing that justifies stopping is a **decision only the maintainer can make**: two designs
that lead to materially different code, something destructive, or a product call with no defensible
default. When one of those appears, do not down tools. **Finish everything the decision does not
block**, and put the question at the end, with what you already did above it.

Volume is not a reason to stop, and neither is a long conversation. Neither is "this last piece is
substantial", which is a description of the job. If a batch is genuinely too large to hold at once,
say so at the start and propose a split, rather than discovering it nine items in.

## Feats move with the game

**A feature change is not finished until the feats have moved with it.**
`packages/shared/src/feats/catalog.ts` holds two hundred thresholds on named numbers, and every one
of them points at a mechanic. When a mechanic moves underneath a feat, nothing breaks loudly: the
feat sits at zero forever, on a screen that wears a red badge, and no gate says a word. That is the
same failure the `character_xp_percent` fittings had, where seven Scrapyard cards were sold against
a channel the game had deleted.

In the same change, not a follow-up:

- **Adding a feature.** Give it feats. A mechanic with none is invisible to the one screen that
  tells a player what there is to do. Use a ladder where the thing has degrees and a standalone
  feat where it does not. If it needs a number nobody counts yet, add the measure to
  `feats/measures.ts` and the hook that bumps it to `apps/server/src/feats/tally.ts`.
- **Changing a feature.** Re-read every feat that measures it. A retuned cost, a renamed scope or a
  new ceiling can leave a target that is now trivial or now impossible. The two that have already
  bitten are `building_level` against `BUILDING_MAX_LEVEL` and `faction_seats` against the five
  seats a table actually has.
- **Removing a feature.** Take its feats with it. Retire them, or repoint them at whatever replaced
  the mechanic, and remove the measure from `measures.ts` and its tally hook in the same pass.

Two tests hold this and are worth extending rather than working around: `feats/catalog.test.ts`
prices every reward against its band, refuses a chain whose targets do not climb, and refuses a
scope the game does not have; `apps/server/src/feats/snapshot.test.ts` refuses a feat whose number
nothing produces.

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
