/**
 * The three fields a face is drawn from, rather than a whole member row.
 *
 * Two different shapes carry a person at a table: `FactionMember` on the screen the people in it
 * see, and `FactionProfileMember` on the public file anybody can read. They agree on these three
 * and on almost nothing else, and naming the fields rather than one of the two types is what lets
 * both screens draw the same face instead of the public one falling back to a sigil forever.
 */
export interface Faced {
  userId: string;
  username: string;
  portraitId: string | null;
}
import { PortraitFrame } from '../../components/ui/PortraitFrame';
import { OverseerPortrait } from '../overseer/OverseerPortrait';
import { MemberSigil } from './MemberSigil';

/**
 * A person at the table, as their own face (maintainer request, 2026-09-13).
 *
 * The faction screen drew everybody as a decoration of their *seat*: the roster row showed the
 * card the seat holds and the member window showed a sigil assembled from a hash of the account
 * id, so five people looked like five playing cards and five strangers in goggles. The one
 * picture of them that already exists in the game, the Overseer's portrait the Bar and the crew's
 * file both print, was the one picture this screen did not use. `FactionMemberSchema` carries the
 * id now, so it does.
 *
 * `MemberSigil` stays for the account that has no Overseer. That cannot hold a seat in play, so it
 * is the drawing nobody will see, kept because a roster that throws on one row takes the table
 * down for the other four.
 *
 * Both sizes take the whole box they are given, so the caller decides the shape: `lg` is the
 * portrait beside the readings on somebody's file and carries the drawn frame; `sm` is a plate at
 * avatar size, and it is a `<span>` all the way down because a roster row is a `HoverCard`
 * trigger, which is a real `<button>` and may hold phrasing content only.
 */
export function MemberFace({ member, size }: { member: Faced; size: 'sm' | 'lg' }) {
  const portraitId = member.portraitId;
  /*
   * `data-face` says which of the two branches drew this, and is the only honest anchor a test
   * has. The painting is an `<img alt="">`, which is correct (the name is already beside it in
   * text, so a screen reader announcing it twice is noise) and which leaves it with no accessible
   * role to find it by; and where no art has been delivered yet there is no `<img>` at all, only
   * the gradient and the silhouette. Asserting on the Tailwind classes instead would pin the
   * styling rather than the behaviour.
   */
  if (portraitId === null) {
    return (
      <span
        data-testid={`member-face-${member.username}`}
        data-face="none"
        className="icon-plate flex h-full w-full items-center justify-center rounded-sm text-brass-300"
      >
        <MemberSigil
          seed={member.userId}
          name={`${member.username}, drawn`}
          className="h-4/5 w-4/5"
        />
      </span>
    );
  }
  const face = (
    <span
      data-testid={`member-face-${member.username}`}
      data-face={portraitId}
      className="block h-full w-full"
    >
      <OverseerPortrait portraitId={portraitId} aspect="fill" showTag={false} />
    </span>
  );
  return size === 'lg' ? (
    <PortraitFrame className="h-full w-full">{face}</PortraitFrame>
  ) : (
    <span className="block h-full w-full overflow-hidden rounded-sm border border-brass-500/45 shadow-lifted">
      {face}
    </span>
  );
}
