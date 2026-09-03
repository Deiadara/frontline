import {
  BUILDING_CATALOG,
  type DistrictDetailResponse,
  formatCountdown,
  districtDisplayName,
  FORTIFY_DIFFICULTY_LABELS,
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  fortifyCost,
  fortifyBonusPercent,
  garrisonOf,
  maxFortifyBonusPercent,
  quoteFortify,
  type Army,
  type BattleResult,
  type BattleTarget,
  type Building,
  type BuildingKind,
  type LevelUp,
  type LocationView,
  type Resources,
} from '@frontline/shared';
import { useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { FortifyMeter } from '../../components/ui/FortifyMeter';
import { LabelRow } from '../../components/ui/LabelChip';
import { WeatherBanner } from '../../components/ui/WeatherBanner';
import { ContestedScene, hasPainting } from './ContestedScene';
import { DistrictScene } from '../base/DistrictScene';
import { cn } from '../../lib/cn';
import {
  useBattles,
  useDeclareBattle,
  useDistrict,
  useFortify,
  useUpgradeLocation,
  useMe,
  useScout,
  useSetGarrison,
} from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { ForcePicker } from './ForcePicker';
import { DeclareDialog } from '../battle/DeclareDialog';
import { BattleResultModal } from '../game/BattleResultModal';
import { useServerClock } from '../missions/useServerClock';

/** What one fight left behind: the only thing that knows it happened is its own response. */
interface BattleReport {
  result: BattleResult;
  resources: Resources;
  targetName: string;
  levelUp?: LevelUp | undefined;
}

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
  const query = useDistrict(districtId);

  const scout = useScout();
  const battles = useBattles();
  const declare = useDeclareBattle();
  const [calling, setCalling] = useState<BattleTarget | null>(null);
  /** The location whose sign was last clicked on the painting, ringed until the next click. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The last fight's report. The mutation response is the only thing that knows what happened. */
  const [report, setReport] = useState<BattleReport | null>(null);

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
  // The server's reading of the district's front door. Derived there rather than here, so the
  // screen and the declaration rules cannot disagree about what may be attacked.
  const gate = battles.data?.gates.find((candidate) => candidate.districtId === districtId);

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
   * Another crew's ground opens as a screen, not as a thumbnail in a column (board request).
   *
   * It used to be a small preview inside a panel, which made a neighbour's district a picture of a
   * place rather than a place: you could see the roofs and there was nothing to do with them. It is
   * the same scene your own district is, at the same size, with the same name plate under each
   * building, and the plates are controls. What clicking one offers is the only thing you can
   * offer somebody else's building, which is a fight.
   */
  /*
   * Contested ground opens as a screen too (board request).
   *
   * It was the painting in a panel with a column of cards scrolling under it, which is the shape
   * the board rejected: "not a scrollable box with info, the entire screen is the district". Same
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
        declare={declare}
        onDone={() => setCalling(null)}
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
        viewer={viewer}
        gate={gate}
        playerLevel={me.data?.base?.level ?? 1}
        onLeave={() => void navigate('/game')}
        onCall={setCalling}
        calling={calling}
        slots={slots}
        declare={declare}
        onDone={() => setCalling(null)}
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
                      : `The way in is open until ${new Date(gate.brokenUntil).toLocaleString()}. Everything behind it can be taken while it lasts.`}
                  </p>
                  {gate.brokenUntil === null && (
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
            )}

            {data.unified && (
              <Panel title="Take every location here">
                <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
                  <span className="font-display uppercase tracking-[0.15em] text-brass-300">
                    {data.unified.title}
                  </span>{' '}
                  {data.unified.effect}, on top of what the locations themselves pay.
                </p>
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
                <LocationCard
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

        {calling && (
          <DeclareDialog
            target={calling}
            targetName={
              calling.kind === 'location'
                ? (data.locations.find((view) => view.location.id === calling.locationId)?.location
                    .name ?? districtDisplayName(data.district, viewer))
                : `the gate at ${districtDisplayName(data.district, viewer)}`
            }
            slots={slots}
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

        {report && (
          <BattleResultModal
            result={report.result}
            resources={report.resources}
            targetName={report.targetName}
            levelUp={report.levelUp}
            onClose={() => setReport(null)}
          />
        )}
      </div>
    </div>
  );
}

interface PlaceCardProps {
  /** Anchor for the painting's signs to scroll to. */
  id: string;
  /** Just arrived here from a sign, so say so for a beat. */
  picked: boolean;
  view: LocationView;
  mine: boolean;
  districtId: string;
  baseId: string | undefined;
  army: Army;
  resources: Resources;
  /** The district is held end to end, so nothing in it can be called until the gate is down. */
  shut: boolean;
  onCall: () => void;
}

/** One id scheme, used by the sign that scrolls and the card that is scrolled to. */
function cardId(locationId: string): string {
  return `location-card-${locationId}`;
}

function LocationCard({
  id,
  picked,
  view,
  mine,
  districtId,
  baseId,
  army,
  resources,
  shut,
  onCall,
}: PlaceCardProps) {
  const spec = LOCATION_CATALOG[view.location.kind];
  const fortify = useFortify(baseId, districtId);
  const garrison = useSetGarrison(baseId, districtId);
  const [staging, setStaging] = useState(false);

  const upgrade = useUpgradeLocation(baseId, districtId);
  const quote = quoteFortify(view.location, view.fortification);
  const digging = view.fortifyingUntil !== null;
  const upgrading = view.upgradingUntil !== null;

  return (
    <section
      id={id}
      data-testid={`location-${view.location.id}`}
      // `scroll-mt` clears the standing bar, which is fixed: without it the browser scrolls the
      // card to the top of the *document* and the bar covers the header the sign was pointing at.
      className={cn(
        'flex scroll-mt-24 flex-col gap-3 border p-4 transition-colors duration-300',
        mine ? 'border-brass-500/60 bg-brass-300/5' : 'border-surface-700 bg-surface-900',
        picked && 'ring-1 ring-inset ring-brass-300',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            {spec.label}
          </p>
          <h3 className="font-display text-sm font-bold tracking-[0.08em] text-ink-100">
            {view.location.name}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* The level, as pips rather than a number: a player scanning a district is asking
              "which of these has somebody poured work into", and four filled squares answer that
              without being read. It is also what they are taking if they win: a capture puts it
              back to one. */}
          <span
            className="flex items-center gap-0.5"
            data-testid={`level-${view.location.id}`}
            data-level={view.level}
            data-tip={`Level ${view.level} of ${MAX_LOCATION_LEVEL}`}
            aria-label={`Level ${view.level} of ${MAX_LOCATION_LEVEL}`}
          >
            {Array.from({ length: MAX_LOCATION_LEVEL }, (_, index) => (
              <span
                key={index}
                aria-hidden
                className={cn(
                  'block h-2 w-2 rounded-[1px] border',
                  index < view.level
                    ? 'border-brass-300/70 bg-brass-300'
                    : 'border-surface-600 bg-surface-950',
                )}
              />
            ))}
          </span>
          <span
            className={cn(
              'border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
              mine ? 'border-brass-300/50 text-brass-300' : 'border-surface-600 text-ink-300',
            )}
          >
            {mine ? 'Yours' : view.holderName}
          </span>
        </div>
      </header>

      <p className="font-body text-xs leading-relaxed text-ink-300">{spec.blurb}</p>
      <p className="font-body text-xs leading-relaxed text-brass-300/80">{view.reward}</p>

      {/* What the ground is like: the location's own character folded with today's sky (§A4).
          Above the numbers on purpose: this is what decides *what to bring*, and a player who
          reads nothing else on the card should still see that a tunnel is Crammed IV and Dark. */}
      <LabelRow labels={view.labels} size="sm" />

      <dl className="flex flex-col divide-y divide-surface-700 border-y border-surface-700">
        <Row label="Pays" value={view.bonuses.join(' · ')} />
        <Row label="Defence" value={String(view.defense)} />
        <Row label="Standing there" value={`${view.garrisonSize}`} />
        {/* Drawn rather than counted: see `FortifyMeter`. The ground's difficulty stays in words
            beside it, because it is what decides whether digging here is worth the materials. */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            Dug in
          </span>
          <span className="flex items-center gap-2.5">
            <span className="font-body text-[11px] text-ink-300">
              {FORTIFY_DIFFICULTY_LABELS[view.location.fortifyDifficulty]}
            </span>
            <FortifyMeter
              level={view.fortification}
              percent={fortifyBonusPercent(view.location.fortifyDifficulty, view.fortification)}
              size="sm"
            />
          </span>
        </div>
      </dl>

      {view.unlocks.length > 0 && (
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          Holding it opens up: <span className="text-ink-200">{view.unlocks.join(', ')}</span>
        </p>
      )}

      {mine ? (
        <div className="flex flex-col gap-2">
          {/*
           * Working it up (§A4): the board-game half of holding ground, and the first thing
           * offered because it is the decision the screen exists for. Fortifying makes a location
           * *harder to take*; a level makes it *worth more*. Both are lost on capture, which is
           * what makes pouring into a location you cannot hold a real mistake.
           *
           * The authored sentence is shown, not the percentage: "you get the underground tanks
           * pumping again" is a thing that happens to a petrol station you own, and "+50% oil" is
           * a number going up.
           */}
          {upgrading ? (
            <p
              className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300"
              data-testid={`upgrading-${view.location.id}`}
            >
              Work under way, {formatRemaining(Date.parse(view.upgradingUntil ?? '') - Date.now())}{' '}
              left
            </p>
          ) : view.upgrade === null ? (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              Worked up as far as it goes
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 border border-brass-500/30 bg-brass-300/5 p-2.5">
              <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
                Level {view.upgrade.toLevel} · {formatDuration(view.upgrade.seconds)}
              </span>
              <p className="font-body text-[12px] leading-relaxed text-ink-200">
                {view.upgrade.note}
              </p>
              <CostLine cost={view.upgrade.cost} stock={resources} />
              <div>
                <Button
                  size="sm"
                  disabled={upgrade.isPending}
                  data-testid={`upgrade-${view.location.id}`}
                  onClick={() => upgrade.mutate({ locationId: view.location.id })}
                >
                  {upgrade.isPending ? 'Working…' : 'Work it up'}
                </Button>
              </div>
            </div>
          )}
          {digging ? (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ember-300">
              Digging in, {formatRemaining(Date.parse(view.fortifyingUntil ?? '') - Date.now())}{' '}
              left
            </p>
          ) : quote === null ? (
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
              As dug in as this ground allows (
              {maxFortifyBonusPercent(view.location.fortifyDifficulty)}
              %)
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
                Fortify to level {quote.level} · +{quote.bonusPercent}% ·{' '}
                {formatDuration(quote.seconds)}
              </span>
              <CostLine cost={fortifyCost(quote.level)} stock={resources} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={fortify.isPending}
                  onClick={() => fortify.mutate({ locationId: view.location.id })}
                >
                  {fortify.isPending ? 'Working…' : 'Dig in'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStaging(true)}>
                  Garrison
                </Button>
              </div>
            </div>
          )}
          {!digging && quote === null && (
            <Button size="sm" variant="ghost" onClick={() => setStaging(true)}>
              Garrison
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* One button, because there is one way to take ground now: call it, and turn up.
              "Take it" used to resolve a fight on the spot beside this, which meant nobody ever
              pressed this one. */}
          <Button
            size="sm"
            variant="danger"
            disabled={shut}
            onClick={onCall}
            data-testid={`call-${view.location.id}`}
          >
            {shut ? 'Behind the gate' : 'Call a fight'}
          </Button>
        </div>
      )}

      {staging && (
        <ForcePicker
          title={`Garrison ${view.location.name}`}
          blurb="Units left here hold the location. If it falls, half of them run and half do not."
          army={army}
          pending={garrison.isPending}
          error={garrison.error}
          confirmLabel="Leave them"
          onClose={() => setStaging(false)}
          onConfirm={(changes) =>
            garrison.mutate(
              { locationId: view.location.id, changes },
              { onSuccess: () => setStaging(false) },
            )
          }
        />
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="font-display text-xs tabular-nums text-ink-200">{value}</dd>
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
 * What it takes to open a district (§A4, board rework).
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

  // Somebody is out, and it is this district: a countdown, and nothing to press.
  if (run && run.districtId === data.district.id) {
    return (
      <div className="flex flex-col gap-2 p-4" data-testid="scout-underway">
        <p className="font-body text-xs leading-relaxed text-ink-300">
          <span className="text-ink-100">{run.officerName}</span> is on the road. The street opens
          when they are back.
        </p>
        <Waiting until={run.returnsAt} now={now} />
      </div>
    );
  }

  // Somebody is out, somewhere else. Say where, rather than refusing at the press.
  if (run) {
    return (
      <div className="flex flex-col gap-2 p-4" data-testid="scout-elsewhere">
        <p className="font-body text-xs leading-relaxed text-ink-300">
          Nobody from this crew has been here, and{' '}
          <span className="text-ink-100">{run.officerName}</span> is already out at{' '}
          <span className="text-ink-100">{run.districtName}</span>. One scout at a time.
        </p>
        <Waiting until={run.returnsAt} now={now} />
      </div>
    );
  }

  const plan = data.scoutPlan;
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="font-body text-xs leading-relaxed text-ink-300">
        Nobody from this crew has been here. Send somebody to walk it and the street opens up.
      </p>
      {plan === null ? (
        <p
          className="font-body text-xs leading-relaxed text-oxblood-300"
          data-testid="scout-nobody"
        >
          You have nobody to send. Sign somebody at the Bar first.
        </p>
      ) : (
        <>
          <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-400">
            <span className="text-brass-300">{plan.officerName}</span> would be gone{' '}
            <span className="tabular-nums text-brass-300">{formatSpan(plan.minutes)}</span>
          </p>
          <div>
            <Button size="sm" disabled={pending} onClick={onSend} data-testid="send-scout">
              {pending ? 'Sending…' : 'Send them'}
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
 * The one difference is what a plate does. On your ground it opens the build dialog; here it opens
 * the only thing you can do to a building that is not yours.
 */
function VisitedDistrict({
  data,
  viewer,
  gate,
  playerLevel,
  onLeave,
  onCall,
  calling,
  slots,
  declare,
  onDone,
}: {
  data: DistrictDetailResponse;
  viewer: { ownDistrictId: string | null; ownName: string | null };
  gate: { districtId: string; shut: boolean; brokenUntil: string | null } | undefined;
  playerLevel: number;
  onLeave: () => void;
  onCall: (target: BattleTarget) => void;
  calling: BattleTarget | null;
  slots: readonly string[];
  declare: ReturnType<typeof useDeclareBattle>;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<BuildingKind | null>(null);
  const standing =
    picked === null ? undefined : data.residentBuildings.find((b) => b.kind === picked);

  // The way in, in the server's words rather than this screen's. A gate that is shut and unbroken
  // is why a fight cannot be called, and it is the only reason worth spelling out here.
  const shut = gate?.shut === true && gate.brokenUntil === null;

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
          <span className="font-display text-[13px] font-bold tracking-[0.1em] text-ink-100">
            {districtDisplayName(data.district, viewer)}
          </span>
          {data.raidable && (
            <Button
              size="sm"
              variant="danger"
              data-testid="call-gate"
              onClick={() => onCall({ kind: 'gate', districtId: data.district.id })}
            >
              Call a fight at the gate
            </Button>
          )}
        </div>
      </div>

      {picked !== null && (
        <VisitedBuildingDialog
          kind={picked}
          standing={standing}
          districtName={districtDisplayName(data.district, viewer)}
          shut={shut}
          onClose={() => setPicked(null)}
          onCall={() => {
            if (standing === undefined) return;
            onCall({
              kind: 'building',
              districtId: data.district.id,
              buildingId: standing.id,
            });
            setPicked(null);
          }}
        />
      )}

      {calling && (
        <DeclareDialog
          target={calling}
          targetName={
            calling.kind === 'building'
              ? `${BUILDING_CATALOG[data.residentBuildings.find((b) => b.id === calling.buildingId)?.kind ?? 'nexus'].name} at ${districtDisplayName(data.district, viewer)}`
              : `the gate at ${districtDisplayName(data.district, viewer)}`
          }
          slots={slots}
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
 * What one of their buildings is, and the one thing you can do about it.
 *
 * The mirror of `StructureDialog` on your own ground, and the difference is the whole point of the
 * screen: there it says what the next level costs, and here it says what breaking into this one
 * would take. A building behind a standing gate says so rather than offering a control that the
 * server would refuse, because a refusal after a confirmation is a worse answer than a reason.
 */
function VisitedBuildingDialog({
  kind,
  standing,
  districtName,
  shut,
  onClose,
  onCall,
}: {
  kind: BuildingKind;
  standing: Building | undefined;
  districtName: string;
  shut: boolean;
  onClose: () => void;
  onCall: () => void;
}) {
  const spec = BUILDING_CATALOG[kind];
  return (
    <Modal onClose={onClose} data-testid="visited-building">
      <div className="flex flex-col gap-3 p-5">
        <div>
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            {districtName}
          </p>
          <h2 className="font-display text-lg font-bold tracking-[0.08em] text-ink-100">
            {spec.name}
          </h2>
        </div>
        <p className="font-body text-[13px] leading-relaxed text-ink-200">{spec.description}</p>
        {standing !== undefined && (
          <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
            Standing at level <span className="tabular-nums">{standing.level}</span>
          </p>
        )}

        {shut ? (
          <p className="font-body text-[13px] leading-relaxed text-oxblood-300">
            The gate is standing, so nothing behind it can be reached. Break the gate first and
            everything in here is open for a day.
          </p>
        ) : (
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            Breaking in damages the building and takes whatever your people can carry out of the
            stockpile behind it.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            variant="danger"
            disabled={shut || standing === undefined}
            data-testid="call-building"
            onClick={onCall}
          >
            Call a fight here
          </Button>
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
  declare,
  onDone,
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
  declare: ReturnType<typeof useDeclareBattle>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [standing, setStanding] = useState(false);
  const picked = data.locations.find((view) => view.location.id === open);
  const shut = gate?.shut === true && gate.brokenUntil === null;

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
      className="relative h-full w-full"
      style={
        {
          '--scene-top': 'var(--hud-h, 0px)',
          paddingTop: 'var(--hud-h, 0px)',
          paddingBottom: 'var(--nav-h, 0px)',
        } as CSSProperties
      }
    >
      <ContestedScene
        district={data.district}
        locations={data.locations}
        baseId={baseId}
        gate={gate ?? null}
        onPick={(locationId) => {
          // The gate is not a location and has no card: it is the one plate that calls its fight
          // straight from the painting.
          if (locationId === 'gate') onCall({ kind: 'gate', districtId: data.district.id });
          else setOpen(locationId);
        }}
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
          {shut && (
            <span className="font-display text-[11px] uppercase tracking-[0.16em] text-oxblood-300">
              The gate is armed
            </span>
          )}
          <button
            type="button"
            onClick={() => setStanding((open) => !open)}
            data-testid="district-standing-toggle"
            aria-expanded={standing}
            className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300 hover:underline"
          >
            {standing ? 'Hide the ground' : 'The ground'}
          </button>
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
       * nothing sits on the picture unless the player asks for it, and asking is one press in the
       * strip that is already there.
       */}
      {standing && (
        <div
          className="absolute right-4 z-20 flex w-[16rem] max-w-[38vw] flex-col gap-2"
          style={{ top: 'calc(var(--hud-h, 64px) + 56px)' }}
          data-testid="district-standing"
        >
          <WeatherBanner at={new Date(data.serverNow)} />
          <div className="rounded-sm bg-surface-950/85 px-3 py-2 backdrop-blur-sm">
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              Garrison: {garrisonOf(data.district)}.
            </p>
            {data.unified && (
              <p className="mt-1.5 font-body text-[12px] leading-relaxed text-ink-300">
                <span className="font-display uppercase tracking-[0.15em] text-brass-300">
                  {data.unified.title}
                </span>{' '}
                {data.unified.effect}, on top of what the locations themselves pay. Take every
                location here to earn it.
              </p>
            )}
          </div>
        </div>
      )}

      {picked && (
        <Modal onClose={() => setOpen(null)} size="wide" data-testid="location-window">
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-4">
            <LocationCard
              id={cardId(picked.location.id)}
              picked={false}
              view={picked}
              mine={picked.holder.kind === 'crew' && picked.holder.baseId === baseId}
              districtId={data.district.id}
              baseId={baseId}
              army={army}
              resources={resources}
              shut={shut}
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
          targetName={
            calling.kind === 'location'
              ? (data.locations.find((view) => view.location.id === calling.locationId)?.location
                  .name ?? districtDisplayName(data.district, viewer))
              : `the gate at ${districtDisplayName(data.district, viewer)}`
          }
          slots={slots}
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
