import { OVERSEER_PRESETS } from '@frontline/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../lib/api';
import { useCreateOverseer } from '../lib/queries';
import { Button } from '../components/ui/Button';
import { OverseerCard } from '../features/overseer/OverseerCard';

export function CharacterSelectScreen() {
  const navigate = useNavigate();
  const createOverseer = useCreateOverseer();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = OVERSEER_PRESETS.find((p) => p.presetId === selectedId) ?? null;

  const confirm = () => {
    if (!selected) return;
    createOverseer.mutate(
      { presetId: selected.presetId },
      {
        onSuccess: () => {
          void navigate('/game');
        },
      },
    );
  };

  const serverError =
    createOverseer.error instanceof ApiRequestError ? createOverseer.error.message : null;

  return (
    <main className="scanlines relative flex h-screen flex-col overflow-hidden bg-night">
      <div className="grain pointer-events-none absolute inset-0" />

      <header className="relative shrink-0 border-b border-neon-cyan/20 px-8 py-4">
        <p className="font-display text-[10px] tracking-[0.5em] text-neon-cyan/70">
          // OVERSEER SELECTION //
        </p>
        <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.2em] text-steel-100">
          CHOOSE YOUR OVERSEER
        </h1>
        <p className="mt-1 font-body text-xs text-steel-400">
          Four operators wait to run your syndicate. Each rewrites how the war is fought.
        </p>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-2">
          {OVERSEER_PRESETS.map((preset) => (
            <OverseerCard
              key={preset.presetId}
              preset={preset}
              selected={preset.presetId === selectedId}
              onSelect={() => setSelectedId(preset.presetId)}
            />
          ))}
        </div>
      </div>

      <footer className="relative flex shrink-0 items-center justify-between gap-4 border-t border-neon-cyan/20 bg-night-raised px-8 py-4">
        <div className="min-w-0">
          {selected ? (
            <p className="truncate font-display text-xs uppercase tracking-[0.2em] text-neon-cyan">
              Selected // {selected.name}
            </p>
          ) : (
            <p className="font-display text-xs uppercase tracking-[0.2em] text-steel-500">
              No overseer selected
            </p>
          )}
          {serverError && (
            <p role="alert" className="mt-1 font-body text-[11px] text-neon-magenta">
              {serverError}
            </p>
          )}
        </div>
        <Button onClick={confirm} disabled={!selected || createOverseer.isPending} size="md">
          {createOverseer.isPending ? 'Deploying…' : 'Confirm Overseer'}
        </Button>
      </footer>
    </main>
  );
}
