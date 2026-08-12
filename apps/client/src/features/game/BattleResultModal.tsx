import type { BattleResult, Resources } from '@frontline/shared';
import { RewardLine, ResourceGrid } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../lib/cn';

interface BattleResultModalProps {
  result: BattleResult;
  resources: Resources;
  targetName: string;
  onClose: () => void;
}

/** Post-battle report: outcome banner, terminal log, salvage, updated stockpile. */
export function BattleResultModal({
  result,
  resources,
  targetName,
  onClose,
}: BattleResultModalProps) {
  const won = result.winner === 'attacker';

  return (
    <Modal
      onClose={onClose}
      labelledBy="battle-outcome"
      className={cn(
        won ? 'border-neon-cyan/60 shadow-neon-cyan' : 'border-neon-magenta/60 shadow-neon-magenta',
      )}
    >
      <div
        className={cn(
          'scanlines border-b px-6 py-5 text-center',
          won ? 'border-neon-cyan/30' : 'border-neon-magenta/30',
        )}
      >
        <p className="font-display text-[10px] uppercase tracking-[0.4em] text-steel-400">
          Assault on {targetName}
        </p>
        <h2
          id="battle-outcome"
          className={cn(
            'mt-1 font-display text-4xl font-black tracking-[0.3em]',
            won ? 'text-glow-cyan text-neon-cyan' : 'text-glow-magenta text-neon-magenta',
          )}
        >
          {won ? 'VICTORY' : 'DEFEAT'}
        </h2>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
        <div className="border border-steel-800 bg-night p-3">
          {result.log.map((line, i) => (
            <p
              key={i}
              className="flex gap-2 py-0.5 font-mono text-[11px] leading-relaxed text-steel-300"
            >
              <span className={won ? 'text-neon-cyan' : 'text-neon-magenta'}>&gt;</span>
              <span>{line}</span>
            </p>
          ))}
        </div>

        <div>
          <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.25em] text-steel-400">
            Salvage
          </p>
          <div className="border border-warning/25 bg-night p-3">
            <RewardLine rewards={result.rewards} />
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.25em] text-steel-400">
            Updated Stockpile
          </p>
          <ResourceGrid resources={resources} />
        </div>
      </div>

      <div className="border-t border-steel-800 p-4">
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
