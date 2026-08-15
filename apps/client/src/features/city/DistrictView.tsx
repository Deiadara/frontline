import {
  FORTIFY_DIFFICULTY_LABELS,
  FORTIFY_MAX_LEVEL,
  PLACE_KIND_CATALOG,
  fortifyCost,
  maxFortifyBonusPercent,
  quoteFortify,
  type Army,
  type BattleResult,
  type LevelUp,
  type PlaceView,
  type Resources,
} from '@frontline/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import {
  useAttackPlace,
  useDistrict,
  useFortify,
  useMe,
  useRaidDistrict,
  useScout,
  useSetGarrison,
} from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { ForcePicker } from './ForcePicker';
import { BattleResultModal } from '../game/BattleResultModal';

/** What one fight left behind — the only thing that knows it happened is its own response. */
interface BattleReport {
  result: BattleResult;
  resources: Resources;
  targetName: string;
  levelUp?: LevelUp | undefined;
}

/**
 * Inside one district (GDD §A4) — the places, who is holding them, and what it would take.
 *
 * Everything a player does to the city is on this page: taking a place, leaving people on one,
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
  const attack = useAttackPlace(baseId, districtId);
  const raid = useRaidDistrict(baseId);
  const [target, setTarget] = useState<PlaceView | null>(null);
  const [raiding, setRaiding] = useState(false);
  /** The last fight's report. The mutation response is the only thing that knows what happened. */
  const [report, setReport] = useState<BattleReport | null>(null);

  const data = query.data;
  const army = me.data?.base?.army ?? {};

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-steel-500">
          Reading the street…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div>
          <button
            type="button"
            onClick={() => void navigate('/game')}
            className="font-display text-[10px] uppercase tracking-[0.2em] text-neon-cyan/70 hover:underline"
          >
            ← Back to the city
          </button>
          <p className="mt-2 font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // {(data.district.nickname ?? data.district.kind).toUpperCase()} //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            {data.district.name}
          </h1>
          <p className="mt-2 max-w-2xl font-body text-xs leading-relaxed text-steel-500">
            {data.district.blurb}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag label={`${data.travelMinutes} min away`} />
            <Tag label={`Difficulty ${data.district.difficulty}`} />
            {data.unified && <Tag label={data.unified.title} tone="mine" />}
          </div>
        </div>

        {!data.scouted ? (
          <Panel title="Unscouted">
            <div className="flex flex-col gap-3 p-4">
              <p className="font-body text-xs leading-relaxed text-steel-400">
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
          <Panel title="A crew lives here">
            <div className="flex flex-col gap-3 p-4">
              <p className="font-body text-xs leading-relaxed text-steel-400">
                {data.base?.name ?? 'Nobody'} holds this ground. Home districts can never be
                captured — only robbed, and left limping for a while afterwards.
              </p>
              {data.raidable && (
                <div>
                  <Button size="sm" variant="danger" onClick={() => setRaiding(true)}>
                    Plan a raid
                  </Button>
                </div>
              )}
            </div>
          </Panel>
        ) : (
          <>
            {data.unified && (
              <Panel title="Take every place here">
                <p className="p-4 font-body text-xs leading-relaxed text-steel-400">
                  <span className="font-display uppercase tracking-[0.15em] text-neon-cyan">
                    {data.unified.title}
                  </span>{' '}
                  — {data.unified.effect}, on top of what the places themselves pay.
                </p>
              </Panel>
            )}

            <div className="grid gap-4 lg:grid-cols-2" data-testid="places">
              {data.places.map((view) => (
                <PlaceCard
                  key={view.place.id}
                  view={view}
                  mine={view.holder.kind === 'faction' && view.holder.baseId === baseId}
                  districtId={data.district.id}
                  baseId={baseId}
                  army={army}
                  resources={me.data?.base?.resources ?? EMPTY_STOCK}
                  onAttack={() => setTarget(view)}
                />
              ))}
            </div>
          </>
        )}

        {target && (
          <ForcePicker
            title={`Take ${target.place.name}`}
            blurb={`Held by ${target.holderName}. Defence ${target.defense}.`}
            army={army}
            facingSize={target.garrisonSize}
            pending={attack.isPending}
            error={attack.error}
            confirmLabel="Send them in"
            onClose={() => setTarget(null)}
            onConfirm={(force) =>
              attack.mutate(
                { placeId: target.place.id, force },
                {
                  onSuccess: (data) => {
                    setTarget(null);
                    setReport({
                      result: data.result,
                      resources: data.base.resources,
                      targetName: target.place.name,
                      levelUp: data.levelUp,
                    });
                  },
                },
              )
            }
          />
        )}

        {raiding && (
          <ForcePicker
            title={`Raid ${data.district.name}`}
            blurb="You cannot take a home district. What you can do is empty it — bounded by what your people can carry."
            army={army}
            pending={raid.isPending}
            error={raid.error}
            confirmLabel="Go"
            onClose={() => setRaiding(false)}
            onConfirm={(force) =>
              raid.mutate(
                { districtId: data.district.id, force },
                {
                  onSuccess: (result) => {
                    setRaiding(false);
                    setReport({
                      result: result.result,
                      resources: result.base.resources,
                      targetName: data.district.name,
                      levelUp: result.levelUp,
                    });
                  },
                },
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
  view: PlaceView;
  mine: boolean;
  districtId: string;
  baseId: string | undefined;
  army: Army;
  resources: Resources;
  onAttack: () => void;
}

function PlaceCard({ view, mine, districtId, baseId, army, resources, onAttack }: PlaceCardProps) {
  const spec = PLACE_KIND_CATALOG[view.place.kind];
  const fortify = useFortify(baseId, districtId);
  const garrison = useSetGarrison(baseId, districtId);
  const [staging, setStaging] = useState(false);

  const quote = quoteFortify(view.place, view.fortification);
  const digging = view.fortifyingUntil !== null;

  return (
    <section
      data-testid={`place-${view.place.id}`}
      className={cn(
        'flex flex-col gap-3 border p-4',
        mine ? 'border-neon-cyan/40 bg-neon-cyan/5' : 'border-steel-800 bg-night-raised',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase tracking-[0.2em] text-steel-500">
            {spec.label}
          </p>
          <h3 className="font-display text-sm font-bold tracking-[0.08em] text-steel-100">
            {view.place.name}
          </h3>
        </div>
        <span
          className={cn(
            'shrink-0 border px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.16em]',
            mine ? 'border-neon-cyan/50 text-neon-cyan' : 'border-steel-700 text-steel-400',
          )}
        >
          {mine ? 'Yours' : view.holderName}
        </span>
      </header>

      <p className="font-body text-xs leading-relaxed text-steel-500">{spec.blurb}</p>
      <p className="font-body text-xs leading-relaxed text-neon-cyan/80">{view.reward}</p>

      <dl className="flex flex-col divide-y divide-steel-800 border-y border-steel-800">
        <Row label="Pays" value={view.bonus} />
        <Row label="Defence" value={String(view.defense)} />
        <Row label="Standing there" value={`${view.garrisonSize}`} />
        <Row
          label="Dug in"
          value={`${view.fortification} / ${FORTIFY_MAX_LEVEL} · ${FORTIFY_DIFFICULTY_LABELS[view.place.fortifyDifficulty]}`}
        />
      </dl>

      {view.unlocks.length > 0 && (
        <p className="font-body text-[11px] leading-relaxed text-steel-500">
          Holding it opens up: <span className="text-steel-300">{view.unlocks.join(', ')}</span>
        </p>
      )}

      {mine ? (
        <div className="flex flex-col gap-2">
          {digging ? (
            <p className="font-display text-[10px] uppercase tracking-[0.16em] text-ember-300">
              Digging in — {formatRemaining(Date.parse(view.fortifyingUntil ?? '') - Date.now())}
            </p>
          ) : quote === null ? (
            <p className="font-display text-[10px] uppercase tracking-[0.16em] text-steel-600">
              As dug in as this ground allows (
              {maxFortifyBonusPercent(view.place.fortifyDifficulty)}
              %)
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-500">
                Fortify to level {quote.level} · +{quote.bonusPercent}% ·{' '}
                {formatDuration(quote.seconds)}
              </span>
              <CostLine cost={fortifyCost(quote.level)} stock={resources} />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={fortify.isPending}
                  onClick={() => fortify.mutate({ placeId: view.place.id })}
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
        <div>
          <Button size="sm" variant="danger" onClick={onAttack}>
            Take it
          </Button>
        </div>
      )}

      {staging && (
        <ForcePicker
          title={`Garrison ${view.place.name}`}
          blurb="Units left here hold the place. If it falls, half of them run and half do not."
          army={army}
          pending={garrison.isPending}
          error={garrison.error}
          confirmLabel="Leave them"
          onClose={() => setStaging(false)}
          onConfirm={(changes) =>
            garrison.mutate(
              { placeId: view.place.id, changes },
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
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-steel-500">
        {label}
      </dt>
      <dd className="font-display text-xs tabular-nums text-steel-200">{value}</dd>
    </div>
  );
}

function Tag({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'mine' }) {
  return (
    <span
      className={cn(
        'border px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.16em]',
        tone === 'mine' ? 'border-neon-cyan/50 text-neon-cyan' : 'border-steel-700 text-steel-400',
      )}
    >
      {label}
    </span>
  );
}
