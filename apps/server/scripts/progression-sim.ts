/**
 * One crew played from level one, on the real rules, to see whether the mission ladder holds up
 * (maintainer, 2026-09-28: "simulate going through the entire game and see that the missions make
 * sense, the progress makes sense and the pool works with different levels").
 *
 * What is real: the boards (`missionOffers` at the crew's level, on the day's keys), the grades,
 * the odds (`missionOdds` against the leader's grade for the job), the clock, the XP and the level
 * curve, the fight premium (`missionXp` through `fightPayFactor`), the Bar's own recruits
 * (`barRoster`), the officer slots a level grants (`officerSlotsAt`: none before the Bar, one at
 * level 5, another every two levels), the infamy a won raid on Combine ground pays
 * (`infamyForRaidWon`), and the training rules (one bench, five hours a day, two points a session
 * and one above fifty, never the same attribute twice running).
 *
 * What is a model, and says so: how long a player is on each day, which job they pick (the best
 * expected XP an hour with the best free leader), how often they hire, and where their training
 * hours go (the attribute that lifts the most-dealt leanings most). In `mixed` mode one crew takes
 * fights: the army is assumed to be one that wins them `FIGHT_WIN` of the time (the fight itself is
 * not simulated), and a win kills `KILLED_ON_WIN` of the enemy's unit slots, a loss `KILLED_ON_LOSS`,
 * which is what pays infamy, and every other day it calls a fight on Combine ground
 * (`DECLARED_EVERY_DAYS`). Every point of infamy is spent on the next rank as soon as it covers it.
 * XP from buildings, research, drills, hires, declared fights and feats is left out, so a real crew
 * runs a little ahead. Feats pay no infamy, so leaving them out costs the rank ladder nothing.
 *
 * A leader leads one job at a time across every crew: the first version cleared the busy set per
 * crew, so one officer ran every slot at once and the pace read faster than the game allows.
 *
 *   pnpm --filter @frontline/server exec tsx scripts/progression-sim.ts [days] [hoursPerDay] [deal] [plain|mixed]
 */
import {
  ATTRIBUTE_NAMES,
  FAILED_MISSION_XP_SHARE,
  GRADES,
  GRADE_ENEMY_STRENGTH,
  gradePeakLevel,
  IMPORTANCE_WEIGHT,
  MAX_ATTRIBUTE,
  MISC_AREA_ID,
  OVERSEER_PRESETS,
  TRAININGS_PER_DAY,
  MAX_NOTORIETY,
  NOTORIETY_TIERS,
  infamyForKills,
  infamyForRaidWon,
  missionInfamyForKills,
  officerSlotsAt,
  notorietyUpgradeCost,
  TRAINING_GAIN,
  TRAINING_HALF_GAIN_FROM,
  composeProfile,
  concurrentMissionSlots,
  fieldStrength,
  gradeIndex,
  leaderGradeIndex,
  leaningsFor,
  missionOdds,
  missionOffers,
  missionXp,
  playerXpToNextLevel,
  templateTimings,
  districtsOfCity,
  DEFAULT_CITY_ID,
  mulberry32,
  flatRoom,
  type Attributes,
  type AttributeName,
  type AttributeImportance,
  type DealtJob,
  type MissionProfile,
} from '@frontline/shared';
import { barRoster } from '../src/bar/roster.js';
import { enemyForce } from '../src/missions/enemy.js';

const DAYS = Number(process.argv[2] ?? 120);
const HOURS_PER_DAY = Number(process.argv[3] ?? 6);
/**
 * What-if for the deal only: `level` deals as the real rule does, a number deals as a crew at
 * that share of its level would, and `leader` deals round the crew's own best leader instead.
 */
const DEAL = process.argv[4] ?? 'level';
/** `plain` sends plain work only; `mixed` puts one crew on fights. */
const MODE = process.argv[5] ?? 'mixed';
/** The fight model: how often the army wins, and how much of the enemy it kills either way. */
const FIGHT_WIN = 0.85;
const KILLED_ON_WIN = 0.75;
const KILLED_ON_LOSS = 0.35;
/**
 * And a fight it calls itself every so many days on Combine ground, in `mixed` mode: the garrison
 * killed at a point a slot (sized like the day's hardest fight card) and what a won raid on an
 * ordinary Combine site pays on top. It used to add the site's 40 alone and miss the 25 every won
 * raid pays.
 */
const DECLARED_EVERY_DAYS = 2;
const GOVERNMENT_SITE_INFAMY = infamyForRaidWon({ fromTheState: true, seatOfPower: false });
/**
 * How often the crew signs somebody, and how many officers its payroll book is assumed to carry.
 * The level's slots are the other ceiling (`officerSlotsAt`), and the lower of the two binds. The
 * pace barely feels the book: 3, 5, 8 and 12 officers all put level ninety within two days of each
 * other (measured 2026-10-01), because two or three crews out at once need few leaders.
 */
const HIRE_EVERY_DAYS = 3;
const PAID_OFFICERS = 5;

interface Leader {
  name: string;
  attributes: Attributes;
  lastDrilled: AttributeName | null;
  /** Minute of the day this leader is next free, across every crew. */
  freeAt: number;
}

const rng = mulberry32(20260928);
const contested = districtsOfCity(DEFAULT_CITY_ID).filter((d) => d.kind === 'contested');

/** The boards open to a crew at this level: misc, and one more district every eight levels. */
function areasAt(level: number): string[] {
  const districts = Math.min(contested.length, 2 + Math.floor(level / 8));
  return [MISC_AREA_ID, ...contested.slice(0, districts).map((d) => d.id)];
}

const dayKey = (day: number) => `sim-day-${String(day)}`;

function bestLeaderFor(job: DealtJob, leaders: readonly Leader[], at: number) {
  // A fight leans on the fight alone (maintainer, 2026-09-28).
  const profile = composeProfile(
    job.template.kind === 'battle' ? ['fight'] : leaningsFor(job.template),
  );
  let best: { leader: Leader; index: number } | null = null;
  for (const leader of leaders) {
    if (leader.freeAt > at) continue;
    const index = leaderGradeIndex(leader.attributes, profile);
    if (best === null || index > best.index) best = { leader, index };
  }
  return best;
}

/** Unit slots in the force a fight of this grade fields, off a fixed seed per card. */
function enemySlots(job: DealtJob, day: number): number {
  const army = enemyForce(job.grade, `sim:${String(day)}:${job.template.id}`);
  return infamyForKills(army);
}

function worthPerHour(job: DealtJob, chance: number): number {
  const minutes = templateTimings(job.template, job.grade).totalMinutes;
  const xp = missionXp(job.template, minutes, job.grade);
  const expected = xp * (chance + (1 - chance) * FAILED_MISSION_XP_SHARE);
  return expected / (minutes / 60);
}

/** Where the day's training goes: the attribute that lifts the most-dealt leanings most. */
function train(leaders: Leader[], profiles: readonly MissionProfile[]): void {
  const weightOf = new Map<AttributeName, number>();
  for (const profile of profiles) {
    for (const [name, importance] of Object.entries(profile) as [
      AttributeName,
      AttributeImportance,
    ][]) {
      weightOf.set(name, (weightOf.get(name) ?? 0) + IMPORTANCE_WEIGHT[importance]);
    }
  }
  for (let session = 0; session < TRAININGS_PER_DAY; session += 1) {
    let pick: { leader: Leader; name: AttributeName; score: number } | null = null;
    for (const leader of leaders) {
      for (const name of ATTRIBUTE_NAMES) {
        if (name === leader.lastDrilled) continue;
        const value = leader.attributes[name];
        if (value >= MAX_ATTRIBUTE) continue;
        const gain = value >= TRAINING_HALF_GAIN_FROM ? 1 : TRAINING_GAIN;
        const score = (weightOf.get(name) ?? 0) * gain;
        if (pick === null || score > pick.score) pick = { leader, name, score };
      }
    }
    if (!pick) return;
    const value = pick.leader.attributes[pick.name];
    pick.leader.attributes = {
      ...pick.leader.attributes,
      [pick.name]: Math.min(
        MAX_ATTRIBUTE,
        value + (value >= TRAINING_HALF_GAIN_FROM ? 1 : TRAINING_GAIN),
      ),
    };
    pick.leader.lastDrilled = pick.name;
  }
}

/**
 * Signs the best person in the room, and once the books are full, lets the weakest officer go for
 * them when they are better: a crew keeps its leaders up to what the Bar now offers. The Overseer
 * is never let go.
 */
function hire(leaders: Leader[], day: number, level: number, profiles: readonly MissionProfile[]) {
  // A city of one: the room is pitched at this crew's level and rank, and it may only sign
  // somebody whose rank door it clears and whose infamy ask its wallet covers.
  const room = barRoster(`2026-10-${String(day)}`, flatRoom(level, rank)).filter(
    (one) => one.requirement.minNotoriety <= rank && one.requirement.minInfamy <= infamy,
  );
  if (room.length === 0) return;
  const score = (attributes: Attributes) =>
    profiles.reduce((sum, profile) => sum + leaderGradeIndex(attributes, profile), 0);
  const best = room.reduce((top, one) =>
    score(one.attributes) > score(top.attributes) ? one : top,
  );
  const recruit = { name: best.name, attributes: best.attributes, lastDrilled: null, freeAt: 0 };
  // The Overseer is `leaders[0]` and holds no officer slot.
  if (leaders.length - 1 < Math.min(officerSlotsAt(level), PAID_OFFICERS)) {
    leaders.push(recruit);
    return;
  }
  const officers = leaders.slice(1);
  // Below the Bar's level there is no slot to fill and nobody to swap out.
  if (officers.length === 0) return;
  const weakest = officers.reduce((low, one) =>
    score(one.attributes) < score(low.attributes) ? one : low,
  );
  if (score(best.attributes) > score(weakest.attributes)) {
    leaders.splice(leaders.indexOf(weakest), 1, recruit);
  }
}

/** The level the boards are dealt at under the what-if, off the crew's level and its leaders. */
function dealLevelFor(level: number): number {
  if (DEAL === 'level') return level;
  if (DEAL === 'leader') {
    // The level whose deal is centred on the crew's best leader for its average job.
    const index = Math.max(
      ...leaders.map((one) =>
        leaderGradeIndex(one.attributes, composeProfile(['haul', 'salvage', 'talk'])),
      ),
    );
    const grade = GRADES[Math.max(0, Math.min(GRADES.length - 1, Math.round(index)))]!;
    return Math.min(level, gradePeakLevel(grade));
  }
  return Math.max(1, Math.round(level * Number(DEAL)));
}

const overseer = OVERSEER_PRESETS[0]!;
const leaders: Leader[] = [
  { name: overseer.name, attributes: overseer.attributes, lastDrilled: null, freeAt: 0 },
];

let level = 1;
let xpInto = 0;
let infamy = 0;
let rank = 0;
const rankAt = new Map<number, number>();
let totalRuns = 0;
const reachedAt = new Map<number, number>();
const rows: string[] = [];
const seenTemplates = new Set<string>();

for (let day = 1; day <= DAYS; day += 1) {
  // The boards this crew reads today, at the level it starts the day on.
  const dealLevel = dealLevelFor(level);
  const board = areasAt(level).flatMap((area) => missionOffers(area, dayKey(day), dealLevel));
  const dealt = board.filter((job) => job.template.kind === 'standard');
  const fights = board.filter((job) => job.template.kind === 'battle');
  const profiles = dealt.map((job) => composeProfile(leaningsFor(job.template)));
  if (day % HIRE_EVERY_DAYS === 1) hire(leaders, day, level, profiles);

  const minutesLeft = HOURS_PER_DAY * 60;
  let runs = 0;
  let wins = 0;
  let chanceSum = 0;
  let marginSum = 0;
  let xpDay = 0;
  let infamyDay = 0;
  const used = new Set<string>();
  for (const leader of leaders) leader.freeAt = 0;
  // Crews run side by side. Each is sent again the moment it is home, until the day's hours run
  // out (the last job of the day may run overnight), always taking the free crew earliest in the
  // day, so a leader home from one crew's job can lead the next crew's.
  const slots = concurrentMissionSlots(level);
  const slotClock = Array.from({ length: slots }, () => 0);
  const slotDone = Array.from({ length: slots }, () => false);
  for (;;) {
    let slot = -1;
    for (let one = 0; one < slots; one += 1) {
      if (slotDone[one] || slotClock[one]! >= minutesLeft) continue;
      if (slot === -1 || slotClock[one]! < slotClock[slot]!) slot = one;
    }
    if (slot === -1) break;
    const clock = slotClock[slot]!;
    const fighting = MODE === 'mixed' && slot === 0 && fights.length > 0;
    const pool = (fighting ? fights : dealt).filter((job) => !used.has(job.template.id));
    const options = pool
      .map((job) => {
        const lead = bestLeaderFor(job, leaders, clock);
        if (!lead) return null;
        const chance = fighting
          ? FIGHT_WIN
          : missionOdds({
              grade: job.grade,
              leader: lead.leader.attributes,
              profile: composeProfile(leaningsFor(job.template)),
            }).chance;
        return { job, lead, chance, worth: worthPerHour(job, chance) };
      })
      .filter((one): one is NonNullable<typeof one> => one !== null);
    if (options.length === 0) {
      // Nobody free: this crew waits for the next leader to come home, or stops for the day.
      const next = Math.min(...leaders.map((one) => one.freeAt).filter((at) => at > clock));
      if (Number.isFinite(next) && next < minutesLeft) slotClock[slot] = next;
      else slotDone[slot] = true;
      continue;
    }
    const pick = options.reduce((top, one) => (one.worth > top.worth ? one : top));
    used.add(pick.job.template.id);
    seenTemplates.add(pick.job.template.id);
    const minutes = templateTimings(pick.job.template, pick.job.grade).totalMinutes;
    const won = rng() < pick.chance;
    const xp = missionXp(pick.job.template, minutes, pick.job.grade);
    xpDay += won ? xp : Math.round(xp * FAILED_MISSION_XP_SHARE);
    if (fighting) {
      const killed = Math.round(enemySlots(pick.job, day) * (won ? KILLED_ON_WIN : KILLED_ON_LOSS));
      infamyDay += missionInfamyForKills({ razors: killed });
    } else {
      runs += 1;
      wins += won ? 1 : 0;
      chanceSum += pick.chance;
      marginSum += missionOdds({
        grade: pick.job.grade,
        leader: pick.lead.leader.attributes,
        profile: composeProfile(leaningsFor(pick.job.template)),
      }).margin;
    }
    pick.lead.leader.freeAt = clock + minutes;
    slotClock[slot] = clock + minutes;
  }
  if (MODE === 'mixed' && day % DECLARED_EVERY_DAYS === 0 && fights.length > 0) {
    const hardest = fights.reduce((top, one) =>
      gradeIndex(one.grade) > gradeIndex(top.grade) ? one : top,
    );
    infamyDay += Math.round(enemySlots(hardest, day) * KILLED_ON_WIN) + GOVERNMENT_SITE_INFAMY;
  }
  infamy += infamyDay;
  for (let cost = notorietyUpgradeCost(rank); cost !== null && infamy >= cost;) {
    infamy -= cost;
    rank += 1;
    rankAt.set(rank, day);
    cost = rank >= MAX_NOTORIETY ? null : notorietyUpgradeCost(rank);
  }
  totalRuns += runs;

  xpInto += xpDay;
  while (xpInto >= playerXpToNextLevel(level)) {
    xpInto -= playerXpToNextLevel(level);
    level += 1;
    if (level % 10 === 0 && !reachedAt.has(level)) reachedAt.set(level, day);
  }
  train(leaders, profiles);

  const meanGrade =
    dealt.reduce((sum, job) => sum + gradeIndex(job.grade), 0) / Math.max(1, dealt.length);
  const bestLeader = Math.max(
    ...leaders.map(
      (one) =>
        profiles.reduce((sum, profile) => sum + leaderGradeIndex(one.attributes, profile), 0) /
        Math.max(1, profiles.length),
    ),
  );
  if (day <= 10 || day % 10 === 0) {
    rows.push(
      [
        `day ${String(day).padStart(3)}`,
        `lvl ${String(level).padStart(3)}`,
        `dealt ${GRADES[Math.round(meanGrade)]!.padEnd(2)} (${meanGrade.toFixed(1)})`,
        `best leader ${GRADES[Math.max(0, Math.round(bestLeader))]!.padEnd(2)} (${bestLeader.toFixed(1)})`,
        `runs ${String(runs).padStart(2)}`,
        `won ${String(Math.round((100 * wins) / Math.max(1, runs))).padStart(3)}%`,
        `odds ${String(Math.round((100 * chanceSum) / Math.max(1, runs))).padStart(3)}%`,
        `margin ${(marginSum / Math.max(1, runs)).toFixed(1).padStart(5)}`,
        `xp/day ${String(xpDay).padStart(7)}`,
        `infamy/day ${String(infamyDay).padStart(6)}`,
        `rank ${String(rank).padStart(2)}`,
        `officers ${String(leaders.length)}`,
      ].join('  '),
    );
  }
}

console.log(
  `Played ${String(DAYS)} days at ${String(HOURS_PER_DAY)}h a day, ${MODE === 'mixed' ? 'one crew fighting' : 'plain work only'}, dealt by ${DEAL}.\n`,
);
for (const row of rows) console.log(row);
console.log('\nLevel reached by day:');
for (const [at, day] of [...reachedAt.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  level ${String(at).padStart(3)} on day ${String(day)}`);
}
console.log('\nRank bought by day:');
for (const [at, day] of [...rankAt.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(
    `  ${String(at).padStart(2)} ${NOTORIETY_TIERS[at]!.padEnd(18)} on day ${String(day)}`,
  );
}
console.log(`\nRuns: ${String(totalRuns)}. Distinct jobs taken: ${String(seenTemplates.size)}.`);

console.log('\nWhat a fight fields, per grade, in Razors (fieldStrength of one Razor):');
const razor = fieldStrength({ razors: 1 });
console.log(
  GRADES.map((grade) => `${grade} ${String(Math.round(GRADE_ENEMY_STRENGTH[grade] / razor))}`).join(
    '  ',
  ),
);
