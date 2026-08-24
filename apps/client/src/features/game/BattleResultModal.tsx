import type { BattleResult, LevelUp, Resources } from '@frontline/shared';
import { LevelUpBanner } from '../../components/LevelUp';
import { RewardLine, ResourceGrid } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';

interface BattleResultModalProps {
  result: BattleResult;
  resources: Resources;
  targetName: string;
  /** §I1 pays for the raid win or lose — set only when this raid's XP crossed a level. */
  levelUp?: LevelUp | undefined;
  onClose: () => void;
}

/** Post-battle report: outcome banner, terminal log, salvage, level-up, updated stockpile. */
export function BattleResultModal({
  result,
  resources,
  targetName,
  levelUp,
  onClose,
}: BattleResultModalProps) {
  const won = result.winner === 'attacker';

  return (
    <Modal
      onClose={onClose}
      labelledBy="battle-outcome"
      className={cn(won ? 'border-brass-500 shadow-brass' : 'border-oxblood-500 shadow-lifted')}
    >
      <div
        className={cn(
          'border-b px-6 py-5 text-center',
          won ? 'border-brass-300/30' : 'border-oxblood-500/30',
        )}
      >
        <p className="font-display text-[11px] uppercase tracking-[0.24em] text-ink-300">
          Assault on {targetName}
        </p>
        <h2
          id="battle-outcome"
          className={cn(
            'mt-1 font-display text-4xl font-black tracking-[0.2em]',
            won ? 'text-brass-300' : 'text-oxblood-300',
          )}
        >
          {won ? 'VICTORY' : 'DEFEAT'}
        </h2>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
        {/* First in the scroller: the raid is over, and this is the part that changed the player. */}
        {levelUp && <LevelUpBanner levelUp={levelUp} />}

        <div className="border border-surface-700 bg-surface-950 p-3">
          {result.log.map((line, i) => (
            <p
              key={i}
              className="flex gap-2 py-0.5 font-mono text-[12px] leading-relaxed text-ink-200"
            >
              <span className={won ? 'text-brass-300' : 'text-oxblood-300'}>&gt;</span>
              <span>{line}</span>
            </p>
          ))}
        </div>

        <div>
          <p className="mb-1.5 font-display text-[11px] uppercase tracking-[0.25em] text-ink-300">
            Salvage
          </p>
          <div className="border border-warning/25 bg-surface-950 p-3">
            <RewardLine rewards={result.rewards} />
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-display text-[11px] uppercase tracking-[0.25em] text-ink-300">
            Updated Stockpile
          </p>
          <ResourceGrid resources={resources} />
        </div>
      </div>

      <div className="border-t border-surface-700 p-4">
        <Button
          variant={won ? 'primary' : 'danger'}
          onClick={onClose}
          className="w-full justify-center"
        >
          Dismiss
        </Button>
      </div>
    </Modal>
  );
}
