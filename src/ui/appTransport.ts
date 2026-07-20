// Resolve the API transport once: real fetch against the platform when
// CRIBL_API_URL is present; otherwise, in dev only, the bundled fixtures so the
// app runs without a backend. The dynamic import keeps fixtures out of prod.

import type { Transport } from '../data/apiClient';

let cached: Transport | undefined | 'unresolved' = 'unresolved';

export async function appTransport(): Promise<Transport | undefined> {
  if (cached !== 'unresolved') return cached;
  if (typeof window !== 'undefined' && window.CRIBL_API_URL) {
    cached = undefined;
  } else if (import.meta.env.DEV) {
    try {
      const mod = await import('../data/__fixtures__');
      cached = mod.makeFixtureTransport();
    } catch {
      cached = undefined;
    }
  } else {
    cached = undefined;
  }
  return cached;
}
