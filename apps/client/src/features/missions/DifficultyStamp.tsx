import { OFFICER_MARKS, type OfficerMark } from '@frontline/shared';
import { useId } from 'react';
import { cn } from '../../lib/cn';

/**
 * The grade letters, drawn with a marker rather than set in a face (maintainer, 2026-09-28).
 *
 * Each is a few strokes in a 36 by 40 box, bowed a little the way a hand does not quite rule a
 * line. Only the seven letters the mark scale uses: F is the easiest job, S the hardest.
 */
const LETTER_STROKES: Readonly<Record<string, string>> = {
  F: 'M5 3 Q18 1 31 4 M6 3 Q5 22 7 39 M6 20 Q16 18 25 21',
  E: 'M5 3 Q18 1 30 4 M6 3 Q5 22 6 39 M6 39 Q18 38 31 40 M6 20 Q15 19 24 22',
  D: 'M6 3 Q5 22 6 39 M6 3 C34 0 37 40 6 39',
  C: 'M31 8 C24 -2 4 2 4 21 C4 40 24 42 32 33',
  B: 'M6 3 Q5 22 6 39 M6 3 C29 0 30 19 7 20 M7 20 C34 18 34 42 6 39',
  A: 'M3 40 Q12 20 18 2 Q24 20 33 40 M9 26 Q18 24 27 27',
  S: 'M31 7 C26 -1 6 0 6 11 C6 21 30 18 30 30 C30 42 8 42 3 33',
};

/** The plus and minus, drawn at the letter's shoulder the way a marker grades a paper. */
const MODIFIER_STROKES: Readonly<Record<string, string>> = {
  '+': 'M0 8 Q7 7 13 8 M6.5 1 Q6 8 7 15',
  '-': 'M0 8 Q7 7 13 8',
};

/** The letter's size in the stamp, and where the stencil bridge cuts across it. */
const LETTER_SCALE = 0.68;
const LETTER_TOP = 32;
const BRIDGE_Y = LETTER_TOP + 14 * LETTER_SCALE;

/** The scale along the foot: one tick per mark, F- at the left, S+ at the right. */
const RULER_LEFT = 20;
const RULER_WIDTH = 80;
const RULER_STEP = RULER_WIDTH / (OFFICER_MARKS.length - 1);
const RULER_Y = 72;

/**
 * A job's difficulty, pressed onto the brief like a stamp (maintainer, 2026-09-28).
 *
 * Drawn as a checkpoint stamp rather than a clerk's: a chamfered double frame, DIFFICULTY cut out
 * of a solid bar in the display face, the grade stencilled underneath with a bridge through it,
 * and a ruler along the foot with a notch where this grade sits between F- and S+, so the letter
 * reads against the whole scale at a glance. The frame and the letter go through a pen wobble (the
 * displacement `DrawnMarks.tsx` uses) and everything through a speckle mask, so it reads as
 * pressed rather than printed. The ink says the band before the letter does: verdigris for F to
 * D, brass for C and B, oxblood from A up.
 */
export function DifficultyStamp({ mark, className }: { mark: OfficerMark; className?: string }) {
  const id = useId();
  const letter = mark[0] ?? 'F';
  const modifier = mark[1];
  const ink = 'FED'.includes(letter)
    ? 'text-verdigris-100'
    : 'CB'.includes(letter)
      ? 'text-brass-300'
      : 'text-oxblood-300';
  // A graded letter sits left of centre so the letter and its mark are centred as a pair.
  const letterX = modifier === undefined ? 47.8 : 42;
  const notchX = RULER_LEFT + OFFICER_MARKS.indexOf(mark) * RULER_STEP;

  return (
    <svg
      viewBox="0 0 120 84"
      role="img"
      aria-label={`Difficulty ${mark}`}
      data-testid="difficulty-stamp"
      data-mark={mark}
      className={cn('-rotate-6 overflow-visible', ink, className)}
    >
      <defs>
        <filter id={`pen-${id}`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="5" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="2.2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/* Worn ink: a speckle of gaps where the stamp did not quite meet the paper. */}
        <filter id={`wear-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.6 2.3" />
        </filter>
        <mask id={`ink-${id}`} maskUnits="userSpaceOnUse" x="-10" y="-10" width="140" height="104">
          <rect x="-10" y="-10" width="140" height="104" filter={`url(#wear-${id})`} />
        </mask>
        {/* The caption is the paper showing through the bar, the way a cut stamp prints it. */}
        <mask id={`caption-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="84">
          <rect x="9" y="9" width="102" height="18" fill="white" />
          <text
            x="60"
            y="23"
            textAnchor="middle"
            fill="black"
            style={{ font: '700 14px "Roboto Condensed", sans-serif', letterSpacing: '0.14em' }}
          >
            DIFFICULTY
          </text>
        </mask>
        {/* The stencil bridge: one cut straight across the grade. */}
        <mask id={`stencil-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="84">
          <rect width="120" height="84" fill="white" />
          <rect x="0" y={BRIDGE_Y} width="120" height="1.8" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#ink-${id})`} opacity="0.9">
        <path
          d="M17 9 H103 L111 17 V27 H9 V17 Z"
          fill="currentColor"
          mask={`url(#caption-${id})`}
        />
        <g
          filter={`url(#pen-${id})`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 4 H107 L116 13 V71 L107 80 H13 L4 71 V13 Z" strokeWidth="3.2" />
          <path d="M17 9 H103 L111 17 V67 L103 75 H17 L9 67 V17 Z" strokeWidth="1" />
          <g mask={`url(#stencil-${id})`}>
            <path
              d={LETTER_STROKES[letter]}
              transform={`translate(${letterX} ${LETTER_TOP}) scale(${LETTER_SCALE})`}
              strokeWidth="7"
            />
            {modifier !== undefined && (
              <path
                d={MODIFIER_STROKES[modifier]}
                transform={`translate(${letterX + 27} ${LETTER_TOP}) scale(${LETTER_SCALE})`}
                strokeWidth="5"
              />
            )}
          </g>
        </g>
        <g stroke="currentColor" strokeWidth="0.9">
          <path d={`M${RULER_LEFT} ${RULER_Y} H${RULER_LEFT + RULER_WIDTH}`} />
          {OFFICER_MARKS.map((tick, index) => (
            <path
              key={tick}
              d={`M${RULER_LEFT + index * RULER_STEP} ${RULER_Y} v${index % 3 === 0 ? -3.5 : -1.8}`}
            />
          ))}
        </g>
        <path
          d={`M${notchX - 3} ${RULER_Y - 8} h6 l-3 4.5 Z`}
          fill="currentColor"
          data-testid="difficulty-notch"
        />
      </g>
    </svg>
  );
}
