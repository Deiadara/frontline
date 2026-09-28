import type { RoomProfile } from '@frontline/shared';
import { roomProfileOf } from '../city/stakes.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The profile a city's room is poured at for one game day, frozen the first time anybody asks.
 *
 * The seats read the city's crews, and the crews move all day: a crew joining or levelling at noon
 * used to re-roll every chair, so the person a player bid on in the morning was not the person on
 * the card by the evening, and the close rebuilt a third. Whichever comes first, the read route, a
 * bid or the close, writes the day's profile, and every later caller rebuilds the room from it. A
 * crew that levels today changes tomorrow's room.
 *
 * A table from a day that was never frozen (bid on before `bar_rooms` existed) is settled against
 * the city as it stands at the close, which is what every close did before.
 */
export function barRoomOf(repos: Repositories, cityId: string, day: string): RoomProfile {
  const frozen = repos.bar.room(day, cityId);
  if (frozen !== null) return frozen;
  const live = roomProfileOf(repos, cityId);
  repos.bar.freezeRoom(day, cityId, live);
  return live;
}
