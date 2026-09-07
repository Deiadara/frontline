import { SEAT_SLOT_ORDER, seatOrder, type FactionMember } from '@frontline/shared';

/**
 * Where the five plates hang in the back room, as fractions of the room's painting.
 *
 * One row along the foot of the room, split evenly across its width with a margin at each end, so
 * the five plates cover the whole foot and none of them sits on a painted face: the point of a
 * painted room is that the people in it are the picture. The leader is the middle plate, the rest
 * of the table fills outward from the leader in rank order, and the spare chairs take what is
 * left at the ends ({@link seated}).
 *
 * Bottom-anchored (`OnPlate anchor="bottom"`), so `y` is a plate's foot and the plate grows
 * upward, away from the frame's bottom edge and the nav under it.
 *
 * Fractions of the *picture*, not of the frame, for the reason `PlateRoom` spells out: a percentage
 * of the viewport slides off the table the moment somebody resizes a window.
 */
export interface SeatPlace {
  readonly x: number;
  readonly y: number;
}

/** The foot of the row, a little above the bottom of the picture. */
const ROW_Y = 0.94;
/** The gap left at either end of the row, so the first and last plate are not against the edge. */
const ROW_MARGIN = 0.04;

/** The five slots, left to right: even cells between the two margins with a plate centred in each. */
export const SEAT_PLACES: readonly SeatPlace[] = Array.from({ length: 5 }, (_, at) => ({
  x: ROW_MARGIN + ((1 - 2 * ROW_MARGIN) / 5) * (at + 0.5),
  y: ROW_Y,
}));

/**
 * The narrowest the picture is ever drawn: 1024x768, where the 21:10 plate is fitted by height into
 * the 470px band between the bars and comes out 987px wide.
 */
export const NARROWEST_PICTURE_PX = 987;
export const NARROWEST_PICTURE_HEIGHT_PX = 470;

/**
 * A plate's size on the narrowest picture: `w-[10.75rem]` below `xl`, about 58px tall
 * (`Room.tsx`). At `xl` and up the plate steps to `11.25rem`, and the picture is at least 1065px
 * wide there, so the cells are wider by more than the plate grows.
 */
export const PLATE_PX = { width: 172, height: 58 } as const;

/**
 * Whether two plates are drawn over each other on a picture this size.
 *
 * The failure this exists to catch: five names at four visible places is a roster that has
 * silently lost somebody. Two plates are clear of each other when they are apart on either axis.
 */
export function platesOverlap(
  a: SeatPlace,
  b: SeatPlace,
  picture: { width: number; height: number },
): boolean {
  const dx = Math.abs(a.x - b.x) * picture.width;
  const dy = Math.abs(a.y - b.y) * picture.height;
  return dx < PLATE_PX.width && dy < PLATE_PX.height;
}

/**
 * Who is in which slot: the leader in the middle, the table filling outward in rank order, and the
 * room left at the ends. The slot order is shared with the server (`SEAT_SLOT_ORDER`), which deals
 * the cards off it.
 *
 * `null` is an empty place rather than an absent one, so the room always draws five and a table of
 * two reads as a table with three seats going spare. The rank order is `seatOrder`'s, which is the
 * same pecking order the roster is listed in.
 */
export function seated(members: readonly FactionMember[]): readonly (FactionMember | null)[] {
  const inOrder = seatOrder(members);
  const slots: (FactionMember | null)[] = SEAT_PLACES.map(() => null);
  inOrder.slice(0, SEAT_PLACES.length).forEach((member, rank) => {
    const slot = SEAT_SLOT_ORDER[rank];
    if (slot !== undefined) slots[slot] = member;
  });
  return slots;
}

/**
 * Anybody the room has no chair for.
 *
 * Unreachable while the cap holds (`MAX_FACTION_MEMBERS` is enforced by the join path and the
 * invite path both), and drawn anyway: a member the room cannot seat must not be a member the
 * screen never mentions. The Members door lists them from the payload, so this is only about the
 * picture being honest that it is short of chairs.
 */
export function unseated(members: readonly FactionMember[]): readonly FactionMember[] {
  return seatOrder(members).slice(SEAT_PLACES.length);
}
