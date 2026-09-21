import {
  findUnit,
  type CombineLeaderView,
  type UnitOption,
  type UnitSpec,
} from '@frontline/shared';
import { useState } from 'react';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';
import { UnitCard } from '../units/UnitCard';
import { catalogueOption } from '../units/UnitWindow';

/**
 * The Combine legendary whose shadow a district is under (`city/combine.ts`, 2026-09-19).
 *
 * Two readings on the district screen, and both are public: a tag in the header saying whose
 * ground this is, and his line in the ground box saying what that costs a crew fighting here. The
 * tag is the hover: his card is a pointer away, the way a unit's is on the mission board.
 *
 * The card is built off the catalogue rather than off the roster, and it has to be. The roster
 * is the *player's* sheets, and the Combine's are not on it by construction (`PLAYER_UNITS`), so
 * `roster.units.find(...)` would come back empty for every one of them. The catalogue sheet is
 * the same numbers the engine fights him with, which is the only claim the card makes.
 */

/**
 * How a leader's name is spoken in a sentence.
 *
 * "Under the Syndic" and "Under the Executioner", because those are titles; "Under Directive
 * Zero", because that is a codename and "the Directive Xero" is nobody. A table rather than a
 * grammar, since there are three of them and the fourth will be written by hand too.
 */
const TITLED: ReadonlySet<string> = new Set(['syndic', 'executioner']);

/** The leader's name as a sentence uses it: `the Syndic`, `Directive Xero`. */
export function spokenName(leader: Pick<CombineLeaderView, 'unitId' | 'name'>): string {
  return TITLED.has(leader.unitId) ? `the ${leader.name}` : leader.name;
}

/** What the tag in the district header says. */
export function leaderTagLine(leader: CombineLeaderView): string {
  return leader.alive ? `Under ${spokenName(leader)}` : `${opening(leader)} is dead`;
}

/** The spoken name opening a sentence: `The Syndic`, `Directive Xero`. */
function opening(leader: Pick<CombineLeaderView, 'unitId' | 'name'>): string {
  const name = spokenName(leader);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * What the ground box's Garrison row says under the garrison line.
 *
 * His power while he stands; when he does not, the fact that the district has lost it. The
 * second reading is the reward for killing him, and a screen that went quiet the moment he died
 * would leave a crew unsure whether the thing they came for had happened.
 */
export function leaderGroundLine(leader: CombineLeaderView): string {
  if (leader.alive) return leader.powerLine;
  return `${opening(leader)} is dead. This ground fights without ${leader.pronoun.object}.`;
}

/**
 * The tag in the district header, in the hostile tone the Seat of power tag wears.
 *
 * A `HoverCard` rather than a span with one inside it: the trigger is the whole tag, so the tag is
 * the button, which is what lets a keyboard reach the card at all.
 *
 * **It opens on a click as well as on a pointer** (maintainer, 2026-09-20). The hover is the
 * glance and the dialog is the read, and the difference is not taste: a `HoverCard`'s card is
 * portalled `pointer-events-none`, so every mark, modifier and characteristic on his sheet was a
 * coloured word that could not be pointed at. His sheet is the densest in the game and the marks
 * are the whole of the counterplay against him, so the one card in the game that most needs its
 * own hovers was the one card that could not have them. In the dialog it is the same card with
 * `live`, which is the roster's own chips and the roster's own explanations.
 *
 * `onActivate` on the same button rather than a second control beside it: a clickable element
 * inside a tooltip trigger is nested interactive content, which is what `HoverCard` documents and
 * refuses to be.
 */
export function CombineLeaderTag({ leader }: { leader: CombineLeaderView }) {
  const [open, setOpen] = useState(false);
  const sheet = findUnit(leader.unitId);
  return (
    <>
      <HoverCard
        label={`${leader.name}: open ${leader.pronoun.possessive} file`}
        size="card"
        data-testid="combine-leader"
        onActivate={() => setOpen(true)}
        card={<LeaderFile leader={leader} />}
      >
        <span
          className={cn(
            'block border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
            leader.alive
              ? 'border-oxblood-500/60 text-oxblood-300'
              : // Dead: the same frame, the ink gone out of it. Still hostile ground, no longer his.
                'border-surface-600 text-ink-300 line-through decoration-oxblood-500/70',
          )}
        >
          {leaderTagLine(leader)}
        </span>
      </HoverCard>

      {open && sheet && (
        <Modal
          onClose={() => setOpen(false)}
          // The unit window's width, for the same reason it has it: the card inside caps at 52rem
          // below 1440, so a 60rem window left a column of empty plate beside him.
          size="wide"
          dismissible
          labelledBy={LEADER_TITLE_ID}
          data-testid="combine-leader-window"
          className="border-oxblood-500/30"
        >
          <LeaderFile leader={leader} />
        </Modal>
      )}
    </>
  );
}

/** The heading the dialog names itself by. One leader's file is open at a time, so one id. */
const LEADER_TITLE_ID = 'combine-leader-title';

/**
 * The id his power wears as a mark. Not a `UnitRuleId`: it is a fact about *him* rather than a
 * rule the catalogue hands out, and no other sheet can carry it.
 */
const POWER_MARK_ID = 'combine_power';

/**
 * His sheet as the roster draws one (maintainer, 2026-09-20).
 *
 * "The exact same template as the units' template, the normal ones in the units tab." So this is
 * a real {@link UnitOption} and the card below is the real {@link UnitCard}, rather than a second
 * layout that looks like it until somebody changes one of them.
 *
 * Built here rather than fetched because it cannot be fetched: `/units` projects `PLAYER_UNITS`
 * and the Combine is not on it by construction (`units/faction.test.ts` is the wall). Every field
 * comes off the same catalogue the engine fights him with, so the numbers on the card are the
 * numbers in the fight.
 *
 * **His power is the first mark.** It was a paragraph under a heading, which made the one thing
 * that decides a fight in his district read as prose while `Dug In` beside it read as a rule. A
 * mark with a name (`CombineLeader.powerName`) and the sentence on its hover is how the game
 * writes every other thing a unit carries, and it is what the card's own band is for. Brass, the
 * default, because a chip's colour on this card says what the mark does *for the unit whose sheet
 * this is*, which is the rule every other card in the game follows.
 *
 * The four ownership fields are the honest empties: nobody holds one, nothing fits one, nothing
 * gates one, and it trains nowhere. `enemy` on the card is what stops them being drawn as zeroes.
 */
export function leaderOption(sheet: UnitSpec, leader: CombineLeaderView): UnitOption {
  /*
   * Through `catalogueOption`, which is the same builder every other sheet the roster cannot
   * supply goes through (`units/UnitWindow.tsx`). It takes extra rules for exactly this: his power
   * is a mark only he carries, and it goes first, ahead of the catalogue's own.
   *
   * This file used to write the whole `UnitOption` out again, which is twenty fields that have to
   * agree with the other copy for ever. They already disagreed on one: `unique` defaulted to true
   * here and false there, for the same sheets.
   */
  return catalogueOption(sheet, [
    {
      id: POWER_MARK_ID,
      label: leader.powerName,
      // Dead, the mark stays on the sheet and says so. The sheet is who he is; whether he is
      // still standing is a fact about the district, and the tag outside already carries it.
      description: leader.alive
        ? leader.powerLine
        : `While ${leader.pronoun.subject} stood: ${leader.powerLine.charAt(0).toLowerCase()}${leader.powerLine.slice(1)}`,
    },
  ]);
}

/**
 * What the dialog holds: the roster card, and the one line the roster has nowhere to put.
 *
 * Where he stands is a fact about the *city*, not about his sheet, so it sits above the card
 * rather than inside it: it is the plot that ends him, which is the reason a player opened this.
 * Everything else about him is on the card, in the places a player already knows to look.
 */
function LeaderFile({ leader }: { leader: CombineLeaderView }) {
  const sheet = findUnit(leader.unitId);
  if (!sheet) return null;
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
        <span id={LEADER_TITLE_ID}>{leader.name}</span>
        <span className="text-ink-400"> · </span>
        {leader.alive ? 'stands at' : 'stood at'}{' '}
        <span className="text-brass-300">{leader.locationName}</span>
      </p>
      <UnitCard unit={leaderOption(sheet, leader)} garrisoned={0} abroad={0} enemy />
    </div>
  );
}

/*
 * `CombineLeaderCard`, the narrow `InfoWindow` dossier this file used to draw on a pointer, was
 * removed on 2026-09-20: "the hover card that appears when you hover over the liaison and Xero
 * should have a bigger space for the portrait and be more similar to the unit card".
 *
 * It is {@link LeaderFile} on both now, which is the roster's own card. The portrait goes from a
 * 75px stamped icon in a header to the card's own column at its full 3:4, and the hover and the
 * window stop being two drawings of one man. What the dossier carried that the card does not is
 * on the card in a better place: his power was a paragraph under a heading and is now the first
 * chip in the marks band, with the sentence on its own hover.
 */
