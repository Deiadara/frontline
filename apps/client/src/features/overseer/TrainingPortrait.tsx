import { OVERSEER_SUBJECT, type OfficerMark, type TrainingSubject } from '@frontline/shared';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { cn } from '../../lib/cn';
import { OfficerPortrait } from './OfficerPortrait';
import { OverseerPortrait } from './OverseerPortrait';

/**
 * Somebody on the training sheet, as a face, with their mark stamped on it when they have one.
 *
 * The frame is picked by *who* they are, never by whether they hold a chair. The tab used to branch
 * on `officerRole === null`, which is true of the Overseer and of everybody on the bench alike, so
 * a benched officer went through the Overseer's frame: that looks their pool face up among the
 * Overseer presets, finds nothing, and draws a blank silhouette where their portrait should be.
 *
 * `className` sizes the box; the portrait fills its width at its own aspect.
 */
export function TrainingPortrait({
  subject,
  stamp,
  className,
}: {
  subject: Pick<TrainingSubject, 'id' | 'name' | 'portraitId' | 'injuredUntil' | 'mark'>;
  /** Where the mark sits and how big it is. Without it no mark is drawn, as on the floor chips. */
  stamp?: string;
  className?: string;
}) {
  return (
    <span
      className={cn('relative block', className)}
      data-testid={`training-face-${subject.id}`}
      data-face={subject.id === OVERSEER_SUBJECT ? 'overseer' : 'officer'}
    >
      {subject.id === OVERSEER_SUBJECT ? (
        // The Overseer wears the portrait they chose, at the overseer frame's 3:4.
        <OverseerPortrait portraitId={subject.portraitId ?? ''} showTag={false} />
      ) : (
        // An officer, seated or benched, wears one off the pool at that pool's own 4:5.
        <OfficerPortrait
          portraitId={subject.portraitId}
          name={subject.name}
          injuredUntil={subject.injuredUntil}
          className="aspect-[4/5] w-full"
        />
      )}
      {stamp !== undefined && (
        <PortraitMark mark={subject.mark ?? null} name={subject.name} className={stamp} />
      )}
    </span>
  );
}

/**
 * The mark, the crew card's own stamp at a size a list row can carry.
 *
 * Draws nothing without a mark: the bench has no chair to be marked against, and the Overseer has
 * no grade until one is put on the wire for them. Top right, which is the one corner of every
 * portrait that is background rather than face (`CrewPage`'s note on the same stamp).
 */
export function PortraitMark({
  mark,
  name,
  className,
}: {
  mark: OfficerMark | null;
  name: string;
  className?: string;
}) {
  if (mark === null) return null;
  return (
    <MarkStamp
      mark={mark}
      className={cn('text-oxblood-300/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]', className)}
      tip={`${name}: ${mark}`}
    />
  );
}
