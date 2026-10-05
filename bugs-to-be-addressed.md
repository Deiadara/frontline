# Bugs to be addressed

Findings that need a maintainer decision. Each entry: area, what happens, why it matters, options.

## Officers and their programmes (bug pass, 2026-09-29)

### 1. The Instructor of the Young's session rungs pay the officers' drills (closed 2026-10-04)

- **Area:** Section Leaders (+1) and The Intake (+2), `training_sessions`, spent as `extraTrainingSessions` on the Training tab (`routes/training.ts`).
- **What happened:** the track was "How fast a unit becomes a soldier" and both blurbs were about recruits becoming soldiers, but the payout was more hours a day on the officers' training floor.
- **Resolution:** the chair rework removed the Instructor of the Young. The Intake now sits on the Veteran's track and pays muster speed (16%), and Section Leaders is gone.
