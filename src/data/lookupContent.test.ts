import { describe, it, expect } from 'vitest';
import { parseLookupContent, hashContent, lookupSize, sizeCollisionRecords, clusterLookups, lookupMetaDiff, type LookupContent } from './lookupContent';
import type { KORecord } from './types';

function lookupRec(group: string, size: number | undefined): KORecord {
  return {
    key: `${group}/-/lookup/geo.csv`,
    type: 'lookup',
    group,
    id: 'geo.csv',
    name: 'geo.csv',
    raw: size === undefined ? {} : { size },
    searchText: [],
  };
}
const content = (fields: string[], rows: string[][]): LookupContent => ({ fields, rows });

describe('parseLookupContent', () => {
  it('drops the internal __id column and stringifies cells', () => {
    const c = parseLookupContent({ fields: ['__id', 'char', 'prob'], items: [[1, '-', 0.013]] });
    expect(c.fields).toEqual(['char', 'prob']);
    expect(c.rows).toEqual([['-', '0.013']]);
  });
});

describe('hashContent', () => {
  it('is stable and distinguishes content, columns, and cell boundaries', () => {
    const base = content(['k', 'v'], [['a', '1'], ['b', '2']]);
    expect(hashContent(base)).toBe(hashContent(content(['k', 'v'], [['a', '1'], ['b', '2']])));
    expect(hashContent(base)).not.toBe(hashContent(content(['k', 'v'], [['a', '1'], ['b', '3']]))); // a cell changed
    expect(hashContent(base)).not.toBe(hashContent(content(['k', 'w'], [['a', '1'], ['b', '2']]))); // a column changed
    // boundary safety: ["ab"] must not hash the same as ["a","b"]
    expect(hashContent(content(['k'], [['ab']]))).not.toBe(hashContent(content(['k'], [['a', 'b']])));
  });
});

describe('lookupSize', () => {
  it('reads size from the record raw, undefined when absent', () => {
    expect(lookupSize(lookupRec('g', 2048))).toBe(2048);
    expect(lookupSize(lookupRec('g', undefined))).toBeUndefined();
  });
});

describe('sizeCollisionRecords', () => {
  it('returns only instances that share a size with another group', () => {
    const recs = [lookupRec('a', 100), lookupRec('b', 100), lookupRec('c', 200)];
    expect(sizeCollisionRecords(recs).map((r) => r.group).sort()).toEqual(['a', 'b']); // c's size is unique
  });
});

describe('clusterLookups', () => {
  it('a same-size bucket stays one provisional (pending) variant until content loads', () => {
    const recs = [lookupRec('a', 100), lookupRec('b', 200), lookupRec('c', 200)];
    const { variants, present } = clusterLookups(recs, new Map());
    expect(present).toEqual(['a', 'b', 'c']);
    const bc = variants.find((v) => v.groups.length === 2)!;
    expect(bc.groups).toEqual(['b', 'c']);
    expect(bc.pending).toBe(true);
  });

  it('splits a same-size bucket by content hash once content is loaded, majority first', () => {
    const recs = [lookupRec('a', 100), lookupRec('b', 100), lookupRec('c', 100)];
    const same = content(['k'], [['x']]);
    const other = content(['k'], [['y']]);
    const byKey = new Map<string, LookupContent>([
      [recs[0].key, same],
      [recs[1].key, same],
      [recs[2].key, other],
    ]);
    const { variants } = clusterLookups(recs, byKey);
    expect(variants.map((v) => v.groups)).toEqual([['a', 'b'], ['c']]);
    expect(variants[0].hash).toBeDefined();
    expect(variants[0].hash).not.toBe(variants[1].hash);
    expect(variants[0].percent).toBe(67);
    expect(variants[0].rows).toBe(1);
  });
});

describe('lookupMetaDiff', () => {
  it('reports counts, column differences, and an identical verdict', () => {
    const a = content(['k', 'v'], [['x', '1']]);
    const b = content(['k', 'w'], [['x', '9'], ['y', '2']]);
    const d = lookupMetaDiff(a, b);
    expect({ aRows: d.aRows, bRows: d.bRows }).toEqual({ aRows: 1, bRows: 2 });
    expect(d.onlyA).toEqual(['v']);
    expect(d.onlyB).toEqual(['w']);
    expect(d.identical).toBe(false);
    expect(lookupMetaDiff(a, content(['k', 'v'], [['x', '1']])).identical).toBe(true);
  });
});
