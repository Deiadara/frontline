import type { LiveEventKind, NotificationKind } from '@frontline/shared';

/**
 * Which screens a receipt makes stale.
 *
 * Every receipt refreshes the bell, so `notification` is implied for all of them and is added by
 * the publisher rather than listed here. This table is only the *extra* screen a kind disturbs: a
 * fight redraws the battles board and the city under it, an invite redraws the inbox.
 *
 * A kind that is missing from this table is not a bug and needs no entry. It still rings the bell,
 * which is the whole of what most receipts are: "the wage was paid", "the roof went on".
 */
export const NOTIFICATION_LIVE_KINDS: Partial<Record<NotificationKind, LiveEventKind>> = {
  battle_report: 'battle',
  battle_incoming: 'battle',
  district_attacked: 'battle',
  reinforcement_arrived: 'battle',
  message_received: 'message',
  faction_invite: 'message',
  faction_joined: 'faction',
  faction_left: 'faction',
  // The player's own holdings changed while they were looking at something else.
  building_done: 'base',
  research_done: 'base',
  training_done: 'base',
  unit_trained: 'base',
  mission_home: 'base',
  // §H7a: the close signs somebody while the player is asleep, so the crew they are looking at
  // when the bell rings is a crew short of the officer it just won.
  officer_hired: 'base',
};
