# SPEC — Client (`apps/client`)

The UI contract the client dev implements. The scaffold already boots to a themed splash with
Tailwind tokens, fonts, the `/api` dev proxy, vitest + Playwright. Replace the splash in
`App.tsx` with the router and screens below. Import every domain type/schema/constant from
`@frontline/shared`; never redeclare them.

## API client (`src/lib/api.ts`)

Implement the existing `apiFetch(path, schema, init?)` stub:

- Prefix `path` with `API_BASE_URL` (`/api`, proxied to `:4000` by Vite in dev).
- `Content-Type: application/json`; if the session store holds a token, attach
  `Authorization: Bearer <token>`.
- 2xx → `schema.parse(await res.json())` — the return type is `z.infer<Schema>`; a malformed
  body must throw, never leak unvalidated data into the app.
- non-2xx → parse with `ApiErrorSchema` and throw a typed `ApiRequestError {status, code,
message}`; on `401` also clear the session (logout).
- On top of `apiFetch`, export one thin function per endpoint in `docs/SPEC-server.md`
  (`register`, `login`, `getMe`, `createOverseer`, `getCity`, `getBase`, `attack`), each using
  the matching shared request/response schema.

## State management

- **zustand** (`src/store/session.ts`): `{token: string | null, user: User | null}` +
  `login/logout` actions. Persist ONLY the token to `localStorage` (key `frontline.token`);
  rehydrate on boot and refetch the user via `GET /api/me`.
- **react-query** for ALL server data — no server state copied into zustand. Query keys:
  `['me']`, `['city']`, `['base', id]`. After `POST /api/overseer` invalidate `['me']` +
  `['city']`; after `POST /api/battle` invalidate `['me']`, `['city']`, `['base', myBaseId]`.
  Mount one `QueryClientProvider` in `main.tsx`.

## Routes (react-router-dom)

| Path         | Screen                                                  | Guard                                                                 |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `/auth`      | Auth (login/register)                                   | Redirect to `/game` if authenticated                                  |
| `/overseer`  | Character Select                                        | Requires session; redirect to `/game` if user already has an overseer |
| `/game`      | Game shell (city map)                                   | Requires session; redirect to `/overseer` if no overseer yet          |
| `/game/base` | Base panel (inside shell context panel or as sub-route) | as `/game`                                                            |
| `*`          | Redirect to `/game`                                     |                                                                       |

## Screens

1. **Auth** — centered card on the dark base, login/register toggle, username + password fields
   (client-side validation with the shared `RegisterRequestSchema` before submitting), inline
   server error display (`error.message`), submit disabled while pending.
2. **Character Select** — the 4 `OVERSEER_PRESETS` as cards: portrait area (see image rule
   below; placeholder gradient keyed to `portraitId` is fine), name, archetype tag, bio, and the
   8 skills as labeled 1..20 bars PLUS a compact FM-style radar/spider (SVG is fine — octagon,
   one vertex per `SKILL_NAMES` entry). Selecting a card → confirm button → `POST /api/overseer`
   → navigate to `/game`.
3. **Game shell** (`/game`) — fixed viewport app frame, no page scroll:
   - **Top HUD** (fixed height): the four resources with icons/labels (from `me.base.resources`)
     plus the overseer avatar & name on the right.
   - **Left nav** (fixed width): Map / Base / (disabled placeholders for future: Staff, Market).
   - **Center**: Pixi city map. Render `CITY_DISTRICTS` at `position * canvasSize`; node color
     by `kind` (use `src/theme/tokens.ts` — cyan = player_base, magenta = npc_stronghold, amber
     = raid, steel = market), show name + difficulty on hover, clicking a `raid`/`npc_stronghold`
     node opens the attack flow in the right panel. Draw other players' bases from
     `city.bases` at their district.
   - **Right context panel** (fixed width, own scroll): selected district details (name, kind,
     difficulty, rewards) + ATTACK button (`POST /api/battle`), or base summary when own base
     selected.
4. **Base panel** — own base: name, level, district; resources; buildings list (join base
   `buildings` against `BUILDING_CATALOG` for display name/description/output). Read-only this
   milestone (no construction UI).
5. **Battle result modal** — opens on `POST /api/battle` response: WIN/DEFEAT banner (cyan glow
   vs magenta glow), the `result.log` lines rendered as a terminal-style feed, rewards line, and
   updated resource totals. Dismiss → HUD resources already refreshed via query invalidation.

## Layout rules (STRICT — these prevent the classic visual bugs)

- The app shell is `h-screen` flex; **every** scrollable descendant gets `min-h-0` (and
  `min-w-0` in row layouts) so flex children can actually shrink; scrolling happens only in
  designated `overflow-y-auto` panels — never on `body`.
- No absolutely-positioned overlaps except intentional HUD layers (modals, the
  scanline/grain overlays); modals use a fixed inset-0 backdrop with a centered panel.
- Images/portraits always `object-cover` inside a fixed aspect box (`aspect-[3/4]` for
  portraits) — never intrinsic-size layout shifts.
- The Pixi canvas mounts in a dedicated container `div` sized by a **ResizeObserver**; the
  renderer resizes to the container (`app.renderer.resize(w, h)`), and the container has
  `overflow-hidden` so the canvas can never overflow its panel. Destroy the Pixi app on unmount.
- Responsive down to **1280x800** with no overflow/overlap; below that, don't bother this
  milestone.

## Aesthetic

Cyberpunk/dystopian: dark base `night` (#0a0e17), neon cyan (#22d3ee) for interactive/friendly,
magenta (#e11d8f) for hostile/danger, `warning` amber for loot/caution, muted `steel` grays for
text. Display font Orbitron/Rajdhani (`font-display`, headers/HUD labels, wide tracking), Inter
(`font-body`) for body copy. Fonts are loaded in `index.html`. Use the existing utilities:
`.scanlines`, `.grain`, `.text-glow-cyan`, `.text-glow-magenta`, `shadow-neon-cyan/-magenta`.
Panels: 1px borders in `neon-cyan/20`–`/30` on `night-raised` surfaces; square corners or
minimal radius. All colors come from `src/theme/tokens.ts` / Tailwind theme — no ad-hoc hex.

## Testing

- Vitest + Testing Library (configured; see `App.test.tsx`): cover the auth form validation, the
  character-select rendering of all 4 presets, and the api client's parse/error paths (mock
  `fetch`).
- Playwright (configured, chromium, 1280x800, dev-server auto-start): keep `e2e/splash.spec.ts`
  green by updating it to the auth screen, and add a screenshot spec per screen as it lands.
