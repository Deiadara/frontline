# Sound

Six sounds, one slider, one listener. What follows is what the browser makes us do, what other
browser strategy games actually do, and what Frontline does about it.

Code: `apps/client/src/lib/sound.ts`. Files: `apps/client/public/sounds/`. Provenance:
`docs/ART-BIBLE.md` §11.

---

## 1. What the platform imposes

These are constraints, not choices.

- **No sound before a gesture.** Chrome, Safari and Firefox all block audio until the user has
  interacted with the document. An `AudioContext` built before that is created in the `suspended`
  state and `resume()` only takes effect from inside a user-gesture handler
  ([Chrome for Developers, "Web Audio, Autoplay Policy and Games"](https://developer.chrome.com/blog/web-audio-autoplay)).
  So the context is created and resumed on the first `pointerdown` or `keydown`, and not on mount.
  `pointerdown` rather than `click` buys the 60 to 150ms a human takes to release the button, which
  is enough for six small files to decode before the click that wants the first sound.
- **One decode per file, not per play.** `decodeAudioData` once into an `AudioBuffer`; each play is
  a fresh `AudioBufferSourceNode` pointed at that buffer. Source nodes are single-use and cheap.
  `new Audio(url).play()` per click is the other way, and it re-decodes, leaks elements and cannot
  be mixed.
- **Volume goes through a `GainNode`**, never by editing sample data. One master gain for the
  slider, one per-sound gain for level matching, both feeding `destination`.
- **Every failure is silent.** No Web Audio constructor, a refused `resume()`, a 404, a codec the
  browser will not take: all of it degrades to no sound and none of it throws into a click handler.

## 2. What browser strategy games do

Grepolis, Forge of Empires, Travian, Ikariam, Elvenar and Hero Zero converge on the same shape,
and the parts worth copying are these.

- **A click is confirmation, not decoration.** The sound fires on the thing that _did_ something.
  Hover, focus, typing, scrolling and background polling are silent. Grepolis and Forge of Empires
  both make ordinary buttons quiet and put weight on the actions that spend.
- **Committing sounds different from browsing.** Hero Zero's buttons are physically pressed metal
  and the primary action is unmistakable; the audio does the same job as the art. Spending
  resources, starting a build and declaring a fight get a firmer sound than opening a screen.
- **Events are louder than the interface.** A build finishing, a unit arriving, an attack incoming:
  these are what a strategy game's audio is actually for, because the player is often looking at
  another tab. They must be clearly above the clicks or they are missed.
- **One slider, and it is easy to find.** Most of these games have separate music and effects
  sliders because they have music. Frontline has no music yet, so it has one slider called Sounds.
  Background noise is a later job and gets its own control when it lands.
- **Restraint is the difference between atmosphere and irritation.** The games that are pleasant to
  play for an hour have a small set of short sounds. The ones players mute have a sound on every
  hover.

## 3. What Frontline does

### 3.1 The six sounds

| Kind      | When                                                                       | Character                   |
| --------- | -------------------------------------------------------------------------- | --------------------------- |
| `click`   | any ordinary button, and every ghost (secondary) button                    | soft mechanical click, 91ms |
| `confirm` | primary and danger buttons: the presses that spend, commit or destroy      | low two-tone confirm, 290ms |
| `page`    | any `a[href]`, which in this app is always a router link to another screen | rising swish, 145ms         |
| `done`    | a mission home, a build, research or training finishing                    | bright chime, 490ms         |
| `call`    | calling a fight, and a fight resolving or being declared against you       | low struck gong, 120ms      |
| `refuse`  | the server, or the screen, refusing something                              | short low thud, 100ms       |

### 3.2 What never makes a sound

Hover. Focus. Typing. Scrolling. Polling. Live events that are only mail or faction churn. A screen
re-rendering. A tooltip opening. Any of these on a sound is how a game teaches a player to find the
mute.

### 3.3 How a sound gets attached

One delegated listener on `document`, the same idea as `TooltipLayer`. Nothing calls `playSound`
from a click handler.

- `button` defaults to `click`, `a[href]` defaults to `page`. There is not one raw `<a>` in
  `apps/client/src`, so every anchor is a router `Link` or `NavLink` and the page swish falls out of
  the markup. The bottom nav and the HUD's screen links need no attribute of their own.
- `Button` sets `data-sound` by variant: primary and danger get `confirm`, ghost gets `click`.
- A site that wants something else puts `data-sound="<kind>"` on the control or on any ancestor;
  the nearest one wins. `DeclareDialog`'s "Call it" carries `data-sound="call"`.
- `data-sound="none"` silences a subtree.

Events arrive through the live channel (`lib/live.ts`). `base` and `notification` play `done`,
`battle` plays `call`, `message` and `faction` play nothing.

Refusals are heard by watching for a `role="alert"` node appearing, rather than from a mutation
hook. This client's `QueryClient` has no `MutationCache.onError` to hang one on, every refusal in
the game ends up as a `role="alert"` (success uses `role="status"`), and watching the DOM also
catches refusals that never reach the server.

### 3.4 How loud

Two stages of gain.

**Per kind**, fixed, and it is level matching rather than importance. The two Kenney packs are
mastered very differently: measured RMS across the six files ranges from 0.059 to 0.265. The gains
in `KIND_GAIN` are `target / measured RMS`, with targets chosen so the interface sits under the
events:

| Kind    | source RMS | gain | resulting RMS |
| ------- | ---------- | ---- | ------------- |
| click   | 0.059      | 0.34 | 0.020         |
| page    | 0.184      | 0.13 | 0.024         |
| confirm | 0.265      | 0.11 | 0.029         |
| refuse  | 0.128      | 0.33 | 0.042         |
| done    | 0.258      | 0.19 | 0.049         |
| call    | 0.072      | 0.76 | 0.055         |

**Master**, from the slider. Perceptual, not linear and not squared. Loudness roughly halves for
every 10dB of level dropped, so the middle of the bar should sit near `10 ** (-10 / 20)`, about
0.316 amplitude. The exponent solving `0.5 ** p = 0.316` is 5/3:

```
amplitude = (percent / 100) ** (5 / 3)
```

`(percent / 100) ** 2` puts the middle at 0.25, which is a slider that lies about its own middle.
0 is exactly 0 and 100 is exactly 1.

### 3.5 Rate limiting

Per kind, so two different sounds in one millisecond are still two sounds.

- `click`, `confirm`, `page`: 60ms. Short enough that two deliberate clicks are two sounds, long
  enough that a double-click is one.
- `refuse`: 250ms. A form with two invalid fields mounts two alerts in one frame, and that is one
  refusal.
- `done`, `call`: 1200ms. A batch of settles is one chime.

On top of that, `lib/live.ts` holds incoming events for 200ms and plays the highest-ranked sound
that turned up (`call` outranks `done`). One thing happening emits more than one event: a fight
resolving pushes `battle` and the `notification` for its report, so playing on arrival would be a
chime under a drum.

### 3.6 Mute and persistence

0 means silent: the master gain is exactly 0 and `play` returns before building anything.

The level lives on the account (`users.sound_volume`, 0 to 100, default 60) and arrives on `/me`,
so it follows the player to another browser. It is also mirrored into `localStorage` under
`frontline.soundVolume` so the first click of a session is at the right level before `/me` lands.
The mirror is a cache and never the record: when `/me` disagrees, `/me` wins.

The Sounds panel in Settings drives the engine on every movement, because the click it plays when
you let go is the only way to know what a number means. Saving is what makes it follow the account.
The bar is drawn rather than an `<input type="range">`: a native range brings three vendors' shadow
DOM with it. It is a `role="slider"` with `aria-valuenow`, arrows move it 5, Page Up and Page Down
move it 20, Home and End go to the ends.

## 4. Adding a sound

Do not, unless the board asks. Six is the budget and the reason is §2's last point. If one is
genuinely needed:

1. Add the kind to `SOUND_KINDS`, `KIND_GAIN` and `MIN_GAP_MS`.
2. Drop `apps/client/public/sounds/<kind>.ogg` in, under 50KB, and add its row to `ART-BIBLE.md`
   §11. No row, no ship.
3. Measure its RMS and set the gain to `target / RMS` against the table in §3.4, rather than by ear
   on one pair of headphones.
4. Point the sites at it with `data-sound`, not with a call from a click handler.

## Sources

- [Web Audio, Autoplay Policy and Games, Chrome for Developers](https://developer.chrome.com/blog/web-audio-autoplay)
- [Autoplay policy in Chrome, Chrome for Developers](https://developer.chrome.com/blog/autoplay)
- [Web Audio API best practices, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Using the Web Audio API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API)
- [Kenney, UI Audio (CC0)](https://kenney.nl/assets/ui-audio)
- [Kenney, Interface Sounds (CC0)](https://kenney.nl/assets/interface-sounds)

## What counts as a press

The layer listens in the capture phase, so a handler that stops propagation (a modal's panel does, to keep a press from falling through to the backdrop) cannot hide a press from it. A press is a `button`, a link, a checkbox or radio, a `summary`, or anything with `role` `button`, `option`, `switch`, `tab` or `menuitem`. Text fields, the backdrop and plain boxes are not presses.
