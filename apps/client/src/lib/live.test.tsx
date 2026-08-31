import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveEvents } from './live';
import { useSession } from '../store/session';

/**
 * The live channel from the tab's side, driven through the real hook against a fake socket.
 *
 * Mocked at `fetch` rather than at the hook's own seam, for the reason `MissionsLaunch.test.tsx`
 * gives: what is worth pinning here is what goes on the wire and what comes back off it. A test
 * that stubbed an "event arrives" callback would agree with a hook that sent no `Authorization`
 * header, never parsed a frame, and left the caches untouched.
 */

/** A response whose body is a stream the test pushes SSE frames into by hand. */
function fakeStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  return {
    body,
    push: (frame: string) => controller.enqueue(encoder.encode(frame)),
    close: () => controller.close(),
  };
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.setState({ token: 'a-token' });
});

afterEach(() => {
  vi.restoreAllMocks();
  client.clear();
});

describe('the live channel', () => {
  it('opens the stream with the session token in a header, not a query string', async () => {
    const stream = fakeStream();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(stream.body, { status: 200 }));

    renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    // Narrowed rather than stringified: `fetch` also takes a `Request`, and `String()` on one of
    // those is "[object Object]", which would make the assertion below quietly untrue.
    expect(typeof url).toBe('string');
    expect(url as string).toBe('/api/events');
    expect(url as string).not.toContain('a-token');
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe(
      'Bearer a-token',
    );
  });

  it('reports itself live once the stream is open', async () => {
    const stream = fakeStream();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream.body, { status: 200 }));

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current).toBe('live'));
  });

  /** The delivery: a frame on the wire turns into a refetch of exactly the screens it stales. */
  it('invalidates the battle screens when a battle event arrives', async () => {
    const stream = fakeStream();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream.body, { status: 200 }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));
    invalidate.mockClear();

    stream.push('event: battle\ndata: {"kind":"battle","at":"2026-08-31T12:00:00.000Z"}\n\n');

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['battles']));
    expect(keys).toContain(JSON.stringify(['city']));
    // Not the ones a fight does not touch: an event that invalidated everything would be a poll
    // with extra steps, and would refetch eight screens for a receipt about a finished roof.
    expect(keys).not.toContain(JSON.stringify(['bar']));
  });

  it('refetches everything on connect, since it heard nothing while it was down', async () => {
    const stream = fakeStream();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream.body, { status: 200 }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));

    // No key at all: the blanket invalidation that closes the gap a disconnection opened.
    expect(invalidate.mock.calls.some((call) => call[0] === undefined)).toBe(true);
  });

  /** The heartbeat is a comment line. Treating it as an event would refetch the game every 20s. */
  it('ignores the heartbeat', async () => {
    const stream = fakeStream();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream.body, { status: 200 }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));
    invalidate.mockClear();

    stream.push(': beat\n\n');
    stream.push('event: ready\ndata: {"at":"2026-08-31T12:00:00.000Z"}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(invalidate).not.toHaveBeenCalled();
  });

  /** A frame split across two TCP reads is the normal case, not the exotic one. */
  it('reassembles an event that arrives in pieces', async () => {
    const stream = fakeStream();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream.body, { status: 200 }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));
    invalidate.mockClear();

    stream.push('event: message\ndata: {"kind":"mess');
    stream.push('age","at":"2026-08-31T12:00:00.000Z"}\n\n');

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['messages']));
    });
  });

  it('shrugs off a frame it cannot read rather than tearing the channel down', async () => {
    const stream = fakeStream();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream.body, { status: 200 }));

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));

    stream.push('event: battle\ndata: {not json at all\n\n');
    stream.push('event: battle\ndata: {"kind":"nonsense","at":"x"}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const invalidate = vi.spyOn(client, 'invalidateQueries');
    stream.push('event: faction\ndata: {"kind":"faction","at":"2026-08-31T12:00:00.000Z"}\n\n');
    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['faction']));
    });
    expect(result.current).toBe('live');
  });

  it('goes offline and comes back when the stream drops', async () => {
    const first = fakeStream();
    const second = fakeStream();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(first.body, { status: 200 }))
      .mockResolvedValue(new Response(second.body, { status: 200 }));

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));

    first.close();

    await waitFor(() => expect(result.current).toBe('offline'));
    await waitFor(() => expect(result.current).toBe('live'), { timeout: 5_000 });
  });

  it('does not open a channel with no session to open it for', async () => {
    useSession.setState({ token: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBe('offline');
  });

  /**
   * Unmounting has to abort the request, or a session that navigates away from the game leaves an
   * HTTP request open against the server for as long as the tab lives.
   *
   * Asserted on the abort signal rather than on `body.locked`, which was the first thing this test
   * reached for and proved nothing: `getReader()` locks the stream the moment the hook starts
   * reading it, so `locked` is already true while the channel is perfectly healthy. That version
   * passed with the cleanup function deleted.
   */
  it('aborts the request when the shell unmounts', async () => {
    const stream = fakeStream();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(stream.body, { status: 200 }));

    const { result, unmount } = renderHook(() => useLiveEvents(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current).toBe('live'));

    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });
});
