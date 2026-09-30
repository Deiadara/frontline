# Bugs to be addressed

Findings that need a maintainer decision. Each entry: area, what happens, why it matters, options.

## Officers and their programmes (bug pass, 2026-09-29)

### 1. The Instructor of the Young's session rungs pay the officers' drills

- **Area:** Section Leaders (+1) and The Intake (+2), `training_sessions`, spent as `extraTrainingSessions` on the Training tab (`routes/training.ts`).
- **What happens:** the track is "How fast a unit becomes a soldier" and the two blurbs are about recruits becoming soldiers, but the payout is more hours a day on the officers' training floor, the same channel the Gym pays. Nothing on the track touches the unit queue apart from its speed and cost rungs.
- **Why it matters:** "+1 training session/day" on a track about units reads as a unit-queue bonus.
- **Options:** Deferred: the maintainer will rework this track later (2026-09-29).
