import {
  DECLARE_INFAMY_COST,
  DECLARE_UNAFFORDABLE_MESSAGE,
  type BattlesResponse,
  type BattleTarget,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeclareDialog } from './DeclareDialog';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../store/session';

/**
 * The mark a declaration posts has to be one the board still offers.
 *
 * `slots` is re-read every few seconds and the first mark drops off the list the minute it passes.
 * The chosen mark was seeded once from `slots[0]` and never reconciled, so a dialog left open across
 * that minute highlighted nothing and still posted the mark that had just expired.
 */
/** Another player's ground: the one target a call is charged for (§D7). */
const target: BattleTarget = {
  kind: 'location',
  districtId: 'steelbelt',
  locationId: 'steelbelt-press',
};
/** Looter ground down the road, which the board does not list and is therefore free to call. */
const FREE: BattleTarget = {
  kind: 'location',
  districtId: 'steelbelt',
  locationId: 'steelbelt-ramp',
};
const EARLY = '2026-08-13T22:30:00.000Z';
const LATE = '2026-08-14T06:30:00.000Z';

/** A crew that can cover the call, unless the case under test is about a crew that cannot. */
const RICH = 420;

/**
 * The board the dialog reads its price off. Only the Press is listed, because only the Press is a
 * person's: the dialog is told what each target costs rather than left to work it out from a
 * holder plate, and a target the board does not name is free.
 */
const board: BattlesResponse = {
  coming: [],
  reports: [],
  spyReports: [],
  slots: [EARLY, LATE],
  infamy: RICH,
  callPrices: { locations: { [target.locationId]: DECLARE_INFAMY_COST }, districts: {} },
  gates: [],
  structures: [],
  serverNow: '2026-08-13T10:00:00.000Z',
};

beforeEach(() => {
  // The dialog's query is enabled by a session, and nothing here may reach the network: a board
  // that is not in the cache stays out of it.
  useSession.setState({ signedIn: true, user: null });
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      throw new Error(`unstubbed request: ${String(path)}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(
  slots: readonly string[],
  infamy: number = RICH,
  on: BattleTarget = target,
  seeded: BattlesResponse | null = board,
  gate?: { shut: boolean; brokenUntil: string | null },
) {
  const onConfirm = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  if (seeded) queryClient.setQueryData(queryKeys.battles, seeded);
  const dialog = (offered: readonly string[]) => (
    <QueryClientProvider client={queryClient}>
      <DeclareDialog
        target={on}
        placeName="Kessler Press"
        slots={offered}
        gate={gate}
        infamy={infamy}
        pending={false}
        error={null}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />
    </QueryClientProvider>
  );
  const view = render(dialog(slots));
  const rerender = (next: readonly string[]) => view.rerender(dialog(next));
  return { onConfirm, rerender };
}

describe('which mark is called', () => {
  it('follows the board when the mark it opened on expires', () => {
    const { onConfirm, rerender } = open([EARLY, LATE]);
    rerender([LATE]);
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(LATE);
  });

  it('lets go of a mark the player picked once the board no longer offers it', () => {
    const { onConfirm, rerender } = open([EARLY, LATE]);
    fireEvent.click(screen.getByTestId(`slot-${EARLY}`));
    rerender([LATE]);
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(LATE);
  });

  it('keeps a mark the player picked for as long as the board offers it', () => {
    const { onConfirm, rerender } = open([EARLY, LATE]);
    fireEvent.click(screen.getByTestId(`slot-${LATE}`));
    rerender([EARLY, LATE]);
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(LATE);
  });
});

/**
 * A raid lands inside its breach or not at all (maintainer, 2026-09-27), and the route refuses a
 * mark at or after the gate comes back up. The board's marks run a day out whatever the gate is
 * doing, so the picker has to cut them itself or it offers what the route turns away.
 */
describe('a call through a breach', () => {
  const RAID: BattleTarget = { kind: 'district', districtId: 'ashen-terraces' };
  const UP_BETWEEN = '2026-08-14T02:00:00.000Z';

  it('offers only the marks before the gate is back up', () => {
    const { onConfirm } = open([EARLY, LATE], RICH, RAID, board, {
      shut: true,
      brokenUntil: UP_BETWEEN,
    });
    expect(screen.queryByTestId(`slot-${LATE}`)).toBeNull();
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(EARLY);
  });

  it('says so, and sends nothing, when the gate is up before the first mark', () => {
    const { onConfirm } = open([EARLY, LATE], RICH, RAID, board, {
      shut: true,
      brokenUntil: '2026-08-13T20:00:00.000Z',
    });
    expect(screen.getByTestId('declare-breach-closes')).toBeInTheDocument();
    const confirm = screen.getByTestId('declare-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('leaves a location in an open district every mark the board has', () => {
    open([EARLY, LATE], RICH, FREE, board, { shut: false, brokenUntil: UP_BETWEEN });
    expect(screen.getByTestId(`slot-${LATE}`)).toBeInTheDocument();
  });
});

/**
 * §D7: the call's price, said before the player commits.
 *
 * The server refuses a crew that cannot cover it, and a refusal a player only meets after picking a
 * mark and pressing the loudest button in the game is a refusal that arrives too late to be useful.
 * Charged only for another player's ground (maintainer, 2026-09-15); the free half is below.
 */
describe('what the call costs on another player', () => {
  it('quotes the price and the name it comes out of', () => {
    open([EARLY, LATE]);
    const price = screen.getByTestId('declare-price');
    expect(price.textContent).toContain(String(DECLARE_INFAMY_COST));
    expect(price.textContent).toContain('420');
    expect(screen.queryByTestId('declare-unaffordable')).toBeNull();
  });

  it('refuses a crew one point short, and sends nothing', () => {
    const { onConfirm } = open([EARLY, LATE], DECLARE_INFAMY_COST - 1);
    expect(screen.getByTestId('declare-unaffordable').textContent).toBe(
      DECLARE_UNAFFORDABLE_MESSAGE,
    );
    const confirm = screen.getByTestId('declare-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lets a crew with exactly the price through', () => {
    const { onConfirm } = open([EARLY, LATE], DECLARE_INFAMY_COST);
    expect(screen.queryByTestId('declare-unaffordable')).toBeNull();
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(EARLY);
  });
});

/**
 * The other half of the rule, and the control for the first: the same dialog on ground the board
 * does not price, held by a crew with no name at all. No price, no warning, and the call goes.
 */
describe('what the call costs on anybody else', () => {
  it('says nothing about money and lets a crew with no name call it', () => {
    const { onConfirm } = open([EARLY, LATE], 0, FREE);
    expect(screen.queryByTestId('declare-price')).toBeNull();
    expect(screen.queryByTestId('declare-unaffordable')).toBeNull();
    fireEvent.click(screen.getByTestId('declare-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(EARLY);
  });

  it('holds the button until the board has said what the call costs', () => {
    const { onConfirm } = open([EARLY, LATE], RICH, FREE, null);
    expect(screen.queryByTestId('declare-price')).toBeNull();
    const confirm = screen.getByTestId('declare-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/**
 * The heading, and the place in caps (maintainer, 2026-09-20).
 *
 * The sentence was composed at each of the three call sites, so `the gate at ...` was written out
 * three times and the caps rule would have had to be applied three times and kept in step. The
 * dialog takes the place bare and writes the sentence, which is why there is one rule to test.
 *
 * `uppercase` is a CSS transform, so `textContent` still reads `Kessler Press` and jsdom has no
 * stylesheet to compute from. What is asserted here is the half that is structural and the half
 * this file can see: the place is its **own element** carrying the class, which is what makes it
 * possible to case the name without shouting the sentence. The rendered case is asserted where
 * there is real CSS to render it, in `e2e/visiting.spec.ts`.
 */
describe('the heading is wholly in caps', () => {
  /**
   * Every word of it, since 2026-09-22 (maintainer).
   *
   * It used to set the *place* in caps inside a sentence in sentence case, on the argument that
   * a heading wholly shouted loses the difference between the thing being named and the words
   * naming it. The maintainer wants these titles shouted, so the rule is now one class on the
   * heading and the spans inside it carry nothing.
   */
  const shouted = () =>
    screen.getByRole('heading', { level: 2 }).className.split(/\s+/).includes('uppercase');

  it('shouts a gate target, words and place alike', () => {
    open([EARLY, LATE], RICH, { kind: 'gate', districtId: 'kessler' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'the gate at Kessler Press',
    );
    expect(shouted()).toBe(true);
  });

  it('shouts a location target too', () => {
    open([EARLY, LATE], RICH, {
      kind: 'location',
      districtId: 'kessler',
      locationId: 'kessler-press',
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Kessler Press');
    expect(shouted()).toBe(true);
  });

  it('calls a raid on a district a raid', () => {
    open([EARLY, LATE], RICH, { kind: 'district', districtId: 'kessler' });
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('a raid on Kessler Press');
    expect(shouted()).toBe(true);
  });
});

/**
 * A gate is read before it is broken (maintainer, 2026-09-29): the caller carries Spy beside Call
 * it where the door can be spied, and Cancel sits on the far left, apart from both.
 */
describe('the buttons on the row', () => {
  const GATE: BattleTarget = { kind: 'gate', districtId: 'annexes' };

  function openWith(onSpy?: () => void) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(queryKeys.battles, board);
    render(
      <QueryClientProvider client={queryClient}>
        <DeclareDialog
          target={GATE}
          placeName="The Annexes"
          slots={[EARLY]}
          infamy={RICH}
          pending={false}
          error={null}
          onClose={() => undefined}
          onConfirm={() => undefined}
          onSpy={onSpy}
        />
      </QueryClientProvider>,
    );
  }

  it('offers Spy when it is given a way to spy, and hands over to it', () => {
    const onSpy = vi.fn();
    openWith(onSpy);
    fireEvent.click(screen.getByTestId('declare-spy'));
    expect(onSpy).toHaveBeenCalledOnce();
  });

  it('draws no Spy where the door cannot be read', () => {
    openWith();
    expect(screen.queryByTestId('declare-spy')).toBeNull();
  });

  it('puts Cancel first on the row, before Spy and Call it', () => {
    openWith(() => undefined);
    const order = ['declare-cancel', 'declare-spy', 'declare-confirm'].map((id) =>
      screen.getByTestId(id),
    );
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

/**
 * Bug pass, 2026-10-02: the marks were printed on the browser's clock, while the board, the Fights
 * tab and the bells print the player's. 22:30 UTC is 07:30 the next morning in Tokyo.
 */
describe('the marks on offer', () => {
  it("are printed on the player's own clock face", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      },
    });
    queryClient.setQueryData(queryKeys.battles, board);
    queryClient.setQueryData(queryKeys.me, { user: { timezone: 'Asia/Tokyo' } });
    render(
      <QueryClientProvider client={queryClient}>
        <DeclareDialog
          target={target}
          placeName="Kessler Press"
          slots={[EARLY]}
          infamy={RICH}
          pending={false}
          error={null}
          onClose={() => undefined}
          onConfirm={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId(`slot-${EARLY}`)).toHaveTextContent('07:30');
  });
});
