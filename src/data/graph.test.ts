import { describe, it, expect } from 'vitest';
import { fetchOrg } from './fetchOrg';
import { normalizeOrg } from './normalize';
import { buildGraph, downstream, upstream } from './graph';
import { makeFixtureTransport } from './__fixtures__';
import type { EdgeKind, Graph } from './types';

async function fixtureGraph(): Promise<Graph> {
  return buildGraph(normalizeOrg(await fetchOrg({ transport: makeFixtureTransport() })));
}

const has = (g: Graph, from: string, to: string, kind: EdgeKind) =>
  g.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

describe('buildGraph', () => {
  it('resolves a route that sends traffic into a Pack (pipeline: pack:<id>), not a dangling ref', () => {
    // The standard way a Worker Group routes into an installed Pack. Must not be reported as
    // "references missing pipeline pack:<id>" — it should link to the pack record instead.
    const records = [
      { key: 'g/-/route/to_pack', type: 'route' as const, group: 'g', id: 'to_pack', name: 'to_pack', raw: { pipeline: 'pack:sec', output: 'default' }, searchText: [] },
      { key: 'g/-/pack/sec', type: 'pack' as const, group: 'g', id: 'sec', name: 'sec', raw: {}, searchText: [] },
    ];
    const g = buildGraph(records);
    expect(has(g, 'g/-/route/to_pack', 'g/-/pack/sec', 'route-pack')).toBe(true);
    expect(g.danglingRefs).toEqual([]);
    // And the pack sees the route as a dependant (its "used by" list).
    expect((g.in.get('g/-/pack/sec') ?? []).map((e) => e.from)).toEqual(['g/-/route/to_pack']);
  });

  it('flags a route that points at a genuinely missing pack', () => {
    const records = [
      { key: 'g/-/route/to_pack', type: 'route' as const, group: 'g', id: 'to_pack', name: 'to_pack', raw: { pipeline: 'pack:gone' }, searchText: [] },
    ];
    const g = buildGraph(records);
    expect(g.danglingRefs).toEqual([{ from: 'g/-/route/to_pack', kind: 'route-pipeline', missing: 'pack:gone', targetType: 'pipeline' }]);
  });

  it('links routes to their pipeline and destination', async () => {
    const g = await fixtureGraph();
    expect(has(g, 'prod/-/route/r_web', 'prod/-/pipeline/web_logs', 'route-pipeline')).toBe(true);
    expect(has(g, 'prod/-/route/r_web', 'prod/-/destination/splunk_out', 'route-output')).toBe(true);
  });

  it('links pipeline chain and lookup functions', async () => {
    const g = await fixtureGraph();
    expect(has(g, 'prod/-/pipeline/web_logs', 'prod/-/pipeline/shared_enrich', 'chain')).toBe(true);
    expect(has(g, 'prod/-/pipeline/web_logs', 'prod/-/lookup/geo_city.csv', 'lookup')).toBe(true);
  });

  it('links source pre-proc and destination post-proc pipelines', async () => {
    const g = await fixtureGraph();
    expect(has(g, 'prod/-/source/pp_input', 'prod/-/pipeline/preproc_pipe', 'source-pipeline')).toBe(true);
    expect(has(g, 'prod/-/destination/splunk_out', 'prod/-/pipeline/postproc_pipe', 'dest-pipeline')).toBe(true);
  });

  it('feeds routes from sources with sendToRoutes (and not from opted-out sources)', async () => {
    const g = await fixtureGraph();
    expect(has(g, 'prod/-/source/splunk_in', 'prod/-/route/r_web', 'source-route')).toBe(true);
    expect(g.edges.some((e) => e.from === 'prod/-/source/pp_input' && e.kind === 'source-route')).toBe(false);
  });

  it('records a dangling reference for a missing output, but not for an output expression', async () => {
    const g = await fixtureGraph();
    expect(
      g.danglingRefs.some(
        (d) => d.from === 'prod/-/route/r_dangling' && d.kind === 'route-output' && d.missing === 'nonexistent_dest',
      ),
    ).toBe(true);
    expect(g.danglingRefs.some((d) => d.from === 'prod/-/route/r_expr')).toBe(false);
  });

  it('walks upstream and downstream for lineage', async () => {
    const g = await fixtureGraph();
    expect(downstream(g, 'prod/-/pipeline/web_logs').some((e) => e.to === 'prod/-/pipeline/shared_enrich')).toBe(true);
    expect(upstream(g, 'prod/-/pipeline/web_logs').some((e) => e.from === 'prod/-/route/r_web')).toBe(true);
  });
});
