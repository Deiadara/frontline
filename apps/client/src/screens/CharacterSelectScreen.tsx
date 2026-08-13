import { OVERSEER_PRESETS } from '@frontline/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../lib/api';
import { useCreateOverseer } from '../lib/queries';
import { Button } from '../components/ui/Button';
import { OverseerCard } from '../features/overseer/OverseerCard';

interface RowLayout {
  /** Viewport height that shows a whole number of card rows; `undefined` until first measured. */
  readonly height: number | undefined;
  /** Cards left below the cut, which the scroll hint has to advertise. */
  readonly hiddenCards: number;
}

const UNMEASURED: RowLayout = { height: undefined, hiddenCards: 0 };

/** Bottom edge of every card, relative to the grid's top. */
function cardBottoms(grid: HTMLElement): number[] {
  const gridTop = grid.getBoundingClientRect().top;
  return [...grid.children].map((card) => card.getBoundingClientRect().bottom - gridTop);
}

/**
 * Size the scroll viewport to whole card rows.
 *
 * A viewport that ends part-way down a row slices its cards through the middle of the attribute
 * digits, which reads as a rendering fault however little scrolling would recover it. Ending on a
 * row boundary instead means an overflowing roster simply shows fewer cards — a state the scroll
 * hint below explains, and which `snap-y snap-mandatory` keeps true once the player scrolls.
 */
function measureRows(frame: HTMLElement, grid: HTMLElement, hint: HTMLElement | null): RowLayout {
  const bottoms = cardBottoms(grid);
  if (bottoms.length === 0) return UNMEASURED;

  const style = getComputedStyle(frame);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  // The hint is rendered inside the frame, so it spends the space it advertises.
  const available = frame.clientHeight - padding - (hint?.offsetHeight ?? 0);

  const rowBottoms = [...new Set(bottoms)].sort((a, b) => a - b);
  const fitting = rowBottoms.filter((bottom) => bottom <= available + 0.5);
  // A row taller than the frame has nowhere to go but scroll; never collapse to nothing.
  const height = fitting.at(-1) ?? available;

  return { height, hiddenCards: bottoms.filter((bottom) => bottom > height + 0.5).length };
}

export function CharacterSelectScreen() {
  const navigate = useNavigate();
  const createOverseer = useCreateOverseer();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<RowLayout>(UNMEASURED);

  const frameRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);

  // Re-runs when the hint appears or disappears, because that changes the space left for rows.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const grid = gridRef.current;
    if (!frame || !grid) return undefined;

    const measure = () => {
      const next = measureRows(frame, grid, hintRef.current);
      setRows((prev) =>
        prev.height === next.height && prev.hiddenCards === next.hiddenCards ? prev : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [rows.hiddenCards]);

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

      <header className="relative shrink-0 border-b border-neon-cyan/20 px-8 py-3">
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

      {/* Centred so the space a dropped row leaves over reads as framing, not as a dead band. */}
      <div
        ref={frameRef}
        className="relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-8 py-3"
      >
        <div
          className="mx-auto w-full max-w-5xl snap-y snap-mandatory overflow-y-auto"
          style={{ maxHeight: rows.height }}
        >
          <div ref={gridRef} className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
        {rows.hiddenCards > 0 && (
          <p
            ref={hintRef}
            // Padding, not margin: `measureRows` budgets for the hint by `offsetHeight`.
            className="shrink-0 pt-1.5 text-center font-display text-[9px] uppercase tracking-[0.3em] text-neon-cyan/70"
          >
            ▼ Scroll for {rows.hiddenCards} more {rows.hiddenCards === 1 ? 'overseer' : 'overseers'}
          </p>
        )}
      </div>

      <footer className="relative flex shrink-0 items-center justify-between gap-4 border-t border-neon-cyan/20 bg-night-raised px-8 py-3">
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
