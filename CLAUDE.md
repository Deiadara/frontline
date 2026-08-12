# Frontline — project instructions

Cyberpunk/dystopian multiplayer base-building strategy game. pnpm TypeScript monorepo.
See `docs/ARCHITECTURE.md`, `docs/SPEC-server.md`, `docs/SPEC-client.md`.

## Staffing cap (board rule — do not exceed)

**At most 3 agents work on this repo at any time.** Of those three:

- **1 orchestrator** — CTO. Plans, splits work, integrates, arbitrates review disputes. Does not hold a coding slot.
- **2 dev/reviewers** — Protocol Engineer and Code Reviewer. Symmetric roles: each writes code and reviews the other's diffs.

Concurrency sub-caps: **at most 2 coding at once, at most 2 reviewing at once.** The two dev/reviewers swap
between coding and reviewing; they never fan out into more agents.

Not staffed on this repo: QA, Security Auditor, Summarizer, Reflection Coach. Do not loop them in.
Do not spawn additional subagents to parallelize beyond this cap — if capacity is short, queue the work.

## Models

- **Opus (`claude-opus-5`) at high effort** — default for all app code: server, client, tests.
- **Fable (`claude-fable-5`)** — core engine and core game mechanics only (e.g. the real battle engine).
  Do not use it for frontend, glue, or tests.

## Quality bar

- Senior-level, idiomatic, DRY TypeScript. Shared domain types and Zod schemas in `@frontline/shared` are the
  single source of truth — do not redeclare them per app.
- Real tests alongside the code. Gates before handing work back: `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`.
- **Zero visual bugs.** No cut text or images, no overflow, no overlapping elements. Verify with screenshots
  before declaring anything ready.

## Art policy (board rule, 2026-08-13 — supersedes every earlier art plan)

**The board makes the real art. Agents never generate it.**

- **Never drive a chat UI to make art.** No computer-use, no browser automation, no AppleScript/Chrome
  keystrokes, no screenshot-and-type loop against ChatGPT or any other UI. Do not ask the board to enable
  a macOS permission so an agent can do it. This is a hard stop, not a preference.
- **Never buy image generation.** The `fal` and `openai` backends stay dormant and key-gated. No spend.
- **Everything ships on code-generated art plus open-source / unlicensed assets** until the board hands over
  masters. Procedural art (`apps/client/src/render/procedural.ts`) is the default source for every asset key;
  freely-licensed files (CC0/public-domain preferred) fill what code cannot draw. Record the licence and
  source URL for every third-party file — an asset with no recorded provenance does not ship.
- **The import path stays.** A correctly-named file in `assets/` still overrides procedural art, so the
  board's masters drop in with no TypeScript edit. `docs/ART-ORDER.md` (`pnpm art:order`) is the board's
  order sheet and stays regenerated; it is a list _for the board_, never a work queue for an agent.

## Shared working tree — commit discipline

All agents share **one** working tree, and more than one run is often writing to it at the same time.
`git status` therefore shows other agents' in-flight work alongside your own.

- **Stage explicit paths. Never `git add -A`, never `git commit -a`.** Run `git status` after staging and
  confirm nothing outside your issue is staged.
- **Never commit files you did not edit**, even to "clean up" the tree — you will capture a half-written
  state from a live run and squash two issues into one unreviewable commit.
- **Re-check `git status` before claiming a file.** A tree that was clean at the start of your heartbeat
  may not be clean now; do not state ownership you have not just verified.
- If your work needs another issue's changes, **rebase onto them after they land** — do not commit them
  yourself.

## Communication

All board communication happens in the **MOU-112 issue thread**, via the CEO. Do not open side threads for
the board to go read.
