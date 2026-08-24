# Frontline

Cyberpunk/dystopian multiplayer base-building strategy game. pnpm TypeScript monorepo.

- `packages/shared`: domain model: types, Zod schemas, constants, battle engine interface.
- `apps/server`: Fastify + better-sqlite3 REST API.
- `apps/client`: React + Vite + Pixi client.

Design docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/SPEC-server.md`](docs/SPEC-server.md), [`docs/SPEC-client.md`](docs/SPEC-client.md).

## Prerequisites

- **Node 24+** (`.nvmrc` pins 24: run `nvm use` if you use nvm).
- **pnpm 11.21.0** (`packageManager` in `package.json`; `corepack enable` will pick it up).

## Run it

From the repository root:

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds `@frontline/shared` and then starts both servers in parallel:

- API on **http://localhost:4000**
- client on **http://localhost:5173** (Vite proxies `/api` to the API server)

Open **http://localhost:5173** and log in with the MVP account:

| Operator ID | Passphrase |
| ----------- | ---------- |
| `Nikos`     | `Nikos`    |

The login form arrives prefilled with these, so you can just press **Jack In**.

> These credentials are seeded on every server boot and are MVP-only: see
> `apps/server/src/seed/`. They must be removed before any public deployment.

First run walks you through: **login → choose an overseer → city map**. Choosing an
overseer settles your base in **Neon Docks**. The magenta node in the north-east,
**Ashen Terraces**, is the AI rival **Vex Holdings**: select it and hit **Launch Attack**
to raid it. Winning pays its salvage straight into your stockpile.

The database is a file (`apps/server/frontline.sqlite` by default, see
`apps/server/.env.example`). It persists across restarts, and the boot-time seed never
overwrites what is already there. To start over, stop the server and delete that file.

### Running the two servers separately

```bash
pnpm --filter @frontline/shared build   # the apps import shared from its dist/ build
pnpm --filter @frontline/server dev     # API on :4000
pnpm --filter @frontline/client dev     # client on :5173
```

## Gates

Everything below must pass before handing work back:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

End-to-end (Playwright drives the real API + client; both are started for you, on ports
4010/5175, against a throwaway database in `.tmp/e2e/` so your dev stack is untouched):

```bash
pnpm exec playwright install chromium   # first time only
pnpm test:e2e
```

The live spec writes screenshots of every step, at both reviewed viewports, to
`apps/client/screenshots/live/1280x720/` and `apps/client/screenshots/live/1920x1080/`.
