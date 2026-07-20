import { describe, it, expect } from 'vitest';
import { chunkItemsBySize, getChunkedArray, getJSON, setChunkedArray, setJSON } from './kv';
import type { Transport } from './data/apiClient';

/** In-memory stand-in for the KV REST endpoint. `capBytes` mirrors the real store's per-value
 *  size cap: a PUT whose body exceeds it 413s (the bug that made large values silently fail). */
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
    if (method === 'DELETE') {
      const existed = store.delete(path);
      return Promise.resolve(new Response('', { status: existed ? 200 : 404 }));
    }
    return store.has(path)
      ? Promise.resolve(new Response(store.get(path), { status: 200 }))
      : Promise.resolve(new Response('', { status: 404 }));
  };
}

describe('kv helpers', () => {
  it('round-trips a JSON value', async () => {
    const t = memoryTransport();
    const value = { builtAt: 'now', records: [1, 2, 3], nested: { a: true } };
    expect(await setJSON('index:snapshot', value, t)).toBe(true);
    expect(await getJSON('index:snapshot', t)).toEqual(value);
  });

  it('returns null for a key that was never written', async () => {
    expect(await getJSON('index:agemap', memoryTransport())).toBeNull();
  });

  it('returns null when stored data is not valid JSON', async () => {
    const bad: Transport = () => Promise.resolve(new Response('{ not json', { status: 200 }));
    expect(await getJSON('index:snapshot', bad)).toBeNull();
  });

  it('never throws when the transport fails', async () => {
    const boom: Transport = () => Promise.reject(new Error('network down'));
    expect(await setJSON('k', { a: 1 }, boom)).toBe(false);
    expect(await getJSON('k', boom)).toBeNull();
  });
});

describe('chunkItemsBySize', () => {
  it('packs items up to the byte budget, then starts a new chunk', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ i, blob: 'x'.repeat(1_000) }));
    const chunks = chunkItemsBySize(items, 3_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(items.length); // nothing dropped or duplicated
    for (const c of chunks) {
      expect(JSON.stringify(c).length <= 3_000 || c.length === 1).toBe(true);
    }
  });

  it('gives a single oversized item its own chunk rather than dropping it', () => {
    const chunks = chunkItemsBySize([{ blob: 'x'.repeat(10_000) }], 1_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  it('returns no chunks for an empty array', () => {
    expect(chunkItemsBySize([], 1_000)).toEqual([]);
  });
});

describe('setChunkedArray / getChunkedArray', () => {
  it('round-trips an array too large for a single value', async () => {
    const t = memoryTransport(100_000); // ~the real Leader cap; the 80 KB chunk budget fits under it
    const items = Array.from({ length: 100 }, (_, i) => [`k${i}`, { v: 'y'.repeat(2_000) }] as const);
    expect(await setChunkedArray('index:agemap', items, t)).toBe(true);
    // Manifest records more than one chunk (a single value would exceed the cap).
    expect((await getJSON<{ chunks: number }>('index:agemap', t))!.chunks).toBeGreaterThan(1);
    expect(await getChunkedArray('index:agemap', t)).toEqual(items.map((e) => [...e]));
  });

  it('reports remote failure when a chunk exceeds the cap, and reads back null', async () => {
    // A cap below a single item forces every chunk PUT to 413 → remote failure signalled,
    // and the incomplete write must read back as "no value" (never a spliced partial).
    const t = memoryTransport(500);
    const items = Array.from({ length: 5 }, (_, i) => [`k${i}`, { v: 'y'.repeat(2_000) }] as const);
    expect(await setChunkedArray('index:agemap', items, t)).toBe(false);
    expect(await getChunkedArray('index:agemap', t)).toBeNull();
  });

  it('returns null when nothing was written', async () => {
    expect(await getChunkedArray('index:agemap', memoryTransport())).toBeNull();
  });
});
