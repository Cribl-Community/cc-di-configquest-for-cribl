import { describe, it, expect } from 'vitest';
import { fetchOrg } from './fetchOrg';
import { normalizeOrg, flatten } from './normalize';
import { makeFixtureTransport } from './__fixtures__';
import { KO_TYPES } from './types';
import type { KORecord } from './types';

async function buildRecords(): Promise<KORecord[]> {
  const raw = await fetchOrg({ transport: makeFixtureTransport() });
  return normalizeOrg(raw);
}

const byKey = (records: KORecord[], key: string) => records.find((r) => r.key === key);

describe('flatten', () => {
  it('emits path: value lines, indexes arrays, and skips null/empty', () => {
    expect(flatten({ a: null, b: '', c: 'x', n: 0, d: [1, null, 'two'] })).toEqual([
      'c: x',
      'n: 0',
      'd[0]: 1',
      'd[2]: two',
    ]);
  });

  it('builds dotted paths through nested objects and arrays', () => {
    expect(flatten({ conf: { functions: [{ conf: { expression: "host.startsWith('web-')" } }] } })).toEqual([
      "conf.functions[0].conf.expression: host.startsWith('web-')",
    ]);
  });

  it('caps recursion depth instead of overflowing the stack on pathological nesting', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 10_000; i += 1) deep = { nest: deep };
    expect(() => flatten(deep)).not.toThrow();
    expect(flatten(deep).some((line) => line.endsWith(': (truncated)'))).toBe(true);
  });
});

describe('normalizeOrg', () => {
  it('produces one record per knowledge object across groups and packs', async () => {
    const records = await buildRecords();
    expect(records.length).toBe(90);
  });

  it('collects every knowledge-object type the fixture org declares', async () => {
    const types = new Set((await buildRecords()).map((r) => r.type));
    expect([...types].sort()).toEqual([...KO_TYPES].sort());
  });

  it('normalizes a pipeline with a stable key and conf-derived description', async () => {
    const web = byKey(await buildRecords(), 'prod/-/pipeline/web_logs');
    expect(web).toBeDefined();
    expect(web).toMatchObject({
      type: 'pipeline',
      group: 'prod',
      id: 'web_logs',
      name: 'web_logs',
      description: 'Parse and enrich web logs',
    });
    expect(web?.pack).toBeUndefined();
  });

  it('flattens a nested function conf value into searchText', async () => {
    const web = byKey(await buildRecords(), 'prod/-/pipeline/web_logs');
    expect(web?.searchText).toContain("conf.functions[0].conf.add[0].value: 'ZEBRA_TOKEN_42'");
  });

  it('uses the route name for display and carries route flags', async () => {
    const route = byKey(await buildRecords(), 'prod/-/route/r_web');
    expect(route).toMatchObject({ type: 'route', name: 'web to splunk' });
    expect(route?.disabled).toBeUndefined();
  });

  it('tags pack-scoped objects with their pack and a scoped key', async () => {
    const detect = byKey(await buildRecords(), 'prod/security_pack/pipeline/pack_detect');
    expect(detect).toBeDefined();
    expect(detect?.pack).toBe('security_pack');
  });

  it('captures the disabled flag on sources', async () => {
    const dead = byKey(await buildRecords(), 'prod/-/source/dead_input');
    expect(dead?.disabled).toBe(true);
  });
});
