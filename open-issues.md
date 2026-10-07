# Open issues

Found by the recurring bug pass. Each one needs a decision or more than a few lines, so nothing here
has been changed. Fixed findings are not listed. Newest pass first.

## Decided, 2026-10-06 (built the same day)

Every ruling below is built and tested, each test checked against a revert of its fix. The
exceptions are the ones the rulings themselves set aside: the speed work (skipped at 16 accounts)
and the "leave as is" calls. The item sections further down are the record of how each was found.

- **Late fights (items 22, 36).** A fight settled after its start time uses the world as of its
  start: injury, disruption, the walk home and the report are dated at the start, and gates,
  recruits and crew bonuses are read as they stood then.
- **Sign-in lock (item 37).** Count wrong passwords per account and per address, so a stranger's
  guesses lock only the stranger's address out of that account.
- **Officer loot perk on raids (pass 13).** The bonus takes the extra from the victim's stockpile,
  capped by what they hold, so nothing is created; the Bone Market refund is not scaled by it.
- **Free bets on a mate's call (item 1).** Leave as is: every call-off refunds every bet.
- **Work in progress on captured ground (item 2).** Every pending upgrade of a location or a
  captured gate is cancelled when the ground is captured, and nobody is refunded.
- **The 20-slot call-off (item 3).** Decided once, at the lock: an attack is called off only if, one
  hour before it starts, it has fewer than 20 unit slots in. Nothing after the lock can void it.
- **Admin bets (item 4).** The stake on record is what was charged, so an admin bet pays out on zero.
- **Muster refusals (item 6).** Muster is greyed out, with the reason on hover, whenever the order
  would be refused: the count is more than the crew can afford or house, the bench is full, a
  one-of-a-kind unit is already held, or the Mausoleum cap is reached. A refusal that can still
  happen (another tab spent the caps first) shows inside the card that was pressed.
- **The Stackhouse bet window (item 5).** Once opened it keeps a copy of the fight and stays up,
  showing any refusal, until the player closes it.
- **Switching city (items 10, 42).** Leave as is.
- **Dialog focus (item 8).** A full focus trap: Tab cycles inside the dialog, focus returns to the
  opener on close, and hover cards ignore that returned focus.
- **Admin "Call it" (item 7).** The battles board says when the price is waived, and the dialog
  lets the call through.
- **The Right Hand and their own orders (item 51).** May lead them: running the orders is not a
  commitment.
- **Drills (item 52).** No drill for an officer out on a run, held for a fight, or injured. The
  bench is allowed. (Injured is now refused too, a change from today.)
- **Spy recall (item 50).** Refused once the spies have reached the place.
- **Capture infamy (pass 13).** Leave as is: paid on every capture.
- **Vehicle seats in a fight (item 56).** Seats count only for units still on the road; a landed
  unit frees its seat. One function at both doors.
- **Bids are held when placed (item 57).** A bid comes off the bidder's stock when it is placed.
  Raising your own bid refunds the old one and takes the new one. At the end, everybody who did not
  win gets back what they bid, caps or infamy. (See "Held bids cover" below.)
- **Weekly regrowth (item 39).** Waits for last week's fights to settle, but no longer than an hour
  after the Monday mark, then runs anyway.
- **Held bids cover (item 57).** The Runner's lots (caps), the fence's shelf (infamy) and the
  Stackhouse.
- **Letters per day (item 41).** Counted from a 24-hour send log that deleting letters cannot touch.
- **Writing to anybody (item 43).** The composer looks names up on the server, not the top 100.
- **The Overseer pool (item 24).** Leave as is: the game holds 16 accounts (four cities of four), so
  the 30 Overseers are enough.
- **A fight that cannot run (item 20, pass 13).** Dropped after logging the error, never crashing
  or stopping the server; everything else keeps going, and its units return to their owners.
- **A fight two mates are in (item 29).** Shown once, under the member who called it or is being
  attacked, and counted by fight.
- **A standing order with its party out (item 30).** The leader stays selected with an "out" mark,
  and the party lists the units out on the run as out.
- **Standing orders on a lost rung (item 53).** The tick re-checks every rung the save checks and
  stalls the slot with the same wording.
- **Decimals in number fields (item 40).** Cut at the point: "2.5" reads 2.
- **Migrations (item 38).** Refuse to start, in development and production alike, when the record
  and the files disagree (out of order, or applied with no file).
- **The move quote (item 13).** Carries the send's refusal; Send stays greyed with the reason.
- **Feats filter (item 28).** The ladder claimed from stays open until the player picks another.
- **Guard first, then pop up (universal rule; items 6, 19, 47, the founding screen).** Every button
  that would be refused is greyed out and not clickable, and its hover says why (for example "not
  enough unit slots"). Only what slips past the guard (a race, another tab) shows as an error, in a
  small box next to the button pressed, with an X; it closes on the X or the next click anywhere.
  Nothing on the page moves. This supersedes "inside the card" for the muster.
- **Trap tile (item 48).** Green on the report of the side whose trap it was, red on the other.
- **Spy reads after downtime (item 49).** Dated at the restart, when the ground was actually read.
- **Carrying capacity on reports (item 58).** Stored on the run when it settles and shown from there;
  runs settled before the field drop the "out of N" clause.
- **Speed work (items 9, 11, 12, 16, 23, 31, 33, 44, 54, 55).** Skipped for now: at 16 accounts
  none is slow. Revisit if a screen ever feels slow.
- **Backup history (item 25).** Lines older than 7 days are pruned.
- **Backup mirror (item 26).** A missing mirror folder is never created: the copy is skipped with a
  warning.
- **Admin drills (item 17, training half).** No: drills keep their daily and queue limits in admin
  mode. (The yard half was fixed in pass 9.)
- **The faction log (pass 13).** Store when a fight is called and when help is sent, and log them at
  those times; the lines stay after the fight.
- **Notices on narrow screens (item 27).** Below 1280px only, the burn notice and the level-up
  banner sit below the build strip and the banner gets an X. Normal screens stay pixel-identical.
- **The standings label (item 34).** Reads the home city's name, so it never changes width.
- **Research refusals (item 18).** The server sends the exact reason the page shows on hover.
- **Technical fixes, all approved (items 14, 15, 32, 35, 45, 46).** Dismantle by card id with the
  server refusing a mismatch; a stored location level above the cap reads as the cap; a level-up
  drained by the Missions prefetch is still announced; the bars are measured whenever they appear;
  the flaky test's clock is pinned; the console's ground grants go through the settle and its
  checks.
- **Leaving a faction (item 21).** The moment a crew leaves, every unit it has in allies' locations
  or fights leaves and walks home, even inside the locked window.

## Pass 12, 2026-10-06 (the Monitor road, mission windows, the market's pickers, movement, gates, the Runner)

### 56. The deploy door and the machines door count seats differently

Sending units to a fight counts every unit already landed or walking against the machines' seats;
loading machines counts only columns still on the road ("whoever has landed rides nothing"). So a
crew can be refused a walker the bike could carry, or load a bike onto units that already landed.
Which is the rule: seats for the whole muster, or seats for what is on the road? Then one function
for both doors.

`apps/server/src/battle/deploy.ts`, `apps/server/src/battle/movement.ts` (`oversellsSeats`).

### 57. The Runner's close judges "can they pay" at the settle, not when he packed up

After downtime, a winner who could not cover the bid at the close is paid for by production banked
after it, at the discount read then. Settling to now before charging was a deliberate 2026-09-28
fix; whether the winner should be judged as they stood at the close is a call.

`apps/server/src/market/auction.ts`.

### 58. An old mission report works out what the crew could carry from today's figures

"Carried all 300 of the 200 they could lift": the report recomputes the run's carrying capacity with
the crew's current loadouts, bag bonus and marks, while the server settled the haul with the values
at the mark. Storing the capacity on the mission when it settles (a field and a migration) is the
honest fix; dropping the "out of N" clause for older runs is the cheap one.

`apps/client/src/features/missions/MissionReportWindow.tsx`, `apps/server/src/missions/resolve.ts`.

## Pass 11, 2026-10-06 (standing orders, the crew and feats on the server, unit cards, the shell's readouts)

### 51. Can the Right Hand lead the runs their own standing orders send?

The orders are the Right Hand's work, and the Right Hand is also free to be picked as a run's
leader by those same orders: nothing excludes the chair. Under "officers do one thing at a time",
is running the orders already their one commitment?

`apps/server/src/automations/runners.ts` (`freeOfficers`).

### 52. Can an officer drill while out on a run or held for a fight?

`POST /training` admits the bench and the injured on purpose, and never asks whether the officer is
leading a run or held for a declared fight. If a drill is a commitment, the route should refuse
busy officers the way a launch does.

`apps/server/src/routes/training.ts`.

### 53. A standing order keeps running on a rung the crew no longer has

Each tick re-checks the slot's unlock and slot count against research, but not its order kind,
its fitted party size or its "optimise for" choice; only the save checks those. Finished research
only shrinks when a rung is renamed or retired, so a slot saved as "battles" under a renamed rung
would keep calling fights. Running the save's four rung checks in the tick, stalling with the same
words, would close it.

`apps/server/src/automations/runners.ts`.

### 54. Standing orders redo their heaviest reads for every candidate job

Per send attempt: the free-officer check (two queries per officer) runs once per candidate job,
about 300 queries for 12 jobs and 13 officers; the practice fights that rank a fight's leader run
for every fight candidate before one is picked; and the crew's standing is folded twice. A runner
that throws rather than stalls gets no back-off, so it scores every candidate again each second.
Computing the free officers once per run, ranking the fight leader after the pick, and stalling a
throwing slot for a while would remove most of it.

`apps/server/src/automations/runners.ts`.

### 55. Every `/me` poll reads the whole control map six times to count ready feats

`featsReadyCount` builds the full feat snapshot, which reads all location rows six times over
(three lift rooms, the garrison count, the districts held whole, the snapshot itself). About 1 ms
per poll per crew today, growing with officers and perks. Building the control map and the lift
room once per request and passing them down would make it one read.

`apps/server/src/routes/me.ts`, `apps/server/src/feats/snapshot.ts`.

## Pass 10, 2026-10-06 (the battle screens, the city map, spying, sleepers, the fence's shelf, upgrades)

### 47. The captured-gate error on the city map moves every gate panel

The gate panels sit in a stack anchored to the bottom left of the map, and a refused raise or
cancel adds its note to that stack, so every panel jumps up by the note's height and the stack can
cover the Terminus place tags placed to clear it. The note also stays until the next press. Options:
draw it inside the panel it is about (that panel still grows upward), float it beside the stack, or
show it as a toast. A layout call.

`apps/client/src/features/game/CityView.tsx`.

### 48. The trap tile on a fight report is always in the loss colour

The report's trap tile is drawn red for both sides, so the defender whose own trap "took 12" reads
it as a loss. Green for the side that laid it, or keep it neutral?

`apps/client/src/features/battle/BattleReportModal.tsx`.

### 49. After downtime, a spy read is taken at the restart and dated at the arrival

The runners' read of the ground is taken when the world next settles and then dated at the moment
they arrived. Normally that is the same second, but after a restart over a fight, a report dated
20:00 shows the ground as the 21:00 fight left it, and the new holder is told they were watched at
20:00. The save cannot rebuild the ground as of the arrival, so the choices are reading before the
fights when the arrival came first, or dating the report at the restart.

`apps/server/src/spying/spying.ts` (`snapshotSpying`).

### 50. A spy job can be recalled after the runners have already looked

The recall window is a tenth of the whole job, which is longer than the walk out whenever the look
is more than eight times the walk (a 2 minute walk and a 240 minute look give about 24 minutes). A
recall after arrival discards the read, and a holder who caught them is never told. The spy learns
nothing, so it is not an exploit. Refuse a recall once they have arrived, or still tell the holder?

`packages/shared/src/spying/spying.ts` (`spyRecallable`), `apps/server/src/spying/spying.ts`.

## Pass 9, 2026-10-06 (the Bar room, mail, the tutorial, the shell, rewards' timing, the yard, every-crew lists)

### 41. The ten-letters-a-day cap to one player resets when the reader deletes the letters

The cap counts the sender's letters still sitting in the recipient's mailbox, and the mailbox trim
that runs on every arrival hard-deletes every letter the reader has deleted. So a spammer sends ten,
the victim deletes them, any later arrival (a faction letter from the same spammer skips the
per-recipient check but still trims) wipes the rows, and the count is back to zero. Deleting spam is
what reopens the gate. Fix options: a small ledger of sends kept for 24 hours that trims cannot
reach (as invitations already have), or never hard-deleting rows younger than 24 hours. Related: the
daily 100 is only right because `MAILBOX_LIMIT` and `MESSAGES_PER_DAY` are both 100; lowering the
mailbox limit would quietly lift the daily cap.

`apps/server/src/routes/social.ts`, `apps/server/src/db/repos/social.ts`.

### 42. The Bar's readouts and city picker vanish while another city's room loads

Switching city in the Bar drops the room's data until the new one arrives, so the picker, payroll,
crew and last-night readouts disappear and come back. Keeping the previous room as placeholder data
would hold the layout still, but it would also leave the old city's recruits pressable for that
moment, so the stool and the bid buttons would need to treat placeholder data as loading.

`apps/client/src/features/bar/BarPage.tsx`, `useBar` in `apps/client/src/lib/queries.ts`.

### 43. The letter composer only knows the top 100 players

Recipient lookup and reply-to resolve names against the leaderboard, which the server caps at 100,
so typing the exact name of a real player ranked lower reads "no such player" (as does any name
while the board is still loading). Needs a server-side name lookup, or an accepted limit.

`apps/client/src/features/social/RecipientPicker.tsx`, `MessagesPage.tsx`.

### 44. The Garage page repeats its heaviest read per vehicle

Each vehicle row reads the crew's standing effects (a walk of the city's control table) twice, once
for the price and once inside the affordability check, and `vehiclesAbroad` runs twice per request.
Reading the effects once per request and passing them down is a refactor of `garage/routes.ts`.

`apps/server/src/garage/routes.ts`.

### 45. A level-up can be announced to nobody (suspected, narrow)

`GET /missions` drains the durable level-up marker, and the shell prefetches that route once at
start, while only `/me` feeds the shell's level-up toast. A level crossed by a mission that resolves
inside that one prefetched request is drained and shown only if the Missions page is opened before
the cache entry is collected. `/me` polls every 5 seconds and usually drains first, so the window is
small. Options: have the prefetch hand a `levelUp` to the shell, or drain only on `/me`.

`apps/client/src/lib/queries.ts` (`usePrefetchScreens`), `apps/server/src/routes/missions.ts`.

### 46. The bars' measured heights would stay at zero if the shell ever mounted while loading

`GameScreen` measures the top and bottom bars once, on mount, and its "Loading district" branch
renders neither, so a shell first mounted on that branch would leave `--hud-h` and `--nav-h` at 0px
and every screen under the bars. Unreachable today (the boot gates prime `/me` first); a callback
ref in `useMeasuredHeight` would remove the trap.

`apps/client/src/screens/GameScreen.tsx`.

## Pass 8, 2026-10-06 (the UI building blocks, the API client, boot, the world tick, sign-in limits)

### 36. A fight settled after a restart is fought against the world at the restart

When the server was down across a fight's mark, the next settle brings gates, crews and breaches up
to now before it runs the fight: a gate raise, a recruit batch or a breach ending between the mark
and the restart already counts in that fight. Only raids read the world at the mark, and arriving
columns were fixed for the same reason (`battle/movement.ts`). The choice is between resolving each
fight as of its mark, which needs every stage readable "as of", and running the stages interleaved
in time order up to each mark.

`apps/server/src/world/settle.ts`, `apps/server/src/battle/resolve.ts`.

### 37. Anybody can keep an account's sign-in locked for as long as they like

The per-account lock counts misses against the typed username in a fixed 15-minute window and is
checked before the password, so ten wrong guesses each time the window rolls over keep the owner
out of new sign-ins indefinitely (players already signed in are unaffected). One address can hold
two accounts shut this way inside its own budget. Separately, the sign-in and register budget is
per address, so one player behind a carrier's shared address can use it up for everybody on it.
Options: count misses per account and address, let the right password through a lock that only a
foreign address built, or both.

`apps/server/src/limits/sign-in.ts`, `apps/server/src/limits/rules.ts`.

### 38. The migration runner trusts its own record

A pending migration that sorts before one already applied is applied out of order on an existing
save, and an applied name with no file left on disk goes unnoticed. The way it bites is a renumbered
migration after the dev server already ran it: the same `ADD COLUMN` stops boot, or the same
`UPDATE` runs twice. A few lines can detect both; the decision is whether to warn or refuse to
start, and whether the answer differs in development.

`apps/server/src/db/index.ts`.

### 39. The weekly regrowth can run before last week's fights are all settled

If one of last week's fights fails on the first tick after Monday 00:00, regrowth still runs and
claims the week, and the retried fight is fought against Monday's rebuilt garrison. Holding regrowth
back while any fight before the boundary is unresolved fixes that, but a fight that keeps failing
would then block regrowth for good. Needs a call on which failure is worse, or a cap on how long
regrowth waits.

`apps/server/src/world/settle.ts`.

### 40. A decimal typed into a number field reads ten times too big

Number fields keep digits only, so "2.5" becomes 25 and "1.5k" becomes 15, in caps and counts
alike. Either cut the figure at the decimal point (2.5 reads 2) or refuse the keystroke.

`apps/client/src/components/ui/NumberField.tsx`.

## Pass 7, 2026-10-06 (profiles, standings, the console, the cities wall, settling, /me)

### 33. `/me` redoes the same work about twenty times per poll

One `/me` scans every location control row about 21 times (each parsed), folds the crew's standing
6 times, and re-reads the user and Overseer for each lift room; every screen polls it every 5 s.
`productionRatesFor` and `productionYieldFor` each recompute the same yield. Separately, the muster
settle awards XP once per unit, so a full bench of 250 units runs 250 crew-effect folds and writes in
one settle. A per-request cache of the control map and the standing fold is the fix; it touches the
signature of most of the settle helpers, so it wants a decision on where the cache lives.

`apps/server/src/routes/me.ts`, `apps/server/src/district/settle.ts`, `apps/server/src/units/muster.ts`.

### 34. The standings scope label changes width as the board loads

"My city only (Ashfall)" loses and regains its "(Ashfall)" each time the board switches between
Players and Factions, because the city name comes off the board's own data, which is cleared on the
switch; the strip can re-wrap. Either reserve the space or take the name from the home city.

`apps/client/src/features/leaderboard/LeaderboardPage.tsx`.

### 35. One stored location level past the cap would stop every settle in the game

`rowToControl` parses every control row with no per-row guard, and `controls()` is read by every
settle. A future cut to `MAX_LOCATION_LEVEL` below a level already stored would throw on every read
of the map (migration 0111 shows that class of row has happened before). Nothing triggers it today;
clamping or skipping such a row on read would make it safe.

`apps/server/src/db/repos/city.ts`.

## Pass 6, 2026-10-06 (factions, standing orders, the roster, the shell, sleepers, the console)

### 29. A fight two mates are in is listed twice on the faction screen

`allyBattles` lists one row per member in a fight, which `project.test.ts` pins on purpose ("the
screen carries a row each"). The cards now have their own keys (fixed this pass), but the count
over the room doubles, and the chip for that fight opens two near-identical cards. Decide whether
the faction screen should show a shared fight once (under the member who called it or is being
attacked) or keep one row per member and count fights by id.

`apps/server/src/factions/project.ts`, `apps/client/src/features/faction/Fights.tsx`,
`apps/client/src/features/faction/Readings.tsx`.

### 30. A running standing order looks as if it names no officer

`GET /automations` lists only officers who are free, so while a slot's own party is out its leader
is missing from the list and the dropdown reads "Choose the officer who leads". Switching the slot
off then re-seeds the party with units not at home, which the editor cannot show. Adding the held
officer to the options is easy; how to show units that are out is a small UI call.

`apps/client/src/features/actions/AutomationsPage.tsx`, `apps/server/src/routes/automations.ts`.

### 31. The Right Hand runs hundreds of practice fights per send

For every candidate job the runner works out the free officers again (a duty query per officer),
and for every fight card it ranks every free officer by practice fights, though only the chosen
job's leader is used: about 550 engine fights and several hundred queries per send for a crew with
7 fight cards and 13 officers. `GET /automations`, polled every 5 s, repeats the per-officer duty
loop. Compute the free officers once per run and rank leaders only for the job picked.

`apps/server/src/automations/runners.ts`, `apps/server/src/routes/automations.ts`.

### 32. The console's ground grants skip the settle and some guards

`grantFootholds` and `mockBattleOn` write control rows directly rather than through `putControl`,
so the next settle pays production on the new ground back to the crew's previous settle; and
`mockBattleOn`'s spare plot can be a Combine leader's or ground with a fight already called on it,
and wipes its garrison. Testing build only.

`apps/server/src/routes/admin.ts`.

## Pass 5, 2026-10-06 (the market, feats, the Garage, the base panel, sign-in, live, backups)

### 24. A few accounts can hold the whole Overseer pool

Every account without an Overseer that opens the choices holds 4 of the 30 characters for 10
minutes, and a lapsed hold is replaced by a fresh 4. One address may register 20 accounts per 15
minutes, so 8 idle accounts re-reading the choices every 10 minutes keep the pool empty for every
real newcomer, and nothing ever removes accounts that never pick. Options: cap holds per address,
make an unclaimed hold cost something, or expire accounts that never choose.

`apps/server/src/routes/overseer.ts` (`offerFor`), `apps/server/src/limits/rules.ts`.

### 25. Every backup writes a history row that is never pruned

Each 2-minute snapshot records `backup.taken`, about 720 rows a day, and nothing prunes the history
table, so every snapshot copies a growing log of snapshots. Decide whether backup rows should be
pruned, or not recorded in history at all (the server log already has them).

`apps/server/src/index.ts`, `apps/server/src/db/repos/history.ts`.

### 26. The backup mirror on a missing mount writes to the local disk

`mirrorBackup` creates the mirror directory if it is missing, so a mirror meant for a mounted drive
that is not mounted quietly fills the local disk instead. A mirror failure is now logged on its own
and no longer reads as a failed snapshot (fixed this pass), but missed copies are never backfilled.
Decide whether the mirror should refuse a directory that does not already exist.

`apps/server/src/db/backup.ts`.

### 27. The burn notice and the level-up banner cover the build queue below 1280px

On the district screen below 1280px the build rail is a full-width strip, and the burn notice and
the level-up banner open at the same height over it, covering the middle orders and their cancel
marks; the burn lasts two hours and is bought exactly when there is a queue. The panel already
publishes `--scene-safe-top` for this rail; offsetting the notices by it should fix it, but the
house rule is that normal screens stay pixel-identical, so this wants a screenshot pass at both
widths. Whether the level-up banner gets its own dismiss is a small UI call.

`apps/client/src/features/base/BasePanel.tsx`.

### 28. Claiming the last ready rung under a filter moves the feats board

With "Unclaimed" (or "Shut") on, collecting a ladder's last ready rung filters that ladder out, so
its row disappears and the right pane jumps to the first ladder in the list. It may be the filter
working as designed; keeping the open ladder pinned until the player picks another is the
alternative.

`apps/client/src/features/feats/FeatsPage.tsx`.

## Pass 4, 2026-10-06 (the map, fights, deploying, the market board, feats)

### 20. A pending fight this build cannot read is skipped, and its units stay held

One unreadable pending battle (a retired defender or target kind) used to stop every fight in the
world from resolving. The reads now skip it with a warning, so the rest of the world runs, but that
one fight stays pending for ever with its deployments held. Abandoning it from the settle would
strand the units on it, since every cleanup path reads the fight through the same parser. Decide
whether a boot sweep should send such a fight's units home and close it, the way the closed-city
sweep does for ground.

`apps/server/src/db/repos/sieges.ts` (`readableBattles`), `apps/server/src/battle/resolve.ts`.

### 21. An ally that leaves the faction cannot pull its units out of a fight

`sideOf` (`battle/deploy.ts`) checks the crew's current alignment against the row's side, so an
ally that leaves the faction is refused (`not_a_participant`) on a withdrawal or on taking its
machines back, and its units are stuck until the mark walks them home. The likely answer is to let
any crew with a row withdraw and narrow, whatever its alignment now.

`apps/server/src/battle/deploy.ts`, `apps/server/src/battle/routes.ts`.

### 22. A settle that runs late treats the tick as the moment of the fight

The settle uses its own `now` for the officer's injury window, the walk home's departure, a raid's
disruption start and the standing folds, while the breach expiry and the gate reset were already
moved to the mark. After an outage from 20:00 to 23:00, a fight marked 20:30 lays its officer up
until 23:00 the next day and sends survivors off at 23:00. Decide which of these belong at the mark.

`apps/server/src/battle/resolve.ts` (`resolveOne`, `applyOutcome`).

### 23. The market sweep parses every open listing on every tick

`openIdsAskingNothing` reads and parses every open listing each second to find the empty ones, and
`claimsFor` runs one extra query per claim on `GET /market`. Small today; worth a narrower query or
a stored flag before launch.

`apps/server/src/market/board.ts`, `apps/server/src/db/repos/market.ts`.

## Pass 3, 2026-10-06 (crew, training, research, the Scrapyard, popups)

### 15. A dismantle names its bracket by position

The yard's dismantle sends a slot index read off the last `/me`, and the server closes the gap
behind a card it removes. Two dismantles in a row on stale data could take the wrong card. Every
yard button now waits while any yard write is in flight, which closes the window this pass found,
but the request itself is still positional: sending the modification's id with the slot (and the
server refusing a mismatch) needs a route change.

`apps/client/src/features/scrapyard/ScrapyardPage.tsx` (`slotOf`), the clear-modification route,
`packages/shared/src/building/addons.ts`.

### 16. The research and training reads fold the crew's standing four times per poll

`GET /research` (every 15 s) runs `standingEffectsFor` four times and `GET /training` (every 5 s)
two, plus two lift rooms; each fold scans every control row twice and reads each faction member's
base one by one. Roughly 100 queries per research poll per open tab. Build the research clock and
the effects once per request and pass them down. The same refactor should carry the request's
`now` into `researchClockFor`, the yard's `officerFitReader` calls and the training routes' folds,
which still read the wall clock (the build quotes and clocks were fixed this pass).

`apps/server/src/research/tracks.ts`, `apps/server/src/routes/training.ts`,
`apps/server/src/district/scrapyard.ts`, `apps/server/src/factions/cards.ts`.

### 17. Admin mode: the yard and the training floor do not know about it

The Scrapyard screen checks real affordability and parts, so in the testing build (admin on by
default) it shows "You cannot cover that" on builds the server would make for free. Training never
consults `adminWaives` at all, so "No sessions left today" and "The queue is full" still refuse in
admin mode, though `admin/mode.ts` says those are waived. Decide whether both should follow admin
mode.

`apps/server/src/district/scrapyard.ts` (`projectScrapyard`), `apps/server/src/routes/training.ts`.

### 18. A refused research start says less than the page does

`routes/research.ts` maps every gate to "Your people are not ready for that yet", and sends
`cannot_afford` as `INSUFFICIENT_CAPS` though a rung costs planks, scrap, supplies and metal too.
The exact reason (`itemBlocker`) exists and only tests use it. Worth deciding which sentence the
route should send.

`apps/server/src/routes/research.ts`, `apps/server/src/research/tracks.ts`.

### 19. The Blueprints unlock refusal sits below the fold

It renders under the whole document list in a scrolling workspace, so a refused unlock near the
top of the list shows its reason off screen. Move it to the row pressed, or above the list.

`apps/client/src/features/research/BlueprintsSection.tsx`.

## Pass 2, 2026-10-06 (missions, the Bar, moves, factions)

### 10. Switching city blanks the Missions and Bar screens for a moment

The city is part of the board's query key and nothing keeps the previous city's data while the new
one loads. On the first visit to another city, the city picker you just pressed disappears, the
"crews out" line goes, and both side panels read "Reading the board..." until the read lands. The
in-flight list is the same for every city, so that part is pure flicker. The Bar's picker does the
same.

Options: keep the previous city's data on screen until the new one answers (and decide what the
board shows meanwhile); or draw the picker from a read that is already loaded.

`apps/client/src/features/missions/MissionsPage.tsx`, `apps/client/src/features/bar/BarPage.tsx`.

### 11. The missions board read does the same expensive work several times

`GET /missions` (and the recall's answer) folds the crew's standing three times and the crew effects
four times, each fold reading every control row in the world, on a screen that polls. Not wrong,
just slow as the map grows. Worth computing each once per request; it touches several helpers'
signatures, so it is a small refactor rather than a fix.

`apps/server/src/routes/missions.ts`.

### 12. The move stage reads every pending fight twice per column

`settleMoves` calls `fightDueBefore` and then `landAt` calls `fightCalledOn`, and both parse the
whole pending list, for every column due. Read it once per stage and pass it down.

`apps/server/src/moves/moves.ts`.

### 13. The move quote does not check what the send would refuse

`/actions/move/quote` checks only what the crew has at the source, so it happily quotes a walk the
send then refuses (the same place, a shut city, ground somebody else holds). Harmless, but the
dialog shows a time for a move that cannot happen. Decide whether the quote should carry the
send's refusal.

`apps/server/src/battle/routes.ts`.

### 14. `whole-district.test.ts` failed once under load and never alone

"pays in a fight away from the district the crew holds whole" failed once in a full server run on
2026-10-06, then passed in the next full run and fifteen times in a row on its own. The fixture
declares both fights at the wall clock (`makeWorld`, `declare`, `aDayAfter`), so a run that crosses
a declaration-window or lock boundary mid-test is the likely cause; it was not reproduced, so this
is a guess. Pinning the clock with `vi.useFakeTimers` in that file would rule it out.

`apps/server/src/battle/whole-district.test.ts`, `apps/server/src/testing/fight-world.ts`.

## Pass 1, 2026-10-06 (Stackhouse, calling fights, spying, mustering, dialogs)

### 1. A bet on a faction mate's call is a free option

Bets close at the lock (an hour before the mark), and the under-strength rule judges the fight from
that same instant. Units can still be withdrawn until the lock. So a crew can bet 5,000 on its mate's
attack at one minute past the close, and if the defence looks bad, the mate pulls the attack under 20
unit slots before the lock: the fight is called off, it has no winner, and the stake comes back. If the
defence looks weak, the bet rides at twice the stake. The losing half of the bet never costs anything.

Options: a fight called off for strength settles bets as lost for the side that walked; or bets close
some time before the deployments can still be emptied.

`apps/server/src/blackmarket/stackhouse.ts` (`outcomeOf`), `apps/server/src/battle/understrength.ts`.

### 2. Cancelling a captured gate raise refunds whoever holds the district now

A captured gate raise stores what was paid, not who paid it. If crew A orders a raise just before
losing the district, crew B can cancel it inside the first tenth of the clock and receive 90% of A's
materials.

Options: store the payer and refund them; or refuse a cancel by anybody but the payer.

`apps/server/src/city/gates.ts` (`cancelGateRaise`), migration 0146.

### 3. The under-strength judgment runs for the whole last hour, not once at the lock

`insideLock` is true from the lock until the fight settles, so the call-off check reruns every tick
for an hour. A column sent just before the lock can still be turned round in its first tenth after the
lock, when the defender's line is frozen, and the next tick then voids the fight and refunds every
bet.

Options: judge once at the lock and remember it; or refuse to recall a fight column inside the lock.

`apps/server/src/battle/understrength.ts`, `apps/server/src/battle/movement.ts` (`recallColumn`).

### 4. Admin mode mints caps through the Stackhouse

In admin mode a bet is charged nothing (`adminCaps`) but the full stake is recorded, so a refund or a
win pays real caps. Admin mode is on by default outside the test runner, so dev saves accumulate caps
this way. Decide whether admin bets should record the stake actually charged (zero) or be refused.

`apps/server/src/blackmarket/stackhouse.ts` (`placeStackhouseBet`).

### 5. The Stackhouse bet window vanishes, taking its refusal with it

The window only renders while the fight is on the book, and the book is refetched after every bet,
refused or not. A refusal near the close (`closed`), or a bet already placed from another tab
(`bet_riding`), shows its message for one round trip and then the window disappears with no
explanation. The 5-second poll can also close it mid-confirmation when the fight leaves the book.
"Lock it in" also stays pressable after the close time, until the next poll.

Options: keep a copy of the fight in the window once opened, so it stays up until the player closes
it; or show the refusal on the panel itself.

`apps/client/src/features/market/Stackhouse.tsx`.

### 6. A refused muster pushes the whole unit catalogue down

The muster error note is inserted above the card grid, so a refusal (`cannot_afford` is common) moves
every card down by the note's height, and the player's pointer is no longer on the button they
pressed. The next successful order removes the note and the grid jumps back.

Options: show the refusal on the card that was pressed; or give the note a fixed slot that is always
reserved.

`apps/client/src/features/units/UnitsPage.tsx`.

### 7. Admin mode disables "Call it" when infamy is short, though the server waives the price

The declare dialog does not know admin mode waives the call price, so it disables the button. Needs
the client to know the price is waived (a field on the battles board, for example).

`apps/client/src/features/battle/DeclareDialog.tsx`, `apps/server/src/battle/declare.ts`.

### 8. Dialogs do not keep keyboard focus inside them

Focus now moves into a dialog when it opens (fixed this pass), but Tab can still leave it for the page
behind, and focus is not returned to the opener on close. Returning it would reopen the opener's hover
card (cards open on focus), so it needs a small design call: a full focus trap, and whether hover
cards should ignore programmatic focus.

`apps/client/src/components/ui/Modal.tsx`, `apps/client/src/components/ui/HoverCard.tsx`.

### 9. The Stackhouse reads run a query per fight and per faction member

`ourBaseIds` reads one base per faction member, and `openFights` resolves each side of each pending
fight up to three times, on every read and every bet. Fine at today's scale; worth one batched read
before launch.

`apps/server/src/blackmarket/stackhouse.ts`.
