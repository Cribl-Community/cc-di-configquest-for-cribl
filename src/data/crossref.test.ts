import { describe, it, expect } from 'vitest';
import { fetchOrg } from './fetchOrg';
import { normalizeOrg } from './normalize';
import { crossref } from './crossref';
import { makeFixtureTransport } from './__fixtures__';
import type { FindingsReport, KORecord, KOType } from './types';

function rec(type: KOType, id: string, raw: object): KORecord {
  return { key: `g/-/${type}/${id}`, type, group: 'g', id, name: id, raw, searchText: [] };
}

async function buildFindings(): Promise<FindingsReport> {
  const raw = await fetchOrg({ transport: makeFixtureTransport() });
  return crossref(normalizeOrg(raw));
}

describe('crossref — data-hole suppression', () => {
  it('does not fabricate route/lookup findings for a scope whose data failed to load', async () => {
    // A route that references a pipeline, and a lookup nothing references — normally both flag.
    const records = [
      rec('route', 'r1', { pipeline: 'gone_pipe', output: 'default' }),
      rec('lookup', 'orphan.csv', {}),
    ];
    // Baseline: both are flagged.
    const base = crossref(records);
    expect(base.danglingRoutes.map((f) => f.recordKey)).toEqual(['g/-/route/r1']);
    expect(base.unusedLookups.map((f) => f.recordKey)).toEqual(['g/-/lookup/orphan.csv']);
    // With the scope marked unreliable (its pipelines/lookups couldn't be fetched), neither is
    // asserted — the "missing pipeline" may simply be a pipeline that failed to load.
    const suppressed = crossref(records, undefined, { unreliableScopes: new Set(['g/-']) });
    expect(suppressed.danglingRoutes).toEqual([]);
    expect(suppressed.unusedLookups).toEqual([]);
  });
});

describe('crossref — cross-scope lookup usage', () => {
  it('does not flag a group lookup that is referenced by a pack pipeline', async () => {
    const lookupUse = { conf: { functions: [{ id: 'lookup', conf: { file: 'geo.csv' } }] } };
    const records = [
      rec('lookup', 'geo.csv', {}), // group-scope lookup
      { ...rec('pipeline', 'enrich', lookupUse), key: 'g/pack1/pipeline/enrich', pack: 'pack1', searchText: ['conf.functions[0].conf.file: geo.csv'] },
    ];
    // The pack pipeline references the group lookup; it must not read as unused across scopes.
    expect(crossref(records).unusedLookups).toEqual([]);
  });
});

describe('crossref', () => {
  it('flags exactly the one orphaned pipeline', async () => {
    const { orphanedPipelines } = await buildFindings();
    expect(orphanedPipelines.map((f) => f.recordKey)).toEqual(['staging/-/pipeline/orphan_pipe']);
  });

  it('does not flag pipelines referenced via Chain, Source, or Destination', async () => {
    const keys = (await buildFindings()).orphanedPipelines.map((f) => f.recordKey);
    // shared_enrich (Chain), preproc_pipe (Source pre-proc), postproc_pipe (Destination post-proc)
    expect(keys).not.toContain('prod/-/pipeline/shared_enrich');
    expect(keys).not.toContain('prod/-/pipeline/preproc_pipe');
    expect(keys).not.toContain('prod/-/pipeline/postproc_pipe');
  });

  it('does not flag the built-in default pipeline', async () => {
    const keys = (await buildFindings()).orphanedPipelines.map((f) => f.recordKey);
    expect(keys).not.toContain('prod/-/pipeline/main');
    expect(keys).not.toContain('staging/-/pipeline/main');
  });

  it('respects pack scope — a pack pipeline used by a pack route is not orphaned', async () => {
    const keys = (await buildFindings()).orphanedPipelines.map((f) => f.recordKey);
    expect(keys).not.toContain('prod/security_pack/pipeline/pack_detect');
  });

  it('flags exactly the planted dangling routes, one per missing reference', async () => {
    const { danglingRoutes } = await buildFindings();
    expect(danglingRoutes.map((f) => f.recordKey).sort()).toEqual([
      'lab/-/route/r_ghost_pipe',
      'prod/-/route/r_dangling',
    ]);
    const missingOutput = danglingRoutes.find((f) => f.recordKey === 'prod/-/route/r_dangling');
    expect(missingOutput?.detail).toContain('nonexistent_dest');
    const missingPipeline = danglingRoutes.find((f) => f.recordKey === 'lab/-/route/r_ghost_pipe');
    expect(missingPipeline?.detail).toContain('ghost_pipe');
  });

  it('does not flag routes with a dynamic output expression or a built-in destination', async () => {
    const keys = (await buildFindings()).danglingRoutes.map((f) => f.recordKey);
    expect(keys).not.toContain('prod/-/route/r_expr'); // enableOutputExpression
    expect(keys).not.toContain('prod/-/route/r_noisy'); // output: devnull (built-in)
  });

  it('flags exactly the one unused lookup', async () => {
    const { unusedLookups } = await buildFindings();
    expect(unusedLookups.map((f) => f.recordKey)).toEqual(['prod/-/lookup/unused_ref.csv']);
  });

  it('does not flag lookups referenced via a Lookup function or a C.Lookup() expression', async () => {
    const keys = (await buildFindings()).unusedLookups.map((f) => f.recordKey);
    expect(keys).not.toContain('prod/-/lookup/geo_city.csv'); // Lookup function conf.file
    expect(keys).not.toContain('prod/-/lookup/threat_intel.csv'); // C.Lookup() expression
  });

  it('reports the disabled route and source, and the pipeline with a disabled function', async () => {
    const { disabled } = await buildFindings();
    const keys = disabled.map((f) => f.recordKey).sort();
    expect(keys).toEqual(['apac/-/route/r_legacy_drop', 'prod/-/pipeline/noisy_pipe', 'prod/-/source/dead_input']);
    const noisy = disabled.find((f) => f.recordKey === 'prod/-/pipeline/noisy_pipe');
    expect(noisy?.detail).toBe('1 disabled function');
  });

  it('flags a route whose pipeline does not exist (missing-pipeline branch)', () => {
    const records = [
      rec('route', 'r_ghost', { id: 'r_ghost', name: 'ghost', pipeline: 'ghost_pipe', output: 'real_out', final: true }),
      rec('destination', 'real_out', { id: 'real_out', type: 's3' }),
    ];
    const { danglingRoutes } = crossref(records);
    expect(danglingRoutes.map((f) => f.recordKey)).toEqual(['g/-/route/r_ghost']);
    expect(danglingRoutes[0].detail).toBe('References missing pipeline: ghost_pipe');
  });

  it('never flags the built-in pipelines main/devnull/passthru as orphaned', () => {
    const records = [
      rec('pipeline', 'main', { id: 'main', conf: { functions: [] } }),
      rec('pipeline', 'devnull', { id: 'devnull', conf: { functions: [] } }),
      rec('pipeline', 'passthru', { id: 'passthru', conf: { functions: [] } }),
    ];
    expect(crossref(records).orphanedPipelines).toEqual([]);
  });
});
