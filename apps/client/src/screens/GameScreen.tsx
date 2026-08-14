import { Outlet } from 'react-router-dom';
import { useMe } from '../lib/queries';
import { LeftNav } from '../features/game/LeftNav';
import { TopHud } from '../features/game/TopHud';

/** Fixed-viewport game shell: top HUD, left nav, and routed center content. */
export function GameScreen() {
  const me = useMe();
  const overseer = me.data?.overseer ?? null;
  const base = me.data?.base ?? null;

  if (!overseer || !base) {
    return (
      <main className="flex h-screen items-center justify-center bg-night">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-steel-500">
          Loading command…
        </p>
      </main>
    );
  }

  return (
    <div className="scanlines relative flex h-screen flex-col overflow-hidden bg-night">
      <div className="grain pointer-events-none absolute inset-0 z-0" />
      <TopHud
        overseer={overseer}
        faction={base.name}
        resources={base.resources}
        economy={base.economy}
      />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1">
        <LeftNav />
        <Outlet />
      </div>
    </div>
  );
}
