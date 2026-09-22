import {
  formatClock,
  BUILDING_CATALOG,
  type DistrictDetailResponse,
  formatCountdown,
  districtDisplayName,
  garrisonOf,
  scoutRecallWindowMs,
  type Army,
  type BattleTarget,
  type Building,
  type BuildingKind,
  type Resources,
  plateAspect,
} from '@frontline/shared';
import { useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePlayerZone } from '../settings/usePlayerZone';
import { PLAQUE_PLATE, PlaqueFace } from '../../components/DistrictPlaque';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { Modal } from '../../components/ui/Modal';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { WeatherBanner } from '../../components/ui/WeatherBanner';
import { CombineLeaderTag } from './CombineLeader';
import { ContestedScene, hasPainting } from './ContestedScene';
import { LocationSheet, cardHeadingId, cardId, crewFileHref } from './LocationSheet';
import { SpyDialog } from './SpyPanel';
import { GroundBox, GroundToggle, UnifiedBonusLines } from './GroundBox';
import { DistrictScene } from '../base/DistrictScene';
import { cn } from '../../lib/cn';
import { useMeasuredSize } from '../../lib/useMeasuredHeight';
import {
  useBattles,
  useDeclareBattle,
  useDistrict,
  useMe,
  useRecallScout,
  useScout,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { DeclareDialog } from '../battle/DeclareDialog';
import { useServerClock } from '../missions/useServerClock';

/**
 * Inside one district (GDD §A4): the locations, who is holding them, and what it would take.
 *
 * Everything a player does to the city is on this page: taking a location, leaving people on one,
 * digging it in, or robbing a crew's home. The map is where you choose *where*; this is where you
 * choose *what*.
 */
/** Only reached before `/me` has answered, when there is nothing to price against yet. */
const EMPTY_STOCK: Resources = {
  caps: 0,
  supplies: 0,
  oil: 0,
  scrap: 0,
  highQualityMetal: 0,
  planks: 0,
};

export function DistrictView() {
  const { districtId } = useParams<{ districtId: string }>();
  const navigate = useNavigate();
  const me = useMe();
  const baseId = me.data?.base?.id;
  // The player's own clock, the way every other deadline on a screen is printed.
  const zone = usePlayerZone();
  const query = useDistrict(districtId);

  const scout = useScout();
  const battles = useBattles();
  const declare = useDeclareBattle();
  const [calling, setCalling] = useState<BattleTarget | null>(null);
  /** The location whose sign was last clicked on the painting, ringed until the next click. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The gate's own spy window on the panel view, which has no painting to hang one off. */
  const [spyingGate, setSpyingGate] = useState(false);

  const data = query.data;
  const army = me.data?.base?.army ?? {};
  /*
   * Who is doing the looking, for `districtDisplayName`.
   *
   * The *viewer's* own crew and plot, not the district's resident: a plot is called after its
   * occupant only when the occupant is you, and everybody else's is a number. Passing the resident
   * here would have published every crew's name on the one screen that opens onto their ground.
   */
  const viewer = {
    ownDistrictId: me.data?.base?.districtId ?? null,
    ownName: me.data?.base?.name ?? null,
  };
  const slots = battles.data?.slots ?? [];
  // §D7: what a call is paid out of. Off the battle board rather than off `/me`, so the price and
  // the marks a player is choosing between come from the same read of the same moment.
  const infamy = battles.data?.infamy ?? 0;
  // The server's reading of the district's front door. Derived there rather than here, so the
  // screen and the declaration rules cannot disagree about what may be attacked.
  const gate = battles.data?.gates.find((candidate) => candidate.districtId === districtId);
  /*
   * The server's clock, for the two countdowns on a location card. They read `Date.now()`, and on
   * a machine twenty minutes fast an upgrade with twenty minutes to run said "0s left" for the
   * whole twenty. `ScoutPanel` below learnt the same lesson first and says why.
   */
  const now = useServerClock(data?.serverNow, query.dataUpdatedAt);
  // A door this crew is standing behind is not one it spies on: the route refuses `own_ground`.
  const ownGround =
    data?.holder?.kind === 'crew'
      ? data.holder.baseId === baseId
      : data?.base?.id !== undefined && data.base.id === baseId;

  if (!data) {
    /*
     * A failed read has to say so, not sit on "Reading the street" for ever.
     *
     * Queries do not retry (`main.tsx` sets `retry: false`), so one refused request left this
     * screen showing a loading line with nothing behind it and no way back except the browser's
     * own reload. The same shape was on thirteen other screens and is one component now.
     */
    return (
      <ScreenLoad
        what="This district"
        loading="Reading the street…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  /*
   * Another crew's ground opens as a screen, not as a thumbnail in a column (maintainer request).
   *
   * It used to be a small preview inside a panel, which made a neighbour's district a picture of a
   * place rather than a place: you could see the roofs and there was nothing to do with them. It is
   * the same scene your own district is, at the same size, with the same name plate under each
   * building, and the plates are controls. What clicking one offers is the only thing you can
   * offer somebody else's building, which is a fight.
   */
  /*
   * Contested ground opens as a screen too (maintainer request).
   *
   * It was the painting in a panel with a column of cards scrolling under it, which is the shape
   * the maintainer rejected: "not a scrollable box with info, the entire screen is the district". Same
   * rule as a lived-in district and as your own, so all three are one screen with one painting and
   * a plate under each thing on it, and clicking a plate opens what you can do about that thing.
   */
  if (data.scouted && data.district.kind === 'contested' && hasPainting(data.district.id)) {
    return (
      <ContestedDistrict
        data={data}
        viewer={viewer}
        gate={gate}
        baseId={baseId}
        army={army}
        resources={me.data?.base?.resources ?? EMPTY_STOCK}
        onLeave={() => void navigate('/game')}
        onCall={setCalling}
        calling={calling}
        slots={slots}
        infamy={infamy}
        declare={declare}
        onDone={() => setCalling(null)}
        now={now}
      />
    );
  }

  if (
    data.scouted &&
    data.district.kind === 'residential' &&
    data.residentBuildings.length > 0 &&
    data.base?.id !== baseId
  ) {
    return (
      <VisitedDistrict
        data={data}
        gate={gate}
        playerLevel={me.data?.base?.level ?? 1}
        onLeave={() => void navigate('/game')}
        onCall={setCalling}
        calling={calling}
        slots={slots}
        infamy={infamy}
        declare={declare}
        onDone={() => setCalling(null)}
        now={now}
        baseId={baseId}
        caps={me.data?.base?.resources.caps ?? 0}
      />
    );
  }

  return (
    <div
      className="relative h-full overflow-y-auto px-4"
      style={{
        paddingTop: 'calc(var(--hud-h, 64px) + 20px)',
        paddingBottom: 'calc(var(--nav-h, 88px) + 20px)',
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div>
          <button
            type="button"
            onClick={() => void navigate('/game')}
            className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300 hover:underline"
          >
            ← Back to the city
          </button>
          <p className="mt-2 font-display text-[11px] tracking-[0.24em] text-brass-300">
            // {(data.district.nickname ?? data.district.kind).toUpperCase()} //
          </p>
          {/* The same rule the map reads: a plot is called after whoever lives on it. Two screens
              disagreeing about what a district is called is worse than either name being wrong. */}
          <h1 className="mt-1 font-display text-2xl font-bold tracking-[0.15em] text-ink-100">
            {districtDisplayName(data.district, viewer)}
          </h1>
          {/* What the initials stand for, on the one screen with room to say it. The map draws the
              short name because a tag on a painting has room for three letters; this is where a
              player finds out that CCS is the Civic Command Sector. */}
          {data.district.formalName !== null && (
            <p
              className="mt-1 font-display text-[12px] uppercase tracking-[0.18em] text-brass-300"
              data-testid="district-formal-name"
            >
              {data.district.formalName}
            </p>
          )}
          <p className="mt-2 max-w-2xl font-body text-xs leading-relaxed text-ink-300">
            {data.district.blurb}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag label={`${data.travelMinutes} min away`} />
            <Tag label={`Difficulty ${data.district.difficulty}`} />
            <Tag label={`${data.district.locations.length} locations`} />
            {data.unified && <Tag label={data.unified.title} tone="mine" />}
            {/* §A3, and it is public: which ground the Combine keeps its power on is not something
                a crew has to scout, it is the thing everybody in the city already knows. */}
            {data.district.seatOfPower && <Tag label="Seat of power" tone="hostile" />}
            {/* Whose ground it is, and it is as public as the seat: he stands in the fog too. */}
            {data.combineLeader && <CombineLeaderTag leader={data.combineLeader} />}
          </div>
          {/* Who is standing on it. Behind the fog, because that *is* scouting: a district nobody
              has been to says nothing about who is holding it.

              Both of these read off the district itself and used to live in the intel panel that
              floated on the city map. The map is a painting now and the panel went with it, so
              they moved to the one screen that is about this district. */}
          {data.scouted && (
            <p className="mt-2 font-body text-[12px] leading-relaxed text-ink-300">
              Garrison: {garrisonOf(data.district)}.
            </p>
          )}
          {/* The sky, over every location below it. Rendered from the server's clock rather than
              the browser's, so a player whose machine is an hour out is not told the ground is
              something it is not. */}
          <WeatherBanner at={new Date(data.serverNow)} className="mt-3" />
        </div>

        {!data.scouted ? (
          <Panel title="Unscouted">
            <ScoutPanel
              data={data}
              receivedAt={query.dataUpdatedAt}
              pending={scout.isPending}
              onSend={() => scout.mutate({ districtId: data.district.id })}
            />
          </Panel>
        ) : data.district.kind === 'residential' ? (
          <>
            {/* The painting itself is not here: a district another crew lives on opens as a full
                screen of its own (`VisitedDistrict`, above), the same way yours does. What is left
                in this column is the paperwork that has no place on a painting. */}
            <Panel title={data.base ? 'A crew lives here' : 'Nobody lives here yet'}>
              <div className="flex flex-col gap-3 p-4">
                {/* Two states, and the empty one is not an error. Every plot is the same ground;
                    one nobody has moved into is drawn as that ground at level 1, which is exactly
                    what a crew settling here would start from. */}
                <p className="font-body text-xs leading-relaxed text-ink-300">
                  {data.base
                    ? `${data.base.name} holds this ground. Home districts can never be captured. They get robbed, and they limp for a while afterwards.`
                    : 'An empty plot, drawn as it stands before anybody builds on it. A crew settling here starts from exactly this.'}
                </p>
                {data.raidable && (
                  <div>
                    <Button
                      size="sm"
                      variant="danger"
                      data-testid="call-gate"
                      onClick={() => setCalling({ kind: 'gate', districtId: data.district.id })}
                    >
                      Call a fight at the gate
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          </>
        ) : (
          <>
            {gate?.shut === true && (
              <Panel title={gate.brokenUntil === null ? 'The gate is armed' : 'The gate is down'}>
                <div className="flex flex-col gap-3 p-4">
                  <p className="font-body text-xs leading-relaxed text-ink-300">
                    {gate.brokenUntil === null
                      ? 'One party holds every location in here, so there is no way in but the front. Break the gate and everything behind it is reachable for a day.'
                      : `The way in is open until ${formatClock(new Date(gate.brokenUntil), zone)}. Everything behind it can be taken while it lasts.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {gate.brokenUntil === null && (
                      <Button
                        size="sm"
                        variant="danger"
                        data-testid="call-gate"
                        onClick={() => setCalling({ kind: 'gate', districtId: data.district.id })}
                      >
                        Call a fight at the gate
                      </Button>
                    )}
                    {/* The other thing to do about a shut door (maintainer, 2026-09-22): read
                        it. A district held end to end has nothing inside it a runner can reach,
                        so the gate is the one target, and the route refuses a crew's own door. */}
                    {!ownGround && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="spy-gate"
                        onClick={() => setSpyingGate(true)}
                      >
                        Spy on the gate
                      </Button>
                    )}
                  </div>
                </div>
              </Panel>
            )}

            {data.unified && (
              <Panel title="Take every location here">
                <div className="p-4">
                  <UnifiedBonusLines unified={data.unified} />
                </div>
              </Panel>
            )}

            {/* Titled for what the panel *is*, not for the district: the district's own name is
                already the page heading two inches above this, and repeating it put the same words
                in an `h1` and an `h2` on one screen. */}
            {hasPainting(data.district.id) && (
              <Panel title="The ground">
                {/* Clicking a sign scrolls its card into view and rings it for a moment: the
                    painting answers "where is it and what is it", the card answers "what do I do
                    about it", and the two are a long way apart on a narrow window. */}
                <ContestedScene
                  district={data.district}
                  locations={data.locations}
                  baseId={baseId}
                  gate={gate ?? null}
                  onPick={(locationId) => {
                    setPicked(locationId);
                    document
                      .getElementById(cardId(locationId))
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                />
              </Panel>
            )}

            <div className="grid gap-4 lg:grid-cols-2" data-testid="locations">
              {data.locations.map((view) => (
                <LocationSheet
                  key={view.location.id}
                  id={cardId(view.location.id)}
                  picked={picked === view.location.id}
                  view={view}
                  mine={view.holder.kind === 'crew' && view.holder.baseId === baseId}
                  districtId={data.district.id}
                  baseId={baseId}
                  army={army}
                  resources={me.data?.base?.resources ?? EMPTY_STOCK}
                  shut={gate?.shut === true && gate.brokenUntil === null}
                  now={now}
                  spying={{ run: data.spyRun, quote: data.spyQuote, blocker: data.spyBlocker }}
                  onCall={() =>
                    setCalling({
                      kind: 'location',
                      districtId: data.district.id,
                      locationId: view.location.id,
                    })
                  }
                />
              ))}
            </div>
          </>
        )}

        {spyingGate && (
          <SpyDialog
            target={{ kind: 'gate', districtId: data.district.id }}
            title="Spy on the gate"
            eyebrow={districtDisplayName(data.district, viewer)}
            blurb="One party holds the whole district, so the door is armed and it is the only thing your runners can read from outside. What comes back is what stands behind it."
            placeName="the gate"
            districtId={data.district.id}
            baseId={baseId}
            caps={me.data?.base?.resources.caps ?? 0}
            spying={{ run: data.spyRun, quote: data.spyQuote, blocker: data.spyBlocker }}
            latest={data.spyGateReport}
            now={now}
            testId="spy-gate-panel"
            onClose={() => setSpyingGate(false)}
          />
        )}

        {calling && (
          <DeclareDialog
            target={calling}
            placeName={
              calling.kind === 'location'
                ? (data.locations.find((view) => view.location.id === calling.locationId)?.location
                    .name ?? districtDisplayName(data.district, viewer))
                : districtDisplayName(data.district, viewer)
            }
            slots={slots}
            infamy={infamy}
            pending={declare.isPending}
            error={declare.error}
            onClose={() => setCalling(null)}
            onConfirm={(scheduledFor, holdAfterCapture) =>
              declare.mutate(
                { target: calling, scheduledFor, holdAfterCapture },
                { onSuccess: () => setCalling(null) },
              )
            }
          />
        )}
      </div>
    </div>
  );
}

function Tag({
  label,
  tone = 'plain',
}: {
  label: string;
  // `hostile` is the Combine's, and it has to read apart from `mine` at a glance: the two tags can
  // sit on the same row, and "this ground is yours" and "the state keeps its power here" are the
  // furthest apart two facts on this screen.
  tone?: 'plain' | 'mine' | 'hostile';
}) {
  return (
    <span
      className={cn(
        'border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
        tone === 'mine'
          ? 'border-brass-300/50 text-brass-300'
          : tone === 'hostile'
            ? 'border-oxblood-500/60 text-oxblood-300'
            : 'border-surface-600 text-ink-300',
      )}
    >
      {label}
    </span>
  );
}

/**
 * What it takes to open a district (§A4, maintainer rework).
 *
 * Scouting used to be a button that did it. It is a journey now, so this panel has three states
 * and the middle one is the whole point of the change: **somebody is walking there**, and until
 * they walk back this ground tells you nothing.
 *
 * The price is quoted before the press, like every other price in the game. A run is measured in
 * hours, so finding out how long it was afterwards is not a decision a player got to make.
 */
function ScoutPanel({
  data,
  receivedAt,
  pending,
  onSend,
}: {
  data: DistrictDetailResponse;
  /**
   * When this payload arrived, so the countdown can be corrected to the server's clock.
   *
   * It was `undefined`, which is the hook's documented way of saying "no response yet" and makes it
   * fall back to `Date.now()`. Passing it for a payload we *have* threw the correction away, so the
   * one countdown on this screen ran on the browser's clock: skewed machines saw the wrong time
   * remaining, and nudging the system clock forward made a scouting run look closer to home. Every
   * other caller of this hook passes `dataUpdatedAt`, which is the whole reason the hook takes it.
   */
  receivedAt: number;
  pending: boolean;
  onSend: () => void;
}) {
  const now = useServerClock(data.serverNow, receivedAt);
  const run = data.scoutingRun;
  const recall = useRecallScout(data.district.id);

  /*
   * The one thing a player can do about a scout on the road, and only in the first tenth of the
   * way out (maintainer request, 2026-09-12): turn them round. They walk home the distance covered and
   * the ground stays shut, so the panel says so once they have.
   */
  const turnRound = run && (
    <>
      <CancelMark
        windowMs={scoutRecallWindowMs(run, now)}
        label={`Turn the ${run.officerName} round`}
        pending={recall.isPending}
        onCancel={() => recall.mutate({})}
        data-testid="recall-scout"
      />
      {recall.error && (
        <p role="alert" className="font-body text-xs text-oxblood-300">
          {recall.error.message}
        </p>
      )}
    </>
  );

  // Somebody is out, and it is this district: a countdown, and the X while it is still open.
  if (run && run.districtId === data.district.id) {
    return (
      <div className="flex flex-col gap-2 p-4" data-testid="scout-underway">
        <p className="font-body text-xs leading-relaxed text-ink-300">
          {run.recalledAt === null ? (
            <>
              The <span className="text-ink-100">{run.officerName}</span> is on the road. The street
              opens when they are back.
            </>
          ) : (
            <>
              The <span className="text-ink-100">{run.officerName}</span> turned round and is
              walking home. The street stays shut: they never got here.
            </>
          )}
        </p>
        <Waiting until={run.returnsAt} now={now} />
        {turnRound}
      </div>
    );
  }

  // Somebody is out, somewhere else. Say where, rather than refusing at the press.
  if (run) {
    return (
      <div className="flex flex-col gap-2 p-4" data-testid="scout-elsewhere">
        <p className="font-body text-xs leading-relaxed text-ink-300">
          Nobody from this crew has been here, and the{' '}
          <span className="text-ink-100">{run.officerName}</span> is already out at{' '}
          <span className="text-ink-100">{run.districtName}</span>. One party at a time.
        </p>
        <Waiting until={run.returnsAt} now={now} />
        {turnRound}
      </div>
    );
  }

  const plan = data.scoutPlan;
  /*
   * Scouting is the Master of Whispers' work (maintainer, 2026-09-22): a party of theirs goes,
   * nobody of yours walks. The two ways it can be refused are said here in the words the route
   * refuses in, so a player is never told "send them" over a button that answers no.
   */
  const blocker = data.scoutBlocker;
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="font-body text-xs leading-relaxed text-ink-300">
        Nobody from this crew has been here. Send a scout party and the street opens up.
      </p>
      {blocker !== null || plan === null ? (
        <p
          className="font-body text-xs leading-relaxed text-oxblood-300"
          data-testid="scout-nobody"
        >
          {blocker === 'not_researched'
            ? 'Your Master of Whispers has not worked Scouting out yet. It is the first thing on their track.'
            : blocker === 'no_whispers'
              ? 'Nobody is in the Master of Whispers chair. Scouting is their work: sign one at the Bar and seat them.'
              : 'There is no road between here and home for a party to walk.'}
        </p>
      ) : (
        <>
          <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-400">
            <span className="text-brass-300">A scout party</span> would be gone{' '}
            <span className="tabular-nums text-brass-300">{formatSpan(plan.minutes)}</span>
          </p>
          <div>
            <Button size="sm" disabled={pending} onClick={onSend} data-testid="send-scout">
              {pending ? 'Sending…' : 'Send a scout party'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Hours and minutes, in the shape a player reads an evening in. */
function formatSpan(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The clock on a run under way, ticking against the server's own time. */
function Waiting({ until, now }: { until: string; now: Date }) {
  const remaining = Date.parse(until) - now.getTime();
  return (
    <p
      className="font-display text-[15px] font-bold tabular-nums text-brass-300"
      data-testid="scout-countdown"
    >
      {remaining <= 0 ? 'Walking back in' : formatCountdown(remaining)}
    </p>
  );
}

/**
 * A district somebody else lives on, drawn as the place it is.
 *
 * Deliberately the same shell as `BasePanel`: full bleed under the HUD, the scene edge to edge,
 * and everything written about it floating over the top rather than pushing it off screen. A player
 * who has learned where the Nexus sits on their own street knows where it sits on this one, because
 * it is the same painting with the same plates in the same places.
 *
 * **One call on the screen, and it is about the district rather than about a roof.** A home is shut
 * by the crew living on it (§A4), so while their Gate stands the only thing to hit is the gate, and
 * inside the day a breach lasts the only thing to hit is the whole place at once. The plates are
 * information now: what the building is and how far along it is. They used to each offer a fight,
 * which meant turning a district over cost thirteen declarations against a cap of three.
 */
function VisitedDistrict({
  data,
  gate,
  playerLevel,
  onLeave,
  onCall,
  calling,
  slots,
  infamy,
  declare,
  onDone,
  now,
  baseId,
  caps,
}: {
  data: DistrictDetailResponse;
  gate: { districtId: string; shut: boolean; brokenUntil: string | null } | undefined;
  playerLevel: number;
  onLeave: () => void;
  onCall: (target: BattleTarget) => void;
  calling: BattleTarget | null;
  slots: readonly string[];
  infamy: number;
  declare: ReturnType<typeof useDeclareBattle>;
  onDone: () => void;
  now: Date;
  /** The reader, for the spy control: their own door is not something they spy. */
  baseId: string | undefined;
  caps: number;
}) {
  const [picked, setPicked] = useState<BuildingKind | null>(null);
  const [spying, setSpying] = useState(false);
  const standing =
    picked === null ? undefined : data.residentBuildings.find((b) => b.kind === picked);

  /*
   * Whose plot this is, in their own words.
   *
   * The one screen that names the resident rather than numbering the plot. The map numbers them,
   * because there the reader is a stranger to nine of the ten; here they have walked in and the
   * crew's name is already printed two inches below in the panel copy and on every receipt the
   * fight produces. `districtDisplayName` is still the rule, given the resident as the viewer,
   * which is the same call `battle/ground.ts` makes for a report.
   */
  const name = districtDisplayName(data.district, {
    ownDistrictId: data.district.id,
    ownName: data.base?.name ?? null,
  });

  /*
   * The way in, in the server's words rather than this screen's.
   *
   * `brokenUntil` is re-read against the clock rather than trusted for being non-null: the board is
   * cached, and a breach that ran out three minutes ago would otherwise leave a raid button on the
   * screen for the server to refuse.
   */
  const breachEnds = gate?.brokenUntil === undefined ? null : gate.brokenUntil;
  const breachLeft = breachEnds === null ? 0 : Date.parse(breachEnds) - now.getTime();
  const breached = breachLeft > 0;
  const shut = gate?.shut === true && !breached;

  return (
    <div
      className="relative h-full w-full"
      style={{ '--scene-top': 'var(--hud-h, 0px)' } as CSSProperties}
    >
      <DistrictScene
        buildings={data.residentBuildings}
        queue={[]}
        // Their ground: nothing here is gated on *your* level, but the prop is required and the
        // honest answer is the level you actually are.
        playerLevel={playerLevel}
        selected={picked}
        onSelect={setPicked}
        readOnly
        fill
        interactive
      />

      {/* Over the painting, top left, where the same control sits on every other screen. */}
      <div
        className="pointer-events-none absolute inset-x-0 z-20 flex justify-start px-4"
        style={{ top: 'calc(var(--hud-h, 64px) + 12px)' }}
      >
        <div className="pointer-events-auto flex items-center gap-3 rounded-sm bg-surface-950/70 px-3 py-1.5 backdrop-blur-sm">
          <button
            type="button"
            onClick={onLeave}
            data-testid="back-to-city"
            className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300 hover:underline"
          >
            ← Back to the city
          </button>
          {/* Their name on their wall, on the same plate yours is drawn on in the standing bar
              (`DistrictPlaque`). A sign, not a heading: this is a place you are standing in.

              And a door (maintainer request, 2026-09-11): the plate opens the resident's file, the same
              page a location's holder opens. `data.base` is the crew on the plot; a plot nobody has
              settled has no file to open and the plate stays a plate. */}
          {data.base ? (
            <Link
              to={crewFileHref(data.base.id)}
              className={cn(PLAQUE_PLATE, 'group transition-transform hover:-translate-y-0.5')}
              data-testid="visited-district-name"
              aria-label={`${name}: open this crew's file`}
            >
              <PlaqueFace name={name} />
            </Link>
          ) : (
            <div className={PLAQUE_PLATE} data-testid="visited-district-name">
              <PlaqueFace name={name} />
            </div>
          )}
          {/* One call, and which one it is is a fact about the door rather than a choice. While
              their Gate stands there is nothing behind it to reach; inside a breach the raid is
              the whole district at once and the clock says how long that lasts. */}
          {data.raidable && shut && (
            <Button
              size="sm"
              variant="danger"
              data-testid="call-gate"
              onClick={() => onCall({ kind: 'gate', districtId: data.district.id })}
            >
              Break the gate
            </Button>
          )}
          {/* Spying (2026-09-22): a player's district is read at its gate and nowhere else. The
              dialog is the same panel a location sheet carries, pointed at the door. */}
          {data.base && data.base.id !== baseId && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="spy-gate"
              onClick={() => setSpying(true)}
            >
              Spy on the gate
            </Button>
          )}
          {data.raidable && breached && (
            <Button
              size="sm"
              variant="danger"
              data-testid="call-district"
              onClick={() => onCall({ kind: 'district', districtId: data.district.id })}
            >
              Raid the district ({formatRemaining(breachLeft)} left)
            </Button>
          )}
        </div>
      </div>

      {picked !== null && (
        <VisitedBuildingDialog
          kind={picked}
          standing={standing}
          districtName={name}
          onClose={() => setPicked(null)}
        />
      )}

      {spying && (
        <SpyDialog
          target={{ kind: 'gate', districtId: data.district.id }}
          title="Spy on the gate"
          eyebrow={name}
          blurb="A crew's district is read at its door and nowhere else. What comes back is what stands behind the gate, as far as your runners could see past it."
          placeName="the gate"
          districtId={data.district.id}
          baseId={baseId}
          caps={caps}
          spying={{ run: data.spyRun, quote: data.spyQuote, blocker: data.spyBlocker }}
          latest={data.spyGateReport}
          now={now}
          testId="spy-gate-panel"
          onClose={() => setSpying(false)}
        />
      )}

      {calling && (
        <DeclareDialog
          target={calling}
          placeName={name}
          slots={slots}
          infamy={infamy}
          pending={declare.isPending}
          error={declare.error}
          onClose={onDone}
          onConfirm={(scheduledFor, holdAfterCapture) =>
            declare.mutate(
              { target: calling, scheduledFor, holdAfterCapture },
              { onSuccess: onDone },
            )
          }
        />
      )}
    </div>
  );
}

/**
 * What one of their buildings is, and nothing you can do about it.
 *
 * The mirror of `StructureDialog` on your own ground, and the difference is the whole point of the
 * screen: there it says what the next level costs, and here it says what is standing and how far
 * along it is. It carried a `Call a fight here` button until the maintainer made a raid one call on the
 * whole district (§A4): thirteen roofs meant thirteen declarations against a cap of three, so the
 * per-roof fight was a control almost nobody could afford to press. The one call lives on the
 * screen behind this dialog now.
 */
function VisitedBuildingDialog({
  kind,
  standing,
  districtName,
  onClose,
}: {
  kind: BuildingKind;
  standing: Building | undefined;
  districtName: string;
  onClose: () => void;
}) {
  const spec = BUILDING_CATALOG[kind];
  return (
    <Modal onClose={onClose} labelledBy="visited-building-title" data-testid="visited-building">
      <div className="flex flex-col gap-3 p-5">
        <div>
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            {districtName}
          </p>
          <h2
            id="visited-building-title"
            className="font-display text-lg font-bold tracking-[0.08em] text-ink-100"
          >
            {spec.name}
          </h2>
        </div>
        <p className="font-body text-[13px] leading-relaxed text-ink-200">{spec.description}</p>
        {standing !== undefined && (
          <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
            Standing at level <span className="tabular-nums">{standing.level}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Contested ground, drawn as the place it is.
 *
 * Same shell as `VisitedDistrict` and as your own district: full bleed under the HUD, the painting
 * edge to edge, and everything written about it floating over the top rather than pushing it off
 * the screen. It replaced the painting-in-a-panel with a column of cards scrolling underneath, on
 * the board's instruction: a district is a place you are standing in, not a document about a place.
 *
 * Clicking a sign opens that location's card in a window, and the card is the *same component* the
 * column used. That is deliberate: fortifying, garrisoning, upgrading and calling a fight are a
 * screen's worth of controls that already work and are already tested, and re-authoring them for a
 * dialog would be a second implementation of the one thing on this screen that can lose a player
 * their army.
 */
function ContestedDistrict({
  data,
  viewer,
  gate,
  baseId,
  army,
  resources,
  onLeave,
  onCall,
  calling,
  slots,
  infamy,
  declare,
  onDone,
  now,
}: {
  data: DistrictDetailResponse;
  viewer: { ownDistrictId: string | null; ownName: string | null };
  gate: { districtId: string; shut: boolean; brokenUntil: string | null } | undefined;
  baseId: string | undefined;
  army: Army;
  resources: Resources;
  onLeave: () => void;
  onCall: (target: BattleTarget) => void;
  calling: BattleTarget | null;
  slots: readonly string[];
  infamy: number;
  declare: ReturnType<typeof useDeclareBattle>;
  onDone: () => void;
  now: Date;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [standing, setStanding] = useState(false);
  const [spying, setSpying] = useState(false);
  const heldByYou = data.holder?.kind === 'crew' && data.holder.baseId === baseId;
  const picked = data.locations.find((view) => view.location.id === open);
  const shut = gate?.shut === true && gate.brokenUntil === null;
  /*
   * The room between the bars, measured, and the painting fitted to cover it.
   *
   * The scene sizes itself from its width alone (`w-full` with the plate's aspect), which was
   * right while it sat in a scrolling column and wrong the moment it became the screen: on a
   * 1280px window the picture is 610px tall against 484px of clear band once the standing bar
   * has wrapped to two rows, so it ran 126px under the nav and 16px past the bottom of the
   * viewport, and the shell grew a scrollbar. The signs at the foot of the painting went with it.
   *
   * `cover`, not `whole`, and the reason is the shape of the band rather than the size of the
   * plate. The band between the bars is wider than 21:10 at every viewport in the matrix (2.65:1 at
   * 1280x720, 2.13:1 even at 1920x1080), so a plate shown entire can never reach both side edges:
   * it stood centred with 132px of blurred surround each side at 1280 and 13px at 1920, and the
   * maintainer read the surround as grey patches ("do we need a different res?"). No resolution
   * fixes an aspect. Cover-fitting runs the plate edge to edge and gives up a sliver of its top and
   * bottom to the bars instead, split evenly, and the surround has nothing left to fill.
   *
   * What that costs is the top and bottom tenth at the worst viewport, which is where a sign could
   * sit under a bar unreadable and unclickable. `plateFit.test.ts` pins every mark inside the part
   * that stays visible, so a mark placed too low fails a unit test rather than a player.
   *
   * Only the width is handed down; the scene's own aspect gives the height, so the two can never
   * disagree by a rounding pixel.
   *
   * Always the band's full width, never `fitting(..., 'cover')`. Cover picks the larger of the two
   * fits, and in a band taller than 21:10 (a window grown past the fold, or a portrait screen) that
   * is the height fit, which runs the plate 160px past each side edge: the Fence Camp's sign at
   * x 0.985 goes with it, and the layout gate reads the plate as an image sliced by its clip. Width
   * is the one side a player asked to see filled, so the band's width decides, and a tall band
   * letterboxes above and below on the dark surface instead of cropping anything.
   */
  const [roomRef, room] = useMeasuredSize<HTMLDivElement>();
  const plateWidth = room.width;
  const picture = {
    width: plateWidth,
    height: plateWidth / plateAspect(`district-${data.district.id}`),
  };

  return (
    <div
      /*
       * Inset below the standing bar and above the nav, rather than run under them.
       *
       * The painting is the screen, so the temptation is to let it fill the frame edge to edge and
       * float the chrome over it. The signs make that wrong: they are positioned in fractions of
       * the *painting*, so any part of the painting that sits under the bar takes its signs with
       * it, and the topmost one ends up behind the identity plaque. It is not merely hidden, it is
       * unclickable, because the plaque is a real control and eats the pointer. Playwright reported
       * it as `subtree intercepts pointer events`, which is exactly what a player would experience
       * as a plate that does nothing.
       *
       * Both bars publish their measured height, so the clear band is the two variables.
       */
      ref={roomRef}
      className="relative h-full w-full"
      style={
        {
          '--scene-top': 'var(--hud-h, 0px)',
          paddingTop: 'var(--hud-h, 0px)',
          paddingBottom: 'var(--nav-h, 0px)',
        } as CSSProperties
      }
    >
      {/* The band itself, and the clip. A cover-fitted plate is taller than the band, and without
          this box the overhang would run under the bars and out of the viewport, where the shell
          root counts it as overflow and grows a scrollbar. Same arrangement as `PlateRoom`. */}
      <div className="relative h-full w-full overflow-hidden" data-testid="district-band">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          // `100%` until the room has been measured, so the pre-paint layout is the old full-width
          // one rather than a zero-width plate.
          style={{ width: picture.width > 0 ? picture.width : '100%' }}
        >
          <ContestedScene
            district={data.district}
            locations={data.locations}
            baseId={baseId}
            gate={gate ?? null}
            onPick={(locationId) => {
              // The gate is not a location and has no card: it is the one plate that calls its
              // fight straight from the painting.
              if (locationId === 'gate') onCall({ kind: 'gate', districtId: data.district.id });
              else setOpen(locationId);
            }}
          />
        </div>
      </div>

      {/* Over the painting, top left, where the same control sits on every other screen. */}
      <div
        className="pointer-events-none absolute inset-x-0 z-20 flex justify-start px-4"
        style={{ top: 'calc(var(--hud-h, 64px) + 12px)' }}
      >
        <div className="pointer-events-auto flex items-center gap-3 rounded-sm bg-surface-950/70 px-3 py-1.5 backdrop-blur-sm">
          <button
            type="button"
            onClick={onLeave}
            data-testid="back-to-city"
            className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300 hover:underline"
          >
            ← Back to the city
          </button>
          {/*
           * The district's name, as the page's heading.
           *
           * An `h1`, not a styled span: this screen *is* the district, so the name of it is the
           * heading of the document, and a screen whose only heading is decorative reads as a
           * fragment to anything that navigates by structure. It carried an `h1` while it was a
           * column of panels and lost one when it became a painting, which is the kind of thing a
           * rewrite drops silently.
           */}
          <h1 className="font-display text-[13px] font-bold tracking-[0.1em] text-ink-100">
            {districtDisplayName(data.district, viewer)}
          </h1>
          {/* What the initials stand for. `CCS` is a tag on a painting; this is the paperwork. */}
          {data.district.formalName !== null && (
            <span
              className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300"
              data-testid="district-formal-name"
            >
              {data.district.formalName}
            </span>
          )}
          {/* §A3: which ground the Combine keeps its power on is public, so it stands in the strip
              and not behind the toggle. The unpainted column wears the same words as a tag; the
              Blacksite dropped them the day it became a painting, and `government.spec.ts` is what
              noticed. */}
          {data.district.seatOfPower && (
            <span className="font-display text-[11px] uppercase tracking-[0.16em] text-oxblood-300">
              Seat of power
            </span>
          )}
          {/* The legendary over this ground, alive or dead, with his card on the hover. Beside the
              seat rather than behind the toggle: which district is whose is the one fact about the
              Combine a crew plans a campaign around. */}
          {data.combineLeader && <CombineLeaderTag leader={data.combineLeader} />}
          {shut && (
            <span className="font-display text-[11px] uppercase tracking-[0.16em] text-oxblood-300">
              The gate is armed
            </span>
          )}
          {/*
           * Spying a shut district (maintainer, 2026-09-22).
           *
           * One party holds every location here, so the gate is armed and the only thing a
           * runner can read from outside is the door itself (`spying/spying.ts` refuses a
           * location inside it with `not_the_gate`). Without this the rule had no door on the
           * client: the location sheets sent the player to "the district's own screen" and the
           * district's own screen offered nothing. Not on a district this crew holds end to
           * end, where the route refuses its own door (`own_ground`).
           */}
          {shut && !heldByYou && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="spy-gate"
              onClick={() => setSpying(true)}
            >
              Spy on the gate
            </Button>
          )}
        </div>
      </div>

      {/*
       * What is true of the whole district rather than of one thing on it, behind a toggle.
       *
       * The sky, who is standing here, and what holding the whole place pays. These were panels in
       * the column this screen replaced, and dropping them with the column would have been a quiet
       * feature loss: the weather changes what a fight on this ground costs, so it belongs on the
       * ground rather than one screen away.
       *
       * **Shut by default, and that is the whole design.** Floated open in a corner it covered the
       * Bone Market, and a panel over a sign does not merely hide it: the panel is a real box and
       * eats the pointer, so the plate underneath stops working. There is no free corner to move it
       * to either, because the signs are spread across the whole painting by construction. So
       * nothing sits on the picture unless the player asks for it.
       *
       * **The toggle and the box are one column** (maintainer request, 2026-09-11). The button used to
       * sit in the strip at the top left and the box opened at the top right, the width of the
       * screen away from the thing that opened it. The button is the head of the column now and the
       * box hangs directly under it, so what you pressed and what appeared are one shape.
       */}
      <div
        className="pointer-events-none absolute right-4 z-20 flex w-[17rem] max-w-[40vw] flex-col items-end gap-2"
        style={{ top: 'calc(var(--hud-h, 64px) + 12px)' }}
        data-testid="district-standing-column"
      >
        <div className="pointer-events-auto">
          <GroundToggle open={standing} onToggle={() => setStanding((open) => !open)} />
        </div>
        {standing && (
          <GroundBox
            district={data.district}
            combineLeader={data.combineLeader}
            unified={data.unified}
            at={new Date(data.serverNow)}
            className="pointer-events-auto w-full"
          />
        )}
      </div>

      {spying && (
        <SpyDialog
          target={{ kind: 'gate', districtId: data.district.id }}
          title="Spy on the gate"
          eyebrow={data.district.name}
          blurb="One party holds the whole district, so the door is armed and it is the only thing your runners can read from outside. What comes back is what stands behind it."
          placeName="the gate"
          districtId={data.district.id}
          baseId={baseId}
          caps={resources.caps}
          spying={{ run: data.spyRun, quote: data.spyQuote, blocker: data.spyBlocker }}
          latest={data.spyGateReport}
          now={now}
          testId="spy-gate-panel"
          onClose={() => setSpying(false)}
        />
      )}

      {picked && (
        <Modal
          onClose={() => setOpen(null)}
          size="wide"
          // The card's own heading names the window. `LocationCard` puts `id` on its `<section>`
          // and its `<h3>` is the place's name, so the id the card already carries is the one
          // thing a reader needs: without it this dialog announced itself as nothing at all.
          labelledBy={cardHeadingId(picked.location.id)}
          data-testid="location-window"
        >
          {/* Bounded by the dialog rather than by a second guess at the viewport. `Modal` is a
              flex column already capped at `100vh-2rem`, so `min-h-0` on its one child is all the
              bound this needs; the `100vh-8rem` that used to be here threw away 96px of window and
              put a scrollbar on a sheet that fits. */}
          <div className="min-h-0 overflow-y-auto p-4">
            <LocationSheet
              id={cardId(picked.location.id)}
              picked={false}
              view={picked}
              mine={picked.holder.kind === 'crew' && picked.holder.baseId === baseId}
              districtId={data.district.id}
              baseId={baseId}
              army={army}
              resources={resources}
              shut={shut}
              now={now}
              spying={{ run: data.spyRun, quote: data.spyQuote, blocker: data.spyBlocker }}
              onCall={() => {
                onCall({
                  kind: 'location',
                  districtId: data.district.id,
                  locationId: picked.location.id,
                });
                setOpen(null);
              }}
            />
          </div>
        </Modal>
      )}

      {calling && (
        <DeclareDialog
          target={calling}
          placeName={
            calling.kind === 'location'
              ? (data.locations.find((view) => view.location.id === calling.locationId)?.location
                  .name ?? districtDisplayName(data.district, viewer))
              : districtDisplayName(data.district, viewer)
          }
          slots={slots}
          infamy={infamy}
          pending={declare.isPending}
          error={declare.error}
          onClose={onDone}
          onConfirm={(scheduledFor, holdAfterCapture) =>
            declare.mutate(
              { target: calling, scheduledFor, holdAfterCapture },
              { onSuccess: onDone },
            )
          }
        />
      )}
    </div>
  );
}
