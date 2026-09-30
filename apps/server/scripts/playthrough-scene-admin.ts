/**
 * The admin phase: the same database behind a server started with `ADMIN=true`, and the Console's
 * bench used by one crew. Every clock is five seconds and nothing is charged; the prices quoted are
 * still the real ones.
 */
import {
  type AdminMutationResponse,
  type AdminSnapshot,
  type BattlesResponse,
  type BuildStructureResponse,
  type CreateOverseerResponse,
  type MeResponse,
  type OverseerChoicesResponse,
} from '@frontline/shared';
import type { Harness } from './playthrough-harness.js';
import { player, type Cast } from './playthrough-cast.js';
import { expectDelta } from './playthrough-helpers.js';

export async function adminBench(h: Harness, cast: Cast): Promise<void> {
  const e = player(cast, 'E');
  const a = player(cast, 'A');

  h.at('admin: the mode is on');
  const me = await h.ok<MeResponse>({ as: e, method: 'GET', route: '/api/me' });
  h.check(me?.admin === true, 'the server was started with ADMIN=true and /me says it is off');
  const snapshot = await h.ok<AdminSnapshot>({ as: e, method: 'GET', route: '/api/admin' });
  h.check(
    snapshot?.baseId === e.baseId && snapshot.state.chargesResources === false,
    `the admin snapshot reads ${JSON.stringify(snapshot?.state)}`,
  );

  h.at('admin: nothing is charged');
  if (me?.base) {
    const built = await h.ok<BuildStructureResponse>({
      as: e,
      method: 'POST',
      route: '/api/base/build',
      body: { kind: 'apothecary' },
    });
    if (built) {
      expectDelta(h, me.base.resources, built.base.resources, {}, 'a build in admin mode');
      const order = built.base.buildQueue.find((one) => one.kind === 'apothecary');
      h.check(
        (order?.durationSeconds ?? 99) <= snapshot.state.actionSeconds,
        `an admin-mode build takes ${order?.durationSeconds}s`,
      );
    }
  }

  h.at('admin: the knobs');
  const knobs = await h.ok<AdminMutationResponse>({
    as: e,
    method: 'POST',
    route: '/api/admin/knobs',
    body: {
      playerLevel: 30,
      infamy: 250,
      notoriety: 2,
      buildingLevel: 5,
      structure: 'quarters',
      resources: { caps: 12_345 },
    },
  });
  if (knobs) {
    h.check(
      knobs.admin.playerLevel === 30 && knobs.admin.infamy === 250,
      `the knobs set level ${knobs.admin.playerLevel} and infamy ${knobs.admin.infamy}`,
    );
    h.check(
      knobs.admin.buildings.find((one) => one.kind === 'quarters')?.level === 5,
      'the structure knob did not move the Quarters',
    );
  }
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/admin/knobs',
    body: {},
    expect: 400,
    code: 'VALIDATION_ERROR',
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/admin/knobs',
    body: { playerLevel: 999 },
    expect: 400,
    code: 'VALIDATION_ERROR',
  });

  h.at('admin: grants');
  await h.ok<AdminMutationResponse>({
    as: e,
    method: 'POST',
    route: '/api/admin/grant',
    body: { units: { razors: 7 }, technologies: 'master_of_whispers', boosts: 1 },
  });
  await h.refuse({
    as: e,
    method: 'POST',
    route: '/api/admin/grant',
    body: {},
    expect: 400,
    code: 'VALIDATION_ERROR',
  });

  h.at('admin: a mock fight');
  const mocked = await h.ok<AdminMutationResponse>({
    as: e,
    method: 'POST',
    route: '/api/admin/mock-battle',
    body: {},
  });
  if (mocked) {
    const battles = await h.ok<BattlesResponse>({ as: e, method: 'GET', route: '/api/battles' });
    h.check(
      Boolean(battles?.coming.some((one) => one.role === 'defender')),
      'the mock fight is not coming at E',
    );
  }

  h.at('admin: a clean slate');
  const reset = await h.ok<AdminMutationResponse>({
    as: e,
    method: 'POST',
    route: '/api/admin/reset',
    body: {},
  });
  h.check(
    reset?.admin.playerLevel === 1,
    `a clean slate left the crew at level ${reset?.admin.playerLevel}`,
  );
  const bare = await h.ok<MeResponse>({ as: e, method: 'GET', route: '/api/me' });
  h.check(bare?.overseer === null, 'a clean slate kept the Overseer');
  const offer = await h.ok<OverseerChoicesResponse>({
    as: e,
    method: 'GET',
    route: '/api/overseer/choices',
  });
  const presetId = offer?.choices[0]?.presetId;
  if (presetId) {
    const again = await h.ok<CreateOverseerResponse>({
      as: e,
      method: 'POST',
      route: '/api/overseer',
      body: { presetId },
      expect: 201,
    });
    h.check(
      again?.base.id === e.baseId,
      'after a clean slate the new character was given a second base',
    );
  }
  // Somebody else's crew is untouched by E's bench.
  const aMe = await h.ok<MeResponse>({ as: a, method: 'GET', route: '/api/me' });
  h.check((aMe?.base?.level ?? 0) > 1, "E's clean slate reached A's crew");
}
