/**
 * The Overseer pool (GDD §F6, maintainer request 2026-09-15).
 *
 * Four characters out of thirty, and the one a player takes leaves the pool for everybody. Two
 * properties carry the whole feature and neither is obvious from reading `overseerOffer`: the four
 * an account sees are **stable**, so the screen is not a slot machine somebody reloads until the
 * character they wanted appears, and the pool **drains**, so a world late in its life really is
 * offering from what is left rather than from the table.
 */
import { describe, expect, it } from 'vitest';
import {
  OVERSEER_OFFER_SIZE,
  OVERSEER_POOL_SIZE,
  OVERSEER_PRESETS,
  overseerOffer,
  overseerRemaining,
} from './overseer.js';
import { OVERSEER_SIGNATURE_PERK_IDS, ROLLABLE_PERK_IDS, findPerk } from './crew/perks.js';

const ALL = OVERSEER_PRESETS.map((preset) => preset.presetId);
const ids = (offer: readonly { presetId: string }[]) => offer.map((preset) => preset.presetId);

describe('what a new account is offered', () => {
  it('offers exactly four, all real and all different', () => {
    const offer = overseerOffer([], 'account-1');
    expect(offer).toHaveLength(OVERSEER_OFFER_SIZE);
    expect(new Set(ids(offer)).size).toBe(OVERSEER_OFFER_SIZE);
    for (const preset of offer) expect(ALL).toContain(preset.presetId);
  });

  /** The reload test. Same account, same four, however many times the screen asks. */
  it('offers the same four to the same account every time', () => {
    const once = ids(overseerOffer([], 'account-steady'));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(ids(overseerOffer([], 'account-steady'))).toEqual(once);
    }
  });

  /**
   * ...and not the same four to everybody, which is the other half.
   *
   * A stable offer is easy to get wrong in the direction of a constant: hash the account, forget to
   * use it, and every player in the world is shown the first four. Measured across a thousand
   * accounts rather than asserted on two, because two can agree by luck.
   */
  it('does not show every account the same four', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      for (const id of ids(overseerOffer([], `account-${index}`))) seen.add(id);
    }
    expect(seen.size, 'some characters can never be offered to anybody').toBe(OVERSEER_POOL_SIZE);
  });

  /**
   * ...and the **batches** vary, not merely the characters in them.
   *
   * The test above passed while the draw could produce only 29 distinct quartets out of the 27,405
   * that exist, because all thirty characters were still reachable *somewhere* across those 29.
   * Reachability of a character and variety of a batch are two different properties and only one
   * of them was ever pinned.
   *
   * The draw was `(hash + step * stride) % pool.length` with `stride` also derived from
   * `hash % pool.length`, so the whole batch came off a single residue. What it cost the game: a
   * lapsed hold was supposed to redraw a *different* four, and came back with the same four 3.55%
   * of the time, which is the intermittent failure `overseer-holds.test.ts` was showing.
   *
   * The bound is deliberately far below the 27,384 a correct draw actually reaches at this sample
   * size, so an ordinary change to the hash does not redden it; anything that collapses the draw
   * back onto one modulus lands two orders of magnitude under it.
   */
  it('draws many different quartets, not many different characters', () => {
    const batches = new Set<string>();
    for (let index = 0; index < 5000; index += 1) {
      batches.add(ids(overseerOffer([], `batch-${index}`)).join(','));
    }
    expect(batches.size, 'the draw collapses onto a handful of quartets').toBeGreaterThan(4000);
  });

  /** The consequence a player meets: a fresh seed is a fresh four, near enough always. */
  it('replaces a lapsed batch with a different one', () => {
    let identical = 0;
    for (let index = 0; index < 2000; index += 1) {
      const before = ids(overseerOffer([], `lapse-${index}-first`)).join(',');
      const after = ids(overseerOffer([], `lapse-${index}-second`)).join(',');
      if (before === after) identical += 1;
    }
    // Chance alone gives 2000 / 27405, well under one. The broken walk gave about 71.
    expect(identical, 'a redraw keeps landing on the batch it just replaced').toBeLessThan(5);
  });
});

/**
 * Account ids shaped like the real ones.
 *
 * `request.currentUser.id` is a UUID, and the walk below is a hash of it, so ids of the form
 * `account-3` exercise a narrow slice of the hash space. Generated rather than random so a failure
 * names the same account every run.
 */
function accountIds(count: number): string[] {
  const ids: string[] = [];
  let state = 0x2545f491;
  // xorshift32, and the top nibble of it. An LCG's low bits cycle with period 16, which produced
  // four hundred ids carrying about twenty distinct hashes: a generator too regular to be evidence.
  const hex = (digits: number): string => {
    let out = '';
    for (let n = 0; n < digits; n += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out += (state >>> 28).toString(16);
    }
    return out;
  };
  for (let n = 0; n < count; n += 1) {
    ids.push(`${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`);
  }
  return ids;
}

/**
 * Four, at every size the pool can be, for accounts the hash actually spreads over.
 *
 * The walk `(hash + step * stride) % size` only reaches every entry when `stride` and `size` are
 * coprime. It used to force an odd stride and call that coprime with any even size, which is not
 * true: fifteen is odd and shares a factor with thirty, so on the **full** pool an account hashing
 * to that stride walked `{i, i + 15}` and the `Set` stopped filling at two. Measured at 6.67% of
 * accounts on a brand-new server, and worse as the pool drains (20% at ten left, 33% at six).
 *
 * The player saw two portraits on a screen whose own header told them twenty-eight characters were
 * unspoken for, with no way to ask again: the offer is a hash of their account, so reloading
 * returned the same two forever.
 *
 * Swept over every pool size rather than asserted at thirty, because which sizes break is a
 * property of the factorisation and the pool is content that will move again.
 */
describe('the offer is always as large as the pool allows', () => {
  const ACCOUNTS = accountIds(400);

  it('never hands back fewer than four while more than four are left', () => {
    for (let claimedCount = 0; claimedCount < OVERSEER_POOL_SIZE; claimedCount += 1) {
      const claimed = ALL.slice(0, claimedCount);
      const left = OVERSEER_POOL_SIZE - claimedCount;
      const wanted = Math.min(OVERSEER_OFFER_SIZE, left);
      for (const account of ACCOUNTS) {
        const offer = ids(overseerOffer(claimed, account));
        expect(offer.length, `pool of ${left}: ${account} was offered ${offer.length}`).toBe(
          wanted,
        );
        expect(new Set(offer).size, `pool of ${left}: ${account} was offered a twin`).toBe(wanted);
      }
    }
  });

  /**
   * The other half: the walk has to reach every entry, not merely four of them.
   *
   * A stride of 1 would pass the count assertion above at every pool size and offer the same four
   * consecutive characters to everybody, which is the constant this feature's stability property
   * is one edit away from.
   */
  it('can offer every remaining character to somebody, at every pool size', () => {
    for (let claimedCount = 0; claimedCount < OVERSEER_POOL_SIZE - 1; claimedCount += 1) {
      const claimed = ALL.slice(0, claimedCount);
      const seen = new Set<string>();
      for (const account of ACCOUNTS)
        for (const id of ids(overseerOffer(claimed, account))) seen.add(id);
      expect(
        seen.size,
        `pool of ${OVERSEER_POOL_SIZE - claimedCount} never offers all of itself`,
      ).toBe(OVERSEER_POOL_SIZE - claimedCount);
    }
  });
});

/**
 * How many are left, counted off the characters rather than off the rows.
 *
 * `claimedPresetIds` reads `overseers.preset_id` raw, and migration 0095 leaves a spent claim
 * shaped `enforcer:<uuid>` behind for every duplicate a pre-pool save carried. `total - claimed
 * .size` counted each of those as a character somebody holds, so the picker's header understated
 * the pool by one per duplicate, and a database with more overseer rows than there are characters
 * printed a negative number at the player.
 */
describe('how many are still unspoken for', () => {
  it('counts nobody as claimed on an empty world', () => {
    expect(overseerRemaining([])).toBe(OVERSEER_POOL_SIZE);
  });

  it('does not count migration 0095 spent claims as characters', () => {
    const spent = ['enforcer', 'enforcer:row-2', 'enforcer:row-3', 'fixer', 'fixer:row-5'];
    expect(overseerRemaining(spent)).toBe(OVERSEER_POOL_SIZE - 2);
  });

  it('never goes negative, however many rows a legacy save piled onto one character', () => {
    const rows = ['enforcer', ...Array.from({ length: 60 }, (_, n) => `enforcer:row-${n}`)];
    expect(overseerRemaining(rows)).toBe(OVERSEER_POOL_SIZE - 1);
  });

  /** The count and the cards have to agree, or the header is describing a different pool. */
  it('agrees with the size of the pool the offer draws from', () => {
    for (let claimedCount = 0; claimedCount <= OVERSEER_POOL_SIZE; claimedCount += 1) {
      const claimed = [...ALL.slice(0, claimedCount), 'enforcer:spent', 'ghost:spent'];
      const left = overseerRemaining(claimed);
      expect(overseerOffer(claimed, 'account-agreeing')).toHaveLength(
        Math.min(OVERSEER_OFFER_SIZE, left),
      );
    }
  });
});

describe('the pool drains', () => {
  it('never offers a character somebody already holds', () => {
    const claimed = ALL.slice(0, 10);
    for (let index = 0; index < 200; index += 1) {
      const offer = ids(overseerOffer(claimed, `account-${index}`));
      for (const id of offer)
        expect(claimed, `${id} was offered after being taken`).not.toContain(id);
    }
  });

  it('shrinks the offer rather than repeating itself once the pool is nearly out', () => {
    const claimed = ALL.slice(0, OVERSEER_POOL_SIZE - 2);
    const offer = overseerOffer(claimed, 'account-late');
    expect(offer).toHaveLength(2);
    expect(new Set(ids(offer)).size).toBe(2);
  });

  it('offers nothing at all once every character is taken, rather than throwing', () => {
    expect(overseerOffer(ALL, 'account-too-late')).toEqual([]);
  });

  /**
   * The case that decides whether "removed from the pool" is real.
   *
   * Take whatever an account is offered, put it in the claimed set, and ask again: the offer has to
   * move. A cache keyed only on the account, or an offer computed before the claimed set was read,
   * would hand back the same person who has just been taken.
   */
  it('moves on the moment one of an account own four is taken', () => {
    const before = ids(overseerOffer([], 'account-racing'));
    const after = ids(overseerOffer([before[0]!], 'account-racing'));
    expect(after).not.toContain(before[0]);
    expect(after).toHaveLength(OVERSEER_OFFER_SIZE);
  });
});

describe('the signature perks', () => {
  it('gives every character exactly one, and no two the same', () => {
    const carried = OVERSEER_PRESETS.flatMap((preset) => preset.perks);
    expect(carried).toHaveLength(OVERSEER_POOL_SIZE);
    expect(new Set(carried).size).toBe(OVERSEER_POOL_SIZE);
    for (const id of carried) {
      expect(findPerk(id), `${id} is not in the perk book`).toBeDefined();
      expect(OVERSEER_SIGNATURE_PERK_IDS, `${id} is not a signature`).toContain(id);
    }
  });

  /**
   * An officer can never roll one, which is what "unique" has to mean to be worth anything.
   *
   * Without this a player could hire the bonus they chose their character for, twice, off the Bar.
   */
  it('keeps every signature out of the recruitment pool', () => {
    for (const id of OVERSEER_SIGNATURE_PERK_IDS) expect(ROLLABLE_PERK_IDS).not.toContain(id);
    // ...and the recruitment pool is still the rest of the book rather than empty.
    expect(ROLLABLE_PERK_IDS.length).toBeGreaterThan(100);
  });
});
