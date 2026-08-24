import {
  FORTIFY_DIFFICULTY_LABELS,
  FORTIFY_MAX_LEVEL,
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  fortifyCost,
  maxFortifyBonusPercent,
  quoteFortify,
  type Army,
  type BattleResult,
  type BattleTarget,
  type LevelUp,
  type LocationView,
  type Resources,
} from '@frontline/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { LabelRow } from '../../components/ui/LabelChip';
import { WeatherBanner } from '../../components/ui/WeatherBanner';
import { DistrictScene } from '../base/DistrictScene';
import { DISTRICT_ASPECT } from '../base/plots';
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

/** What one fight left behind — the only thing that knows it happened is its own response. */
interface BattleReport {
  result: BattleResult;
  resources: Resources;
  targetName: string;
  levelUp?: LevelUp | undefined;
}

/**
 * Inside one district (GDD §A4) — the locations, who is holding them, and what it would take.
 *
 * Everything a player does to the city is on this page: taking a location, leaving people on one,
 * digging it in, or robbing a crew's home. The map is where you choose *where*; this is where you
 * choose *what*.
 */
/** Only reached before `/me` has answered, when there is nothing to price against yet. */
const EMPTY_STOCK: Resources = { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 };

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
  /** The last fight's report. The mutation response is the only thing that knows what happened. */
  const [report, setReport] = useState<BattleReport | null>(null);

  const data = query.data;
  const army = me.data?.base?.army ?? {};
  const slots = battles.data?.slots ?? [];
  // The server's reading of the district's front door. Derived there rather than here, so the
  // screen and the declaration rules cannot disagree about what may be attacked.
  const gate = battles.data?.gates.find((candidate) => candidate.districtId === districtId);

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Reading the street…
        </p>
      </div>
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
          <h1 className="mt-1 font-display text-2xl font-bold tracking-[0.15em] text-ink-100">
            {data.district.name}
          </h1>
          <p className="mt-2 max-w-2xl font-body text-xs leading-relaxed text-ink-300">
            {data.district.blurb}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag label={`${data.travelMinutes} min away`} />
            <Tag label={`Difficulty ${data.district.difficulty}`} />
            <Tag label={`${data.district.locations.length} locations`} />
            {data.unified && <Tag label={data.unified.title} tone="mine" />}
          </div>
          {/* The sky, over every location below it. Rendered from the server's clock rather than
              the browser's, so a player whose machine is an hour out is not told the ground is
              something it is not. */}
          <WeatherBanner at={new Date(data.serverNow)} className="mt-3" />
        </div>

        {!data.scouted ? (
          <Panel title="Unscouted">
            <div className="flex flex-col gap-3 p-4">
              <p className="font-body text-xs leading-relaxed text-ink-300">
                Nobody from this crew has been here. Send scouts and the street opens up.
              </p>
              <div>
                <Button
                  size="sm"
                  disabled={scout.isPending}
                  onClick={() => scout.mutate({ districtId: data.district.id })}
                >
                  {scout.isPending ? 'Working…' : 'Send scouts'}
                </Button>
              </div>
            </div>
          </Panel>
        ) : data.district.kind === 'residential' ? (
          <>
            {/* Their district, drawn the same way yours is.
                
                Another crew's ground used to be a paragraph of text saying somebody lived there,
                which is a strange thing for a game whose whole district screen is a location you look
                at. A structure is a building on a street — anyone walking past can see how far it
                has been built up — so it is drawn. What stays behind the fog is everything a crew
                *knows*: their roles, their discovered facts, their stockpile. None of that is here.
                
                Read-only: the plots do not open a dialog, because there is nothing on somebody
                else's ground for you to build. */}
            {data.residentBuildings.length > 0 && (
              <Panel title={`${data.base?.name ?? 'Their'} district`}>
                {/* The plate's own shape, read from the asset rather than typed: a hard-coded
                    ratio here letterboxed the painting inside the panel the day it was
                    redelivered at a different size, and every outline in it moved with the
                    letterbox. */}
                <div
                  className="relative w-full overflow-hidden"
                  style={{ aspectRatio: DISTRICT_ASPECT }}
                >
                  <DistrictScene
                    buildings={data.residentBuildings}
                    queue={[]}
                    selected={null}
                    onSelect={() => undefined}
                    readOnly
                  />
                </div>
              </Panel>
            )}
            <Panel title="A crew lives here">
              <div className="flex flex-col gap-3 p-4">
                <p className="font-body text-xs leading-relaxed text-ink-300">
                  {data.base?.name ?? 'Nobody'} holds this ground. Home districts can never be
                  captured. They get robbed, and they limp for a while afterwards.
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

            <div className="grid gap-4 lg:grid-cols-2" data-testid="locations">
              {data.locations.map((view) => (
                <LocationCard
                  key={view.location.id}
                  view={view}
                  mine={view.holder.kind === 'faction' && view.holder.baseId === baseId}
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
                    .name ?? data.district.name)
                : `the gate at ${data.district.name}`
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

function LocationCard({
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
      data-testid={`location-${view.location.id}`}
      className={cn(
        'flex flex-col gap-3 border p-4',
        mine ? 'border-brass-500/60 bg-brass-300/5' : 'border-surface-700 bg-surface-900',
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
              without being read. It is also what they are taking if they win — a capture puts it
              back to one. */}
          <span
            className="flex items-center gap-0.5"
            data-testid={`level-${view.location.id}`}
            data-level={view.level}
            title={`Level ${view.level} of ${MAX_LOCATION_LEVEL}`}
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

      {/* What the ground is like — the location's own character folded with today's sky (§A4).
          Above the numbers on purpose: this is what decides *what to bring*, and a player who
          reads nothing else on the card should still see that a tunnel is Crammed IV and Dark. */}
      <LabelRow labels={view.labels} size="sm" />

      <dl className="flex flex-col divide-y divide-surface-700 border-y border-surface-700">
        <Row label="Pays" value={view.bonuses.join(' · ')} />
        <Row label="Defence" value={String(view.defense)} />
        <Row label="Standing there" value={`${view.garrisonSize}`} />
        <Row
          label="Dug in"
          value={`${view.fortification} / ${FORTIFY_MAX_LEVEL} · ${FORTIFY_DIFFICULTY_LABELS[view.location.fortifyDifficulty]}`}
        />
      </dl>

      {view.unlocks.length > 0 && (
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          Holding it opens up: <span className="text-ink-200">{view.unlocks.join(', ')}</span>
        </p>
      )}

      {mine ? (
        <div className="flex flex-col gap-2">
          {/*
           * Working it up (§A4) — the board-game half of holding ground, and the first thing
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

function Tag({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'mine' }) {
  return (
    <span
      className={cn(
        'border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
        tone === 'mine' ? 'border-brass-300/50 text-brass-300' : 'border-surface-600 text-ink-300',
      )}
    >
      {label}
    </span>
  );
}
