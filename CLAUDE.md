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

## Communication

All board communication happens in the **MOU-112 issue thread**, via the CEO. Do not open side threads for
the board to go read.
