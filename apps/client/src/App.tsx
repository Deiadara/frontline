import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './lib/queries';
import { useSoundLayer } from './lib/sound';
import { installLastPress } from './lib/lastPress';
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
import { CrewProfilePage } from './features/profile/CrewProfilePage';
import { FactionProfilePage } from './features/faction/FactionProfilePage';
import { MarketPage } from './features/market/MarketPage';
import { OffersPage } from './features/market/OffersPage';
import { BlackMarketPage } from './features/market/BlackMarketPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AdminPage } from './features/admin/AdminPage';
import { ScrapyardPage } from './features/scrapyard/ScrapyardPage';
import { FeatsPage } from './features/feats/FeatsPage';
import { LevelLadderPage } from './features/standing/LevelLadderPage';
import { NotorietyLadderPage } from './features/standing/NotorietyLadderPage';
import { LEVEL_LADDER_ROUTE, NOTORIETY_LADDER_ROUTE } from './components/Meters';
import {
  RequireAuth,
  RequireGuest,
  RequireUnlock,
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
  // One listener for every button and link in the game, and one gesture unlock for the browser's
  // autoplay policy: see `lib/sound.ts`. A hook rather than a mounted component because it also
  // has to read the account's volume off `/me`.
  useSoundLayer();
  // And one more, for where the last press landed: a spend's receipt floats off that button
  // rather than off the chip. See `lib/lastPress.ts`.
  useEffect(() => installLastPress(), []);

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
          {/* §A4: the census is the Monitor's second page (maintainer, 2026-09-19). Its own route
              rather than a piece of state, so the roster's Total Units door, a bookmark and the
              browser's Back button all land on the same tab. `ActionsPage` reads the section off
              the path, which is how the archive's three tabs already work. */}
          <Route path="actions/units" element={<ActionsPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="battles" element={<BattlePage />} />
          <Route
            path="faction"
            element={
              <RequireUnlock area="faction">
                <FactionPage />
              </RequireUnlock>
            }
          />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="units" element={<UnitsPage />} />
          <Route path="missions" element={<MissionsPage />} />
          {/* §I3: nine screens open on a condition, and five of those conditions are not a level
              (maintainer, 2026-09-19). `RequireUnlock` draws the door rather than redirecting, so
              a player who arrives early is told what opens it and where they stand against it. */}
          <Route
            path="bar"
            element={
              <RequireUnlock area="bar">
                <BarPage />
              </RequireUnlock>
            }
          />
          {/* §I1d: all three tabs of the archive are the same screen. The section follows the
              URL, so a link into the documents lands on the documents. */}
          <Route
            path="research"
            element={
              <RequireUnlock area="research">
                <ResearchPage />
              </RequireUnlock>
            }
          />
          <Route
            path="research/blueprints"
            element={
              <RequireUnlock area="research">
                <ResearchPage />
              </RequireUnlock>
            }
          />
          <Route
            path="research/reimagining"
            element={
              <RequireUnlock area="research">
                <ResearchPage />
              </RequireUnlock>
            }
          />
          <Route
            path="crew"
            element={
              <RequireUnlock area="crew">
                <CrewPage />
              </RequireUnlock>
            }
          />
          <Route
            path="crew/effects"
            element={
              <RequireUnlock area="crew">
                <CrewEffectsPage />
              </RequireUnlock>
            }
          />
          <Route
            path="training"
            element={
              <RequireUnlock area="training">
                <TrainingPage />
              </RequireUnlock>
            }
          />
          <Route path="overseer" element={<OverseerProfilePage />} />
          <Route path="crews/:id" element={<CrewProfilePage />} />
          {/* A faction's public file, beside a crew's and named the same way: plural noun, the id
              the link carried. `faction` (singular) above is your own table and stays where it is,
              so bookmarks of it keep working. */}
          <Route path="factions/:id" element={<FactionProfilePage />} />
          <Route
            path="market"
            element={
              <RequireUnlock area="market">
                <MarketPage />
              </RequireUnlock>
            }
          />
          {/* The Market's other two tabs are gated twice, and deliberately: the Market itself is
              the level, and then each of these wants its own thing on top of it. Nested rather
              than combined into one condition, so the sign a player lands on names the *nearest*
              thing standing between them and the screen rather than the outermost. */}
          <Route
            path="market/offers"
            element={
              <RequireUnlock area="market">
                <RequireUnlock area="offers">
                  <OffersPage />
                </RequireUnlock>
              </RequireUnlock>
            }
          />
          <Route
            path="market/black"
            element={
              <RequireUnlock area="market">
                <RequireUnlock area="black_market">
                  <BlackMarketPage />
                </RequireUnlock>
              </RequireUnlock>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          {/* The Blueprints page lived in the Inventory page until §I1d moved it into research. Kept as a
              redirect rather than dropped: the old path is in bookmarks and in old notifications. */}
          <Route
            path="inventory/blueprints"
            element={<Navigate to="/game/research/blueprints" replace />}
          />
          {/* The Workshop folded into the Scrapyard (maintainer request, 2026-09-10). The old path is
              in bookmarks and in old notifications, so it redirects rather than 404s. */}
          <Route path="workshop" element={<Navigate to="/game/scrapyard" replace />} />
          {/* §B9: the Scrapyard's own page: the nav's door, and the plot's dialog. Behind the
              structure itself (maintainer, 2026-09-19), which is the one gate that needs no
              explaining: the screen is what the building does. */}
          <Route
            path="scrapyard"
            element={
              <RequireUnlock area="scrapyard">
                <ScrapyardPage />
              </RequireUnlock>
            }
          />
          {/* §B11: the Garage has a page rather than a dialog, because its whole value is a list. */}
          {/* Feats (maintainer request, 2026-09-13). No `RequireLevel`: the board is the one screen
              that is meant to be readable from the first minute, because half of what is on it is
              what a new crew is about to do anyway. */}
          <Route path="feats" element={<FeatsPage />} />
          {/* The two screens the standing bar's chips open (maintainer request, 2026-09-17): the
              XP curve with what each level opens, and the notoriety ladder with what each rank
              costs and pays. Reached only from those chips, so both keep a title and a drawn way
              out rather than a door in the scenery switcher. The paths come off the chips
              themselves, so there is one statement of where these live. */}
          <Route path={LEVEL_LADDER_ROUTE} element={<LevelLadderPage />} />
          <Route path={NOTORIETY_LADDER_ROUTE} element={<NotorietyLadderPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/game" replace />} />
      </Routes>
    </BootGate>
  );
}
