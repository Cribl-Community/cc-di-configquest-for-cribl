import { describe, it, expect } from 'vitest';
import { blastRadius, coverage } from './coverage';
import { buildGraph } from './graph';
import type { KORecord, KOType } from './types';

function rec(type: KOType, id: string, raw: object, disabled?: boolean): KORecord {
  return { key: `g/-/${type}/${id}`, type, group: 'g', id, name: id, raw, searchText: [], disabled };
}

describe('coverage', () => {
  it('flags an enabled source that opted out of routing with no other outlet', () => {
    const records = [
      rec('source', 'lonely', { id: 'lonely', type: 'tcp', sendToRoutes: false }),
      rec('source', 'routed', { id: 'routed', type: 'tcp', sendToRoutes: true }),
      rec('source', 'qc', { id: 'qc', type: 'tcp', sendToRoutes: false, connections: [{ output: 'd' }] }),
    ];
    expect(coverage(records, buildGraph(records)).deadEndSources.map((f) => f.recordKey)).toEqual([
      'g/-/source/lonely',
    ]);
  });

  it('does not flag a source whose sendToRoutes is unset (defaults to routing)', () => {
    const records = [rec('source', 'def', { id: 'def', type: 'tcp' })];
    expect(coverage(records, buildGraph(records)).deadEndSources).toEqual([]);
  });

  it('flags an enabled destination nothing feeds, exempting built-in sinks', () => {
    const records = [
      rec('route', 'r1', { id: 'r1', name: 'r1', pipeline: 'p', output: 'used', final: true }),
      rec('destination', 'used', { id: 'used', type: 's3' }),
      rec('destination', 'orphan_sink', { id: 'orphan_sink', type: 's3' }),
      rec('destination', 'devnull', { id: 'devnull', type: 'devnull' }),
      rec('pipeline', 'p', { id: 'p', conf: { functions: [] } }),
    ];
    expect(coverage(records, buildGraph(records)).deadEndDestinations.map((f) => f.recordKey)).toEqual([
      'g/-/destination/orphan_sink',
    ]);
  });

  it('flags routes shadowed by an earlier final catch-all', () => {
    const records = [
      rec('route', 'r_catch', { id: 'r_catch', name: 'catch all', pipeline: 'p', output: 'd', final: true, filter: 'true' }),
      rec('route', 'r_after', { id: 'r_after', name: 'after', pipeline: 'p', output: 'd', final: false, filter: "x=='y'" }),
      rec('pipeline', 'p', { id: 'p', conf: { functions: [] } }),
      rec('destination', 'd', { id: 'd', type: 's3' }),
    ];
    expect(coverage(records, buildGraph(records)).unreachableRoutes.map((f) => f.recordKey)).toEqual([
      'g/-/route/r_after',
    ]);
  });

  it('blastRadius counts fan-in on a shared pipeline', () => {
    const records = [
      rec('route', 'r1', { id: 'r1', name: 'r1', pipeline: 'shared', output: 'd', final: false }),
      rec('route', 'r2', { id: 'r2', name: 'r2', pipeline: 'shared', output: 'd', final: true }),
      rec('pipeline', 'shared', { id: 'shared', conf: { functions: [] } }),
      rec('destination', 'd', { id: 'd', type: 's3' }),
    ];
    expect(blastRadius(buildGraph(records), 'g/-/pipeline/shared')).toBe(2);
  });
});
