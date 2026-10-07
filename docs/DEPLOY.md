# Running Frontline on a server

One Linux VPS, one Node process, one SQLite file, Caddy in front. This is the shape of most
persistent browser strategy games at this size, and it has a lot of headroom: measured on
2026-09-27 (`apps/server/scripts/load.ts`), the server answered 190 requests a second at about 25%
of one core, which is what 160 open tabs send at the client's polling rate. Extrapolated, one core
carries several hundred. What limits the player count today is the map (each open city has four
home plots), not the server.

## The pieces

| File                           | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `deploy/frontline.service`     | systemd unit: restarts on any crash, memory and file caps, sandboxed |
| `deploy/Caddyfile`             | HTTPS, the built client, `/api` proxied, the live channel unbuffered |
| `deploy/frontline.env.example` | Every setting the server reads, with production values               |
| `docs/RECOVERY.md`             | Restoring a snapshot                                                 |

## First install

```bash
# As root, on a fresh Debian or Ubuntu machine with Node 24 and Caddy installed.
useradd --system --home /var/lib/frontline --shell /usr/sbin/nologin frontline
mkdir -p /var/lib/frontline /mnt/backup/frontline /etc/frontline
chown frontline:frontline /var/lib/frontline /mnt/backup/frontline

git clone <repository> /srv/frontline
cd /srv/frontline
corepack enable && pnpm install --frozen-lockfile
pnpm --filter @frontline/shared build
pnpm --filter @frontline/server build
pnpm --filter @frontline/client build

cp deploy/frontline.env.example /etc/frontline/frontline.env
chmod 600 /etc/frontline/frontline.env
# Fill in JWT_SECRET (openssl rand -hex 32) and the host name. It also keys which mission
# cards pay a blueprint page (missions/prize-salt.ts), so keep it out of logs and the client.

cp deploy/frontline.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now frontline

cp deploy/Caddyfile /etc/caddy/Caddyfile   # after replacing play.example.com
systemctl reload caddy
```

The server refuses to start in production with the development signing key, with `ADMIN` on, or
with `TRUST_PROXY=true` (`assertDeployable` in `apps/server/src/config.ts`). It also refuses to
start on a database that fails its integrity check, and says to restore a snapshot. A production
boot never creates the dev account, and refuses to start while a database copied from development
still has it signing in with the password committed to this repository: change that password or
delete the account first.

Firewall: open 22, 80 and 443 only. The game listens on `127.0.0.1:4000` (`HOST` in the env file),
so nothing reaches it except through Caddy.

## Updating

```bash
cd /srv/frontline && git pull
pnpm install --frozen-lockfile
pnpm --filter @frontline/shared build && pnpm --filter @frontline/server build
pnpm --filter @frontline/client build
systemctl restart frontline
```

A restart takes a snapshot on the way down and runs any new migrations on the way up. Players see
the game reconnect within a few seconds; nothing in flight is lost, because every clock in the game
is a timestamp in the database rather than a timer in the process.

## What keeps it up

- **Crashes.** An error that escapes a request or a timer is logged and the server carries on; every
  write is a SQLite transaction that commits whole or not at all, so there is nothing half done
  behind it. Past ten such errors a minute, or on running out of memory or file handles, the server
  exits on purpose and systemd starts a fresh one two seconds later.
- **Floods.** Caddy caps request bodies and slow clients. The server caps request bodies (64 KB),
  requests per account and per address (`apps/server/src/limits/rules.ts`), failed sign-ins per
  account and per address (ten a quarter hour, refused before the password is hashed), live
  streams per
  account (8), per address (40) and in total (2,000), and open sockets (`MAX_CONNECTIONS`). The
  rate-limit table itself is capped, and IPv6 callers are counted by their /64.
- **Hostile input.** Every request body is parsed against a shared schema with bounded strings,
  numbers and lists before any handler reads it, and every amount is checked against what the crew
  actually holds before anything is paid.
- **Sessions.** A login lasts thirty days and renews itself while the player plays. The browser
  holds it in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie (`Secure` because `NODE_ENV` is
  `production`), so no script on the page can read it, and every write that rides it must carry
  the `X-Requested-With: frontline` header the client sends. Changing a password or pressing
  "Log out everywhere" ends every other session at once.
- **Losing progress.** See `docs/RECOVERY.md`: a verified snapshot every two minutes, tiered
  retention back thirty days, a copy on a second disk, and one more snapshot on every clean stop.
  Snapshots are taken on a worker thread, so they do not pause the game: measured on a 108 MB
  database, the longest event-loop stall during one went from about 250 ms to under 5 ms.
  `synchronous = FULL` means a write the game acknowledged is on disk.

## Security headers

Caddy sets them on every answer (`deploy/Caddyfile`). The one with teeth is the
Content-Security-Policy:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self'; media-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self';
frame-ancestors 'none'; object-src 'none'
```

Everything the page loads comes from its own origin: the bundle, the stylesheet, the self-hosted
fonts, the sounds, the images, and the API with its live channel. Nothing inline may run and no
string may be evaluated, so a script injected into the page through some future bug does not
execute, and has no host to send anything to if it did. `data:` images are the SVG patterns Vite
inlines into the stylesheet. The client turns off Zod's schema compiler
(`apps/client/src/zod-jitless.ts`), which otherwise tries `new Function` on every load.

Beside it: `frame-ancestors 'none'` and `X-Frame-Options DENY` (no framing), `nosniff`,
`Referrer-Policy no-referrer`, HSTS, a `Permissions-Policy` that turns off the device APIs the game
never asks for, and `Cross-Origin-Opener-Policy same-origin`.

`scripts/deploy-csp.test.ts` pins the policy and the client facts it depends on (no inline script
or style in `index.html`, Zod's compiler off before the first schema). What a test cannot see is
the bundle doing something new at run time, so after a change to the client that loads a new kind
of thing, serve a production build with the same header and look for violations before deploying:

```bash
pnpm --filter @frontline/client build
# Any static server that sends the header from the Caddyfile will do. Then, in Chrome devtools,
# walk the game and filter the console for "Content Security Policy".
```

Verified on 2026-09-30 that way: the sign-in door, the character picker and all 28 game screens
under the mocked e2e API, zero violations. Before the Zod switch, every page load had one.

## Watching it

`GET /health` answers `200` with `{status, database, clockAgeMs, loopP99Ms}` while the database
answers and the world clock is ticking, and `503` when either is not. Point an uptime monitor at
it through an SSH tunnel or from the machine itself (Caddy does not expose it publicly). The server
logs a warning whenever the slowest one percent of event-loop waits in a minute passes 200 ms.

`journalctl -u frontline -f` is the live log.

## Heavier traffic, or a determined attacker

Caddy on its own does not absorb a volumetric flood. For that, put Cloudflare (free tier) in front:
proxy the DNS record, set `TRUST_PROXY=2`, and firewall 80 and 443 to Cloudflare's published
address ranges so nothing can reach the origin directly.

## Growing past one process

Everything about the game state is in one SQLite file written by one process, which is what makes
it simple and consistent. The path past it, if the game ever needs thousands of concurrent players,
is Postgres for the state and a pub/sub channel (Redis) for the live stream, with several stateless
server processes behind Caddy. The repositories in `apps/server/src/db/repos/` are the only code
that speaks SQL, so that move is contained to them and to `live/hub.ts`.
