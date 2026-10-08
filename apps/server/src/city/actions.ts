import {
  MAX_LOCATION_LEVEL,
  clearedGroundState,
  findLocation,
  type LocationControl,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { settleBasesById } from '../district/settle.js';
import { settleEach } from '../world/guard.js';
import { tallyLocationLevelRaised } from '../feats/tally.js';
import { dropGateRaise } from './gates.js';

/**
 * Doing things to the city (GDD §A4): what is left of it here is the upgrade clock on held ground.
 *
 * It used to open with a promise that forces would one day walk. They do: every unit that goes
 * anywhere is a column on the clock (`moves/moves.ts`, `battle/movement.ts`), and the instant
 * garrison door that was the last thing here to skip the road is gone.
 */

/**
 * Finishes any location upgrade whose clock has run out.
 *
 * Called at the top of every city read and write, which is the same lazy contract the rest of the
 * game runs on, and by the world clock. Returns the controls it settled so callers do not read them
 * twice. It settled dug-in fortification on the same row as well, until fortification left the game
 * (maintainer, 2026-09-26).
 */
export function settleLocationUpgrades(
  repos: Repositories,
  now: Date,
): Map<string, LocationControl> {
  const controls = repos.city.controls();
  const finished = [...controls.values()].filter(
    (control) =>
      control.upgradingUntil !== null && Date.parse(control.upgradingUntil) <= now.getTime(),
  );
  /*
   * Not ahead of a fight on the same ground that came first (bug pass, 2026-10-06). Upgrades settle
   * before battles in the world's settle, so after a restart over both, work due at 21:05 banked
   * its level before the 21:00 capture that should have taken it, and the captor inherited it.
   * Such an upgrade waits for that fight; if the ground is still the holder's after it, the next
   * settle banks it. Read only when something is due, because this runs on every read path.
   */
  const firstFight = new Map<string, number>();
  if (finished.length > 0) {
    for (const battle of repos.sieges.pending()) {
      if (battle.target.kind !== 'location') continue;
      const mark = Date.parse(battle.scheduledFor);
      const known = firstFight.get(battle.target.locationId);
      if (known === undefined || mark < known) firstFight.set(battle.target.locationId, mark);
    }
  }
  const due = finished.filter((control) => {
    const fight = firstFight.get(control.locationId);
    return fight === undefined || fight > Date.parse(control.upgradingUntil ?? '');
  });
  settleEach(
    repos,
    'location upgrades',
    due,
    (control) => control.locationId,
    (control) => {
      const settled: LocationControl = {
        ...control,
        level: Math.min(MAX_LOCATION_LEVEL, control.level + 1),
        upgradingUntil: null,
      };
      /*
       * Settled up to when the work landed, not to the tick (bug pass, 2026-10-06): after a restart
       * the holder was paid the old level for the whole downtime past it. The settle never walks
       * backwards, so a crew already read past this instant is not paid twice.
       */
      const landedAt = new Date(
        Math.min(now.getTime(), Date.parse(control.upgradingUntil ?? now.toISOString())),
      );
      putControl(repos, settled, landedAt);
      controls.set(control.locationId, settled);
      // P8-C: counted for whoever holds the ground when the work lands.
      if (settled.holder.kind === 'crew' && settled.level > control.level) {
        tallyLocationLevelRaised(repos, settled.holder.baseId);
      }
    },
  );
  return controls;
}

/*
 * `setGarrison` was here, the whole of `POST /city/garrison`, and it went with the route
 * (maintainer, 2026-09-28: "Nothing sends units immediately, you need to move them"). It put units
 * on a held location, or brought them home, in the same instant and across cities. Standing units on
 * ground is a move now (`moves/moves.ts`), which walks, and the rules this door enforced (a porter
 * is not a line, a legend will not stand for a nobody, nothing leaves in a fight's last hour) are
 * `sendMove`'s. `CITY_REFUSALS` went with it: nothing else returned one.
 */

/**
 * Writes a location's control row, settling first every crew whose output the write moves.
 *
 * Ground pays its holder by the hour (`perHour` and `resourceYieldPercent` in the standing fold),
 * and production is lazy: it is priced at the crew's next read against whatever it holds *then*.
 * A change of holder or level written without a settle was applied to the whole window since
 * each crew last looked, so the crew that took a Gas Station was paid for the hours before it
 * did, and the crew that lost it lost those hours too (audit, 2026-09-28). Both crews are settled
 * against the row as it stands, then the row is written.
 *
 * The settle writes the crews' rows, so a caller holding a copy of either must re-read it after.
 *
 * Ground that changes hands loses its work in progress (maintainer, 2026-10-06): the location's own
 * upgrade, and any raise of its district's captured gate, are called off and nobody is refunded.
 * A raise stores what was paid and not who paid it, so a crew that took the last plot of a district
 * could cancel the loser's raise inside its first tenth and pocket ninety percent of it. Here
 * because this is the one door every change of holder goes through: a fight, a claim on arrival,
 * the console's grants.
 */
export function putControl(repos: Repositories, next: LocationControl, now: Date): void {
  const before = repos.city.control(next.locationId);
  const changesHands = before !== undefined && holderKey(before) !== holderKey(next);
  if (before && (changesHands || before.level !== next.level)) {
    settleBasesById(repos, [holderOf(before), holderOf(next)], now);
  }
  if (!changesHands) {
    repos.city.put(next);
    return;
  }
  /*
   * Arca's ground state is the holder's and goes with them (2026-10-07): the tower's switch
   * falls open, the wall's pins come down and unlock for the taker, and the trophy count starts
   * again from this instant. A level change alone keeps all of it: the pins unlock on their own
   * because `pamphletsPinnedAt` is now below the level (`pamphletsUnlocked`).
   */
  repos.city.put({
    ...next,
    upgradingUntil: null,
    upgradePaid: null,
    ...clearedGroundState(now),
  });
  // Only when the ground was a crew's: walking onto open ground takes nobody's work, and the
  // regime raises no gates.
  const districtId = findLocation(next.locationId)?.districtId;
  if (districtId && before?.holder.kind === 'crew') dropGateRaise(repos, districtId);
}

/** Who holds it, told apart even when nobody's crew does: the regime, the looters, open ground. */
function holderKey(control: LocationControl): string {
  return control.holder.kind === 'crew' ? `crew:${control.holder.baseId}` : control.holder.kind;
}

function holderOf(control: LocationControl): string | null {
  return control.holder.kind === 'crew' ? control.holder.baseId : null;
}
