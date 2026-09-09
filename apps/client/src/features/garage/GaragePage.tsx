import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { useGarage } from '../../lib/queries';
import { InfoNote, PageShell, ScreenLoadSheet } from '../game/PageShell';

/**
 * The Garage (GDD §B11, §C).
 *
 * The building grants nothing passively, so this page *is* the building: what the yard is for,
 * what level it stands at and how many seats are parked in it. The machines themselves are on the
 * roster, under a Vehicles tab beside the units they carry (board request, 2026-09-08): a machine
 * is chosen against the legs of the people who will ride it, and that comparison wants the two
 * sheets on one screen. This page is the door to that tab, and the door says what is behind it.
 */
export function GaragePage() {
  const query = useGarage();
  const navigate = useNavigate();

  const data = query.data;
  if (!data) {
    /*
     * A screen that cannot load has to say so, *inside the frame*.
     *
     * This drew "Opening the yard..." for every state that was not data, so a 500 looked exactly
     * like a slow network and looked like it for ever. `GET /api/battles` shipped that way for
     * months and nobody could describe it well enough to report it, which is why `LoadFailure`
     * exists and why there is a permanent guard in `screens.spec.ts` walking every screen behind
     * the nav.
     *
     * The framed version, because a page that has not loaded has no `PageShell` of its own yet:
     * the bare one is rendered into the shell's outlet at the top-left, under the standing bar,
     * where the words are in the DOM and nowhere a player can read them.
     */
    return (
      <ScreenLoadSheet
        what="The yard"
        loading="Opening the yard…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
        detail="Nothing has been lost. The machines are where you left them."
      />
    );
  }

  return (
    <PageShell quote="Everything in here ran once. Most of it will again." wide>
      {/* §C3: a column arrives when its last people do, so a machine is worth what it does for the
          *slowest* group and nothing at all for anybody else. This note used to say the opposite,
          which was the old weighted average wearing the new model's words. */}
      <InfoNote label="What a machine is for">
        A machine is worth nothing parked, and nothing to the people it leaves behind: a column gets
        there when its last walkers do, so two on a bike out of a column of forty arrive early and
        wait. Seats are only worth what they take off the slowest group. Take them to a fight from
        the battle screen. If everyone riding one dies it is destroyed, and whoever killed them
        earns infamy equal to what it was carrying.
      </InfoNote>

      <Panel
        title="The yard"
        action={
          <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
            {data.capacity > 0 ? `${data.capacity} seats` : 'nothing built'}
          </span>
        }
      >
        <p className="px-4 py-3 font-body text-[13px] leading-relaxed text-ink-300">
          {data.garageLevel === 0
            ? 'There is no Garage yet. Build one in the district before the yard is worth walking into.'
            : `Garage at level ${data.garageLevel}. Every machine is gated on that, on the plans, and on what is in the stockpile.`}
        </p>
      </Panel>

      <Panel title="The machines">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            Every machine the yard can build is on the roster, beside the people it carries, with
            its seats and its speed against theirs.
          </p>
          <Button
            size="sm"
            data-testid="garage-machines"
            onClick={() => void navigate('/game/units?tab=vehicles')}
          >
            See the machines
          </Button>
        </div>
      </Panel>
    </PageShell>
  );
}
