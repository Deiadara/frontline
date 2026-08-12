# Frontline — Game Design Document (v2)

Source of truth for the feature set the board specified in **MOU-159**. Every requirement the board wrote
is captured here with a stable ID (`A1`, `B3`, …). Child issues cite these IDs; if an ID is not covered by
a shipped change, the feature is not done.

Conventions used below:

- **[BOARD]** — written by the board. Do not reinterpret; if it looks wrong, escalate to the CEO.
- **[CEO]** — a provisional decision the CEO made to unblock implementation. The board may override at any
  time; overriding one costs a small refactor, not a redesign.
- **[TODO-LATER]** — explicitly deferred by the board ("we'll work on that later" / "I'll add the new
  things in a separate task"). Model it now if the data shape needs it; do not build the mechanic.

---

## A. World, tone and art direction

- **A1 [BOARD]** The hideout is a **small village**, laid out like Grepolis' town view — discrete
  buildings you can see and click, sitting in a place — not the current single-panel base view. Keep only
  the _vibe_ of what exists today, not the layout.
- **A2 [BOARD]** Overall aesthetic: **less futuristic, more dystopic**. Reference is **Zaun / the
  undercity in Arcane** — cyberpunk technology inside a broken-down, post-war society. Lots of scrap,
  jury-rigged structures, robots: old, destroyed, and new ones side by side. Clean chrome-and-neon
  futurism is off-target.
- **A3 [BOARD]** In NPC battles the main enemy is **the Government**, which is a tyranny. NPC content,
  faction naming, mission fiction and enemy composition all hang off this.

## B. Attributes, traits and the hidden role model

- **B1 [BOARD]** Attributes are rated **out of 100** (replacing the current 1..20 scale).
- **B2 [BOARD]** Starting spread at recruitment: **average 15–20**, a good attribute **~30**, a bad one
  **~10**.
  - **B2a [CEO]** Concretely: roll each attribute around a mean of ~17, then apply the character's
    role-affinity template to lift 3–5 attributes toward ~30 and push 1–3 down toward ~10. **No attribute
    exceeds 40 at recruitment** — the 40–100 band is what progression is for. Exact distribution is the
    engineer's call as long as a large sample reproduces the board's three numbers.
- **B3 [BOARD]** **Many** distinct attributes — enough that all 19 roles in §C have something that is
  genuinely theirs.
- **B4 [BOARD]** Attributes are grouped into **Football-Manager-style categories**: Physical Attributes,
  Mental Attributes, Skills, Traits, etc.
  - **B4a [CEO]** Categories: **Physical**, **Mental**, **Social**, **Technical**, plus **Traits** (§B7,
    a different kind of thing — discrete, not 0..100).
- **B5 [BOARD]** The attribute set must cover every role's field, each in its respective area.
- **B6 [BOARD]** **Every human has every attribute**, including ones irrelevant to their role. There is no
  per-role attribute subset.
- **B7 [BOARD]** Some characters have a **unique trait granting a bonus**. Add a starter set now; the full
  trait system is **[TODO-LATER]**.
- **B8 [BOARD]** What each role actually needs is **internal to the game and never exposed to players**.
  **No star ratings**, no "suitability" score, no derived fit indicator. Players guess from the attributes
  and traits they can see.
  - **B8a [CEO]** Architectural constraint: the role-requirement table lives **server-side only** and must
    never be shipped in the client bundle or returned by any API. A test asserts this.
- **B9 [BOARD]** **Research unlocks partial insight.** A librarian-like role/task that investigates hiring
  starts giving input: what pairs well with what, and feedback you can ask for about potential assignments
  for a given role. It stays hints — never the raw table.

## C. Roles (officer positions)

- **C1 [BOARD]** The 19 fillable positions:
  Head Spy · Lead Engineer · Finance Officer · Head of Growth · Field Commander · Head of Research ·
  Wetware Chief · Fabricator · Salvager · Right Hand · Cartographer · Trader · Security Officer ·
  Chief Medic · Instructor of the Young · Raid Boss · Scout · Consigliere · Professor.
- **C2 [BOARD]** Humans are generic; **roles are what you hire them into**. The same character could be
  slotted anywhere — well or badly.
- **C3 [CEO]** One officer per role slot; a role is either filled or empty. Duplicate officers in the same
  role are not supported in this pass.
- **C4** The Professor runs _reskilling_ (§G4). The librarian-ish research task in §B9 is a
  Professor/Head-of-Research activity.

## D. Economy: resources and meters

- **D1 [BOARD]** **Food** — core supply. **More officers require more food.**
- **D2 [BOARD]** **Caps** — the currency (Fallout-style). Officer **wages** are paid in caps (§H7).
- **D3 [BOARD]** **Oil** — consumed by upgrading and building inside the hideout.
- **D4 [BOARD]** **Morale** — a meter.
- **D5 [BOARD]** **Scrap** — a resource.
- **D6 [BOARD]** **High-quality metal** — a resource, distinct from scrap.
- **D7 [BOARD]** **Infamy** — a meter raised by infamous actions: things that are usually not morally
  good, but that get your name passed around the street.
- **D8 [BOARD]** **Reputation** — a _word_, not a number, applied to your group by its actions, and it
  changes over time. Named examples: **Revolutionary**, **Anti-systemic** (lots of anti-government
  action), **Hostile** (attacks other players a lot), **Cautious**, **Opportunist**, **Honorable**,
  **Treacherous**, **Collaborator**, **Reckless**, **Feared**, **Respected**.
  - **D8a [BOARD]** Add **all** of them now. Ones with no mechanic to drive them yet get an explicit
    **[TODO-LATER]** marker in code and are wired up when the mechanic lands.
- **D9 [CEO]** The current MVP resources (`credits`, `power`, `data`, `alloy`) are **replaced**, not
  extended: caps, food, oil, scrap, high-quality metal. There is no live player data to preserve, so a
  destructive migration is acceptable.

## E. Missions, travel and timers

- **E1 [BOARD]** Winning fights yields resources, **thematically matched to the mission** you ran.
- **E2 [BOARD]** Missions take real time. The troops / assigned people **are away** and **return** when
  it completes.
- **E3 [BOARD]** A **dedicated page** in the game shows every in-flight mission with its timer.
- **E4 [BOARD]** When choosing a mission you see **how long the travel is** and **how long the mission
  itself takes**, before committing.
- **E5 [BOARD]** Rewards **scale with time**. Battles pay more than standard missions **but risk your
  people**.
- **E6 [BOARD]** Travel time by distance band: **close ≈ 5 min**, **further ≈ 20 min**, **furthest ≈ 1
  hour**.
- **E7 [BOARD]** Mission duration itself ranges from **2–3 minutes up to a day**.
- **E8 [BOARD]** **Total elapsed = 2 × travel + mission time.**

## F. The player's own character (Overseer)

- **F1 [BOARD]** The Overseer has the **same attributes and traits** as everyone else.
- **F2 [BOARD]** You can **develop any of them**.
- **F3 [BOARD]** Board-named examples of what attributes do: **Charisma** → leading people, raising
  morale. A **physical** attribute → keeping things in check. **Communication** → inspires better ideas
  out of your people. **Imagination** → coming up with new things.
- **F4 [BOARD]** Attributes are **bonuses**, and some **unlock new actions**. Worked example: researching
  something new — if the person on it has high enough **Imagination**, an option unlocks that would
  otherwise stay locked.
- **F5 [BOARD]** Second use: **modifiers on outcomes**. Worked example: a raid to steal resources —
  good **Speed** and **Stealth** on your character raise the team's success chance.
- **F6 [BOARD]** The initial Overseer **choice stays as it is today** — same four options — restated on
  the new attribute model (§B).

## G. Assignees

- **G1 [BOARD]** Under each officer you can place **Assignees**. They come from a **fungible pool** —
  they are interchangeable and have no individual identity.
- **G2 [BOARD]** The pool **grows with level**; on level-up you place the new ones you got.
- **G3 [BOARD]** Per-officer cap = **your level ÷ 2**: 1 at the start, **2 once you reach level 4**, and
  so on.
  - **G3a [CEO]** Read as `max(1, floor(level / 2))`.
- **G4 [BOARD]** **"Reskilling"** — a process run by the **Professor** that lets you **reassign every
  assignee** at once.
- **G5 [BOARD]** Assignees add bonus to the **speed** and the **ability/power** of whatever the officer
  is doing.
- **G6 [BOARD]** **Hard** missions and internal processes **require an officer**. **Easy** ones can be run
  by a delegation of **assignees alone** — but slower and with a lower success chance.
- **G7 [BOARD]** Diminishing-returns bonus table (applies to both time reduction and power), by assignee
  count: **1→5% · 2→10% · 3→14.5% · 4→19% · 5→23.5% · 6→29% · 7→33% · 8→37% · 9→40% · 10→43% ·
  11→45% · 12→50%.** **12 assignees at 50% is the maximum.**
- **G8 [BOARD]** Grants: **start with 2**; **+1 per level**; **+1 extra at every 5th level** (5, 10,
  15, …).

## H. Recruitment — the Bar

- **H1 [BOARD]** Recruiting happens at a place called **the Bar**.
- **H2 [BOARD]** The Bar holds the currently available characters. The roster **refreshes every day** and
  is **the same for every player**.
  - **H2a [CEO]** Therefore it is generated deterministically from the UTC date — one global roster, no
    per-player rolls.
- **H3 [BOARD]** Each character has **requirements to join you**, e.g. "at least this much infamy".
- **H4 [BOARD]** Your group's **reputation label** (§D8) affects whether someone is willing to join,
  judged against **that character's ambitions and moral compass** — every character has both.
- **H5 [BOARD]** Each character you hold has an **alignment meter**: how much they agree or disagree with
  what your group does. **Too low → they threaten to leave. High → they get bonuses to some skills.**
- **H6 [BOARD]** Characters **evolve slowly**: each can **level up**, and on level-up you get **5 skill
  points to add** — _"2 separate points you can individually assign"_.
  - **H6a [CEO]** Read as: 5 points total per level, of which **2 are player-assigned** and 3 are
    auto-allocated along the character's affinities. Flagged to the board; cheap to flip if the intended
    reading was different.
- **H7 [BOARD]** Recruitment involves **negotiating a salary** if the character is interested. Salary is
  in **caps**, paid **once a week on the real-world clock**. The **first payment happens at recruitment**
  and covers **however much of the week is left**.
- **H8 [BOARD]** You can hold **2 recruits at the start**, **+1 per level**.

## I. Experience and levelling

- **I1 [BOARD]** XP comes from **missions**, **building things**, **quests**, and **fighting other
  players**.
- **I2 [BOARD]** Levelling up grants the bonuses above (assignee pool §G8, per-officer cap §G3, recruit
  slots §H8) **and unlocks new things**.
- **I3 [BOARD]** The set of unlocks beyond the above is **[TODO-LATER]** — the board will file it
  separately. Build the unlock hook, not a catalogue of unlocks.

---

## Delivery map

| Workstream                          | Covers                              |
| ----------------------------------- | ----------------------------------- |
| W1 Attribute & role model           | B1–B9, C1–C4, F1, F6                |
| W2 Economy: resources & meters      | D1–D9, H7 (payroll engine)          |
| W3 Missions, travel & timers        | E1–E8                               |
| W4 Assignees                        | G1–G8                               |
| W5 The Bar & recruitment            | H1–H8                               |
| W6 XP & levelling                   | I1–I3                               |
| W7 Research & hidden-info discovery | B9, F2–F5                           |
| W8 Hideout as a village             | A1, D3                              |
| W9 Art direction v2 (Zaun)          | A2                                  |
| W10 The Government (NPC enemy)      | A3, D8 (anti-government reputation) |
