import {
  BUILDING_CATALOG,
  FACTION_RANK_LABELS,
  districtDisplayName,
  findDistrict,
  notorietyTier,
  type ProfileHolding,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { buildingPortraitUrl } from '../../assets/delivered';
import { PLAQUE_PLATE, PlaqueFace } from '../../components/DistrictPlaque';
import { PerkTags } from '../../components/PerkTags';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { PortraitFrame } from '../../components/ui/PortraitFrame';
import { cn } from '../../lib/cn';
import { useCrewProfile, useMe } from '../../lib/queries';
import { FactionBadge } from '../faction/FactionBadge';
import { PageShell } from '../game/PageShell';
import { FileSection } from '../overseer/FileSection';
import { OverseerPortrait } from '../overseer/OverseerPortrait';

/**
 * A crew's file (maintainer request, 2026-09-11): the same page for you and for everybody else.
 *
 * Every link in the game that names a crew lands here: a location's holder, a row on the
 * standings, the plate over a neighbour's district. It is built the way the Overseer's own file is
 * built, with the person down the left and the facts in framed sections on the right, so a player
 * who has read their own file can read anybody's. The only thing that changes with the reader is
 * the doors at the foot of the rail: your own file leads to your sheet and the training yard,
 * somebody else's leads to their district and to the mail.
 *
 * What is on it is what the city already says out loud, gathered: see the schema for the line
 * between that and the sheet, which stays hidden (§F2).
 */
export function CrewProfilePage() {
  const { id } = useParams<{ id: string }>();
  const query = useCrewProfile(id);
  const me = useMe();
  const data = query.data;

  if (!data) {
    return (
      <ScreenLoad
        what="This crew's file"
        loading="Pulling the file…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { crew, player, overseer, standing, faction, home, holdings } = data;
  /*
   * What to call their plot: the same rule the map uses (`districtDisplayName`), read from the
   * *viewer's* side. Your own plot is your crew's name; everybody else's is a number, because the
   * authored name of a residential district is a placeholder and the crew's name is already on
   * the plaque beside this.
   */
  const homeDistrict = findDistrict(home.districtId);
  const plot = homeDistrict
    ? districtDisplayName(homeDistrict, {
        ownDistrictId: me.data?.base?.districtId ?? null,
        ownName: me.data?.base?.name ?? null,
      })
    : home.districtName;
  const since = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(player.since),
  );

  return (
    <PageShell
      wide
      title={crew.name}
      icon="crew"
      lede={`${player.name}, level ${standing.level}. In the city since ${since}.`}
      action={
        data.isYou ? (
          <span className="rounded-sm border border-verdigris-300/60 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-verdigris-100">
            Your file
          </span>
        ) : crew.isBot ? (
          <span className="rounded-sm border border-surface-500 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            House crew
          </span>
        ) : undefined
      }
    >
      <div
        className="grid items-start gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]"
        data-testid="crew-profile"
        data-you={data.isYou ? 'true' : 'false'}
      >
        {/* Who. The one column on the screen that is about the person rather than the numbers. */}
        <div className="flex min-w-0 flex-col gap-3">
          <Panel className="flex flex-col border border-surface-500/70">
            {/*
             * The face, at the rail's full width and in a frame (maintainer request, 2026-09-13).
             *
             * It was capped at `16rem` and centred in a 21rem rail, so a fifth of the widest block
             * on the page was empty panel either side of a picture with a 1px line round it. The
             * cap is gone and the frame is the portrait's own box, which is the same treatment the
             * Overseer's file carries: a player who has read their own file reads this one.
             */}
            <div
              data-testid="profile-portrait"
              className="painted washed flex border-b border-surface-600/70"
            >
              <PortraitFrame className="w-full">
                {overseer ? (
                  <OverseerPortrait
                    portraitId={overseer.portraitId}
                    archetype={overseer.archetype}
                    aspect="portrait"
                    showTag
                  />
                ) : (
                  <div className="icon-plate flex aspect-[3/4] w-full items-center justify-center">
                    <Icon name="crew" className="h-16 w-16 text-brass-300/50" />
                  </div>
                )}
              </PortraitFrame>
            </div>
            <div className="flex flex-col gap-2.5 p-3.5" data-testid="profile-identity">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
                >
                  <Icon name={player.icon} />
                </span>
                <div className="min-w-0">
                  <h2
                    className="break-words font-stamp text-[20px] leading-tight text-ink-100"
                    data-testid="profile-player"
                  >
                    {player.name}
                  </h2>
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
                    {data.isYou ? 'You' : 'Player'}
                  </p>
                </div>
              </div>
              <span aria-hidden className="ink-rule block w-full" />
              {overseer ? (
                <>
                  <div>
                    <p
                      className="break-words font-stamp text-[17px] leading-tight text-ink-100"
                      data-testid="profile-overseer"
                    >
                      {overseer.name}
                    </p>
                    <p className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-300">
                      Overseer, {overseer.archetype}
                    </p>
                  </div>
                  <p className="font-body text-[13px] italic leading-relaxed text-ink-200">
                    {overseer.bio}
                  </p>
                  <PerkTags perks={overseer.perks} tone="profile" />
                </>
              ) : (
                <p className="font-body text-[13px] italic leading-relaxed text-ink-300">
                  No Overseer has been named for this crew.
                </p>
              )}
            </div>
          </Panel>

          <Panel className="border border-surface-500/70" data-testid="profile-faction">
            <div className="flex items-center gap-3 p-3.5">
              {/* No fixed height on the wrapper: a badge is drawn 6:5, so a 48-wide one is 58 tall
                  and a square box would cut its foot off. */}
              <span className="flex w-12 shrink-0 items-center justify-center">
                {faction ? (
                  <FactionBadge badge={faction.badge} size={48} title={faction.name} />
                ) : (
                  <span className="icon-plate flex h-12 w-12 items-center justify-center rounded-sm text-ink-400 [&_svg]:h-6 [&_svg]:w-6">
                    <Icon name="faction" />
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-300">
                  Faction
                </p>
                {faction ? (
                  <>
                    <p className="truncate font-stamp text-[17px] leading-tight text-ink-100">
                      {faction.name}
                    </p>
                    <p className="font-body text-[12px] text-ink-300">
                      {FACTION_RANK_LABELS[faction.rank]}. The table has earned{' '}
                      <span className="tabular-nums text-brass-300">
                        {Math.round(faction.infamyEarned).toLocaleString()}
                      </span>{' '}
                      infamy.
                    </p>
                  </>
                ) : (
                  <p className="font-body text-[13px] italic text-ink-300">At no table.</p>
                )}
              </div>
            </div>
          </Panel>

          {/* The doors, and which doors is the one thing the reader changes. */}
          <div className="flex flex-col gap-2" data-testid="profile-doors">
            {data.isYou ? (
              <>
                <Door to="/game/overseer" icon="crew" testId="profile-your-sheet">
                  Your sheet
                </Door>
                <Door to="/game/training" icon="training" testId="profile-training">
                  Training
                </Door>
              </>
            ) : (
              <>
                <Door to={`/game/city/${crew.districtId}`} icon="district" testId="profile-visit">
                  Their district
                </Door>
                {!crew.isBot && (
                  <Door to="/game/messages" icon="messages" testId="profile-message">
                    Write to them
                  </Door>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3" data-testid="file-body">
          <FileSection icon="standings" title="Standing" note="Where they sit in the city">
            <dl
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
              data-testid="profile-standing"
            >
              <Stat label="Level" value={String(standing.level)} />
              <Stat label="Infamy" value={Math.round(standing.infamy).toLocaleString()} />
              <Stat label="Notoriety" value={notorietyTier(standing.notoriety)} />
              <Stat
                label="Rank"
                value={standing.rank === null ? 'Unranked' : `#${standing.rank}`}
              />
              <Stat label="Fights won" value={String(standing.fights.won)} />
              <Stat label="Fights lost" value={String(standing.fights.lost)} />
            </dl>
          </FileSection>

          <FileSection
            icon="district"
            title="Home"
            note={`${plot}, and what is standing on it`}
            action={
              <Link
                to={`/game/city/${crew.districtId}`}
                className={cn(PLAQUE_PLATE, 'group transition-transform hover:-translate-y-0.5')}
                aria-label={`${crew.name}: open their district`}
                data-testid="profile-home-plate"
              >
                <PlaqueFace name={crew.name} />
              </Link>
            }
          >
            {!home.seen ? (
              <p
                className="font-body text-[13px] italic text-ink-300"
                data-testid="profile-home-unseen"
              >
                You have not walked their street. Scout it and this page will say what is standing.
              </p>
            ) : home.buildings.length === 0 ? (
              <p className="font-body text-[13px] italic text-ink-300">
                Nothing built yet. The plot stands as it was found.
              </p>
            ) : (
              <ul
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
                data-testid="profile-buildings"
              >
                {home.buildings.map((building) => {
                  const spec = BUILDING_CATALOG[building.kind];
                  const picture = buildingPortraitUrl(building.kind);
                  return (
                    <li
                      key={building.kind}
                      className="flex items-center gap-2.5 rounded-sm border border-surface-700 bg-surface-950/40 p-2"
                    >
                      <span className="icon-plate flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm">
                        {picture !== null ? (
                          <img
                            src={picture}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <Icon name="build" className="h-5 w-5 text-brass-300/70" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-display text-[12px] font-bold tracking-[0.06em] text-ink-100">
                          {spec.name}
                        </span>
                        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
                          Level <span className="tabular-nums">{building.level}</span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </FileSection>

          <FileSection
            icon="city"
            title="Holdings"
            note="Ground they hold across the city, on streets you have walked"
          >
            <Holdings holdings={holdings} hidden={data.hiddenHoldings} />
            {data.districtsHeldWhole.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-2 border-t border-surface-700/70 pt-2"
                data-testid="profile-whole-districts"
              >
                <span className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-300">
                  Held end to end
                </span>
                {data.districtsHeldWhole.map((district) => (
                  <Link
                    key={district.districtId}
                    to={`/game/city/${district.districtId}`}
                    className="rounded-sm border border-brass-500/50 bg-brass-300/10 px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.12em] text-brass-100 hover:border-brass-300"
                  >
                    {district.name}
                  </Link>
                ))}
              </div>
            )}
          </FileSection>
        </div>
      </div>
    </PageShell>
  );
}

/** What they hold, grouped by district, each row a way there. */
function Holdings({ holdings, hidden }: { holdings: ProfileHolding[]; hidden: number }) {
  const byDistrict = new Map<string, ProfileHolding[]>();
  for (const hold of holdings) {
    const group = byDistrict.get(hold.districtId) ?? [];
    group.push(hold);
    byDistrict.set(hold.districtId, group);
  }
  const more =
    hidden === 0
      ? null
      : hidden === 1
        ? 'One more, on ground you have not scouted.'
        : `${hidden} more, on ground you have not scouted.`;

  if (holdings.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-ink-300" data-testid="profile-holdings">
        {more ?? 'Nothing outside their own walls.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="profile-holdings">
      {[...byDistrict.entries()].map(([districtId, group]) => (
        <div key={districtId} className="flex flex-col gap-1">
          <Link
            to={`/game/city/${districtId}`}
            className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300 hover:underline"
          >
            {group[0]?.districtName ?? districtId}
          </Link>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {group.map((hold) => (
              <li
                key={hold.locationId}
                data-testid={`profile-holding-${hold.locationId}`}
                className="flex items-center justify-between gap-2 rounded-sm border border-surface-700 bg-surface-950/40 px-2.5 py-1.5"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-display text-[12px] font-bold tracking-[0.06em] text-ink-100">
                    {hold.name}
                  </span>
                  <span className="truncate font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
                    {hold.kind}
                  </span>
                </span>
                <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
                  Level <span className="tabular-nums">{hold.level}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {more !== null && (
        <p
          className="font-body text-[12px] italic text-ink-300"
          data-testid="profile-hidden-holdings"
        >
          {more}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-surface-700 bg-surface-950/40 px-2.5 py-2">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      {/* Wraps rather than truncates: a notoriety tier is two words ("Back-Alley Runner") and a
          six-across grid at 1280 gives each cell about 130px, which is one word's worth. */}
      <dd className="break-words font-display text-[15px] font-bold leading-tight tabular-nums text-brass-100">
        {value}
      </dd>
    </div>
  );
}

function Door({
  to,
  icon,
  testId,
  children,
}: {
  to: string;
  icon: IconName;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="door-tile flex items-center justify-center gap-2 rounded-md border border-brass-500/60 px-3 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-all duration-150 hover:-translate-y-0.5 hover:border-brass-300 hover:text-brass-100"
    >
      <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
        <Icon name={icon} />
      </span>
      <span className="relative z-[2]">{children}</span>
    </Link>
  );
}
