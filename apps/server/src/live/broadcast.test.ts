import { describe, expect, it } from 'vitest';
import { broadcastKindFor } from './broadcast.js';

/**
 * Which writes every open tab hears about. The table is the rule; this pins its edges.
 */
describe('broadcastKindFor', () => {
  it('names the world for the map, the board, the factions and a crew name', () => {
    expect(broadcastKindFor('POST', '/api/city/gate')).toBe('world');
    expect(broadcastKindFor('POST', '/api/city/garrison')).toBe('world');
    expect(broadcastKindFor('POST', '/api/battles/declare')).toBe('world');
    expect(broadcastKindFor('POST', '/api/battles/deploy?x=1')).toBe('world');
    expect(broadcastKindFor('POST', '/api/battles/withdraw')).toBe('world');
    expect(broadcastKindFor('POST', '/api/actions/recall')).toBe('world');
    expect(broadcastKindFor('POST', '/api/factions')).toBe('world');
    expect(broadcastKindFor('POST', '/api/factions/leave')).toBe('world');
    expect(broadcastKindFor('POST', '/api/factions/reinforce')).toBe('world');
    expect(broadcastKindFor('POST', '/api/overseer')).toBe('world');
    expect(broadcastKindFor('POST', '/api/base/district-name')).toBe('world');
    // The one shared-world write that is a PATCH: the name on every bid and every standings row.
    expect(broadcastKindFor('PATCH', '/api/settings/profile')).toBe('world');
  });

  /** One crew's own books: a leader, a trap, a boost, a rank, an invite, a blurb. */
  it('keeps a private write on the board or at the table private', () => {
    expect(broadcastKindFor('POST', '/api/battles/lead')).toBeNull();
    expect(broadcastKindFor('POST', '/api/battles/trap')).toBeNull();
    expect(broadcastKindFor('POST', '/api/battles/boost')).toBeNull();
    expect(broadcastKindFor('POST', '/api/battles/notoriety')).toBeNull();
    expect(broadcastKindFor('POST', '/api/battles/vehicles')).toBeNull();
    expect(broadcastKindFor('POST', '/api/factions/invite')).toBeNull();
    expect(broadcastKindFor('POST', '/api/factions/description')).toBeNull();
    expect(broadcastKindFor('POST', '/api/overseer/something')).toBeNull();
  });

  it('names the market and the bar for theirs', () => {
    expect(broadcastKindFor('POST', '/api/market/bid')).toBe('market');
    expect(broadcastKindFor('POST', '/api/market/offer/accept')).toBe('market');
    expect(broadcastKindFor('POST', '/api/black-market/take')).toBe('market');
    expect(broadcastKindFor('POST', '/api/bar/bid')).toBe('bar');
    expect(broadcastKindFor('POST', '/api/bar/seal')).toBe('bar');
  });

  /** Nobody else can see these, so nobody else is told. */
  it('says nothing for a write that changes only the writer', () => {
    expect(broadcastKindFor('POST', '/api/city/scout')).toBeNull();
    expect(broadcastKindFor('POST', '/api/base/build')).toBeNull();
    expect(broadcastKindFor('POST', '/api/units/train')).toBeNull();
    expect(broadcastKindFor('POST', '/api/research/start')).toBeNull();
    expect(broadcastKindFor('POST', '/api/bar/release')).toBeNull();
    expect(broadcastKindFor('POST', '/api/bar/payroll')).toBeNull();
    expect(broadcastKindFor('POST', '/api/settings')).toBeNull();
  });

  it('says nothing for a read, and does not mistake a prefix for a longer word', () => {
    expect(broadcastKindFor('GET', '/api/city')).toBeNull();
    expect(broadcastKindFor('GET', '/api/battles')).toBeNull();
    expect(broadcastKindFor('POST', '/api/marketplace')).toBeNull();
    expect(broadcastKindFor('POST', '/api/barometer')).toBeNull();
  });
});
