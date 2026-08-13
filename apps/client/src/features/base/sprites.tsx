import type { BuildingKind } from '@frontline/shared';
import type { ReactNode } from 'react';
import { ramps } from '../../theme/tokens';

/**
 * Code-drawn structures for the hideout village (GDD §A1), on the §A2 direction: jury-rigged scrap
 * rather than clean chrome, lit by sodium ember and hextech leak. Procedural art is the shipping
 * source (board art policy) — nothing here waits on a delivered master.
 *
 * Every sprite draws in the same 100x100 box and is anchored to the bottom edge, so a short
 * structure and a tall one still stand on the same ground line when their plots differ in height.
 */

const { ferrite, ember, hextech, bile, smog, sear } = ramps;

/** Shared roof/wall body so the six silhouettes read as one settlement, not six clip-art icons. */
function Hull({
  x,
  y,
  width,
  height,
  fill = ferrite[700],
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
}) {
  return (
    <>
      <rect x={x} y={y} width={width} height={height} fill={fill} />
      <rect x={x} y={y} width={width} height={2} fill={ferrite[500]} />
    </>
  );
}

/** A lit window — the only thing that says anybody is home. */
function Lamp({ x, y, glow = ember[300] }: { x: number; y: number; glow?: string }) {
  return <rect x={x} y={y} width={4} height={5} fill={glow} />;
}

const SPRITES: Record<BuildingKind, ReactNode> = {
  command_center: (
    <>
      <path d="M20 40 50 18 80 40Z" fill={ferrite[500]} />
      <Hull x={22} y={40} width={56} height={54} />
      <rect x={30} y={30} width={4} height={16} fill={ferrite[300]} />
      <path d="M32 30 44 26" stroke={ferrite[300]} strokeWidth={1.5} />
      <Lamp x={34} y={52} />
      <Lamp x={48} y={52} />
      <Lamp x={62} y={52} />
      <rect x={44} y={70} width={12} height={24} fill={ferrite[950]} />
      <rect x={44} y={70} width={12} height={3} fill={hextech[300]} />
      <path d="M14 94h72" stroke={ferrite[950]} strokeWidth={3} />
    </>
  ),
  reactor: (
    <>
      <Hull x={26} y={44} width={48} height={50} fill={ferrite[950]} />
      <ellipse cx={50} cy={44} rx={24} ry={8} fill={ferrite[700]} />
      <ellipse cx={50} cy={44} rx={13} ry={4.5} fill={hextech[500]} />
      <rect x={46} y={20} width={8} height={26} fill={ferrite[700]} />
      <path d="M50 20c-6-6 6-9 0-15" stroke={smog[300]} strokeWidth={2} fill="none" />
      <rect x={30} y={58} width={40} height={5} fill={hextech[700]} />
      <Lamp x={36} y={74} glow={hextech[300]} />
      <Lamp x={60} y={74} glow={hextech[300]} />
      <path d="M18 94h64" stroke={ferrite[950]} strokeWidth={3} />
    </>
  ),
  data_hub: (
    <>
      <Hull x={30} y={48} width={40} height={46} />
      <path d="M50 10 50 48" stroke={ferrite[500]} strokeWidth={3} />
      <path d="M50 14 36 26M50 14 64 26" stroke={ferrite[300]} strokeWidth={1.5} />
      <circle cx={50} cy={10} r={4} fill={sear[300]} />
      <rect x={36} y={56} width={28} height={3} fill={hextech[300]} />
      <rect x={36} y={64} width={20} height={3} fill={hextech[500]} />
      <rect x={36} y={72} width={24} height={3} fill={hextech[500]} />
      <Lamp x={58} y={80} glow={hextech[300]} />
      <path d="M22 94h56" stroke={ferrite[950]} strokeWidth={3} />
    </>
  ),
  foundry: (
    <>
      <Hull x={18} y={50} width={64} height={44} />
      <path d="M18 50 34 36 82 36 82 50Z" fill={ferrite[500]} />
      <rect x={60} y={12} width={12} height={26} fill={ferrite[700]} />
      <path d="M66 12c-7-8 7-11 0-12" stroke={smog[300]} strokeWidth={2} fill="none" />
      <path d="M26 94 26 68 44 68 44 94Z" fill={ember[500]} />
      <path d="M30 94 30 74 40 74 40 94Z" fill={ember[300]} />
      <Lamp x={54} y={60} />
      <Lamp x={68} y={60} />
      <path d="M12 94h76" stroke={ferrite[950]} strokeWidth={3} />
    </>
  ),
  barracks: (
    <>
      <path d="M16 54 50 34 84 54Z" fill={ferrite[500]} />
      <Hull x={20} y={54} width={60} height={40} />
      <rect x={44} y={72} width={12} height={22} fill={ferrite[950]} />
      <Lamp x={28} y={62} />
      <Lamp x={66} y={62} />
      <path d="M24 34 24 22 40 26" stroke={ferrite[300]} strokeWidth={2} fill="none" />
      <path d="M24 22 30 26 24 30Z" fill={sear[300]} />
      <path d="M10 94h80" stroke={ferrite[950]} strokeWidth={3} />
    </>
  ),
  wall: (
    <>
      <Hull x={8} y={52} width={84} height={42} fill={ferrite[950]} />
      <path
        d="M8 52h12v-8h12v8h12v-8h12v8h12v-8h12v8h12"
        fill="none"
        stroke={ferrite[700]}
        strokeWidth={6}
      />
      <path d="M8 64h84M8 78h84" stroke={ferrite[700]} strokeWidth={1.5} />
      <path d="M12 40q10 8 20 0t20 0 20 0 16 0" stroke={bile[500]} strokeWidth={1.5} fill="none" />
      <Lamp x={20} y={68} />
      <Lamp x={76} y={68} />
    </>
  ),
};

/** The structure's silhouette, or a marked-out empty plot when nothing has been built yet. */
export function StructureSprite({ kind, built }: { kind: BuildingKind; built: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMax meet"
      className="h-full w-full"
      aria-hidden="true"
    >
      {built ? SPRITES[kind] : <VacantPlot />}
    </svg>
  );
}

/** Staked-out ground: rubble and a survey marker, so an empty plot still reads as a place. */
function VacantPlot() {
  return (
    <>
      <path
        d="M18 92 34 62 66 62 82 92Z"
        fill="none"
        stroke={ferrite[500]}
        strokeWidth={2}
        strokeDasharray="6 5"
      />
      <path d="M48 44 48 76" stroke={ferrite[300]} strokeWidth={2} />
      <path d="M48 44 64 50 48 56Z" fill={ember[300]} />
      <path d="M26 92 34 84 42 92Z" fill={ferrite[700]} />
      <path d="M60 92 68 86 76 92Z" fill={ferrite[700]} />
      <path d="M12 94h76" stroke={ferrite[950]} strokeWidth={3} />
    </>
  );
}
