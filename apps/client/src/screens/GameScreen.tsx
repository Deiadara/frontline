import { Outlet } from 'react-router-dom';
import { Ambience, Patina } from '../components/ui/Ambience';
import { useLiveEvents } from '../lib/live';
import { useMe, usePrefetchScreens } from '../lib/queries';
import { useMeasuredHeight } from '../lib/useMeasuredHeight';
import { BottomNav } from '../features/game/BottomNav';
import { QueueRail } from '../features/game/QueueRail';
import { SceneBackdrop } from '../features/game/PageShell';
import { TopHud } from '../features/game/TopHud';

/**
 * The game shell: one screen, the world behind it, and the chrome floating on top.
 *
 * The old shell was a header over a row of [sidebar | content], so every screen was a panel in a
 * frame and the artwork was a picture inside it. This is the other way round: the routed screen
 * *is* the viewport, and the HUD and the scenery switcher are layers over it. That is what makes a
 * town view read as a place you are standing in rather than as an illustration on a page.
 *
 * The chrome is `pointer-events-none` as a layer, with each bar turning them back on. Otherwise the
 * strip of transparent gutter between the HUD and the nav would eat drags meant for the map.
 */
export function GameScreen() {
  const me = useMe();
  // Warm the screens behind the nav so opening one is instant (`usePrefetchScreens`), but only
  // once there is a district to read them against: every one of those endpoints needs a base, so
  // firing them during overseer selection is eight requests that can only fail, and a failed
  // prefetch leaves an error in the cache for the screen's own hook to open on.
  usePrefetchScreens(Boolean(me.data?.base));
  // Opened here, once, and left open for the whole session: this is the component every screen is
  // rendered inside, so the channel outlives navigation. Mounting it on a page instead would drop
  // and rebuild the connection on every click.
  const live = useLiveEvents();
  const [hudRef, hudHeight] = useMeasuredHeight();
  const [navRef, navHeight] = useMeasuredHeight();
  const overseer = me.data?.overseer ?? null;
  const base = me.data?.base ?? null;

  if (!overseer || !base) {
    return (
      <main className="flex h-screen items-center justify-center bg-surface-950">
        <p className="font-display text-xs uppercase tracking-[0.25em] text-ink-300">
          Loading district…
        </p>
      </main>
    );
  }

  return (
    <div
      className="vignette relative h-screen w-screen overflow-hidden bg-surface-950"
      style={
        {
          '--hud-h': `${Math.round(hudHeight)}px`,
          '--nav-h': `${Math.round(navHeight)}px`,
        } as React.CSSProperties
      }
    >
      {/* One backdrop for the whole shell rather than one per screen. The district and the city
          map paint over it completely; every other screen is a document, and letting the place show
          through behind it, blurred back, dimmed down, is what keeps the game from feeling like a
          set of forms you tab between. */}
      <SceneBackdrop />

      <main className="absolute inset-0 z-10">
        <Outlet />
      </main>

      {/* The junk in the corners lives here, under the chrome: at this opacity a fallen robot arm
          over the queue rail's countdowns is a smear on the one thing that is counting down. */}
      <Ambience />

      <div className="grain pointer-events-none absolute inset-0 z-30" />

      <div className="pointer-events-none absolute inset-0 z-40 flex flex-col">
        <div ref={hudRef}>
          <TopHud
            overseer={overseer}
            base={base}
            resources={base.resources}
            economy={base.economy}
            buildings={base.buildings}
            live={live}
            {...(me.data?.unread ? { unread: me.data.unread } : {})}
          />
        </div>
        {/* The world's middle stays clear: nothing floats over it at all. */}
        <div className="min-h-0 flex-1" />
        {/* The rail and the switcher are measured together, and `--nav-h` is the pair. A screen
            that lays itself out around the chrome cares how much of the bottom is taken, not how
            many bars are taking it, and the rail comes and goes with what the crew is doing. */}
        <div ref={navRef}>
          <QueueRail />
          <BottomNav />
        </div>
      </div>

      {/* Above the chrome, below any dialog. The glass has to cross the panel edges to do its job.
          That is what stops the screen reading as a stack of separate widgets, but a modal is a
          thing the player is being asked to read, and nothing gets to sit on top of that. */}
      <div className="pointer-events-none absolute inset-0 z-50">
        <Patina />
      </div>
    </div>
  );
}
