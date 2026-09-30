import {
  missionCompletesAt,
  type Base,
  type Commander,
  type MissionLeader,
  type Overseer,
} from '@frontline/shared';
import { officerDuty } from '../crew/duty.js';
import {
  liftedOfficerSheet,
  liftedOverseerSheet,
  officerLiftRoom,
  standingEffectsFor,
  type LiftRoom,
} from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import type { StoredMission } from '../db/repos/missions.js';

/**
 * Everybody who could lead a run (maintainer, 2026-09-10).
 *
 * The Overseer first and always: they are the leader every crew has from the first day, which is
 * what makes "every run has a leader" (2026-09-28) a rule no crew can be locked out by. Then every
 * officer on the books, in the order the roster holds them, so the list a player scrolls is the
 * list they already know.
 *
 * Names and sheets only. {@link leadersFor} is the same list with one reason each for whoever
 * cannot go today; the launch takes this one, because all it needs from the bench is to turn an
 * id into a person, and it works out whether that person is free *after* it has settled.
 */
/**
 * A person who could lead a run, with no reason attached yet.
 *
 * `arrivalPercent` is off this list as well as the holds, because it is a fact about a *run* and
 * not about the person: the launch reads it off the crew and gates it on whether an officer is
 * leading. `leadersFor` fills it in for the screen; the launch works it out for itself.
 */
export type BenchMember = Omit<MissionLeader, 'held' | 'heldUntil' | 'arrivalPercent'>;

/**
 * The sheet each person leads on is their **lifted** one (maintainer, 2026-09-29): the ground,
 * the Overseer's and the peers' teaching perks, the Right Hand, Shared Knowledge and the Lab, the
 * same figures the crew screen draws. It read the printed sheet, so a Raid Boss taught +5 Strength
 * fought and was graded exactly as before the lesson while the crew screen showed the 25.
 *
 * `room` is required rather than defaulted so that no caller can quietly lead on the card again.
 * One room serves the whole bench, and the quote, the launch and the settle all build one, so the
 * odds a player reads are the odds the run freezes.
 */
export function benchFor(
  overseer: Overseer | undefined,
  commanders: readonly Commander[],
  room: LiftRoom,
): BenchMember[] {
  const bench: BenchMember[] = overseer
    ? [
        {
          id: overseer.id,
          name: overseer.name,
          kind: 'overseer',
          attributes: liftedOverseerSheet(overseer.attributes, room),
        },
      ]
    : [];
  for (const officer of commanders) bench.push(officerAsLeader(officer, room));
  return bench;
}

/** One officer as they lead: their name and their lifted sheet. See {@link benchFor}. */
export function officerAsLeader(officer: Commander, room: LiftRoom): BenchMember {
  return {
    id: officer.id,
    name: officer.name,
    kind: 'officer',
    attributes: liftedOfficerSheet(officer, room).attributes,
  };
}

/** The bench off a room built for this crew at `now`, for callers that have no room in hand. */
export function liftedBenchFor(
  repos: Repositories,
  base: Base,
  overseer: Overseer | undefined,
  now: Date,
): BenchMember[] {
  return benchFor(overseer, base.commanders, officerLiftRoom(repos, base, now));
}

/**
 * The active run this leader is out on, or null.
 *
 * The join between a person and a mission row, and the only place it is spelled: the Overseer is
 * out when an active run says `overseerLed`, an officer when one names them.
 */
export function runLedBy(
  leader: Pick<MissionLeader, 'id' | 'kind'>,
  active: readonly StoredMission[],
): StoredMission | null {
  return (
    active.find((entry) =>
      leader.kind === 'overseer'
        ? entry.mission.overseerLed
        : entry.mission.officerId === leader.id,
    ) ?? null
  );
}

/**
 * The bench with one reason each for whoever is not free.
 *
 * `held` is the one fact the screen cannot work out for itself. For an officer it is
 * {@link officerDuty}, the same question the dispatch routes ask before they refuse, so a dimmed
 * row and a 409 never disagree about why. **The Overseer is held by a run they lead and by nothing
 * else**: they are not on the books, so no declared fight can name them, and §D4's injuries belong
 * to officers. That is why their half is the run join alone.
 *
 * `heldUntil` is the mark they are free at where one exists. A declared fight has none until it
 * settles, which is the one hold the screen can only describe.
 */
export function leadersFor(args: {
  repos: Repositories;
  base: Base;
  overseer: Overseer | undefined;
  /** The crew's active runs. Resolved ones say nothing about who is free today. */
  active: readonly StoredMission[];
  now: Date;
}): MissionLeader[] {
  /*
   * §D5: what a leader takes off the road, on the wire so the send dialog can quote the run.
   *
   * The launch spends `leadArrivalPercent` only when an **officer** leads and never for the
   * Overseer (`routes/missions.ts`), so that gate is repeated here rather than shipping one figure
   * and hoping the screen remembers the rule. It is a crew-wide fold rather than a per-officer
   * one, which is how the launch reads it too: a perk on anybody's sheet shortens a road anybody
   * on the books walks.
   *
   * Without this the dialog could not see the cut at all, and quoted a run led by somebody with
   * Short Way up to ten per cent long. See `MissionOfferSchema.rawTravelMinutes`.
   */
  const arrival = Math.max(
    0,
    standingEffectsFor(args.repos, args.base, args.now).leadArrivalPercent,
  );

  return liftedBenchFor(args.repos, args.base, args.overseer, args.now).map((leader) => {
    if (leader.kind === 'overseer') {
      const run = runLedBy(leader, args.active);
      return {
        ...leader,
        arrivalPercent: 0,
        held: run ? 'run' : null,
        heldUntil: run ? missionCompletesAt(run.mission).toISOString() : null,
      };
    }
    const officer = args.base.commanders.find((held) => held.id === leader.id);
    const duty = officer ? officerDuty(args.repos, args.base, officer, args.now) : null;
    return {
      ...leader,
      arrivalPercent: arrival,
      held: duty?.held ?? null,
      heldUntil: duty?.until ?? null,
    };
  });
}
