import type { BuildingKind } from '@frontline/shared';
import type { ReactNode } from 'react';
import { ramps } from '../../theme/tokens';

/**
 * Code-drawn structures for the district (GDD §A1), on the §A2 direction: jury-rigged scrap rather
 * than clean chrome, lit by sodium ember and hextech leak. Procedural art is the shipping source
 * (board art policy) — nothing here waits on a delivered master, and a delivered master drops in
 * over the top without a TypeScript edit.
 *
 * Every sprite draws in the same 100x100 box and is anchored to the bottom edge, so a short
 * structure and a tall one still stand on the same ground line when their plots differ in height.
 *
 * Thirteen silhouettes have to be told apart at plot size, side by side, in one palette. Each is
 * therefore built around one unmistakable *shape* — a drum, a barrel vault, paired cylinders, an
 * open bay — rather than around detail that dissolves below 90px. `sprites.test.tsx` pins that no
 * two are identical and that every kind has one.
 */

const { ferrite, ember, hextech, bile, smog, sear } = ramps;

/** Shared roof/wall body so the silhouettes read as one settlement, not thirteen clip-art icons. */
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

/** The ground line every structure stands on. Width varies with the footprint. */
function Ground({ x = 12, width = 76 }: { x?: number; width?: number }) {
  return <path d={`M${x} 94h${width}`} stroke={ferrite[950]} strokeWidth={3} />;
}

const SPRITES: Record<BuildingKind, ReactNode> = {
  // A drum with a canted observation ring — the only round-shouldered mass, and the tallest.
  nexus: (
    <>
      <path d="M20 40 50 18 80 40Z" fill={ferrite[500]} />
      <Hull x={22} y={40} width={56} height={54} />
      <rect x={30} y={30} width={4} height={16} fill={ferrite[300]} />
      <path d="M32 30 44 26" stroke={ferrite[300]} strokeWidth={1.5} />
      <Lamp x={34} y={52} glow={hextech[300]} />
      <Lamp x={48} y={52} glow={hextech[300]} />
      <Lamp x={62} y={52} glow={hextech[300]} />
      <rect x={44} y={70} width={12} height={24} fill={ferrite[950]} />
      <rect x={44} y={70} width={12} height={3} fill={hextech[300]} />
      <Ground />
    </>
  ),
  // Three stacked containers, offset — the only stepped silhouette.
  quarters: (
    <>
      <Hull x={16} y={62} width={68} height={32} fill={ferrite[950]} />
      <Hull x={22} y={42} width={52} height={20} />
      <Hull x={30} y={24} width={36} height={18} fill={ferrite[500]} />
      <path d="M84 62 84 42 74 42" stroke={ferrite[300]} strokeWidth={1.5} fill="none" />
      <path d="M74 42 74 24 66 24" stroke={ferrite[300]} strokeWidth={1.5} fill="none" />
      <rect x={44} y={16} width={3} height={9} fill={ferrite[700]} />
      <path d="M45 16c-4-5 4-7 0-9" stroke={smog[300]} strokeWidth={1.5} fill="none" />
      <Lamp x={26} y={70} />
      <Lamp x={54} y={70} />
      <Lamp x={38} y={48} />
      <Ground x={10} width={80} />
    </>
  ),
  // A barrel vault of glazing — the only curved roof, and the only green mass.
  greenhouse: (
    <>
      <path d="M12 94 12 62q38-30 76 0v32Z" fill={ferrite[950]} />
      <path d="M18 94 18 64q32-24 64 0v30Z" fill={bile[700]} opacity={0.55} />
      <path
        d="M32 94 32 56M50 94 50 50M68 94 68 56"
        stroke={ferrite[500]}
        strokeWidth={1.5}
        fill="none"
      />
      <path d="M12 62q38-30 76 0" fill="none" stroke={ferrite[500]} strokeWidth={2.5} />
      <rect x={22} y={72} width={56} height={4} fill={bile[300]} opacity={0.7} />
      <rect x={82} y={54} width={10} height={40} fill={ferrite[700]} />
      <Ground x={8} width={84} />
    </>
  ),
  // A fat drum in a cradle with three stacks — the warm-dominant mass.
  generator: (
    <>
      <Hull x={26} y={44} width={48} height={50} fill={ferrite[950]} />
      <ellipse cx={50} cy={44} rx={24} ry={8} fill={ferrite[700]} />
      <ellipse cx={50} cy={44} rx={13} ry={4.5} fill={ember[300]} />
      <rect x={40} y={20} width={5} height={26} fill={ferrite[700]} />
      <rect x={48} y={14} width={5} height={32} fill={ferrite[700]} />
      <rect x={56} y={22} width={5} height={24} fill={ferrite[700]} />
      <path d="M50 14c-6-6 6-9 0-15" stroke={smog[300]} strokeWidth={2} fill="none" />
      <rect x={30} y={58} width={40} height={5} fill={ember[500]} />
      <rect x={12} y={70} width={12} height={24} fill={ferrite[700]} />
      <path d="M24 76h4" stroke={ferrite[300]} strokeWidth={2} />
      <Lamp x={36} y={74} glow={ember[300]} />
      <Lamp x={60} y={74} glow={ember[300]} />
      <Ground x={8} width={84} />
    </>
  ),
  // Widest and lowest, with a gantry over a heap — the cluttered one.
  scrapyard: (
    <>
      <Hull x={14} y={56} width={52} height={38} />
      <path d="M14 56 28 44 66 44 66 56Z" fill={ferrite[500]} />
      <path d="M70 94 70 34 94 34" stroke={ferrite[500]} strokeWidth={3} fill="none" />
      <path d="M84 34 84 48" stroke={ferrite[300]} strokeWidth={1.5} />
      <rect x={78} y={48} width={12} height={8} fill={ferrite[700]} />
      <path d="M68 94 78 76 92 94Z" fill={ferrite[950]} />
      <path d="M22 94 22 72 40 72 40 94Z" fill={ferrite[950]} />
      <path d="M26 82 34 74" stroke={sear[300]} strokeWidth={2} />
      <Lamp x={48} y={64} />
      <Ground x={8} width={84} />
    </>
  ),
  // Two riveted tanks of different heights, joined by a pipe bridge. The only paired cylinders.
  cistern: (
    <>
      <rect x={14} y={40} width={32} height={54} fill={ferrite[700]} />
      <ellipse cx={30} cy={40} rx={16} ry={6} fill={ferrite[500]} />
      <rect x={56} y={56} width={28} height={38} fill={ferrite[700]} />
      <ellipse cx={70} cy={56} rx={14} ry={5} fill={ferrite[500]} />
      <path d="M46 50 56 50" stroke={ferrite[300]} strokeWidth={3} />
      <path d="M14 62h32M56 72h28" stroke={ferrite[950]} strokeWidth={1.5} />
      <rect x={26} y={76} width={8} height={18} fill={ferrite[950]} />
      <Lamp x={64} y={64} glow={hextech[300]} />
      <path d="M84 84q6 6 8 10" stroke={hextech[500]} strokeWidth={1.5} fill="none" />
      <Ground x={10} width={80} />
    </>
  ),
  // A shuttered block with one lit hatch — the only closed front.
  apothecary: (
    <>
      <Hull x={18} y={44} width={64} height={50} fill={ferrite[950]} />
      <path d="M18 44 82 44 82 38 18 38Z" fill={ferrite[500]} />
      <rect x={26} y={58} width={34} height={26} fill={ferrite[700]} />
      <path
        d="M26 62h34M26 68h34M26 74h34M26 80h34"
        stroke={ferrite[950]}
        strokeWidth={1.5}
        fill="none"
      />
      <rect x={66} y={62} width={12} height={14} fill={ferrite[500]} />
      <rect x={68} y={64} width={8} height={10} fill={ember[300]} />
      <path d="M70 66h4M72 64v10" stroke={ferrite[950]} strokeWidth={1.5} />
      <Ground x={12} width={76} />
    </>
  ),
  // Lowest and widest by a distance — reads horizontal against everything else.
  gate: (
    <>
      <Hull x={4} y={58} width={92} height={36} fill={ferrite[950]} />
      <path
        d="M4 58h12v-8h12v8h12v-8h12v8h12v-8h12v8h12v-8h8"
        fill="none"
        stroke={ferrite[700]}
        strokeWidth={6}
      />
      <path d="M4 70h92M4 82h92" stroke={ferrite[700]} strokeWidth={1.5} />
      <rect x={40} y={66} width={20} height={28} fill={ferrite[700]} />
      <path d="M40 66 60 94" stroke={ferrite[500]} strokeWidth={1.5} />
      <path d="M8 46q10 8 20 0t20 0 20 0 20 0" stroke={bile[500]} strokeWidth={1.5} fill="none" />
      <Lamp x={18} y={72} />
      <Lamp x={78} y={72} />
    </>
  ),
  // A wide awning over an open front — the only structure you can see into.
  commons: (
    <>
      <Hull x={20} y={52} width={60} height={42} fill={ferrite[950]} />
      <path d="M6 52 94 52 88 44 12 44Z" fill={ferrite[500]} />
      <rect x={28} y={62} width={44} height={20} fill={hextech[700]} opacity={0.45} />
      <rect x={34} y={66} width={32} height={12} fill={hextech[300]} opacity={0.5} />
      <rect x={8} y={78} width={18} height={4} fill={ferrite[700]} />
      <rect x={74} y={78} width={18} height={4} fill={ferrite[700]} />
      <rect x={12} y={82} width={3} height={12} fill={ferrite[700]} />
      <rect x={85} y={82} width={3} height={12} fill={ferrite[700]} />
      <path d="M22 40q8-6 16 0" stroke={sear[300]} strokeWidth={1.5} fill="none" />
      <Lamp x={44} y={86} />
      <Ground x={6} width={88} />
    </>
  ),
  // Tallest and thinnest — a louvred slab with banded status light.
  lab: (
    <>
      <Hull x={34} y={26} width={32} height={68} fill={ferrite[950]} />
      <rect x={38} y={34} width={24} height={3} fill={hextech[300]} />
      <rect x={38} y={42} width={18} height={3} fill={hextech[500]} />
      <rect x={38} y={50} width={22} height={3} fill={hextech[500]} />
      <rect x={38} y={58} width={16} height={3} fill={hextech[300]} />
      <path d="M50 26 50 12" stroke={ferrite[500]} strokeWidth={2} />
      <circle cx={50} cy={10} r={3} fill={sear[300]} />
      <path d="M34 78 20 88M66 78 80 88" stroke={ferrite[500]} strokeWidth={2} fill="none" />
      <Lamp x={44} y={80} glow={hextech[300]} />
      <Ground x={18} width={64} />
    </>
  ),
  // Mostly open ground — the one plot that reads as an area rather than a building.
  gauntlet: (
    <>
      <Hull x={68} y={62} width={26} height={32} fill={ferrite[950]} />
      <path d="M8 94 8 52 34 52 34 94" fill="none" stroke={ferrite[700]} strokeWidth={3} />
      <path d="M8 62h26M8 72h26M8 82h26" stroke={ferrite[500]} strokeWidth={2} />
      <path d="M40 94 40 66 58 66" fill="none" stroke={ferrite[700]} strokeWidth={3} />
      <path d="M44 78q6-8 12 0" stroke={ferrite[500]} strokeWidth={1.5} fill="none" />
      <rect x={58} y={20} width={3} height={44} fill={ferrite[700]} />
      <path d="M52 20 68 20 66 26 54 26Z" fill={sear[300]} opacity={0.7} />
      <Lamp x={76} y={72} />
      <Ground x={4} width={92} />
    </>
  ),
  // The tidiest thing on the ground, with a ramp — deliberately at odds with its neighbours.
  infirmary: (
    <>
      <Hull x={24} y={48} width={52} height={46} fill={ferrite[500]} />
      <path d="M24 48 76 48 70 40 30 40Z" fill={ferrite[700]} />
      <rect x={42} y={64} width={16} height={30} fill={ferrite[950]} />
      <rect x={44} y={66} width={12} height={16} fill={hextech[300]} opacity={0.75} />
      <path d="M12 94 24 82 24 94Z" fill={ferrite[700]} />
      <path d="M32 54h12M38 50v12" stroke={sear[300]} strokeWidth={2.5} />
      <rect x={64} y={70} width={5} height={16} fill={ferrite[700]} />
      <rect x={70} y={74} width={5} height={12} fill={ferrite[700]} />
      <rect x={40} y={32} width={20} height={8} fill={ferrite[950]} />
      <Ground x={10} width={80} />
    </>
  ),
  // A deep open bay under a gantry — the only silhouette that reads as an interior.
  garage: (
    <>
      <Hull x={10} y={40} width={80} height={54} fill={ferrite[950]} />
      <path d="M10 40 90 40 82 30 18 30Z" fill={ferrite[700]} />
      <path d="M22 94 22 52 78 52 78 94Z" fill={smog[950]} />
      <path d="M18 56 82 56" stroke={ferrite[500]} strokeWidth={3} />
      <rect x={34} y={44} width={4} height={12} fill={ferrite[300]} />
      <path d="M30 74 46 74 50 82 26 82Z" fill={ferrite[700]} />
      <circle cx={32} cy={84} r={5} fill={ferrite[950]} />
      <circle cx={46} cy={84} r={5} fill={ferrite[950]} />
      <path d="M56 70 76 62M56 70 76 78" stroke={ferrite[500]} strokeWidth={2} fill="none" />
      <Lamp x={62} y={84} />
      <Ground x={6} width={88} />
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
      <Ground />
    </>
  );
}
