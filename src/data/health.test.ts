import { describe, it, expect } from 'vitest';
import { applyHealth, fetchHealth } from './health';
import { makeFixtureTransport } from './__fixtures__';
import type { KORecord } from './types';

const rec = (key: string): KORecord => {
  const [group, , type, id] = key.split('/');
  return { key, type: type as KORecord['type'], group, id, name: id, raw: {}, searchText: [] };
};

describe('fetchHealth', () => {
  it('maps per-object health from the status endpoints', async () => {
    const { available, map } = await fetchHealth(['prod', 'staging'], { transport: makeFixtureTransport() });
    expect(available).toBe(true);
    expect(map['prod/-/source/splunk_in']).toBe('green');
    expect(map['prod/-/source/dead_input']).toBe('red');
    expect(map['prod/-/destination/splunk_out']).toBe('green');
    expect(map['staging/-/source/stg_in']).toBe('green');
  });

  it('degrades to unavailable when status is denied', async () => {
    const transport = makeFixtureTransport({ deny: (p) => p.includes('/system/status/') });
    const { available, map } = await fetchHealth(['prod'], { transport });
    expect(available).toBe(false);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('applyHealth enriches only matching records', () => {
    const records = [rec('prod/-/source/splunk_in'), rec('prod/-/source/other')];
    const enriched = applyHealth(records, { 'prod/-/source/splunk_in': 'red' });
    expect(enriched[0].health).toBe('red');
    expect(enriched[1].health).toBeUndefined();
  });
});
