import { z } from 'zod';
import { BaseSummarySchema } from './base.js';
import { BuildingKindSchema } from './building/index.js';
import { PerksSchema } from './crew/perks.js';
import { BadgeSchema } from './factions/badge.js';
import { FactionRankSchema } from './factions/factions.js';
import { OverseerArchetypeSchema } from './overseer.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { PlayerIconSchema } from './user.js';

/**
 * A crew's file, as any other player may read it (maintainer request, 2026-09-11).
 *
 * One shape for everybody, yours included: the page that draws it is the same page whether the
 * reader is looking at themselves or at the crew that just took the Tideline Market off them. What
 * differs is a flag, and the flag decides which doors the page offers, never what it shows.
 *
 * ## What is public, and why
 *
 * Everything here is something the city already says out loud somewhere. The standings print the
 * level, the infamy and the rank; the map prints who holds which location; a district screen shows
 * every structure standing on a plot and how far along it is; the Bar prints an Overseer's face,
 * name and bio to anybody in the room. Gathering it on one page publishes nothing new.
 *
 * What is **not** here is deliberate. The Overseer's attribute sheet is §F2 hidden information:
 * the whole scouting mechanic exists to make somebody's numbers hard to read, so a file that
 * printed them would be a free scout. The stockpile, the army, the officers and the research are
 * owner-only for the same reason and stay on `/me`.
 */

/** One location this crew holds, on ground the reader has been to. */
export const ProfileHoldingSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1),
  /** The catalogue's label for the kind of place: "Scrap Press", "Pumphouse". */
  kind: z.string().min(1),
  districtId: IdSchema,
  districtName: z.string().min(1),
  level: z.number().int().min(1),
});
export type ProfileHolding = z.infer<typeof ProfileHoldingSchema>;

export const CrewProfileResponseSchema = z.object({
  /** Whether the reader is looking at their own file. Decides the doors, not the content. */
  isYou: z.boolean(),
  crew: BaseSummarySchema,
  player: z.object({
    userId: IdSchema,
    /** What they chose to be called, or the name they log in with. */
    name: z.string().min(1),
    icon: PlayerIconSchema,
    /** When the account was made: how long they have been in the city. */
    since: IsoDateTimeSchema,
  }),
  /**
   * The public half of the Overseer. Null only for an account that registered and never chose
   * one, which cannot hold a crew, so in practice a file always has a face on it.
   */
  overseer: z
    .object({
      name: z.string().min(1),
      archetype: OverseerArchetypeSchema,
      portraitId: z.string().min(1),
      bio: z.string(),
      perks: PerksSchema,
    })
    .nullable(),
  standing: z.object({
    level: z.number().int().positive(),
    infamy: z.number().nonnegative(),
    notoriety: z.number().int().nonnegative(),
    /** Their place on the players' board, or null for a crew the board does not list. */
    rank: z.number().int().positive().nullable(),
    /** Fights they were in, either side, over the same history the battle board keeps. */
    fights: z.object({
      won: z.number().int().nonnegative(),
      lost: z.number().int().nonnegative(),
    }),
  }),
  faction: z
    .object({
      id: IdSchema,
      name: z.string().min(1),
      badge: BadgeSchema,
      rank: FactionRankSchema,
      /** What the faction as a whole has won, which is the number the standings rank it by. */
      infamyEarned: z.number().nonnegative(),
    })
    .nullable(),
  home: z.object({
    districtId: IdSchema,
    /** The authored name of the ground. What the *crew* calls it is `crew.name`. */
    districtName: z.string().min(1),
    /**
     * Whether the reader has walked their street. The district screen shows what is standing on
     * a plot only once it is scouted, and a file that showed it unscouted would be a free look at
     * their Gate (§B7), so `buildings` is empty until this is true.
     */
    seen: z.boolean(),
    /** What is standing on their plot, as a passer-by who has been there sees it. */
    buildings: z.array(z.object({ kind: BuildingKindSchema, level: z.number().int().min(1) })),
  }),
  /**
   * Locations they hold on ground the **reader** has scouted. The fog is enforced here for the
   * same reason it is on the city read: a file listing a hold in a district you have never walked
   * would be telling you what is in there.
   */
  holdings: z.array(ProfileHoldingSchema),
  /** How many more they hold behind the reader's fog. A count says "there is more" without saying where. */
  hiddenHoldings: z.number().int().nonnegative(),
  /**
   * Districts they hold end to end, which is the §A4 unified bonus and a gate they may arm. Under
   * the same fog as `holdings`: a whole district the reader has not scouted is in the hidden count
   * and nowhere else, or the count would say "there is more" and this line would say where.
   */
  districtsHeldWhole: z.array(z.object({ districtId: IdSchema, name: z.string().min(1) })),
  serverNow: IsoDateTimeSchema,
});
export type CrewProfileResponse = z.infer<typeof CrewProfileResponseSchema>;
