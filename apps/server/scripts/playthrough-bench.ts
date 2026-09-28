/**
 * The bench: what the playthrough sets up outside the API, and says so.
 *
 * Playing a crew from level one to a Garage is weeks of real resources, and most of the routes worth
 * checking sit past that. The server's own suites reach those states by writing the rows they need
 * (`app.repos`), and the admin Console does the same thing through a route that only exists in admin
 * mode, which waives every price. The bench is the first of those: it moves a crew to a state the
 * rules can produce, and then every action from there goes through HTTP at real prices.
 *
 * Every write is logged so the report can list exactly what was granted.
 */
import {
  BUILDING_KINDS,
  RESOURCE_KEYS,
  levelCeilingFor,
  storageCapacity,
  storageCapacityFor,
  type Army,
  type BuildingKind,
  type Commander,
  type ItemId,
  type Resources,
  FOUND_FACTION_PLAYER_LEVEL,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { crewEffectsFor } from '../src/crew/standing.js';
import { offerOpeningInvitationAt } from '../src/factions/opening.js';
import type { Harness, Player } from './playthrough-harness.js';

export const benchLog: string[] = [];

function note(player: Player, what: string): void {
  benchLog.push(`${player.label} (${player.username}): ${what}`);
}

function baseOf(h: Harness, player: Player) {
  const base = h.repos.bases.findById(player.baseId);
  if (!base) throw new Error(`bench: ${player.label} has no base`);
  return base;
}

/** Tops the stockpile up by `add`, never past the storage ceiling. */
export function grantResources(h: Harness, player: Player, add: Partial<Resources>): void {
  h.settleAll();
  const base = baseOf(h, player);
  const bulk = storageCapacity(
    base.buildings,
    crewEffectsFor(h.repos, base, h.now()).storageCapacityPercent,
  );
  const resources = { ...base.resources };
  for (const key of RESOURCE_KEYS) {
    const wanted = resources[key] + (add[key] ?? 0);
    resources[key] = Math.min(wanted, storageCapacityFor(base.buildings, key, bulk));
  }
  h.repos.bases.updateResources(base.id, resources);
  note(player, `resources topped up by ${JSON.stringify(add)}`);
}

/** Puts the crew at a level, with nothing carried into it. */
export function setLevel(h: Harness, player: Player, level: number): void {
  h.repos.bases.updateProgression(player.baseId, level, { xpIntoLevel: 0 });
  h.repos.bases.setPendingLevelUp(player.baseId, null);
  h.setAnnounced(player, level);
  note(player, `level set to ${level}`);
}

/**
 * Puts the crew at the Faction door's level, and hands it what crossing that level through play
 * hands it: the seeded faction's invitation, which the XP funnel sends on the way past level 10
 * (`factions/opening.ts`). `setLevel` writes the level directly, so the letter is sent here.
 */
export function reachFactionLevel(h: Harness, player: Player): void {
  setLevel(h, player, FOUND_FACTION_PLAYER_LEVEL);
  offerOpeningInvitationAt(
    h.repos,
    player.userId,
    FOUND_FACTION_PLAYER_LEVEL,
    new Date().toISOString(),
  );
  note(player, 'the seeded faction invitation sent, as crossing level 10 sends it');
}

/** Stands structures at the given levels (clamped to each structure's ceiling). */
export function setBuildings(
  h: Harness,
  player: Player,
  levels: Partial<Record<BuildingKind, number>>,
): void {
  const base = baseOf(h, player);
  const buildings = BUILDING_KINDS.flatMap((kind) => {
    const standing = base.buildings.find((building) => building.kind === kind);
    const wanted = Math.min(levels[kind] ?? standing?.level ?? 0, levelCeilingFor(kind));
    if (wanted <= 0) return [];
    return [
      {
        id: standing?.id ?? randomUUID(),
        kind,
        level: wanted,
        modifications: standing?.modifications ?? [],
      },
    ];
  });
  h.repos.bases.updateDistrict(base.id, buildings, base.buildQueue);
  note(player, `structures set to ${JSON.stringify(levels)}`);
}

export function addUnits(h: Harness, player: Player, army: Army): void {
  const base = baseOf(h, player);
  const next: Record<string, number> = { ...base.army };
  for (const [id, n] of Object.entries(army)) next[id] = (next[id] ?? 0) + (n ?? 0);
  h.repos.bases.updateArmy(base.id, next, base.trainingQueue);
  note(player, `units added ${JSON.stringify(army)}`);
}

export function addItems(h: Harness, player: Player, items: Partial<Record<ItemId, number>>): void {
  const base = baseOf(h, player);
  const inventory: Record<string, number> = { ...base.inventory };
  for (const [id, n] of Object.entries(items)) inventory[id] = (inventory[id] ?? 0) + (n ?? 0);
  h.repos.bases.updateHoldings(base.id, base.resources, inventory);
  note(player, `items added ${JSON.stringify(items)}`);
}

export function setInfamy(h: Harness, player: Player, infamy: number, notoriety?: number): void {
  const base = baseOf(h, player);
  h.repos.bases.updateEconomy(base.id, {
    ...base.economy,
    infamy,
    ...(notoriety === undefined ? {} : { notoriety }),
  });
  note(
    player,
    `infamy set to ${infamy}${notoriety === undefined ? '' : `, notoriety ${notoriety}`}`,
  );
}

export function addTechnologies(h: Harness, player: Player, ids: readonly string[]): void {
  const base = baseOf(h, player);
  const technologies = [...new Set([...base.research.technologies, ...ids])];
  h.repos.bases.updateResearch(base.id, { ...base.research, technologies });
  note(player, `research granted: ${ids.join(', ')}`);
}

export function addOfficer(h: Harness, player: Player, officer: Commander): void {
  const base = baseOf(h, player);
  h.repos.bases.updateCommanders(base.id, [...base.commanders, officer]);
  note(player, `officer ${officer.name} put on the books in ${officer.role ?? 'no chair'}`);
}

export function markScouted(h: Harness, player: Player, districtId: string): void {
  h.repos.city.markScouted(player.baseId, districtId, h.now().toISOString());
  note(player, `district ${districtId} marked as scouted`);
}
