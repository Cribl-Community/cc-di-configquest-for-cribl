import { describe, it, expect } from 'vitest';
import { fetchOrg } from './fetchOrg';
import { normalizeOrg } from './normalize';
import { findSpans, matchesQuery, search } from './search';
import { emptyFilters } from './types';
import { makeFixtureTransport } from './__fixtures__';
import type { KORecord } from './types';

const DAY = 86_400_000;
function agedRecord(id: string, over: Partial<KORecord>): KORecord {
  return { key: `g/-/pipeline/${id}`, type: 'pipeline', group: 'g', id, name: id, raw: {}, searchText: [], ...over };
}

async function buildRecords(): Promise<KORecord[]> {
  const raw = await fetchOrg({ transport: makeFixtureTransport() });
  return normalizeOrg(raw);
}

describe('search', () => {
  it('finds a function-level token and returns aligned match spans', async () => {
    const results = search(await buildRecords(), 'ZEBRA_TOKEN_42', emptyFilters());
    const web = results.find((r) => r.record.id === 'web_logs');
    expect(web).toBeDefined();
    const line = web?.matchLines.find((l) => l.text.includes('ZEBRA_TOKEN_42'));
    expect(line).toBeDefined();
    const span = line!.spans[0];
    expect(line!.text.substring(span.start, span.end).toLowerCase()).toBe('zebra_token_42');
  });

  it('ranks an exact id/name match above a searchText-only match', async () => {
    const results = search(await buildRecords(), 'used_pipe', emptyFilters());
    expect(results[0].record.id).toBe('used_pipe');
    expect(results[0].rank).toBe(0);
    const referencingRoute = results.find((r) => r.record.id === 'sr1');
    expect(referencingRoute?.rank).toBe(3); // only matches via `pipeline: used_pipe`
  });

  it('ranks a partial name/id substring as rank 1 (the common palette case)', async () => {
    const results = search(await buildRecords(), 'web', emptyFilters());
    const web = results.find((r) => r.record.id === 'web_logs');
    expect(web?.rank).toBe(1); // name contains, not exact
  });

  it('ranks a description match below name/id matches', async () => {
    const results = search(await buildRecords(), 'Parse and enrich', emptyFilters());
    const web = results.find((r) => r.record.id === 'web_logs');
    expect(web?.rank).toBe(2);
  });

  it('supports * wildcards, matching literal segments in order', async () => {
    const recs = await buildRecords();
    expect(search(recs, 'web*logs', emptyFilters()).some((r) => r.record.id === 'web_logs')).toBe(true);
    // segments out of order don't match
    expect(search(recs, 'logs*web', emptyFilters()).some((r) => r.record.id === 'web_logs')).toBe(false);
  });

  it('applies the age threshold and owner filters (Phase 3)', () => {
    const now = Date.now();
    const records: KORecord[] = [
      agedRecord('fresh', { lastTouched: new Date(now - 5 * DAY).toISOString(), owner: 'alice' }),
      agedRecord('old', { lastTouched: new Date(now - 100 * DAY).toISOString(), owner: 'bob' }),
      agedRecord('noage', {}),
    ];
    expect(search(records, '', { ...emptyFilters(), minAgeDays: 30 }).map((r) => r.record.id)).toEqual(['old']);
    expect(search(records, '', { ...emptyFilters(), owners: ['alice'] }).map((r) => r.record.id)).toEqual(['fresh']);
  });

  it('intersects type, group, and disabled filters', async () => {
    const records = await buildRecords();

    const routes = search(records, '', { ...emptyFilters(), types: ['route'] });
    expect(routes.length).toBe(13);
    expect(routes.every((r) => r.record.type === 'route')).toBe(true);

    const disabledProdSources = search(records, '', {
      ...emptyFilters(),
      types: ['source'],
      groups: ['prod'],
      disabled: ['disabled'],
    });
    expect(disabledProdSources.map((r) => r.record.id)).toEqual(['dead_input']);
  });

  it('returns every filtered record with no highlights for an empty query', async () => {
    const all = search(await buildRecords(), '', emptyFilters());
    expect(all.length).toBe(90);
    expect(all.every((r) => r.matchLines.length === 0 && r.nameSpans.length === 0)).toBe(true);
  });

  it('scopes the Pack filter to objects belonging to that pack', async () => {
    const packObjects = search(await buildRecords(), '', { ...emptyFilters(), packs: ['security_pack'] });
    expect(packObjects.length).toBe(6);
    expect(packObjects.every((r) => r.record.pack === 'security_pack')).toBe(true);
  });
});

describe('matchesQuery', () => {
  it('is substring by default, treats * as any-run, and is case-insensitive', () => {
    expect(matchesQuery('web_logs', 'WEB')).toBe(true);
    expect(matchesQuery('web_logs', 'web*log')).toBe(true);
    expect(matchesQuery('web_logs', 'log*web')).toBe(false);
    expect(matchesQuery('anything', '')).toBe(true);
    expect(matchesQuery("sourcetype=='zscaler-web'", '*zscaler*')).toBe(true);
  });
});

describe('findSpans', () => {
  it('highlights wildcard segments in order', () => {
    expect(findSpans('web_logs', 'web*log')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    expect(findSpans('web_logs', 'log*web')).toEqual([]);
  });

  it('returns every non-overlapping occurrence, case-insensitively', () => {
    expect(findSpans('eval eval', 'eval')).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ]);
    expect(findSpans('AAaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(findSpans('nothing here', 'xyz')).toEqual([]);
  });
});
