# SPEC: Client (`apps/client`)

The UI contract. Import every domain type/schema/constant from `@frontline/shared`; never
redeclare them.

**This document is the contract, not a progress report**: `STATUS.md` says what is actually
built. The screens below are all shipped; the layout rules at the bottom are the ones that keep
being worth re-reading.

## API client (`src/lib/api.ts`)

Implement the existing `apiFetch(path, schema, init?)` stub:

- Prefix `path` with `API_BASE_URL` (`/api`, proxied to `:4000` by Vite in dev).
- `Content-Type: application/json`; if the session store holds a token, attach
  `Authorization: Bearer <token>`.
- 2xx → `schema.parse(await res.json())`: the return type is `z.infer<Schema>`; a malformed
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
- **react-query** for ALL server data: no server state copied into zustand. Query keys live in
  one place (`lib/queries.ts`): `['me']`, `['city']`, `['base', id]`, `['missions']`, `['bar']`,
  `['research']`, `['assignees']`. Mount one `QueryClientProvider` in `main.tsx`.
- **Invalidate on `onSettled`, not `onSuccess`, for any write that settles first.** The write
  routes settle lazily _before_ they validate, so a refusal can already have moved the stockpile,
  the meters and the level. Refreshing only on success leaves the HUD contradicting the banner
  beside it (MOU-280).
- **A level-up is announced by presence, never by comparing two numbers.** Every response whose
  call can award XP carries an optional `levelUp`; it is set only when a level was actually
  crossed: including on the _error_ envelope, because a refusal can be the only response that
  ever carries one.

## Routes (react-router-dom)

| Path                  | Screen                 | Guard                                                                 |
| --------------------- | ---------------------- | --------------------------------------------------------------------- |
| `/auth`               | Auth (login/register)  | Redirect to `/game` if authenticated                                  |
| `/overseer`           | Character Select       | Requires session; redirect to `/game` if user already has an overseer |
| `/game`               | Game shell (city map)  | Requires session; redirect to `/overseer` if no overseer yet          |
| `/game/base`          | The district (§A1)     | as `/game`                                                            |
| `/game/missions`      | Mission board (§E)     | as `/game`                                                            |
| `/game/bar`           | The Bar (§H)           | as `/game`                                                            |
| `/game/research`      | Research (§B9, §F2)    | as `/game`                                                            |
| `/game/assignees`     | Assignees (§G)         | as `/game`                                                            |
| `/game/market`        | The Market (§Market)   | as `/game`, plus `RequireLevel area="market"`                         |
| `/game/market/offers` | The board (§Market)    | as `/game/market`                                                     |
| `/game/market/black`  | Black Market (§Market) | as `/game/market`                                                     |
| `*`                   | Redirect to `/game`    |                                                                       |

The Market is three tabs of one place: the Runner, the Broker and the supply run on
`/game/market`, trading between crews on `/game/market/offers`, and the back room on
`/game/market/black`. The board is a page of its own rather than a panel on the front, because a
listing is two piles of goods and a verdict on them, which does not read in a shared column.

The front of the market fits one frame (`PageShell fills`, board 2026-09-08): the tab strip with
the Runner's hours as its standing note on the right, a tape of the street's figures
(`.market-ticker`, hidden under 800px tall), then two columns, the Runner over the supply run and
the Broker beside them on the centre line. The Runner's row has a floor of one row of lots and the
supply run is what gives on a short screen, behind its own scroller; `visual.spec.ts` measures
that nothing on the sheet scrolls at 1280x720 and up, and only the barrow at 1024. Every line on
the barrow is a lot (`market/auction.ts`): the card carries the leading bid on a lit tag whose
edge is the reader's standing, and its button reads Bid, Raise or Your table. The button opens
`VendorAuctionWindow`, the Bar's bidding screen without the sealed phase: the lot on the left, the
standing figure, one bid control floored at the price with the server as the authority on the
step, and every bid on the table. `POST /market/bid` answers with the whole board.

## Screens

1. **Auth**: centered card on the dark base, login/register toggle, username + password fields
   (client-side validation with the shared `RegisterRequestSchema` before submitting), inline
   server error display (`error.message`), submit disabled while pending.
2. **Character Select**: the 4 `OVERSEER_PRESETS` as cards: portrait area (see image rule
   below; placeholder gradient keyed to `portraitId` is fine), name, archetype tag, bio, and the
   34 attributes as a grouped 0..100 sheet PLUS a compact FM-style radar/spider (SVG is fine:
   one vertex per `ATTRIBUTE_GROUPS` entry, plotting the group's peak rating). Traits are shown
   as named badges. Selecting a card → confirm button → `POST /api/overseer`
   → navigate to `/game`.
3. **Game shell** (`/game`): **the world is the page.** A fixed viewport with the routed screen
   filling it edge to edge and the chrome floating over the top, rather than a header over a
   sidebar-plus-content grid. The old frame spent a column and a header band of every screen on
   navigation, which forced the artwork into a box; here the artwork is the page and the chrome is
   a layer on it.
   - **Top HUD** (floating, translucent, one row): the crew's district plaque, the six resources as
     icon+value chips, the level and infamy chips, and the overseer on the right. Each chip is
     labelled by its accessible name rather than a printed word: six resources, two meters and an
     identity have to share one line, and a second row costs the painting ~40px on every screen.
   - **Spend and gain figures.** Whenever a number the HUD carries moves, a figure floats off the
     chip that moved: `-1,200` in oxblood for a spend, `+400` in verdigris for a gain, grouped with
     `toLocaleString`, rising 14px and fading over 1.6 seconds (`delta-rise`; `delta-fade`, no
     travel, under `prefers-reduced-motion`). Several in a row stack in their own lanes rather than
     overwriting, and the figures are portalled to `document.body` so a chip's box can never clip
     one. One hook (`lib/deltas.ts`) diffs consecutive readings for every readout that does this:
     the six stockpiles, the infamy wallet, the roster's unit counts and the satchel's item counts.
     The first reading announces nothing.
   - **What counts as the trickle.** Passive production lands on every `/me` poll, and a `+3 scrap`
     every ten seconds trains a player to stop reading the figures that matter. A rise on a
     stockpile that produces is written off when it is no larger than
     `max(GAIN_FLOOR, allowance)`, where the allowance is
     `(districtProduction(buildings).perHour + 100) * 2` over the window between the two readings'
     `economy.productionSettledAt`, which is the server's clock rather than the browser's, and
     never less than one whole unit. The margin covers the two things `/me` does not carry: the
     crew's own production perks, and the ground it holds (`city/locations.ts` is worth 94 caps an
     hour with every location held). The floor of two covers what the margin cannot: a stockpile is
     stored whole, so any read that crosses an accumulated fraction banks a whole unit however slow
     the rate, which is how launching a mission came to announce `+1 oil` and `+1 wood`. Two reward
     lines in the whole mission catalogue are small enough to go silent under it and no job is that
     small in every line, so a crew coming home always throws a figure. The floor applies only to
     readouts that carry production rates: the infamy wallet, the unit counts and the satchel
     announce every move, because one found servo is `+1` and there is nothing else it could be. A
     fall is never written off, whatever its size: nothing in the game quietly drains a stockpile,
     so every click that spends is a receipt. Nothing was added to the wire for this.
   - **The level chip's XP.** The same figures, in verdigris with an `XP` suffix, whenever the
     crew learns something. Diffed on `xpBehind(level, xpIntoLevel)` rather than on `xpIntoLevel`
     itself, because the award that matters most is the one that resets it: a mission that levels
     the crew leaves the progress figure lower than it was. No trickle and no floor, since nothing
     pays XP passively.
   - **Scenery switcher** (floating, along the bottom): City / District / Units / Missions / The
     Bar / Research / Crew / Training / Market / Workshop / Satchel, with Settings pinned to the
     right of the row and the Console appearing only in an admin build. Each entry is a _place_, with
     an icon large enough to read as a destination and its label under it. The row wraps rather
     than shrinking, and the shell measures whatever height that comes to. Gated doors (§I3) still
     draw and still link: they carry a padlock and the level that opens them.
   - **Backdrop**: one `SceneBackdrop` for the whole shell: the district plate, blurred and dimmed.
     The district and the city map paint over it completely; every document screen lets it show
     through, so the location never disappears between clicks.
   - **The city**: the board's painted aerial (`plate-city`, 21:10), drawn whole inside the frame
     by `PlateRoom` and never cropped or stretched, with one hand-drawn tag per district taped onto
     the roof it names (`CityView`). It is not a map and not a canvas: the pan-and-zoom Pixi
     version was a diagram of a place, and a player standing over a city does not read a diagram.
     Tag positions are hand-placed fractions of the painting (`DISTRICT_MARKS`), so a tag stays on
     its building at every window size; a district with no mark would have no way in, which
     `CityView.test.tsx` refuses. Clicking a tag goes to `/game/city/:id`, except your own ground,
     which goes to the district.
   - **All cities**: the same place one step back, as state on this screen rather than a route of
     its own (`CitiesView`), reached by a control on the painting.

   Both bars measure themselves (`ResizeObserver` → `--hud-h` / `--nav-h` on the shell root) and
   every screen clears them with those variables. A hard-coded `pt-24` is wrong at some viewport,
   and when it is wrong it hides a heading behind a bar.

4. **The district** (§A1): a place you look at and click, not a list of rows. Twelve plots on the
   delivered plate, positioned against lots the painting actually has; each is in exactly one of
   four states (standing, being worked on, vacant, locked) and the name plate carries all four,
   because it is the only part of a plot guaranteed to be readable at the smallest supported size.
   Clicking a plot opens its dialog, the Grepolis move, so the scene never has to make room for a
   detail column.

   The scene keeps the plate's aspect and is **contained**, never cropped: a cropped edge is a
   building you can see and cannot click. The faction's name sits on a plaque over it, and renaming
   is an affordance on that plaque.

   Everything written _about_ the district: build queue, power grid, production rates, the
   stockpile and its ceiling, standing, payroll, progression: is in a drawer that starts closed and
   slides up over the scene. **Nothing on this page computes a game rule.** Every figure comes from a
   shared function the server calls too (`districtProduction`, `powerGrid`, `storageCapacity`,
   `populationCapacity`, `buildingCost`, `buildingBuildSeconds`), which is what keeps a dead
   button's _reason_ identical to the server's refusal.

   - **Somebody else's plot** (`VisitedDistrict`, `/game/city/:id` on residential ground) is the
     same screen with the same painting and the same plates. Their crew's name sits at the top on
     the plate `DistrictPlaque` draws yours on (`PLAQUE_PLATE`, `PlaqueFace`): the one screen that
     names a resident rather than numbering the plot, because the visitor has walked in.
   - **One call on the screen**, and which one it is comes from the board's `gates` row rather than
     from anything computed here: `Break the gate` while their gate stands, `Raid the district` with
     the breach's remaining time inside the 24 hours a broken gate is open for. A plate opens an
     info-only dialog, name and level. It used to offer a fight per roof, which meant thirteen
     declarations against a cap of three; the raid is one call on the whole district now (§A4).

5. **Battle result modal**: opens on `POST /api/battle` response: WIN/DEFEAT banner (cyan glow
   vs magenta glow), the `result.log` lines rendered as a terminal-style feed, rewards line, and
   updated resource totals. Dismiss → HUD resources already refreshed via query invalidation.

6. **The Bar** (§H7): a room with a stool in it, and a city-wide daily auction behind the stool.
   There is no negotiation and no hire button. Every crew in the city reads the same eight people
   and bids on them; the highest bid at Athens midnight signs them at exactly that figure, and that
   figure becomes their weekly wage on the payroll book.

   - **The room** (`PlateRoom`, `plate-bar`): `Sit down` on the empty stool, plus four things on
     the glass over the painting. The standing note, a **Your tables** strip (`your-tables`: the
     cap as `used of allowed`, one chip per auction this crew has money on, each carrying the
     person's name, `Leading` / `Outbid` / `Locked` and a live countdown), and three doors: the
     payroll book, the crew, and **Last night** (`open-results`).
   - **The roster** is unchanged behind the stool: one person at a time, an arrow either side, the
     portrait, the perks, the §H3 doors and the thirty-three-row sheet with the role highlighter.
     Under the dossier each card carries the **auction strip**: a phase badge (`Open` /
     `Sealed: final values only` / `Closed`), a `Leading` or `Outbid` mark, the reader's locked
     value when they have one, the leading bid with who holds it (or the reserve on an untouched
     table), the bidder count, a live countdown, and one door into the bidding screen.
   - **The bidding screen** (`auction-window`, a wide `Modal`): the person down the left, the
     table down the right. The right column is the leading figure in large tabular figures with
     `You are leading` / `You have been outbid` / `Nobody has bid`, the countdown (`mm:ss` inside
     the hour, oxblood inside the last five minutes), the bid ceiling (`bidCeiling`, the book after the crew's own negotiators) beside the table cap,
     the controls, and the open bids newest first with the reader's own rows marked.
   - **Three phases, and the controls are different in each.** _Open_: a `NumberField` prefilled
     with `nextBid`, three quick steps (the increment, +5%, +10%) and `Place bid`. The field is
     floored at the person's reserve rather than at `nextBid`, because the minimum is a race the
     client cannot win: a bid under the standing minimum is warned about on the screen and still
     sent, and the server's refusal lands in the window's `role="alert"` line. _Sealed_, the last
     thirty minutes: the open controls are gone entirely and a lock panel takes their place, one
     value floored at `max(reserve, your open bid, leading open bid)`, behind a `Confirm` saying it
     cannot be changed, and afterwards a sealed card reading `Locked: N. Revealed at midnight`.
     _Closed_: a line saying the results arrive with tomorrow's room.
   - **Refused before the request** when the client already knows the answer: the §H3 doors are
     shut, the crew is at its table cap, or this crew is already leading. Leading blocks an open
     bid only: the crew in front at the seal is exactly the one that has to decide how far it will
     really go, so the lock panel stays live.
   - **Last night** lists this crew's outcomes: `won` at N, `lost` to a named crew at N, `passed`
     (highest and could not take them), `unsold`.
   - **Every countdown runs off `serverNow` through `useServerClock`, never `Date.now()`**, and
     the phase is derived from `sealedFrom` / `closesAt` with the shared `auctionPhaseAt` rather
     than read off the response's `phase` field, which is a snapshot of when the response was
     built. The Bar polls every ten seconds because the tables are other people's; the clock ticks
     locally in between.

7. **Location characteristics** (§A4), the board's name for what the code calls environment labels.
   Wet, Windy, Eerie, Dark and the rest, each at a tier in Latin numerals. Every screen that names
   the concept uses that name: the unit card's section is **Characteristics they notice**, and the
   two screens where they decide something carry a titled **Characteristics** row
   (`components/ui/LabelChip.tsx`, `Characteristics`).

   - **A location's card** (`DistrictView`) prints the row under the blurb, above the numbers,
     because it is what decides what to bring. Each chip keeps its own hover, and a characteristic
     the _sky_ put there says so (`features/city/characteristics.ts`): the sky is one roll a day
     over the whole city and lifts with the day, while a tunnel is Crammed for good. There is no
     hour in this. Darkness used to be read off the clock and is not any more
     (`battle/battlefield.ts`, `DARK_GROUND_TIER`), so nothing says "after dark".
   - **A coming fight** (`BattlePage`) carries the same row directly under the ground's name, with
     the frontage, the location's own base defence and anything dug in said in words beside it.
   - **Hovering a unit inside a fight** (the muster's chips, the ring, the road, and a row in the
     deploy dialog) opens `EffectiveCard`: the seven stats a fight turns on with the sheet's figure,
     the effective figure and the percent change coloured by direction, and under it the `reasons`
     the shared `effectiveStats` returns. It is the engine's own function, so the card and the fight
     cannot disagree. Two inputs are not on `BattleView` and the card says so rather than guessing:
     the crew's territory effects (it passes `noTerritoryEffects()`) and the workshop's refit.

8. **The yard and the road** (§C3). A vehicle carries a **speed**, 0 to 100, on the same scale a
   unit's sheet uses, never a percentage off a clock: the machine's card reads `Speed 65` beside
   `Carries 2` in the same tabular treatment, so a machine is comparable with the legs of the
   people going in it. That is why the machines are the roster's last tab (`/game/units?tab=vehicles`,
   `features/garage/VehicleCatalogue.tsx`) rather than a page of their own: the Garage's page
   (`GaragePage`) is the yard's level and seats and one button to that tab. Every screen that quotes a journey spends that speed through the shared
   `columnSpeed(fleet, force, ...)` and `roadMinutes` / `travelMinutes`, which are the functions the
   server measures the real road with.

   - A column moves at its **slowest group**, so the screens say which one:
     `Held to 45 by 12 Scavengers walking` (`features/battle/column.ts`). The number is
     `columnSpeed`'s and is never recomputed; only the name is worked out here, by running that
     function's own three loading rules a second time. The third is the one it is easy to leave
     out and the one that makes the name wrong: **nobody boards a machine slower than their own
     legs**, so a Scrappy on 65 in front of two Road Reavers on 65 is carrying nobody and the
     Reavers are what the column is waiting for.
   - Every one of these quotes reads a unit off the sheet **the workshop left it with**
     (`fittedFor(base.unitLoadouts, unitId)`, which is what the server folds in), because the
     armour line takes speed away: Scrap Plate is -2 and Hardshell Rig is -3. The printed sheet
     would quote a road the crew then overruns.
   - The deploy dialog quotes the column the typed deltas produce, the battle page's machines panel
     quotes the biggest column this crew could send (everybody at home), and the mission board's
     launch dialog quotes the travel leg. All three say **at most**, and the bound is only honest
     because everything they cannot see makes a road _shorter_: the crew's `travelSpeedPercent` and
     its `unitSpeedPercent` (the Skate Ground, an officer's Speed) are on neither `BattleView` nor
     `MissionsResponse`, and `GET /overseer/me` carries the crew half of that fold without the
     ground's, so it would not answer the Skate Ground either.
   - A unit whose sheet carries `no_ride` never boards. The row that offers it shows a small red
     **walks** note beside its count, and only while something is actually loaded: with an empty
     yard everybody walks and a note on every row says nothing.

## Layout rules (STRICT: these prevent the classic visual bugs)

- The app shell is `h-screen` flex; **every** scrollable descendant gets `min-h-0` (and
  `min-w-0` in row layouts) so flex children can actually shrink; scrolling happens only in
  designated `overflow-y-auto` panels: never on `body`.
- Modals are **portalled to `document.body`**. The shell gives the routed `<main>` a `z-index`,
  which makes it a stacking context, so a dialog rendered inside a screen can never rise above the
  floating chrome however large its own `z-index` is: it looked right and swallowed clicks on the
  primary button.
- Full-bleed artwork may run past the frame, and marks itself `data-scenery` so the layout gates
  skip it. The exemption covers that element only, never its subtree: the things standing _on_ the
  artwork are still content that has to be fully on screen.
- Images/portraits always `object-cover` inside a fixed aspect box (`aspect-[3/4]` for
  portraits): never intrinsic-size layout shifts.
- A full-bleed painting is fitted by arithmetic on the frame, never by `object-fit` alone: the
  room is measured with a **ResizeObserver**, the picture is sized from its own aspect ratio, and
  the leftover is filled with a blurred over-scaled copy of the same image (`PlateRoom`). `cover`
  crops a building off the edge and `fill` stretches faces; both are visual bugs the gates catch.
- Responsive down to **1024x768** with no overflow/overlap. The e2e layout gates run at five
  viewports and assert: no two plots or plates overlap, nothing is clipped by a scrolling edge, no
  image is drawn squeezed, and the document never scrolls horizontally.
- **A `max-h` flex column needs `shrink-0` on everything that is not the scroll body.** Otherwise
  flexbox takes the space out of whichever child will give, and a header that gives up four pixels
  clips its own text, which no assertion about the _body_ can see.
- **A wrapping row does not grow an auto grid row.** A `flex-wrap` band inside a grid item
  contributes its height as though it never wrapped, so the track keeps the one-line height and the
  item's own flex children shrink to fit inside it. The roster card hit this: the marks band went to
  two lines and the frame stayed put, squashing the price box from 96px to 77px and moving the Train
  button on that card alone. `min-h` on the item does not help. Size the frame for the rows the
  content can take, put `shrink-0` on whatever must not give, and gate on it: the box that can
  shrink is the box that hides the overflow from every sweep.

## Sound

Six short interface sounds, one slider called Sounds in Settings, and one delegated listener at the
root (`lib/sound.ts`, mounted from `App`). A `button` clicks, an `a[href]` swishes, and
`data-sound="<kind>"` on the control or any ancestor overrides that (`data-sound="none"` silences a
subtree): no screen calls `playSound` from its own handler, the same way no screen positions its own
tooltip. Actions that spend or commit get the firmer `confirm`, calling a fight gets the drum, a
`role="alert"` appearing gets the refusal thud, and live events get the chime, all of them well
under the events in level. Nothing plays before the player's first gesture, because no browser lets
it. The level lives on the account as `soundVolume` (0 to 100, default 60) and is mirrored into
`localStorage` so the first click of a session is right before `/me` lands. The full design, the
gains, the rate limits and the licensing are `docs/SOUND.md`.

## Aesthetic

Cyberpunk/dystopian: dark `surface` base, `brass` for what the game is inviting, `oxblood` for
danger and for what you spent, `verdigris` for what you gained, `hextech` for what you have earned,
and `ink` greys for text. Two faces ship, both self-hosted in `src/fonts.css`: `Roboto Condensed`
sets the interface (`font-display` for headers and HUD labels, wide tracking; `font-body` for
copy) and `Special Elite` (`font-stamp`) is the typewriter. Use the existing utilities: `.grain`,
`.painted`, `.washed`, `.glass`, `.ink-rule`, `.paint-track`/`.paint-fill`, `.text-glow-cyan`,
`.text-glow-magenta`, `shadow-panel`/`shadow-lifted`/`shadow-brass`.
Panels: 1px borders in `neon-cyan/20`-`/30` on `night-raised` surfaces; square corners or
minimal radius. All colors come from `src/theme/tokens.ts` / Tailwind theme: no ad-hoc hex.

## Testing

- Vitest + Testing Library (configured; see `App.test.tsx`): cover the auth form validation, the
  character-select rendering of all 4 presets, and the api client's parse/error paths (mock
  `fetch`).
- Playwright (chromium, dev-server auto-start): a screenshot spec per screen, the layout gates
  above at five viewports, and `live.spec.ts`: the one spec that runs against a **real** server
  and a throwaway database, end to end from registration through ordering a build and waiting for
  the lazy settle to stand it up.
- **Every visual gate has a positive control.** A gate that cannot fail proves nothing, and the
  ones here are exactly the kind that get quietly switched off by a well-meaning fix.

### The red mark

A fight called on the crew's ground is an oxblood tile on the left of the bottom bar on every screen (`unread.fightsOnYou` off `/me`), pulsing, with a count past one, linking to the Battles board. The console's Fights panel calls one on the reviewer for review.
