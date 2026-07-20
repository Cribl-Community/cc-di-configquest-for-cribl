import { describe, it, expect } from 'vitest';
import { fetchObjectHistory } from './history';
import { fetchOrg } from '../fetchOrg';
import { normalizeOrg } from '../normalize';
import { makeFixtureTransport } from '../__fixtures__';
import type { KORecord } from '../types';

async function records(): Promise<KORecord[]> {
  return normalizeOrg(await fetchOrg({ transport: makeFixtureTransport() }));
}

describe('fetchObjectHistory', () => {
  it('collects commits touching an object, each with its diff', async () => {
    const history = await fetchObjectHistory('prod/-/pipeline/web_logs', await records(), {
      transport: makeFixtureTransport(),
    });
    expect(history.length).toBe(3);
    expect(history[0].commit.authorName).toBe('Ada Lovelace');
    expect(history[0].rows.some((r) => r.kind === 'change' || r.kind === 'add' || r.kind === 'del')).toBe(true);
  });

  it('returns nothing for an object no commit touched', async () => {
    const history = await fetchObjectHistory('prod/-/pipeline/noisy_pipe', await records(), {
      transport: makeFixtureTransport(),
    });
    expect(history).toEqual([]);
  });
});
