# SPEC — Client (`apps/client`)

The UI contract. Import every domain type/schema/constant from `@frontline/shared`; never
redeclare them.

**This document is the contract, not a progress report** — `STATUS.md` says what is actually
built. The screens below are all shipped; the layout rules at the bottom are the ones that keep
being worth re-reading.

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
- **react-query** for ALL server data — no server state copied into zustand. Query keys live in
  one place (`lib/queries.ts`): `['me']`, `['city']`, `['base', id]`, `['missions']`, `['bar']`,
  `['research']`, `['assignees']`. Mount one `QueryClientProvider` in `main.tsx`.
- **Invalidate on `onSettled`, not `onSuccess`, for any write that settles first.** The write
  routes settle lazily _before_ they validate, so a refusal can already have moved the stockpile,
  the meters and the level. Refreshing only on success leaves the HUD contradicting the banner
  beside it (MOU-280).
- **A level-up is announced by presence, never by comparing two numbers.** Every response whose
  call can award XP carries an optional `levelUp`; it is set only when a level was actually
  crossed — including on the _error_ envelope, because a refusal can be the only response that
  ever carries one.

## Routes (react-router-dom)

| Path              | Screen                | Guard                                                                 |
| ----------------- | --------------------- | --------------------------------------------------------------------- |
| `/auth`           | Auth (login/register) | Redirect to `/game` if authenticated                                  |
| `/overseer`       | Character Select      | Requires session; redirect to `/game` if user already has an overseer |
| `/game`           | Game shell (city map) | Requires session; redirect to `/overseer` if no overseer yet          |
| `/game/base`      | The district (§A1)    | as `/game`                                                            |
| `/game/missions`  | Mission board (§E)    | as `/game`                                                            |
| `/game/bar`       | The Bar (§H)          | as `/game`                                                            |
| `/game/research`  | Research (§B9, §F2)   | as `/game`                                                            |
| `/game/assignees` | Assignees (§G)        | as `/game`                                                            |
| `*`               | Redirect to `/game`   |                                                                       |

## Screens

1. **Auth** — centered card on the dark base, login/register toggle, username + password fields
   (client-side validation with the shared `RegisterRequestSchema` before submitting), inline
   server error display (`error.message`), submit disabled while pending.
2. **Character Select** — the 4 `OVERSEER_PRESETS` as cards: portrait area (see image rule
   below; placeholder gradient keyed to `portraitId` is fine), name, archetype tag, bio, and the
   34 attributes as a grouped 0..100 sheet PLUS a compact FM-style radar/spider (SVG is fine —
   one vertex per `ATTRIBUTE_GROUPS` entry, plotting the group's peak rating). Traits are shown
   as named badges. Selecting a card → confirm button → `POST /api/overseer`
   → navigate to `/game`.
3. **Game shell** (`/game`) — **the world is the page.** A fixed viewport with the routed screen
   filling it edge to edge and the chrome floating over the top, rather than a header over a
   sidebar-plus-content grid. The old frame spent a column and a header band of every screen on
   navigation, which forced the artwork into a box; here the artwork is the page and the chrome is
   a layer on it.
   - **Top HUD** (floating, translucent, one row): faction name and street reputation, the five
     resources as icon+value chips, the two meters, and the overseer on the right. Each chip is
     labelled by its accessible name rather than a printed word — five resources, two meters and an
     identity have to share one line, and a second row costs the painting ~40px on every screen.
   - **Scenery switcher** (floating, along the bottom): City / District / Units / Missions / The
     Bar / Research / Crew, plus Market as a disabled placeholder. Each entry is a _place_, with an
     icon large enough to read as a destination and its label under it.
   - **Backdrop**: one `SceneBackdrop` for the whole shell — the district plate, blurred and dimmed.
     The district and the city map paint over it completely; every document screen lets it show
     through, so the location never disappears between clicks.
   - **City map**: Pixi, full-bleed. Render `CITY_DISTRICTS` at `position * canvasSize`; node colour
     by whose ground it is, from the **chrome** palette (verdigris = yours, oxblood = hostile, brass
     = unclaimed), name + difficulty on hover, clicking a node selects it. Other players' bases come
     from `city.bases`.
   - **Intel panel**: floats over the right of the map rather than taking a column out of it, so a
     district under the panel can still be dragged out from beneath it.

   Both bars measure themselves (`ResizeObserver` → `--hud-h` / `--nav-h` on the shell root) and
   every screen clears them with those variables. A hard-coded `pt-24` is wrong at some viewport,
   and when it is wrong it hides a heading behind a bar.

4. **The district** (§A1) — a place you look at and click, not a list of rows. Twelve plots on the
   delivered plate, positioned against lots the painting actually has; each is in exactly one of
   four states (standing, being worked on, vacant, locked) and the name plate carries all four,
   because it is the only part of a plot guaranteed to be readable at the smallest supported size.
   Clicking a plot opens its dialog — the Grepolis move — so the scene never has to make room for a
   detail column.

   The scene keeps the plate's aspect and is **contained**, never cropped: a cropped edge is a
   building you can see and cannot click. The faction's name sits on a plaque over it, and renaming
   is an affordance on that plaque.

   Everything written _about_ the district — build queue, power grid, production rates, the
   stockpile and its ceiling, standing, payroll, progression — is in a drawer that starts closed and
   slides up over the scene. **Nothing on this page computes a game rule.** Every figure comes from a
   shared function the server calls too (`districtProduction`, `powerGrid`, `storageCapacity`,
   `populationCapacity`, `buildingCost`, `buildingBuildSeconds`), which is what keeps a dead
   button's _reason_ identical to the server's refusal.

5. **Battle result modal** — opens on `POST /api/battle` response: WIN/DEFEAT banner (cyan glow
   vs magenta glow), the `result.log` lines rendered as a terminal-style feed, rewards line, and
   updated resource totals. Dismiss → HUD resources already refreshed via query invalidation.

## Layout rules (STRICT — these prevent the classic visual bugs)

- The app shell is `h-screen` flex; **every** scrollable descendant gets `min-h-0` (and
  `min-w-0` in row layouts) so flex children can actually shrink; scrolling happens only in
  designated `overflow-y-auto` panels — never on `body`.
- Modals are **portalled to `document.body`**. The shell gives the routed `<main>` a `z-index`,
  which makes it a stacking context, so a dialog rendered inside a screen can never rise above the
  floating chrome however large its own `z-index` is — it looked right and swallowed clicks on the
  primary button.
- Full-bleed artwork may run past the frame, and marks itself `data-scenery` so the layout gates
  skip it. The exemption covers that element only, never its subtree: the things standing _on_ the
  artwork are still content that has to be fully on screen.
- Images/portraits always `object-cover` inside a fixed aspect box (`aspect-[3/4]` for
  portraits) — never intrinsic-size layout shifts.
- The Pixi canvas mounts in a dedicated container `div` sized by a **ResizeObserver**; the
  renderer resizes to the container (`app.renderer.resize(w, h)`), and the container has
  `overflow-hidden` so the canvas can never overflow its panel. Destroy the Pixi app on unmount.
- Responsive down to **1024x768** with no overflow/overlap. The e2e layout gates run at five
  viewports and assert: no two plots or plates overlap, nothing is clipped by a scrolling edge, no
  image is drawn squeezed, and the document never scrolls horizontally.
- **A `max-h` flex column needs `shrink-0` on everything that is not the scroll body.** Otherwise
  flexbox takes the space out of whichever child will give, and a header that gives up four pixels
  clips its own text — which no assertion about the _body_ can see.

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
- Playwright (chromium, dev-server auto-start): a screenshot spec per screen, the layout gates
  above at five viewports, and `live.spec.ts` — the one spec that runs against a **real** server
  and a throwaway database, end to end from registration through ordering a build and waiting for
  the lazy settle to stand it up.
- **Every visual gate has a positive control.** A gate that cannot fail proves nothing, and the
  ones here are exactly the kind that get quietly switched off by a well-meaning fix.
