import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './lib/queries';
import { useSession } from './store/session';
import { AuthScreen } from './screens/AuthScreen';
import { CharacterSelectScreen } from './screens/CharacterSelectScreen';
import { GameScreen } from './screens/GameScreen';
import { BarPage } from './features/bar/BarPage';
import { BasePanel } from './features/base/BasePanel';
import { MapView } from './features/game/MapView';
import { MissionsPage } from './features/missions/MissionsPage';
import { RequireAuth, RequireGuest, RequireNoOverseer, RequireOverseer } from './routes/guards';

function BootMessage({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'error' }) {
  return (
    <main className="scanlines relative flex h-screen flex-col items-center justify-center bg-night">
      <div className="grain pointer-events-none absolute inset-0" />
      <span className="relative h-2 w-2 animate-pulse bg-neon-cyan" />
      <p
        className={`relative mt-4 font-display text-xs uppercase tracking-[0.35em] ${
          tone === 'error' ? 'text-neon-magenta' : 'text-neon-cyan'
        }`}
      >
        {text}
      </p>
    </main>
  );
}

/** Holds the boot loader open until the persisted session's `GET /api/me` resolves. */
function BootGate({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  const me = useMe();
  if (token !== null && me.isLoading) return <BootMessage text="Establishing uplink…" />;
  if (token !== null && me.isError) {
    return <BootMessage text="Uplink failed — reload to retry" tone="error" />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BootGate>
      <Routes>
        <Route
          path="/auth"
          element={
            <RequireGuest>
              <AuthScreen />
            </RequireGuest>
          }
        />
        <Route
          path="/overseer"
          element={
            <RequireAuth>
              <RequireNoOverseer>
                <CharacterSelectScreen />
              </RequireNoOverseer>
            </RequireAuth>
          }
        />
        <Route
          path="/game"
          element={
            <RequireAuth>
              <RequireOverseer>
                <GameScreen />
              </RequireOverseer>
            </RequireAuth>
          }
        >
          <Route index element={<MapView />} />
          <Route path="base" element={<BasePanel />} />
          <Route path="missions" element={<MissionsPage />} />
          <Route path="bar" element={<BarPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/game" replace />} />
      </Routes>
    </BootGate>
  );
}
