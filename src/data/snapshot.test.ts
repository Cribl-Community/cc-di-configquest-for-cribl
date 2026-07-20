import { describe, it, expect } from 'vitest';
import { chunkBySize, loadSnapshot, saveSnapshot } from './snapshot';
import type { Transport } from './apiClient';
import type { FetchReport, KORecord } from './types';

// In-memory KV endpoint that rejects any PUT whose body exceeds `capBytes` with a 413,
// mirroring the real store's per-value size cap (the bug that made large snapshots 413
// on write while the tiny version key succeeded, leaving a stale snapshot loadable).
function memoryTransport(capBytes = Infinity): Transport {
  const store = new Map<string, string>();
  return (path, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'PUT') {
      const body = typeof init?.body === 'string' ? init.body : String(init?.body);
      if (body.length > capBytes) return Promise.resolve(new Response('', { status: 413 }));
      store.set(path, body);
      return Promise.resolve(new Response('', { status: 200 }));
    }
    return store.has(path)
      ? Promise.resolve(new Response(store.get(path), { status: 200 }))
      : Promise.resolve(new Response('', { status: 404 }));
  };
}

// Install a minimal localStorage on globalThis (absent in the Node test env) so tests can
// exercise the real browser path, where the mirror is present and can mask a remote failure.
function installLocalStorage(): () => void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  };
}

function rec(id: string, size: number): KORecord {
  return {
    key: `default/-/regex/${id}`,
    type: 'regex',
    group: 'default',
    id,
    name: id,
    raw: { id, blob: 'x'.repeat(size) },
    searchText: [`id: ${id}`, `blob: ${'x'.repeat(size)}`],
  };
}

const REPORT: FetchReport = { indexedGroups: ['default'], skippedGroups: [], partialFailures: [], builtAt: '2026-01-01T00:00:00Z' };

describe('snapshot persistence', () => {
  it('round-trips an index too large for a single value, stripping searchText', async () => {
    const t = memoryTransport();
    const records = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 10_000)); // ~400 KB total
    await saveSnapshot(records, REPORT, t);

    const loaded = await loadSnapshot(t);
    expect(loaded).not.toBeNull();
    expect(loaded!.records).toHaveLength(records.length);
    expect(loaded!.records.map((r) => r.id)).toEqual(records.map((r) => r.id)); // order preserved
    expect(loaded!.records.every((r) => r.searchText.length === 0)).toBe(true); // recomputed on hydrate
    expect(loaded!.report).toEqual(REPORT);
  });

  it('does not load a snapshot whose write was refused as too large', async () => {
    // Cap below one chunk so a chunk PUT 413s: the version key is never set, so no
    // stale/partial snapshot is served — the app cold-rebuilds instead.
    const t = memoryTransport(50_000);
    const records = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 10_000));
    await saveSnapshot(records, REPORT, t);
    expect(await loadSnapshot(t)).toBeNull();
  });

  it('does not load a refused snapshot even when the localStorage mirror accepted it', async () => {
    // The real-browser case the previous test could not reach under Node: localStorage is
    // present and accepts the chunk, but the REMOTE PUT 413s. The mirror must not make the
    // shared snapshot look valid — validity is gated on the remote store, so this cold-rebuilds.
    const restore = installLocalStorage();
    try {
      const t = memoryTransport(50_000);
      const records = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 10_000));
      await saveSnapshot(records, REPORT, t);
      // A fresh transport (empty remote) with the SAME localStorage models another open: the
      // shared store never got a valid version, so nothing loads from the poisoned mirror.
      expect(await loadSnapshot(memoryTransport())).toBeNull();
    } finally {
      restore();
    }
  });

  it('persists to the shared store when the remote write succeeds, even with localStorage present', async () => {
    const restore = installLocalStorage();
    try {
      const t = memoryTransport(); // no cap — remote accepts
      const records = Array.from({ length: 8 }, (_, i) => rec(`r${i}`, 1_000));
      await saveSnapshot(records, REPORT, t);
      const loaded = await loadSnapshot(t);
      expect(loaded?.records.map((r) => r.id)).toEqual(records.map((r) => r.id));
    } finally {
      restore();
    }
  });

  it('returns null when nothing has been written', async () => {
    expect(await loadSnapshot(memoryTransport())).toBeNull();
  });

  it('rejects a stale snapshot at a superseded version', async () => {
    // A snapshot written, then its version key clobbered to an old value (an upgrade
    // that changed the format) must not load.
    const t = memoryTransport();
    await saveSnapshot([rec('a', 10)], REPORT, t);
    // Clobber the version key (appId is empty under Node, so the path is `/a//kvstore/…`).
    await t('/a//kvstore/index.snapversion', { method: 'PUT', body: JSON.stringify(1) });
    expect(await loadSnapshot(t)).toBeNull();
  });
});

describe('chunkBySize', () => {
  it('packs records up to the byte budget, then starts a new chunk', () => {
    const records = Array.from({ length: 10 }, (_, i) => rec(`r${i}`, 1_000)); // ~1 KB each
    const chunks = chunkBySize(records, 3_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(records.length); // no record dropped or duplicated
    for (const c of chunks) {
      const bytes = c.reduce((n, r) => n + JSON.stringify(r).length, 0);
      // Each chunk is within budget unless it is a single oversized record.
      expect(bytes <= 3_000 || c.length === 1).toBe(true);
    }
  });

  it('gives a single oversized record its own chunk rather than dropping it', () => {
    const chunks = chunkBySize([rec('big', 10_000)], 1_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  it('returns no chunks for an empty index', () => {
    expect(chunkBySize([], 1_000)).toEqual([]);
  });
});
