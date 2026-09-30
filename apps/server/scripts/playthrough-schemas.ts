/**
 * What every route answers with when it succeeds, keyed the way the coverage table is.
 *
 * One table rather than a schema passed at each call site, so a route answering the same thing on
 * every path is checked against the same shape every time, and a route with no entry here is a
 * failure in its own right: the playthrough cannot say a response is correct without knowing what
 * correct looks like.
 */
import {
  ActionsResponseSchema,
  AdminMutationResponseSchema,
  AdminSnapshotSchema,
  AuthResponseSchema,
  AutomationsResponseSchema,
  BarResponseSchema,
  BaseDetailResponseSchema,
  BattleMutationResponseSchema,
  BattlesResponseSchema,
  BidResponseSchema,
  BlackMarketMutationResponseSchema,
  BlackMarketResponseSchema,
  BuildAddonResponseSchema,
  BuildBoostResponseSchema,
  BuildStructureResponseSchema,
  CityMutationResponseSchema,
  CityResponseSchema,
  ClaimAllResponseSchema,
  ClaimFeatResponseSchema,
  CreateOverseerResponseSchema,
  CrewMutationResponseSchema,
  CrewProfileResponseSchema,
  CrewResponseSchema,
  CrewStandingResponseSchema,
  DeployQuoteResponseSchema,
  DistrictDetailResponseSchema,
  FactionMutationResponseSchema,
  FactionProfileResponseSchema,
  FactionResponseSchema,
  FeatsResponseSchema,
  GarageMutationResponseSchema,
  GarageResponseSchema,
  IncreasePayrollResponseSchema,
  LaunchMissionResponseSchema,
  LeaderboardResponseSchema,
  MarketMutationResponseSchema,
  MarketResponseSchema,
  MeResponseSchema,
  MessageMutationResponseSchema,
  MessagesResponseSchema,
  MissionsResponseSchema,
  ModificationSlotResponseSchema,
  MoveQuoteResponseSchema,
  NotificationMutationResponseSchema,
  NotificationsResponseSchema,
  OverseerChoicesResponseSchema,
  ReimagineResponseSchema,
  ReleaseOfficerResponseSchema,
  RenameDistrictResponseSchema,
  ResearchResponseSchema,
  ScrapyardResponseSchema,
  SettingsResponseSchema,
  TrainUnitsResponseSchema,
  TrainingResponseSchema,
  UnitsResponseSchema,
} from '@frontline/shared';
import { z } from 'zod';

/** `{ ok: true }`, which three routes answer with and nothing in the shared package names. */
export const OkResponseSchema = z.object({ ok: z.literal(true) });

/** `/health`, which is served outside `/api` and has no shared schema either. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.literal(true),
  clockAgeMs: z.number().nullable(),
  loopP99Ms: z.number().nullable(),
});

/**
 * The live channel is a stream, not a JSON body. Its "schema" is checked by the stream reader
 * (`playthrough-live.ts`); this marker only says the route is known.
 */
export const STREAM = 'stream' as const;

export type ResponseShape = z.ZodType | typeof STREAM;

export const RESPONSE_SCHEMAS: Readonly<Record<string, ResponseShape>> = {
  'GET /health': HealthResponseSchema,

  'POST /api/auth/register': AuthResponseSchema,
  'POST /api/auth/login': AuthResponseSchema,
  'POST /api/auth/logout-all': OkResponseSchema,

  'GET /api/me': MeResponseSchema,
  'GET /api/settings': SettingsResponseSchema,
  'POST /api/settings/tutorial': SettingsResponseSchema,
  'PATCH /api/settings/profile': SettingsResponseSchema,
  'POST /api/settings/password': SettingsResponseSchema,

  'GET /api/overseer/choices': OverseerChoicesResponseSchema,
  'POST /api/overseer': CreateOverseerResponseSchema,
  'GET /api/overseer/me': CrewStandingResponseSchema,

  'GET /api/base/:id': BaseDetailResponseSchema,
  'POST /api/base/build': BuildStructureResponseSchema,
  'POST /api/base/cancel': BuildStructureResponseSchema,
  'POST /api/base/boost': BuildBoostResponseSchema,
  'POST /api/base/modifications/clear': ModificationSlotResponseSchema,
  'POST /api/base/district-name': RenameDistrictResponseSchema,

  'GET /api/units': UnitsResponseSchema,
  'POST /api/units/train': TrainUnitsResponseSchema,
  'POST /api/units/cancel': TrainUnitsResponseSchema,
  'POST /api/units/burn': UnitsResponseSchema,

  'GET /api/missions': MissionsResponseSchema,
  'POST /api/missions': LaunchMissionResponseSchema,
  'POST /api/missions/recall': MissionsResponseSchema,

  'GET /api/research': ResearchResponseSchema,
  'POST /api/research/tech': ResearchResponseSchema,
  'POST /api/research/cancel': ResearchResponseSchema,

  'GET /api/training': TrainingResponseSchema,
  'POST /api/training': TrainingResponseSchema,
  'POST /api/training/cancel': TrainingResponseSchema,

  'GET /api/crew': CrewResponseSchema,
  'POST /api/crew/reassign': CrewMutationResponseSchema,
  'GET /api/crews/:id': CrewProfileResponseSchema,

  'GET /api/bar': BarResponseSchema,
  'POST /api/bar/bid': BidResponseSchema,
  'POST /api/bar/seal': BidResponseSchema,
  'POST /api/bar/release': ReleaseOfficerResponseSchema,
  'POST /api/bar/payroll': IncreasePayrollResponseSchema,

  'GET /api/market': MarketResponseSchema,
  'POST /api/market/bid': MarketMutationResponseSchema,
  'POST /api/market/barter': MarketMutationResponseSchema,
  'POST /api/market/supply': MarketMutationResponseSchema,
  'POST /api/market/offer': MarketMutationResponseSchema,
  'POST /api/market/withdraw': MarketMutationResponseSchema,
  'POST /api/market/accept': MarketMutationResponseSchema,
  'POST /api/market/claim': MarketMutationResponseSchema,
  'POST /api/blueprints/unlock': MarketMutationResponseSchema,
  'POST /api/blueprints/reimagine': ReimagineResponseSchema,

  'GET /api/black-market': BlackMarketResponseSchema,
  'POST /api/black-market/bid': BlackMarketMutationResponseSchema,

  'GET /api/scrapyard': ScrapyardResponseSchema,
  'POST /api/scrapyard/build': BuildAddonResponseSchema,
  'GET /api/garage': GarageResponseSchema,
  'POST /api/garage/build': GarageMutationResponseSchema,

  'GET /api/feats': FeatsResponseSchema,
  'POST /api/feats/claim': ClaimFeatResponseSchema,
  'POST /api/feats/claim-all': ClaimAllResponseSchema,

  'GET /api/factions': FactionResponseSchema,
  'POST /api/factions': FactionMutationResponseSchema,
  'POST /api/factions/identity': FactionMutationResponseSchema,
  'POST /api/factions/description': FactionMutationResponseSchema,
  'POST /api/factions/invite': FactionMutationResponseSchema,
  'POST /api/factions/answer': FactionMutationResponseSchema,
  'POST /api/factions/leave': FactionMutationResponseSchema,
  'POST /api/factions/disband': FactionMutationResponseSchema,
  'POST /api/factions/member': FactionMutationResponseSchema,
  'POST /api/factions/reinforce': FactionMutationResponseSchema,
  'GET /api/factions/:id/profile': FactionProfileResponseSchema,

  'GET /api/messages': MessagesResponseSchema,
  'POST /api/messages': MessageMutationResponseSchema,
  'POST /api/messages/read': MessageMutationResponseSchema,
  'POST /api/messages/read-all': MessageMutationResponseSchema,
  'POST /api/messages/delete': MessageMutationResponseSchema,
  'GET /api/notifications': NotificationsResponseSchema,
  'POST /api/notifications/read': NotificationMutationResponseSchema,
  'POST /api/notifications/read-all': NotificationMutationResponseSchema,
  'POST /api/notifications/settings': NotificationMutationResponseSchema,

  'GET /api/city': CityResponseSchema,
  'GET /api/city/:id': DistrictDetailResponseSchema,
  'POST /api/city/spy': CityMutationResponseSchema,
  'POST /api/city/spy/recall': CityMutationResponseSchema,
  'POST /api/city/sleepers': CityMutationResponseSchema,
  'POST /api/city/sleepers/recall': OkResponseSchema,
  'POST /api/city/gate': CityResponseSchema,
  'POST /api/city/gate/cancel': CityResponseSchema,
  'POST /api/city/upgrade': CityMutationResponseSchema,
  'POST /api/city/cancel-upgrade': CityMutationResponseSchema,

  'GET /api/battles': BattlesResponseSchema,
  'POST /api/battles/declare': BattleMutationResponseSchema,
  'POST /api/battles/deploy': BattleMutationResponseSchema,
  'POST /api/battles/deploy/quote': DeployQuoteResponseSchema,
  'POST /api/battles/trap': BattleMutationResponseSchema,
  'POST /api/battles/boost': BattleMutationResponseSchema,
  'POST /api/battles/lead': BattleMutationResponseSchema,
  'POST /api/battles/vehicles': BattleMutationResponseSchema,
  'POST /api/battles/notoriety': BattleMutationResponseSchema,

  'GET /api/actions': ActionsResponseSchema,
  'POST /api/actions/recall': ActionsResponseSchema,
  'POST /api/actions/move': ActionsResponseSchema,
  'POST /api/actions/move/quote': MoveQuoteResponseSchema,
  'POST /api/actions/move/recall': ActionsResponseSchema,

  'GET /api/automations': AutomationsResponseSchema,
  'POST /api/automations': AutomationsResponseSchema,

  'GET /api/leaderboard': LeaderboardResponseSchema,
  'GET /api/events': STREAM,

  'GET /api/admin': AdminSnapshotSchema,
  'POST /api/admin/grant': AdminMutationResponseSchema,
  'POST /api/admin/reset': AdminMutationResponseSchema,
  'POST /api/admin/mock-battle': AdminMutationResponseSchema,
  'POST /api/admin/knobs': AdminMutationResponseSchema,
};
