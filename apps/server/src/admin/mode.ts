import type { PartialResources } from '@frontline/shared';

/**
 * Admin / testing mode: the whole game, immediately, without pretending the prices are different.
 *
 * The `UNLOCKED` sandbox raised one seeded account to the end state on boot. That answers "what does
 * level 20 look like" and nothing else: a reviewer still could not watch a build go up, because a
 * build takes hours, and could not try the same build twice, because the second one costs materials
 * the first one spent. This is the other half: a mode where **every clock is five seconds and
 * nothing is charged**, so a design pass can walk the whole game in an afternoon.
 *
 * Two rules make it a testing mode rather than a cheat:
 *
 * - **The interface still shows the real numbers.** A build still reads "4h 20m · 1,200 scrap", and
 *   the admin badge on the HUD is what explains why it finished in five seconds and cost nothing.
 *   A mode that also rewrote the prices would be a different game, and a reviewer judging the
 *   economy would be judging a screen the players never see.
 * - **Refusals still refuse.** Free is not the same as unconditional: a structure the Nexus does not
 *   authorise is still locked, a queue that is full is still full, and a unit that is not unlocked
 *   still is not. Only the *price* and the *clock* are overridden, because those are the two things
 *   that cost a reviewer an afternoon rather than telling them something.
 *
 * It is **on by default** (`ADMIN=false` turns it off) because the board asked for the testing build
 * to be the one you get by running the thing. The badge in the HUD is not decoration: an unmarked
 * free-and-instant build would be indistinguishable from a broken economy.
 */

/** What everything costs in time while admin mode is on. The board's number. */
export const ADMIN_ACTION_SECONDS = 5;

/**
 * The clock any queued action gets.
 *
 * A single seam every duration passes through, so "how long does a thing take in admin mode" has
 * one answer and one place to change it. The real duration is passed in and dropped on purpose:
 * scaling it would make a Nexus level still take minutes, which is the state this exists to skip.
 */
export function adminSeconds(realSeconds: number, admin: boolean): number {
  return admin ? ADMIN_ACTION_SECONDS : realSeconds;
}

/**
 * The same, for the systems that hold their clocks in minutes.
 *
 * Rounded up to a whole minute rather than to zero: research is settled off a `durationMinutes`
 * integer, and a project of length zero would complete inside the same request that started it,
 * which skips the running state a reviewer is often there to look at. One minute is the floor the
 * research module already imposes on itself.
 */
export function adminMinutes(realMinutes: number, admin: boolean): number {
  return admin ? Math.max(1, Math.ceil(ADMIN_ACTION_SECONDS / 60)) : realMinutes;
}

/**
 * What is actually taken out of the stockpile.
 *
 * Empty in admin mode, which every `spendResources` call treats as a no-op. The *quoted* cost is
 * untouched. This is applied at the moment of payment and nowhere earlier, so affordability checks,
 * the numbers on the button and the numbers in the tooltip all still come from the real price.
 */
export function adminCost(cost: PartialResources, admin: boolean): PartialResources {
  return admin ? {} : cost;
}

/**
 * The same, for the handful of costs quoted as a bare number of caps.
 *
 * Zero rather than "skip the charge", so a caller that subtracts it unconditionally still works and
 * no call site grows an `if`.
 */
export function adminCaps(caps: number, admin: boolean): number {
  return admin ? 0 : caps;
}

/**
 * The refusals admin mode waives (board. "I can do anything I want in admin mode").
 *
 * This is the second half of the mode, and it reverses an earlier decision on purpose. The rule
 * used to be "only the price and the clock are overridden; refusals still refuse", which is a
 * defensible testing mode and is not the one the board asked for: a reviewer who wants to look at
 * the Garage cannot, because the Garage is behind twelve Nexus levels, and telling them to spend
 * the afternoon buying those twelve levels is exactly the afternoon this mode exists to give back.
 *
 * What is waived is every gate that is a **rule about progress**: a structure the Nexus has not
 * authorised, a unit that is not unlocked, a queue that is full, a daily allowance that is spent, a
 * roster with no beds. What is *not* waived is anything that is a statement about **reality**: a
 * unit that does not exist, a level above the last one, a project already running, an officer
 * already hired, a role already filled. Waiving those does not open a door, it produces a district
 * that cannot be parsed on the next read, and a reviewer looking at a broken save learns nothing.
 *
 * Membership is stated once, here, rather than as an `if (admin)` beside each gate, so what admin
 * mode does is one list somebody can read, and a new refusal is closed by default.
 */
export const WAIVED_REFUSALS: ReadonlySet<string> = new Set([
  // Progress gates: this is behind something you have not built or reached yet.
  'locked',
  'option_locked',
  'nexus_cap',
  'requirement',
  /** §H3's other door: the crew level a recruit wants to see before they will sign. */
  'level',
  'modification_unavailable',
  'no_lead',
  'no_lead_engineer',
  'no_modification_slot',
  // Capacity gates: there is room for this, just not right now.
  'queue_full',
  'no_slots',
  'no_supply',
  'daily_limit',
  /** §H7: the payroll book has no room for another fee. A ceiling, like the beds and the slots. */
  'no_payroll',
  /**
   * §H7: the six hours after a walkout.
   *
   * A cooldown rather than a capacity, and waived for the same reason `daily_limit` is: on the
   * bench the point is to reach the state, and a reviewer who wanted to see what a marked-up
   * second negotiation looks like should not have to wait until this afternoon for it.
   */
  'standoff',
  // Price gates. `adminCost` already makes the charge zero; this is the check in front of it.
  'cannot_afford',
  'missing_parts',
  'not_enough_infamy',
]);

/**
 * Should this refusal be let through?
 *
 * Written as "the gate still applies" at the call sites, so a reader of a gate function sees the
 * rule and the exemption on the same line.
 */
export function adminWaives(reason: string, admin: boolean): boolean {
  return admin && WAIVED_REFUSALS.has(reason);
}
