# Frontline: Game Design Document (v2)

Source of truth for the feature set the board specified in **MOU-159**. Every requirement the board wrote
is captured here with a stable ID (`A1`, `B3`, …). Child issues cite these IDs; if an ID is not covered by
a shipped change, the feature is not done.

Conventions used below:

- **[BOARD]**: written by the board. Do not reinterpret; if it looks wrong, escalate to the CEO.
- **[CEO]**: a provisional decision the CEO made to unblock implementation. The board may override at any
  time; overriding one costs a small refactor, not a redesign.
- **[TODO-LATER]**: explicitly deferred by the board ("we'll work on that later" / "I'll add the new
  things in a separate task"). Model it now if the data shape needs it; do not build the mechanic.

---

## A. World, tone and art direction

- **A1a [BOARD]** **Population is the army's, not the crew's.** Officers are counted on the books
  and charged nothing: hiring somebody must not compete with training somebody. A district that is
  finished and holding ground houses **about 2,000**, up from 345.
  - **A1b [CEO]** The Quarters' contribution is triangular (`HOUSING_PER_QUARTERS_LEVEL * L(L+1)/2`)
    rather than flat, so the ceiling reaches the board's figure without a level-1 Quarters starting
    the game with beds for an army nobody can pay for. Pinned in `building.test.ts`.
- **A1 [BOARD]** The hideout is a **small village**, laid out like Grepolis' town view: discrete
  buildings you can see and click, sitting in a place, not the current single-panel base view. Keep only
  the _vibe_ of what exists today, not the layout.
- **A2 [BOARD]** Overall aesthetic: **less futuristic, more dystopic**. Reference is **Zaun / the
  undercity in Arcane**: cyberpunk technology inside a broken-down, post-war society. Lots of scrap,
  jury-rigged structures, robots: old, destroyed, and new ones side by side. Clean chrome-and-neon
  futurism is off-target.
- **A3 [BOARD]** In NPC battles the main enemy is **the Government**, which is a tyranny. NPC content,
  faction naming, mission fiction and enemy composition all hang off this.

## B. Attributes, traits and the hidden role model

- **B1 [BOARD]** Attributes are rated **out of 100** (replacing the current 1..20 scale).
- **B2 [BOARD]** Starting spread at recruitment: **average 15-20**, a good attribute **~30**, a bad one
  **~10**.
  - **B2a [CEO]** Concretely: roll each attribute around a mean of ~17, then apply the character's
    role-affinity template to lift 3-5 attributes toward ~30 and push 1-3 down toward ~10. **No attribute
    exceeds 40 at recruitment**: the 40-100 band is what progression is for. Exact distribution is the
    engineer's call as long as a large sample reproduces the board's three numbers.
- **B3 [BOARD]** **Many** distinct attributes: enough that all 19 roles in §C have something that is
  genuinely theirs.
- **B4 [BOARD]** Attributes are grouped into **Football-Manager-style categories**: Physical Attributes,
  Mental Attributes, Skills, Traits, etc.
  - **B4a [CEO]** Categories: **Physical**, **Mental**, **Social**, **Technical**, plus **Traits** (§B7,
    a different kind of thing: discrete, not 0..100).
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
  for a given role. It stays hints: never the raw table.

## C. Roles (officer positions)

- **C1 [BOARD]** The 19 fillable positions:
  Head Spy · Lead Engineer · Finance Officer · Head of Growth · Field Commander · Head of Research ·
  Wetware Chief · Fabricator · Salvager · Right Hand · Cartographer · Trader · Security Officer ·
  Chief Medic · Instructor of the Young · Raid Boss · Scout · Consigliere · Professor.
- **C2 [BOARD]** Humans are generic; **roles are what you hire them into**. The same character could be
  slotted anywhere: well or badly.
- **C3 [CEO]** One officer per role slot; a role is either filled or empty. Duplicate officers in the same
  role are not supported in this pass.
- **C4** The Professor runs _reskilling_ (§G4). The librarian-ish research task in §B9 is a
  Professor/Head-of-Research activity.

## D. Economy: resources and meters

- **D1 [BOARD]** **Supplies**: core stores. Spent on training units and on raising the Quarters.
- **D2 [BOARD]** **Caps**: the currency (Fallout-style). Officer **wages** are paid in caps (§H7).
- **D3 [BOARD]** **Oil**: consumed by upgrading and building inside the hideout.
- **D4 [BOARD]** **Morale**: a meter.
- **D5 [BOARD]** **Scrap**: a resource.
- **D6 [BOARD]** **High-quality metal**: a resource, distinct from scrap.
- **D7 [BOARD]** **Infamy**: a meter raised by infamous actions: things that are usually not morally
  good, but that get your name passed around the street.
- **D8 [BOARD]** **Reputation**: a _word_, not a number, applied to your group by its actions, and it
  changes over time. Named examples: **Revolutionary**, **Anti-systemic** (lots of anti-government
  action), **Hostile** (attacks other players a lot), **Cautious**, **Opportunist**, **Honorable**,
  **Treacherous**, **Collaborator**, **Reckless**, **Feared**, **Respected**.
  - **D8a [BOARD]** Add **all** of them now. Ones with no mechanic to drive them yet get an explicit
    **[TODO-LATER]** marker in code and are wired up when the mechanic lands.
- **D9 [CEO]** The current MVP resources (`credits`, `power`, `data`, `alloy`) are **replaced**, not
  extended: caps, supplies, oil, scrap, high-quality metal. There is no live player data to preserve, so a
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
- **E7 [BOARD]** Mission duration itself ranges from **2-3 minutes up to a day**.
- **E8 [BOARD]** **Total elapsed = 2 × travel + mission time.**

## F. The player's own character (Overseer)

- **F1 [BOARD]** The Overseer has the **same attributes and traits** as everyone else.
- **F2 [BOARD]** You can **develop any of them**.
- **F3 [BOARD]** Board-named examples of what attributes do: **Charisma** → leading people, raising
  morale. A **physical** attribute → keeping things in check. **Communication** → inspires better ideas
  out of your people. **Imagination** → coming up with new things.
- **F4 [BOARD]** Attributes are **bonuses**, and some **unlock new actions**. Worked example: researching
  something new, if the person on it has high enough **Imagination**, an option unlocks that would
  otherwise stay locked.
- **F5 [BOARD]** Second use: **modifiers on outcomes**. Worked example: a raid to steal resources:
  good **Speed** and **Stealth** on your character raise the team's success chance.
- **F6 [BOARD]** The initial Overseer **choice stays as it is today**, same four options, restated on
  the new attribute model (§B).

## G. Assignees

- **G1 [BOARD]** Under each officer you can place **Assignees**. They come from a **fungible pool**.
  They are interchangeable and have no individual identity.
- **G2 [BOARD]** The pool **grows with level**; on level-up you place the new ones you got.
- **G3 [BOARD]** Per-officer cap = **your level ÷ 2**: 1 at the start, **2 once you reach level 4**, and
  so on.
  - **G3a [CEO]** Read as `max(1, floor(level / 2))`.
- **G4 [BOARD]** **"Reskilling"**: a process run by the **Professor** that lets you **reassign every
  assignee** at once.
- **G5 [BOARD]** Assignees add bonus to the **speed** and the **ability/power** of whatever the officer
  is doing.
- **G6 [BOARD]** **Hard** missions and internal processes **require an officer**. **Easy** ones can be run
  by a delegation of **assignees alone**, but slower and with a lower success chance.
- **G7 [BOARD]** Diminishing-returns bonus table (applies to both time reduction and power), by assignee
  count: **1→5% · 2→10% · 3→14.5% · 4→19% · 5→23.5% · 6→29% · 7→33% · 8→37% · 9→40% · 10→43% ·
  11→45% · 12→50%.** **12 assignees at 50% is the maximum.**
- **G8 [BOARD]** Grants: **start with 2**; **+1 per level**; **+1 extra at every 5th level** (5, 10,
  15, …).

## H. Recruitment: the Bar

- **H1 [BOARD]** Recruiting happens at a place called **the Bar**.
- **H2 [BOARD]** The Bar holds the currently available characters. The roster **refreshes every day** and
  is **the same for every player**.
  - **H2a [CEO]** Therefore it is generated deterministically from the UTC date: one global roster, no
    per-player rolls.
- **H3 [BOARD]** Each character has **requirements to join you**, e.g. "at least this much infamy".
- **H4 [BOARD, CUT]** ~~Your group's **reputation label** (§D8) affects whether someone is willing to
  join, judged against **that character's ambitions and moral compass**: every character has both.~~
- **H5 [BOARD, CUT]** ~~Each character you hold has an **alignment meter**: how much they agree or
  disagree with what your group does. **Too low → they threaten to leave. High → they get bonuses to
  some skills.**~~
- **H6 [BOARD, CUT]** ~~Characters **evolve slowly**: each can **level up**, and on level-up you get
  **5 skill points to add**.~~
- **H4-H6 superseded [BOARD]** All three are removed. They were one idea between them, that a hire is a
  _relationship you maintain_: a personality to judge against, a mood that drifted while you were not
  looking, and a second progression track to spend points on. Keeping nineteen people happy and nineteen
  people levelled ran beside the city, the army and the research tree, and none of it was a decision
  anybody made on purpose.
  - **H4a [BOARD]** A character is now **their sheet and their perks**, both visible at the Bar before a
    cap is committed, and neither changes behind the player's back. The only ongoing cost is the wage.
  - **H4b [BOARD]** **Perks** (§B7): a book of a hundred-odd discrete bonuses to the _crew's_ numbers,
    not the carrier's own: `+6% build speed`, `+3 armour on Heavy units`, `-5% to widen the payroll`.
    Each officer rolls **nought to three**, weighted so three is rare. They **sum** across the roster,
    which is what makes filling all nineteen chairs worth the wage bill.
  - **H4c [CEO]** How hard somebody is to haggle with is read off the sheet the player can already see:
    **Composure** is their patience and **Negotiation** is how little ground they give. That replaces
    the two hidden personality tags §H4 used, and it is strictly more legible: both numbers are printed
    on the card while the player decides whether to sit down.
- **H7 [BOARD]** Recruitment involves **negotiating a salary** if the character is interested. Salary is
  in **caps**, paid **once a week on the real-world clock**. The **first payment happens at recruitment**
  and covers **however much of the week is left**.
- **H8 [BOARD]** You can hold **2 recruits at the start**, **+1 per level**.

## J. Factions [BOARD]

- **J1 [BOARD]** Players can come together into a **faction**: a team of **up to 5** members, with a
  name and a badge, on its own tab.
  - **J1a [CEO]** The word previously meant two other things in the code (a district's own name, and
    a map holder kind) and both were renamed out of the way. A district's politics is now its
    **allegiance** (§A4).
- **J2 [BOARD]** The faction screen shows the members, and **the armies each of them currently
  holds**.
- **J3 [BOARD]** An ally's battles appear on the faction tab, and a member can **send units into
  them**. This is implicit rather than explicit: the fight is not a separate object, it is the
  ally's own battle with more people standing on their side.
  - **J3a [CEO]** Read as: a battle side is a list of contributors. Reinforcements go through the
    same deployment path a crew uses for its own fights, so travel, supply and the deployment
    window are the same rules. Survivors are split back per contributor, and everybody who had
    units in a fight gets their own report.
- **J4 [BOARD]** Ranks: **leader**, **chief**, **member**.
  - A **leader** can do anything.
  - A **chief** can invite, remove **members**, and change the description. Not the badge, not the
    name, and not another chief or the leader.
  - A **member** sees everything and fights in everything, and changes nothing.
  - **J4a [CEO]** "Chief cannot touch chief" is the rule that needs stating: two chiefs able to
    remove each other turns a disagreement into a race. `canKick` takes both ranks for that reason.
- **J5 [BOARD]** A faction has a **name**, a **badge** and a **description**, and the name and badge
  can both be changed later. The badge is **built** rather than typed: a shape, a ground colour, a
  pattern over it, an emblem and a colour for the emblem, in the manner of any team-crest builder.
  - **J5a [CEO]** 6 shapes x 12 colours x 6 patterns x 18 emblems x 12 colours, drawn from stored
    identifiers rather than stored as an image (`factions/badge.ts`, `FactionBadge.tsx`). No asset
    ships, and the board's art policy is untouched: it is code-generated art.
- **J6 [BOARD]** **Invitation is the only way in, and it arrives as a message.** The invite lands in
  the recipient's inbox with a button on it; the button asks for confirmation before it joins.
  - **J6a [CEO]** The message carries the invitation's id, so the button spends the same row the
    faction screen would: one way in, two doors onto it. Whether it is still open is read from the
    invitation at display time, so an answered invite stops offering a way in immediately.
- **J7 [BOARD]** **Leaving and disbanding.** Anybody can leave. A **leader** leaving disbands the
  faction, unless they hand it to somebody first; a last member out disbands it whatever their rank.
  The leader can also disband it outright.
  - **J7a [CEO]** Leaving used to be refused for a leader with people at the table, which left
    somebody who wanted out with no way to be finished. It is allowed now and the screen says what
    it will cost before it happens (`leavingDisbands`, and a confirmation on every destructive
    control).

- **J8 [BOARD]** **Team infamy** is **append-only**: the total infamy won in battle by people who
  were members of the faction at the time they won it. It is not the sum of the members' wallets
  (joining with 30,000 adds nothing, spending on notoriety takes nothing away), and **it does not
  fall when somebody leaves**: what they won, they won under that badge.
  - **J8a [CEO]** An accumulator on the _faction_, credited from the two economies a fight produces
    so the faction gets exactly what the player was paid (`creditFaction`). The membership row keeps
    its own figure as well: that one is the member's contribution while they are at the table, which
    is what the roster shows, and it is the one that leaves with them.
- **J9 [BOARD]** A **standings** screen, reached from the standing bar next to Actions. Two boards,
  **players** and **factions**, and a checkbox reading **My city only** that limits either one to
  the player's own city rather than every city.
  - **J9a [CEO]** There is one city (`CITIES`, Ashfall) so the two scopes list the same people
    today, which the board has accepted: the filter is written against a city id so that a second
    city makes it real with no screen change. A crew's city is read off its district (`cityOf`)
    rather than stored, so the map stays the only place that fact lives. A faction is on a city's
    board if any of its members is.
  - **J9b [CEO]** Players rank on the infamy they hold, factions on §J8's append-only figure. Ties
    share a place and the next row skips the places used up.

- **J10 [BOARD]** Invitations are not bounded by geography: you can ask anybody, in any city.

## K. Messages and notifications [BOARD]

- **K1 [BOARD]** Two doors in the standing bar, **left of Battles**, each with an unread count.
- **K2 [BOARD]** **Messages**: write to another player or to your whole faction. Inbox, sent folder,
  reply, delete, unread until opened.
- **K3 [BOARD]** **Notifications**, in the manner of Grepolis: the game reporting what happened
  while you were away, every one linking to the thing it is about.
- **K4 [BOARD]** A filter in settings decides which kinds reach you.
  - **K4a [CEO]** Applied at **write** time rather than read time, so switching a kind back on is a
    statement about the future rather than an unpacking of backlog, and the badge is always a count
    of things the player asked for. Two kinds cannot be switched off: a battle report and an attack
    on your district, both of which report something irreversible.

- **K5 [BOARD]** The bell **is** the list. No tabs and no heading over it: an empty screen when
  nothing has happened, and the filters behind one drawn button in the corner marked
  **Preferences**.
- **K6 [BOARD]** Every notification **opens onto the thing it is about**, as a drawn report with
  labels and boxes rather than a line of prose.
  - **K6a [BOARD]** A mission's report says which job, which district, whether it worked, the
    battle result where there was one, and **what came back against what the job paid**.
  - **K6b [CEO]** A notification carries a `subjectId` (`0053`) so it can name its mission rather
    than pointing at the missions screen. Missions record `spoils`, the payout before the carry cap,
    beside `rewards`, the payout after it (`0052`): neither is derivable from the other after the
    fact, and the difference is the only feedback the carry mechanic has ever had.
- **K7 [BOARD]** Sending units on a mission takes a typed number, steppers, and one-press **Half**
  and **Max**.

## I. Experience and levelling

- **I1 [BOARD]** XP comes from **missions**, **building things**, **quests**, and **fighting other
  players**.
- **I2 [BOARD]** Levelling up grants the bonuses above (recruit slots §H8) **and unlocks new things**.
  The assignee pool (§G8) and the per-officer cap (§G3) it also used to grant are both cut.
- **I3 [BOARD]** The set of unlocks beyond the above is **[TODO-LATER]**: the board will file it
  separately. Build the unlock hook, not a catalogue of unlocks.

---

## Delivery map

| Workstream                          | Covers                              |
| ----------------------------------- | ----------------------------------- |
| W1 Attribute & role model           | B1-B9, C1-C4, F1, F6                |
| W2 Economy: resources & meters      | D1-D9, H7 (payroll engine)          |
| W3 Missions, travel & timers        | E1-E8                               |
| W4 Assignees                        | G1-G8                               |
| W5 The Bar & recruitment            | H1-H8                               |
| W6 XP & levelling                   | I1-I3                               |
| W7 Research & hidden-info discovery | B9, F2-F5                           |
| W8 Hideout as a village             | A1, D3                              |
| W9 Art direction v2 (Zaun)          | A2                                  |
| W10 The Government (NPC enemy)      | A3, D8 (anti-government reputation) |
