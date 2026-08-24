/**
 * The things living in the corners of the frame.
 *
 * A game interface is not only its controls. Disco Elysium's screen has a drawn *object* in every
 * dead corner and Arcane's cuts are full of machinery that nobody in the scene is using — both are
 * saying the same thing, which is that the frame is a place rather than a document. This layer is
 * the cheapest version of that: a few pieces of junk that have been in this room longer than the
 * player has.
 *
 * Four rules, and every one of them is a bug that would otherwise get filed:
 *
 * - **Inert.** The whole layer is `pointer-events-none` and `aria-hidden`. It is scenery; a screen
 *   reader announcing a dead robot arm on the missions board is describing furniture nobody asked
 *   about, and a fly that eats a click on the nav behind it is a defect.
 * - **Inside the frame, always.** Each piece is a fixed-size box inset from the edge, holding an
 *   `<svg>` that exactly fills it. The layout gates flag any image that spills its container or
 *   that a clipping ancestor cuts partway through, and a sprite tucked into a corner is precisely
 *   the shape that trips both — so nothing is bled off the edge, however tempting it looks.
 * - **Quiet.** The pieces sit under the chrome, at low opacity, in the palette's own browns and
 *   irons. Ornament that competes with a button has stopped being ornament.
 * - **Barely moving.** The fly bobs three pixels over eleven seconds; a contact arcs for a frame
 *   every seven. Nothing travels, nothing loops fast enough to catch the eye twice, and everything
 *   stops under `prefers-reduced-motion`.
 *
 * Drawn rather than loaded. These are twenty-line SVGs, which costs one paint and no request, and
 * keeps the board's art-freeze rule intact: procedural art is the default source for every asset,
 * and nothing here is waiting on a master.
 */

/** A dead machine's arm, dropped and never picked up. Lower-left, where no screen puts content. */
function RobotArm() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" fill="none">
      {/* Upper limb, sheared at the shoulder. */}
      <path
        d="M6 66 L34 58 L48 44 L44 36 L26 44 L4 56 Z"
        fill="rgb(74 62 58)"
        stroke="rgb(122 58 24)"
        strokeOpacity="0.5"
        strokeWidth="1.2"
      />
      {/* The joint it broke at. */}
      <circle
        cx="50"
        cy="40"
        r="7.5"
        fill="rgb(58 50 48)"
        stroke="rgb(146 74 30)"
        strokeWidth="1.4"
      />
      <circle cx="50" cy="40" r="2.6" fill="rgb(146 74 30)" fillOpacity="0.7" />
      {/* Forearm, and the three fingers still curled around nothing. */}
      <path
        d="M56 38 L86 30 L94 34 L92 42 L60 47 Z"
        fill="rgb(66 56 53)"
        stroke="rgb(122 58 24)"
        strokeOpacity="0.45"
        strokeWidth="1.2"
      />
      <path
        d="M94 36 L110 30 M94 39 L112 38 M93 42 L108 47"
        stroke="rgb(88 74 70)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Severed cabling, still live enough to spit once in a while. */}
      <path
        d="M6 56 C 0 50, 10 46, 4 40"
        stroke="rgb(96 60 40)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="4" cy="40" r="2.2" fill="rgb(240 173 76)" className="animate-arc-flicker" />
      {/* The stain it has been leaving on the floor. */}
      <ellipse cx="46" cy="72" rx="42" ry="6" fill="rgb(0 0 0)" fillOpacity="0.35" />
    </svg>
  );
}

/** A mechanical fly, sitting. It has been on this corner all game and it is not going anywhere. */
function MechanicalFly() {
  return (
    <svg viewBox="0 0 34 24" className="h-full w-full" fill="none">
      {/* Wings: etched foil, catching whatever light there is. */}
      <ellipse
        cx="13"
        cy="8"
        rx="9"
        ry="4"
        transform="rotate(-24 13 8)"
        fill="rgb(186 176 226)"
        fillOpacity="0.28"
        stroke="rgb(211 204 247)"
        strokeOpacity="0.4"
        strokeWidth="0.6"
      />
      <ellipse
        cx="20"
        cy="8"
        rx="9"
        ry="4"
        transform="rotate(24 20 8)"
        fill="rgb(186 176 226)"
        fillOpacity="0.2"
        stroke="rgb(211 204 247)"
        strokeOpacity="0.32"
        strokeWidth="0.6"
      />
      {/* Body: three brass segments. */}
      <ellipse cx="17" cy="15" rx="7" ry="4.2" fill="rgb(84 60 34)" />
      <ellipse cx="12" cy="14" rx="3.4" ry="3.4" fill="rgb(110 80 44)" />
      <circle cx="9" cy="13.5" r="2.6" fill="rgb(58 46 34)" />
      {/* The one lit eye. */}
      <circle cx="8" cy="13" r="1.1" fill="rgb(240 173 76)" fillOpacity="0.85" />
      {/* Legs, wire-thin. */}
      <path
        d="M12 18 L9 22 M16 19 L15 23 M21 18 L24 22"
        stroke="rgb(64 54 44)"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Conduit coming out of the ceiling and stopping, the way it does in every building down here. */
function HangingConduit() {
  return (
    <svg viewBox="0 0 46 96" className="h-full w-full" fill="none">
      <path
        d="M14 0 L14 44 C 14 58, 26 60, 26 72 L26 84"
        stroke="rgb(70 60 56)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M14 0 L14 44 C 14 58, 26 60, 26 72 L26 84"
        stroke="rgb(122 58 24)"
        strokeOpacity="0.35"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* The clamp somebody put on it, and the frayed end below. */}
      <rect x="8" y="30" width="12" height="6" rx="1" fill="rgb(94 80 74)" />
      <path
        d="M26 84 L22 94 M26 84 L30 93 M26 84 L26 95"
        stroke="rgb(88 74 70)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The whole layer.
 *
 * Mounted once in the game shell rather than per screen, so the junk stays put as a player moves
 * between the district and the roster — a fly that teleports on every navigation is worse than no
 * fly. It sits above the artwork and below the HUD, which is what lets the patina over the top of
 * everything tie the two together.
 */
export function Ambience() {
  return (
    <div
      aria-hidden
      data-testid="ambience"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Every piece is placed against the *measured* height of the chrome rather than a constant.
          The shell publishes `--hud-h` and `--nav-h` because both bars change height with the type
          size and with how many doors the scenery switcher is carrying — and a fly pinned 124px up
          from the bottom ends up sitting on the nav the day that row wraps, which is exactly what
          happened the first time this shipped. */}
      {/* Lower-left, clear of the queue rail and well above the switcher. */}
      <div
        className="absolute left-4 h-[84px] w-[120px] opacity-[0.42]"
        style={{ bottom: 'calc(var(--nav-h, 104px) + 24px)' }}
      >
        <RobotArm />
      </div>
      {/* Upper-right, under the stockpile strip and away from every action button. */}
      <div
        className="absolute right-6 h-[96px] w-[46px] opacity-[0.35]"
        style={{ top: 'calc(var(--hud-h, 96px) + 8px)' }}
      >
        <HangingConduit />
      </div>
      {/* Lower-right, sitting on nothing. */}
      <div
        className="animate-fly-idle absolute right-[26px] h-[24px] w-[34px] opacity-[0.75]"
        style={{ bottom: 'calc(var(--nav-h, 104px) + 18px)' }}
      >
        <MechanicalFly />
      </div>
    </div>
  );
}

/**
 * One sheet of dirty glass over the entire frame.
 *
 * Separate from the sprites, and mounted at a *higher* layer than them, because the two want
 * opposite things. The junk in the corners has to sit **under** the chrome: it is 42% opacity dark
 * metal, and the one place it must never land is on top of the queue rail's countdowns, which is
 * exactly where a piece tucked into the bottom-left corner ends up. The glass has to sit **over**
 * the chrome, because running across the panel edges is the entire reason it exists — without that
 * the screen is a stack of separate widgets with a texture inside each one.
 */
export function Patina() {
  return <div aria-hidden className="patina pointer-events-none absolute inset-0" />;
}
