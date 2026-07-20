// Small async concurrency helpers, shared so the config fetch and the git walks don't each
// hand-roll (and subtly differ on) their bounded-concurrency loop.

const HOLE = Symbol('hole'); // a slot whose task threw — dropped from the result

/**
 * Run `fn` over `items` with at most `concurrency` in flight at once — a ROLLING pool: a worker
 * grabs the next item the instant its previous one settles, so a slow task never leaves other
 * slots idle (unlike a batch that waits for its slowest member). Results come back in INPUT
 * order. A task that throws is dropped (like `Promise.allSettled`'s rejected), so one failure
 * never rejects the whole run — callers that need every slot should not throw.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: (R | typeof HOLE)[] = new Array(items.length).fill(HOLE);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      try {
        out[i] = await fn(items[i], i);
      } catch {
        // leave the hole — the item is dropped from the result, order otherwise preserved
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out.filter((r): r is R => r !== HOLE);
}
