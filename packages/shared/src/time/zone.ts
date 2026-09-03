import { z } from 'zod';

/**
 * What time it is, and whose time that is.
 *
 * The game is run out of Greece, so **Europe/Athens is the game's clock**: every schedule, every
 * refresh and every "he is in at 18:00" is quoted in it unless a player says otherwise. That is a
 * deliberate design choice rather than a shrug at internationalisation: a shared world needs a
 * shared day, and "the black market turns over at midnight" only means something if everybody's
 * midnight is the same one. A player in another timezone can move the *display* to theirs; the day
 * boundary the rules use does not move with them.
 *
 * Two rules underneath that, and both are the standard advice:
 *
 * - **Store and transmit UTC.** Every timestamp on the wire is an ISO-8601 instant; nothing is ever
 *   persisted in a local wall clock. A stored local time is ambiguous twice a year and wrong
 *   forever once a government moves a boundary.
 * - **Carry an IANA name, never an offset.** `Europe/Athens` knows about summer time; `UTC+02:00`
 *   does not, and a player who picked the offset in January is an hour out in July.
 *
 * Formatting goes through `Intl.DateTimeFormat`, which ships in every browser and in Node and needs
 * no table of its own. The one thing it will not do is tell you whether a zone name is real, so
 * {@link isValidTimezone} asks it to construct a formatter and watches for the throw.
 */

/** The clock the rules run on. Everything a player sees defaults to this. */
export const GAME_TIMEZONE = 'Europe/Athens';

/**
 * The zones offered in Settings.
 *
 * A picker listing all ~400 IANA names is a picker nobody scrolls. This is one entry per populated
 * band, Athens first because it is the house clock, and any other valid IANA name still parses if
 * it arrives from somewhere else: the list is a convenience, not the validation.
 */
export const OFFERED_TIMEZONES = [
  GAME_TIMEZONE,
  'UTC',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Berlin',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
] as const;

/** Whether `Intl` recognises this as a real IANA zone. The only honest way to ask. */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * An IANA zone name, checked against the runtime's own tz database rather than against a list.
 *
 * A hardcoded enum would reject a zone the player's browser knows about, and would need editing
 * every time a country splits one. The refusal message names the field because this arrives from a
 * settings form where three other things could also have been wrong.
 */
export const TimezoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimezone, 'Not a recognised timezone name');
export type Timezone = z.infer<typeof TimezoneSchema>;

/** Formatter cache. `Intl.DateTimeFormat` is expensive to build and every clock rebuilds one. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${zone}|${JSON.stringify(options)}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  // An unknown zone falls back to the house clock rather than throwing. A settings row written
  // before a tz database update should show the wrong city, not take the screen down.
  const built = new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: isValidTimezone(zone) ? zone : GAME_TIMEZONE,
  });
  formatters.set(key, built);
  return built;
}

/** `18:30`: a wall clock in the given zone. */
export function formatClock(instant: Date, zone: string = GAME_TIMEZONE): string {
  return formatter(zone, { hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
}

/** `Sat 16 Aug, 18:30`: a clock with enough date on it to survive a day boundary. */
export function formatDayClock(instant: Date, zone: string = GAME_TIMEZONE): string {
  return formatter(zone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * `GMT+3`: the short name the zone is going by at that instant.
 *
 * At that instant on purpose: the same zone is `GMT+2` in winter, and a label frozen at one of them
 * is a label that lies for half the year.
 */
export function zoneLabel(instant: Date, zone: string = GAME_TIMEZONE): string {
  const parts = formatter(zone, { timeZoneName: 'shortOffset', hour: '2-digit' }).formatToParts(
    instant,
  );
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC';
}

/** `Athens`: the last segment of the zone name, which is the part a player reads as a place. */
export function zoneCity(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/**
 * The calendar date at that instant *in that zone*, as `YYYY-MM-DD`.
 *
 * This is the game's unit of a day, and it is why the black market turns over at Athens midnight
 * rather than at UTC midnight. Built out of `formatToParts` rather than by shifting the instant by
 * an offset: an offset is only correct until a summer-time boundary, and the day either side of one
 * is exactly the day somebody notices.
 */
export function dayInZone(instant: Date, zone: string = GAME_TIMEZONE): string {
  const parts = formatter(zone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')}`;
}

/** The hour of the wall clock in that zone, 0..23. */
export function hourInZone(instant: Date, zone: string = GAME_TIMEZONE): number {
  return Number(formatter(zone, { hour: '2-digit', hour12: false }).format(instant));
}

/**
 * The instant the game day containing `instant` rolls over.
 *
 * Found by search rather than by arithmetic, for the summer-time reason above: on the night a zone
 * moves its clocks, "midnight plus 24 hours" is 23 or 25 hours away. Stepping an hour at a time from
 * a point safely inside the day and stopping at the first hour whose date differs costs at most 26
 * comparisons and is correct on every boundary.
 */
export function nextDayBoundary(instant: Date, zone: string = GAME_TIMEZONE): Date {
  const today = dayInZone(instant, zone);
  const HOUR = 3_600_000;
  let probe = instant.getTime();
  for (let step = 0; step < 30; step++) {
    probe += HOUR;
    if (dayInZone(new Date(probe), zone) !== today) break;
  }
  // Walk back to the exact minute the date flips, so a countdown to the refresh is not up to an
  // hour early. Minute resolution is all any clock in this game shows.
  let back = probe;
  for (let step = 0; step < 60; step++) {
    const earlier = back - 60_000;
    if (dayInZone(new Date(earlier), zone) === today) break;
    back = earlier;
  }
  return new Date(back);
}

/**
 * An hour-of-the-UTC-day, rendered as a wall clock in another zone.
 *
 * Kept for anything that genuinely holds a UTC hour. Nothing in the rules does any more: the
 * schedules that used to be drawn in UTC hours are drawn in game hours now, and those render
 * through {@link gameHourInZone}.
 */
export function utcHourInZone(day: string, utcHour: number, zone: string = GAME_TIMEZONE): string {
  return formatClock(new Date(`${day}T${String(utcHour).padStart(2, '0')}:00:00.000Z`), zone);
}

/**
 * The same wall clock, read back as an instant.
 *
 * `Date.UTC` of the parts a zone formatter produced is the wall clock pretending to be UTC, so the
 * difference between that and the instant it came from is the zone's offset at that instant. Two
 * passes, because the offset has to be sampled somewhere and the first sample can land on the
 * wrong side of a summer-time boundary: the second sample is taken at the answer the first one
 * gave, which is inside the correct offset in every case except a wall clock that does not exist.
 */
function offsetMsAt(instant: Date, zone: string): number {
  const parts = formatter(zone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour12: false` still renders midnight as 24 in some ICU versions; Date.UTC normalises it.
  return (
    Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second')) -
    instant.getTime()
  );
}

/**
 * The instant at which it is `hour:00` on `day` in `zone`.
 *
 * The inverse of {@link dayInZone} plus {@link hourInZone}, and the thing any schedule authored in
 * game hours needs to turn itself into an absolute instant. `hour` may run past 23, which is how a
 * session that closes at the end of the day says "midnight tomorrow" without the caller doing date
 * arithmetic of its own.
 *
 * On the one hour a year that a spring-forward deletes, the wall clock asked for does not exist and
 * this returns the instant the clock jumped to. That is the only sane answer and it is an hour
 * nothing in the game is scheduled against twice.
 */
export function instantAtHourInZone(day: string, hour: number, zone: string = GAME_TIMEZONE): Date {
  const asIfUtc = Date.parse(`${day}T00:00:00.000Z`) + hour * 3_600_000;
  const first = asIfUtc - offsetMsAt(new Date(asIfUtc), zone);
  return new Date(asIfUtc - offsetMsAt(new Date(first), zone));
}

/**
 * An hour of the *game* day, rendered as a wall clock in another zone.
 *
 * The rules' schedules are authored in game hours (§ the house clock above), and a player who has
 * moved their display to Tokyo still has to be told when the Runner is in, in Tokyo. The day is
 * passed rather than derived because an hour on its own cannot say which side of a summer-time
 * boundary it falls.
 */
export function gameHourInZone(
  day: string,
  gameHour: number,
  zone: string = GAME_TIMEZONE,
): string {
  return formatClock(instantAtHourInZone(day, gameHour, GAME_TIMEZONE), zone);
}
