import type { OverseerChoicesResponse, OverseerPreset } from '@frontline/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../lib/api';
import { useCreateOverseer, useOverseerChoices } from '../lib/queries';
import { DrawnButton } from '../components/ui/DrawnButton';
import { DrawnRule } from '../components/ui/DrawnMarks';
import { LoadFailure } from '../components/ui/LoadFailure';
import { OverseerPortrait } from '../features/overseer/OverseerPortrait';
import { OverseerSheet } from '../features/overseer/OverseerSheet';

/**
 * How long the four on screen stay held, measured on the server's clock (§F6, 2026-09-17).
 *
 * `expiresAt` alone would be read against the reader's own clock, and a machine a few minutes out
 * would show a countdown starting at seven minutes or at twelve. The response carries `serverNow`
 * for exactly this: the gap between the two is the real window, and it is anchored to the moment
 * the cache took the response rather than to whatever this browser thinks the time is.
 *
 * Null when nothing is held, which happens only when the pool is too small to hold anything back.
 */
function useHoldCountdown(offer: UseQueryResult<OverseerChoicesResponse>): number | null {
  const { dataUpdatedAt, data } = offer;
  const deadline =
    data?.expiresAt == null
      ? null
      : Date.parse(data.expiresAt) - Date.parse(data.serverNow) + dataUpdatedAt;
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setMsLeft(null);
      return undefined;
    }
    const tick = () => setMsLeft(Math.max(0, deadline - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  return msLeft;
}

/** `9:58`, the shape a countdown is read in. */
function asClock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The first screen, in two steps (maintainer, 2026-09-22).
 *
 * **Portraits, then the file.** It used to be four cards holding a thumbnail, a clamped bio, a
 * radar and a 4-column sheet each, all fighting for one viewport: nothing was big enough to look
 * at and the bios were cut mid-word. So the landing is four paintings and a title, and pressing
 * one replaces the screen with that overseer's file at a size worth reading. Two buttons under
 * it: back to the four, or take them.
 *
 * Nothing but the paintings at first on purpose. The pick cannot be undone and the operator is
 * off the board for every other player, so the screen asks for one deliberate press before it
 * shows the numbers anybody would compare on.
 */
export function CharacterSelectScreen() {
  const navigate = useNavigate();
  const createOverseer = useCreateOverseer();
  /*
   * §F6: the four are the **server's**, not the whole table.
   *
   * The preset catalogue ships in `@frontline/shared` and this screen used to map straight over
   * it, which was right while there were four of them and is wrong now there are thirty and a
   * pool that drains. Only the server knows who is left.
   */
  const offer = useOverseerChoices();
  const choices = offer.data?.choices ?? [];
  const [openedId, setOpenedId] = useState<string | null>(null);

  /*
   * §F6: the ten minutes are up, so draw four more without making the player find the reload key.
   *
   * The server has already let the hold go by the time this fires, and pressing Confirm on a
   * lapsed batch is a 410. Refetching here is what turns "the page needs refreshing" into the
   * page having refreshed itself. It cannot loop: a successful draw moves the deadline forward,
   * and a failed one leaves `lapsed` exactly as it was, so the dependencies do not change.
   */
  const msLeft = useHoldCountdown(offer);
  const lapsed = msLeft === 0;
  const { refetch } = offer;
  useEffect(() => {
    if (!lapsed) return;
    setOpenedId(null);
    void refetch();
  }, [lapsed, refetch]);

  const opened = choices.find((preset) => preset.presetId === openedId) ?? null;

  const confirm = () => {
    if (!opened) return;
    createOverseer.mutate(
      { presetId: opened.presetId },
      {
        onSuccess: () => {
          void navigate('/game');
        },
      },
    );
  };

  /* Same fallback as the login screen, and for the same reason: a network, CORS or parse failure
     is not an `ApiRequestError`, and discarding it left this screen looking as though the press
     had done nothing. This is the one screen a player cannot get past. */
  const serverError =
    createOverseer.error === null
      ? null
      : createOverseer.error instanceof ApiRequestError
        ? createOverseer.error.message
        : 'Could not reach the server. Check your connection and try again.';

  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-surface-950">
      <div className="grain pointer-events-none absolute inset-0" />

      {/* The title, and the hold in the corner. Nothing else: the pool figures and the "each
          rewrites how the war is fought" paragraph came off at the maintainer's request. */}
      <header className="relative flex shrink-0 items-start justify-between gap-4 px-6 pb-2 pt-5 sm:px-10">
        <div className="min-w-0">
          <h1
            className="font-stamp text-[clamp(24px,4vw,44px)] leading-none tracking-[0.06em] text-ink-100"
            data-testid="overseer-title"
          >
            CHOOSE YOUR OVERSEER
          </h1>
          <span aria-hidden className="mt-2 block h-2 w-[min(28rem,60vw)] text-brass-300/70">
            <DrawnRule />
          </span>
        </div>
        {msLeft !== null && (
          <p
            data-testid="overseer-hold"
            /* Small, drawn, top right. `ink-box` is the pen's own rectangle, the same one the
               note-to-yourself controls wear. */
            className={`ink-box shrink-0 px-3 py-1.5 text-center font-stamp text-[13px] leading-tight ${
              lapsed ? 'text-oxblood-300' : 'text-brass-300'
            }`}
          >
            {lapsed ? (
              'Drawing four more'
            ) : (
              <>
                <span className="block text-[9px] uppercase tracking-[0.2em] text-ink-300">
                  Held for you
                </span>
                <span className="tabular-nums">{asClock(msLeft)}</span>
              </>
            )}
          </p>
        )}
      </header>

      {/*
       * `justify-start` with the file centred by its own `my-auto`, not `justify-center`.
       *
       * A flex container that centres its children and also scrolls cannot scroll to the top of
       * an overflowing child: the overflow is split above and below, and the part above is
       * unreachable. At 1280x720 the overseer's file is taller than the space left under the
       * title, and with `justify-center` the head of the sheet went under the heading while the
       * foot ran past the two buttons. `my-auto` centres it while it fits and does nothing once
       * it does not, which is the behaviour that was wanted both times.
       */}
      <div className="relative flex min-h-0 flex-1 flex-col justify-start gap-3 overflow-y-auto px-6 pb-5 pt-1 sm:px-10">
        {offer.isError && (
          <div className="mx-auto w-full max-w-5xl">
            <LoadFailure
              what="The overseer files"
              onRetry={() => void offer.refetch()}
              detail="Nothing has been chosen and nothing has been lost. Your crew is waiting on the other side of this."
            />
          </div>
        )}

        {!offer.isError && opened === null && (
          <PortraitWall choices={choices} loading={offer.data === undefined} onOpen={setOpenedId} />
        )}

        {/* `min-h-0` on the column so the file can give ground rather than pushing the two
            buttons past the foot of the frame: a single pixel over and the drawn faces are cut. */}
        {opened !== null && (
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3">
            <OverseerSheet preset={opened} />
            {serverError && (
              <p role="alert" className="font-body text-[13px] text-oxblood-300">
                {serverError}
              </p>
            )}
            {/*
             * Centred and colour-coded (maintainer, 2026-09-22).
             *
             * They used to sit at opposite ends of the sheet in the same brass, which is the
             * layout for a toolbar and the wrong one for the last decision on the screen: the
             * two reads of a pair pushed to the corners are "these are unrelated" and "these are
             * equal". Together in the middle, in red and green, they read as one question with
             * two answers. Red is the way out, green is the way on.
             */}
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8">
              <DrawnButton
                size="md"
                tone="danger"
                onClick={() => setOpenedId(null)}
                data-testid="overseer-back"
              >
                Go back
              </DrawnButton>
              <DrawnButton
                size="md"
                tone="go"
                onClick={confirm}
                disabled={createOverseer.isPending}
                data-testid="overseer-confirm"
              >
                {createOverseer.isPending ? 'Deploying…' : 'Confirm overseer'}
              </DrawnButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * The four, as paintings and nothing else.
 *
 * A name under each, because a player who has met one before is looking for them by name; no
 * archetype chip, no bio, no numbers. Pressing one opens the file.
 */
function PortraitWall({
  choices,
  loading,
  onOpen,
}: {
  choices: readonly OverseerPreset[];
  loading: boolean;
  onOpen: (presetId: string) => void;
}) {
  if (loading) {
    return (
      <p
        className="text-center font-display text-[12px] uppercase tracking-[0.2em] text-ink-300"
        data-testid="overseer-pool"
      >
        Reading the files.
      </p>
    );
  }
  if (choices.length === 0) {
    return (
      <p
        className="mx-auto max-w-2xl text-center font-body text-[13px] leading-relaxed text-ink-300"
        data-testid="overseer-pool"
      >
        Every operator still unspoken for is sitting in somebody else&apos;s booking. The bookings
        run out on their own, so this screen is waiting for the first one to.
      </p>
    );
  }

  return (
    /*
     * As big as the screen will let them be.
     *
     * Four across from `lg` and two below it, and every painting takes the **height** the wall
     * has left over rather than a height derived from its column. That is the brief ("a big
     * full portrait, your four choices taking a lot of the screen"): on a laptop the paintings
     * run from under the title to the names at the foot of the screen.
     *
     * `min-h-0` on the grid and on each button, or a flex child refuses to shrink below its
     * content and the row overflows the frame instead of fitting inside it.
     */
    <div
      className="mx-auto grid min-h-0 w-full max-w-[86rem] flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-6 lg:grid-cols-4 lg:grid-rows-1"
      data-testid="overseer-wall"
    >
      {choices.map((preset) => (
        <button
          key={preset.presetId}
          type="button"
          onClick={() => onOpen(preset.presetId)}
          data-testid={`overseer-card-${preset.presetId}`}
          className="group flex min-h-0 min-w-0 flex-col items-stretch gap-2 text-left"
        >
          {/* The frame is the edge of the picture, not a box with a picture in it: the portrait
              is `fill`, so the painting takes the whole of whatever this is. */}
          {/*
           * The frame is the whole of the column and the whole of the row.
           *
           * No aspect ratio on it, and that is deliberate rather than an omission: four fixed
           * columns and a full-height row already decide the shape, and a ratio declared here
           * would simply be overridden by the two of them. The painting takes whatever that
           * shape is and crops to it (`aspect="fill"`, with the crop aimed high), so a tall
           * viewport gets tall panels and a short one gets squarer ones, and the face is
           * centred in both.
           */}
          <span className="ink-frame relative block h-full w-full overflow-hidden rounded-sm p-1.5 transition-transform duration-200 group-hover:-translate-y-1">
            <span className="block h-full w-full overflow-hidden rounded-sm">
              <OverseerPortrait
                portraitId={preset.portraitId}
                aspect="fill"
                showTag={false}
                className="border-brass-500/30 transition-[filter] duration-200 group-hover:brightness-110"
              />
            </span>
          </span>
          <span className="min-w-0 shrink-0 break-words text-center font-stamp text-[clamp(14px,1.4vw,20px)] leading-tight text-ink-200 transition-colors group-hover:text-brass-300">
            {preset.name}
          </span>
        </button>
      ))}
    </div>
  );
}
