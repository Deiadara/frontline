import {
  CITY_DISTRICTS,
  GRADES,
  MISC_AREA_ID,
  MISC_BOARD_ROTATION_MINUTES,
  missionBoardKey,
  missionOffers,
  type DealtJob,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { namedCard } from './dealt.js';

/**
 * Exact card only (maintainer, 2026-09-29): a launch names the board's key and the grade it read,
 * and is taken only off the board the player is reading or the one just before it, in time (the
 * misc board's previous slot) or in level (the level below, always).
 */

const NOW = new Date('2026-11-10T12:30:00.000Z');
const SLOT = MISC_BOARD_ROTATION_MINUTES * 60_000;
const LEVEL = 40;
const DISTRICT = CITY_DISTRICTS.find((district) => district.kind === 'contested')!.id;

const minus = (slots: number) => new Date(NOW.getTime() - slots * SLOT);

/** The same question `POST /missions` asks, about one dealt card. */
function ask(
  areaId: string,
  boardKey: string,
  job: DealtJob,
  extra: { level?: number; grade?: DealtJob['grade'] } = {},
): DealtJob | null {
  return namedCard({
    areaId,
    templateId: job.template.id,
    boardKey,
    grade: extra.grade ?? job.grade,
    level: extra.level ?? LEVEL,
    now: NOW,
  });
}

/** Every card on a board, with its key. */
function cards(areaId: string, at: Date, level = LEVEL): { key: string; job: DealtJob }[] {
  const key = missionBoardKey(areaId, at);
  return missionOffers(areaId, key, level).map((job) => ({ key, job }));
}

describe('the card a launch names', () => {
  it('takes every card on the board the player is reading, as it was dealt', () => {
    for (const areaId of [MISC_AREA_ID, DISTRICT]) {
      const now = cards(areaId, NOW);
      expect(now.length, `${areaId} deals nothing`).toBeGreaterThan(0);
      for (const { key, job } of now) expect(ask(areaId, key, job)).toEqual(job);
    }
  });

  it('keeps the misc board’s previous slot, for a card read just before it turned over', () => {
    for (const { key, job } of cards(MISC_AREA_ID, minus(1))) {
      expect(ask(MISC_AREA_ID, key, job)).toEqual(job);
    }
  });

  it('refuses a misc card from two slots ago, which the screen never shows', () => {
    const current = new Set(cards(MISC_AREA_ID, NOW).map((one) => one.key));
    const old = cards(MISC_AREA_ID, minus(2));
    expect(current.has(old[0]!.key), 'the fixture keys must differ').toBe(false);
    for (const { key, job } of old) expect(ask(MISC_AREA_ID, key, job)).toBeNull();
  });

  it('refuses yesterday’s district board', () => {
    for (const { key, job } of cards(DISTRICT, new Date(NOW.getTime() - 86_400_000))) {
      expect(ask(DISTRICT, key, job)).toBeNull();
    }
  });

  it('refuses the right job at a grade it was not dealt at', () => {
    for (const { key, job } of cards(MISC_AREA_ID, NOW)) {
      for (const grade of GRADES.filter((one) => one !== job.grade)) {
        expect(ask(MISC_AREA_ID, key, job, { grade }), `${job.template.id} at ${grade}`).toBeNull();
      }
    }
  });

  it('refuses a key the request made up', () => {
    const [first] = cards(MISC_AREA_ID, NOW);
    expect(ask(MISC_AREA_ID, 'anything', first!.job)).toBeNull();
  });

  /** The cards `level` deals on this board and `LEVEL` does not. */
  const onlyAt = (level: number) => {
    const current = new Set(
      cards(MISC_AREA_ID, NOW).map(({ job }) => `${job.template.id}@${job.grade}`),
    );
    return cards(MISC_AREA_ID, NOW, level).filter(
      ({ job }) => !current.has(`${job.template.id}@${job.grade}`),
    );
  };

  /*
   * The board below the crew's level is always open (maintainer, 2026-09-29: "always allow
   * previous"), whether or not the level-up that closed it has been announced.
   */
  it('takes a card the level below dealt', () => {
    const below = onlyAt(LEVEL - 1);
    expect(below.length, 'the level below must deal a card this level does not').toBeGreaterThan(0);
    for (const { key, job } of below) expect(ask(MISC_AREA_ID, key, job)).toEqual(job);
  });

  it('refuses a card only two levels down dealt', () => {
    const below = new Set(
      cards(MISC_AREA_ID, NOW, LEVEL - 1).map(({ job }) => `${job.template.id}@${job.grade}`),
    );
    const twoDown = onlyAt(LEVEL - 2).filter(
      ({ job }) => !below.has(`${job.template.id}@${job.grade}`),
    );
    expect(twoDown.length, 'two levels down must deal a card neither above does').toBeGreaterThan(
      0,
    );
    for (const { key, job } of twoDown) expect(ask(MISC_AREA_ID, key, job)).toBeNull();
  });
});
