import {
  isDistrictAttackable,
  type Base,
  type BaseSummary,
  type District,
  type DistrictKind,
} from '@frontline/shared';
import { Link } from 'react-router-dom';
import { RewardLine, ResourceGrid } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';

const KIND_LABEL: Record<DistrictKind, string> = {
  player_base: 'Player Base',
  raid: 'Raid Site',
  market: 'Market',
  npc_stronghold: 'NPC Stronghold',
};

interface ContextPanelProps {
  selected: District | null;
  myBase: Base;
  /** Public base summaries from `/city` — used to spot an AI rival on the selected node. */
  bases: readonly BaseSummary[];
  onAttack: (district: District) => void;
  isAttacking: boolean;
}

/** Right-hand detail panel: own base summary, hostile target intel, or a prompt. */
export function ContextPanel({
  selected,
  myBase,
  bases,
  onAttack,
  isAttacking,
}: ContextPanelProps) {
  if (!selected) {
    return (
      <Panel title="Intel" className="h-full">
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="font-body text-xs leading-relaxed text-steel-500">
            Select a district on the map to inspect it. Raid sites, strongholds and hostile AI bases
            can be attacked; markets and rival players hold the line.
          </p>
        </div>
      </Panel>
    );
  }

  const isMyBase = selected.id === myBase.districtId;
  const botBase = bases.find((b) => b.isBot && b.districtId === selected.id) ?? null;
  // Same rule the server enforces on POST /battle — see @frontline/shared.
  const attackable = isDistrictAttackable(selected, {
    isOwnBase: isMyBase,
    hasBotBase: botBase !== null,
  });

  return (
    <Panel title="Intel" className="h-full">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <h3 className="text-glow-cyan font-display text-lg font-bold tracking-wide text-steel-100">
            {selected.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={
                botBase
                  ? 'border border-neon-magenta/40 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.2em] text-neon-magenta'
                  : 'border border-neon-cyan/30 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.2em] text-neon-cyan'
              }
            >
              {botBase ? 'Rival Base' : KIND_LABEL[selected.kind]}
            </span>
            <span className="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">
              Difficulty {selected.difficulty}/10
            </span>
          </div>
        </div>

        {isMyBase ? (
          <div className="flex flex-col gap-3">
            <div className="border border-neon-cyan/20 bg-night p-3">
              <p className="font-display text-xs font-semibold tracking-[0.15em] text-neon-cyan">
                {myBase.name}
              </p>
              <p className="mt-0.5 font-body text-[11px] text-steel-400">
                Level {myBase.level} · Your stronghold
              </p>
            </div>
            <ResourceGrid resources={myBase.resources} />
            <Link to="/game/base" className="w-full">
              <Button className="w-full justify-center">Manage Base</Button>
            </Link>
          </div>
        ) : attackable ? (
          <div className="flex flex-col gap-3">
            {botBase && (
              <div className="border border-neon-magenta/25 bg-night p-3">
                <p className="font-display text-xs font-semibold tracking-[0.15em] text-neon-magenta">
                  {botBase.name}
                </p>
                <p className="mt-0.5 font-body text-[11px] text-steel-400">
                  Level {botBase.level} · Hostile
                </p>
              </div>
            )}
            <div>
              <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.25em] text-steel-400">
                Projected Salvage
              </p>
              <div className="border border-warning/25 bg-night p-3">
                <RewardLine rewards={selected.rewards} />
              </div>
            </div>
            <Button
              variant="danger"
              disabled={isAttacking}
              onClick={() => onAttack(selected)}
              className="w-full justify-center"
            >
              {isAttacking ? 'Engaging…' : 'Launch Attack'}
            </Button>
          </div>
        ) : (
          <p className="border border-steel-700 bg-night p-3 font-body text-xs leading-relaxed text-steel-400">
            {selected.kind === 'market'
              ? 'A neutral trading hub. Market operations arrive in a later milestone.'
              : 'Rival territory. Player-versus-player sieges are not open this milestone.'}
          </p>
        )}
      </div>
    </Panel>
  );
}
