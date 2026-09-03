import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './lib/queries';
import { useSession } from './store/session';
import { TooltipLayer } from './components/ui/TooltipLayer';
import { AuthScreen } from './screens/AuthScreen';
import { CharacterSelectScreen } from './screens/CharacterSelectScreen';
import { GameScreen } from './screens/GameScreen';
import { CrewPage } from './features/crew/CrewPage';
import { BarPage } from './features/bar/BarPage';
import { BasePanel } from './features/base/BasePanel';
import { DistrictView } from './features/city/DistrictView';
import { FactionPage } from './features/faction/FactionPage';
import { MessagesPage } from './features/social/MessagesPage';
import { NotificationsPage } from './features/social/NotificationsPage';
import { BattlePage } from './features/battle/BattlePage';
import { UnitsPage } from './features/units/UnitsPage';
import { ActionsPage } from './features/actions/ActionsPage';
import { CrewEffectsPage } from './features/crew/CrewEffectsPage';
import { LeaderboardPage } from './features/leaderboard/LeaderboardPage';
import { CityView } from './features/game/CityView';
import { MissionsPage } from './features/missions/MissionsPage';
import { ResearchPage } from './features/research/ResearchPage';
import { TrainingPage } from './features/overseer/TrainingPage';
import { OverseerProfilePage } from './features/overseer/OverseerProfilePage';
import { MarketPage } from './features/market/MarketPage';
import { BlackMarketPage } from './features/market/BlackMarketPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AdminPage } from './features/admin/AdminPage';
import { InventoryPage } from './features/inventory/InventoryPage';
import { BlueprintsPage } from './features/satchel/BlueprintsPage';
import { WorkshopPage } from './features/workshop/WorkshopPage';
import { ScrapyardPage } from './features/scrapyard/ScrapyardPage';
import { GaragePage } from './features/garage/GaragePage';
import {
  RequireAuth,
  RequireGuest,
  RequireLevel,
  RequireNoOverseer,
  RequireOverseer,
} from './routes/guards';

function BootMessage({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'error' }) {
  return (
    <main className="relative flex h-screen flex-col items-center justify-center bg-surface-950">
      <div className="grain pointer-events-none absolute inset-0" />
      <span className="relative h-2 w-2 animate-pulse bg-brass-300" />
      <p
        className={`relative mt-4 font-display text-xs uppercase tracking-[0.22em] ${
          tone === 'error' ? 'text-oxblood-300' : 'text-brass-300'
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
    return <BootMessage text="Uplink failed. Reload to try again." tone="error" />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BootGate>
      {/* One listener for every `data-tip` in the game: see `TooltipLayer`. Mounted at the root
          rather than per screen, so a name drawn over the HUD and a name drawn over a dialog are
          the same object and cannot drift apart. */}
      <TooltipLayer />
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
          <Route index element={<CityView />} />
          <Route path="base" element={<BasePanel />} />
          <Route path="city/:districtId" element={<DistrictView />} />
          <Route path="actions" element={<ActionsPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="battles" element={<BattlePage />} />
          <Route path="faction" element={<FactionPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="units" element={<UnitsPage />} />
          <Route path="missions" element={<MissionsPage />} />
          {/* §I3: four screens open on a level. `RequireLevel` draws the door rather than
              redirecting, so a player who arrives early is told what opens it. */}
          <Route
            path="bar"
            element={
              <RequireLevel area="bar">
                <BarPage />
              </RequireLevel>
            }
          />
          <Route
            path="research"
            element={
              <RequireLevel area="research">
                <ResearchPage />
              </RequireLevel>
            }
          />
          <Route path="crew" element={<CrewPage />} />
          <Route path="crew/effects" element={<CrewEffectsPage />} />
          <Route
            path="training"
            element={
              <RequireLevel area="training">
                <TrainingPage />
              </RequireLevel>
            }
          />
          <Route path="overseer" element={<OverseerProfilePage />} />
          <Route
            path="market"
            element={
              <RequireLevel area="market">
                <MarketPage />
              </RequireLevel>
            }
          />
          <Route
            path="market/black"
            element={
              <RequireLevel area="market">
                <BlackMarketPage />
              </RequireLevel>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/blueprints" element={<BlueprintsPage />} />
          <Route path="workshop" element={<WorkshopPage />} />
          {/* §B9: the Scrapyard's own page, reached from the plot's dialog rather than the nav. */}
          <Route path="scrapyard" element={<ScrapyardPage />} />
          {/* §B11: the Garage has a page rather than a dialog, because its whole value is a list. */}
          <Route path="garage" element={<GaragePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/game" replace />} />
      </Routes>
    </BootGate>
  );
}
