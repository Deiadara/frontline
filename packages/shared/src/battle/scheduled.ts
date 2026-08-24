import { z } from 'zod';
import { LocationHolderSchema, type LocationHolder } from '../city/control.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { ArmySchema, type Army } from '../units/training.js';

/**
 * A declared fight, and the ground it is over (GDD §A4, battle rework).
 *
 * ## What you may attack
 *
 * Three targets, and which of them is legal is decided entirely by who holds the district:
 *
 * - **A location.** The normal case. A district split between several parties has a way in, so you go
 *   for the thing you actually want.
 * - **The gate.** When one party holds *every* location in a district, the district is shut: there is
 *   no seam to walk through and the only thing to attack is the way in. That is what "the gate is
 *   armed" means, and it is why a crew that finishes a district gets a breathing space rather than a
 *   free-for-all — anybody who wants in has to break the door first, in public, with a day's notice.
 * - **A building.** Only inside the {@link GATE_BREACH_HOURS} window a broken gate opens, and only
 *   where somebody actually lives. This is the loot-and-wreck phase: a home district can never be
 *   taken (that rule has not moved), so what a breach buys is the chance to take things out of it
 *   and leave the structures limping.
 *
 * The rule set is one function, {@link declarationRefusal}, so the route, the client's picker and
 * the settler cannot disagree about what is legal.
 *
 * ## What a declaration is not
 *
 * It is not a commitment of troops. Nobody is sent when a battle is declared — that is
 * {@link BattleDeployment}, it happens over the hours afterwards, and it can be undone right up to
 * the mark. Declaring names the ground and starts the clock, and nothing else.
 */

export const BATTLE_TARGET_KINDS = ['location', 'gate', 'building'] as const;
export const BattleTargetKindSchema = z.enum(BATTLE_TARGET_KINDS);
export type BattleTargetKind = z.infer<typeof BattleTargetKindSchema>;

/**
 * Every target carries its district.
 *
 * Redundant for a location — the catalogue knows which district a location is in — and worth it anyway:
 * the settler reads whose ground it was for §D7 and §D8 on every single resolution, and a lookup
 * that can fail is a lookup that will, on the one row whose location was renamed.
 */
export const BattleTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('location'), districtId: IdSchema, locationId: z.string().min(1) }),
  z.object({ kind: z.literal('gate'), districtId: IdSchema }),
  z.object({ kind: z.literal('building'), districtId: IdSchema, buildingId: IdSchema }),
]);
export type BattleTarget = z.infer<typeof BattleTargetSchema>;

/** How long a broken gate stays broken. The board's number, and the whole shape of a siege. */
export const GATE_BREACH_HOURS = 24;

/**
 * A district's front door.
 *
 * `armed` is derived from the control table every time it is asked — a district is shut exactly when
 * one party holds all of it — so it can never disagree with the map. `brokenUntil` is the one piece
 * of stored state, because "somebody kicked this in at 04:12" is a fact about the past that no
 * amount of reading the present recovers.
 */
export const DistrictGateSchema = z.object({
  districtId: IdSchema,
  /** Null when the gate has never been broken, or when the last breach has run out. */
  brokenUntil: IsoDateTimeSchema.nullable(),
});
export type DistrictGate = z.infer<typeof DistrictGateSchema>;

/** Whether a district is shut. One holder for the whole of it and there is no way round. */
export function gateArmed(holder: LocationHolder | null): boolean {
  return holder !== null && holder.kind !== 'unoccupied';
}

/** Whether a breach is still open. A null or expired clock is a gate standing again. */
export function gateIsBroken(gate: DistrictGate | undefined, now: Date): boolean {
  if (!gate || gate.brokenUntil === null) return false;
  return Date.parse(gate.brokenUntil) > now.getTime();
}

/** When a gate broken now stops being broken. */
export function breachExpiry(now: Date): string {
  return new Date(now.getTime() + GATE_BREACH_HOURS * 3_600_000).toISOString();
}

export const DECLARATION_REFUSALS = [
  'gate_armed',
  'no_gate',
  'gate_intact',
  'nothing_to_break',
] as const;
export const DeclarationRefusalSchema = z.enum(DECLARATION_REFUSALS);
export type DeclarationRefusal = z.infer<typeof DeclarationRefusalSchema>;

export const DECLARATION_REFUSAL_MESSAGES: Readonly<Record<DeclarationRefusal, string>> = {
  gate_armed: 'That district is shut. The only thing to hit is the gate',
  no_gate: 'Nobody holds all of that district. There is no gate to break, only locations to take',
  gate_intact: 'The gate is standing. Nothing behind it can be reached',
  nothing_to_break: 'There is nothing built there to break',
};

/** What the map says about the district a declaration names. */
export interface DistrictStanding {
  /** One party holds every location in it, so the gate is armed. */
  shut: boolean;
  /** A breach is currently open. */
  breached: boolean;
  /** Somebody lives here, so there are structures worth hitting once the gate is down. */
  inhabited: boolean;
}

/**
 * Whether this target may be declared against right now, or why not.
 *
 * The three cases are mutually exclusive by construction, which is the point of running them through
 * one function: a shut district admits only `gate`, an open one only `location`, and `building` only
 * inside a breach. Anything else is a client asking for a fight that does not exist.
 */
export function declarationRefusal(
  target: BattleTarget,
  standing: DistrictStanding,
): DeclarationRefusal | null {
  switch (target.kind) {
    case 'location':
      return standing.shut && !standing.breached ? 'gate_armed' : null;
    case 'gate':
      return standing.shut ? null : 'no_gate';
    case 'building':
      if (!standing.breached) return 'gate_intact';
      return standing.inhabited ? null : 'nothing_to_break';
  }
}

export const BATTLE_SIDES = ['attacker', 'defender'] as const;
export const BattleSideSchema = z.enum(BATTLE_SIDES);
export type BattleSide = z.infer<typeof BattleSideSchema>;

/**
 * What one participant has standing on the ground, ahead of the mark.
 *
 * Units here have **left the crew's roster**. They are not a reservation against it: a stack that is
 * deployed cannot also be defending home, cannot be garrisoned somewhere else, and cannot be trained
 * over. Withdrawing puts them back. Modelling it as a booking against the army instead was the first
 * design and it fell over immediately — a crew could declare six fights and promise the same twenty
 * Razors to all of them.
 *
 * `perimeter` is the second force and it is not part of the battle army. See `battle/perimeter.ts`.
 */
export const BattleDeploymentSchema = z.object({
  battleId: IdSchema,
  /** Null for the Combine and the looters, who have no crew behind them. */
  baseId: IdSchema.nullable(),
  side: BattleSideSchema,
  army: ArmySchema.default({}),
  perimeter: ArmySchema.default({}),
  updatedAt: IsoDateTimeSchema,
});
export type BattleDeployment = z.infer<typeof BattleDeploymentSchema>;

/**
 * A declared fight.
 *
 * `defender` is recorded at declaration and re-read at resolution: it is on the row so a screen can
 * say who you called out without walking the control table, and it is re-read because the ground may
 * well have changed hands in the sixteen hours since.
 *
 * `seed` is drawn at declaration rather than at resolution, so the fight is replayable from the row
 * and so nobody can re-roll it by resolving twice.
 */
export const ScheduledBattleSchema = z.object({
  id: IdSchema,
  target: BattleTargetSchema,
  attackerBaseId: IdSchema,
  defender: LocationHolderSchema,
  scheduledFor: IsoDateTimeSchema,
  declaredAt: IsoDateTimeSchema,
  /** Null while it is still coming. Set the moment the engine has run. */
  resolvedAt: IsoDateTimeSchema.nullable(),
  seed: z.string().min(1),
  /**
   * Do the survivors hold the location they just took, or come home?
   *
   * Chosen at declaration, before anybody has committed a body, because it is the question that
   * decides what the fight is *for*. Coming home is a raid: you take the ground, the map changes
   * colour, and the crew is back on the roster tonight to be sent somewhere else. Holding is an
   * occupation: the survivors become the location's garrison, they defend it against whoever comes to
   * take it back, and they are not available for anything until they are pulled out.
   *
   * Defaulted, so a row written before the flag existed reads as a raid — which is what those
   * fights actually were.
   */
  holdAfterCapture: z.boolean().default(false),
});
export type ScheduledBattle = z.infer<typeof ScheduledBattleSchema>;

/** Has the mark passed without the fight having been run? What the settler looks for. */
export function isBattleDue(battle: ScheduledBattle, now: Date): boolean {
  return battle.resolvedAt === null && Date.parse(battle.scheduledFor) <= now.getTime();
}

/** Bodies committed to a deployment, both forces counted. */
export function deployedSize(deployment: Pick<BattleDeployment, 'army' | 'perimeter'>): number {
  const count = (force: Army): number =>
    Object.values(force).reduce((total, amount) => total + amount, 0);
  return count(deployment.army) + count(deployment.perimeter);
}

/** A participant that has committed nothing at all — which is a legal state right up to the mark. */
export function emptyDeployment(
  battleId: string,
  baseId: string | null,
  side: BattleSide,
  at: string,
): BattleDeployment {
  return { battleId, baseId, side, army: {}, perimeter: {}, updatedAt: at };
}
