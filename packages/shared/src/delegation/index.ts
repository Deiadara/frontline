/**
 * Who is running a job (GDD §G6).
 *
 * This directory used to hold the **assignee pool**: a fungible unit count granted by player level,
 * placed under officers, paying a percentage off a mission's clock and onto its odds. The pool is
 * gone, and with it the placement map, the §G7 bonus table, the §G3 per-officer cap and the §G4
 * reskilling path. It was a second staffing economy sitting on top of the officers, priced in a
 * currency the player could not see and never chose to spend.
 *
 * The officer gate that replaced it is gone too (maintainer, 2026-09-10). "Hard work needs an officer"
 * was a yes/no door on one authored flag, and it has been replaced by a question every job asks:
 * who is leading this, and what are they good at. That lives in `missions.leading.ts`. What is
 * left here is the difficulty enum itself, which the templates, the board and the page prize all
 * still read.
 */
export * from './delegation.js';
