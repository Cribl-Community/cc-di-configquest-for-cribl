import { describe, it, expect } from 'vitest';
import { mapPool } from './async';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('returns results in INPUT order regardless of completion order', async () => {
    const out = await mapPool([30, 10, 20, 5], 2, async (ms, i) => {
      await wait(ms);
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30]);
  });

  it('never exceeds the concurrency cap, but does run in parallel (rolling)', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(3);
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('drops a throwing task and keeps the rest, in order', async () => {
    const out = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(out).toEqual([1, 3]);
  });

  it('returns an empty array for no items', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
