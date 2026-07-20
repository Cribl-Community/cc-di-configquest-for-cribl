import { describe, it, expect } from 'vitest';
import { crossGroupObjects, crossGroupDiff, crossGroupMatrix, groupInstances } from './crossGroup';
import type { KORecord, KOType } from './types';

function rec(group: string, name: string, settings: Record<string, string>, opts: { type?: KOType; pack?: string } = {}): KORecord {
  const type = opts.type ?? 'pipeline';
  return {
    key: `${group}/${opts.pack ?? '-'}/${type}/${name}`,
    type,
    group,
    pack: opts.pack,
    id: name,
    name,
    raw: {},
    searchText: Object.entries(settings).map(([k, v]) => `${k}: ${v}`),
  };
}

describe('crossGroupObjects', () => {
  it('lists only objects that span two or more worker groups, deduped by identity', () => {
    const records = [
      rec('a', 'web', { x: '1' }),
      rec('b', 'web', { x: '2' }),
      rec('c', 'web', { x: '1' }),
      rec('a', 'solo', { x: '1' }), // only one group — not comparable
      { ...rec('a', 'sec_pack', {}), type: 'pack' as KOType }, // packs excluded
    ];
    const objects = crossGroupObjects(records);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ name: 'web', type: 'pipeline', groups: 3 });
  });

  it('does not conflate same-named objects of different type or pack', () => {
    const records = [
      rec('a', 'x', { s: '1' }),
      rec('b', 'x', { s: '1' }, { type: 'route' }),
      rec('a', 'x', { s: '1' }, { pack: 'p' }),
      rec('b', 'x', { s: '1' }, { pack: 'p' }),
    ];
    // pipeline x (1 group), route x (1 group), pack-p x (2 groups) → only the pack pair.
    const objects = crossGroupObjects(records);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ name: 'x', pack: 'p', groups: 2 });
  });
});

describe('crossGroupDiff', () => {
  const instances = [
    rec('a', 'web', { value: '41', filter: 'x' }),
    rec('b', 'web', { value: '42', filter: 'x' }),
    rec('c', 'web', { value: '41', filter: 'x' }),
  ];

  it('reports every setting, flagging which differ, with distinct values majority first', () => {
    const res = crossGroupDiff(instances, ['a', 'b', 'c']);
    expect(res.present).toEqual(['a', 'b', 'c']);
    expect(res.absent).toEqual([]);
    // `filter` is identical everywhere but is still reported — the full config stays visible,
    // flagged so the view can highlight only what drifts.
    expect(res.settings.map((s) => s.path)).toEqual(['filter', 'value']);
    expect(res.settings.find((s) => s.path === 'filter')!.differs).toBe(false);
    const value = res.settings.find((s) => s.path === 'value')!;
    expect(value.differs).toBe(true);
    expect(value.values[0]).toEqual({ value: '41', groups: ['a', 'c'], percent: 67 }); // majority first
    expect(value.values[1]).toEqual({ value: '42', groups: ['b'], percent: 33 });
  });

  it('reports absent groups from the universe and treats an absent setting as a value', () => {
    const withExtra = [rec('a', 'web', { only: 'yes' }), rec('b', 'web', {})];
    const res = crossGroupDiff(withExtra, ['a', 'b', 'd']);
    expect(res.absent).toEqual(['d']); // universe has d, but the object isn't there
    const only = res.settings.find((s) => s.path === 'only')!;
    expect(only.values.find((v) => v.value === 'yes')!.groups).toEqual(['a']);
    expect(only.values.find((v) => v.value === null)!.groups).toEqual(['b']); // absent = its own value
  });

  it('normalizes deploy-substituted secrets so a per-group token is not drift', () => {
    const withSecret = [
      rec('a', 'dst', { token: '"#42:AAAA"', host: 'h1' }, { type: 'destination' }),
      rec('b', 'dst', { token: '"#42:BBBB"', host: 'h1' }, { type: 'destination' }),
    ];
    const res = crossGroupDiff(withSecret, ['a', 'b']);
    // token differs byte-wise but both are deploy secrets → not drift; host matches. Both are
    // still reported, just with nothing flagged as differing.
    expect(res.settings.map((s) => s.path).sort()).toEqual(['host', 'token']);
    expect(res.settings.every((s) => !s.differs)).toBe(true);
  });
});

describe('crossGroupDiff at scale', () => {
  it('handles many groups: clusters values majority-first, normalizes per-group secrets, reports absent', () => {
    const universe = Array.from({ length: 30 }, (_, i) => `g${String(i).padStart(2, '0')}`);
    const present = universe.slice(0, 25); // object exists in 25 of 30 groups
    const instances = present.map((g, i) => {
      const value = i < 20 ? 'A' : i < 23 ? 'B' : 'C'; // 20×A, 3×B, 2×C
      return rec(g, 'shared', { value, token: `"#42:${g}Secret"`, common: 'same' });
    });
    const res = crossGroupDiff(instances, universe);
    expect(res.present).toHaveLength(25);
    expect(res.absent).toEqual(['g25', 'g26', 'g27', 'g28', 'g29']);
    // token differs per group but is a deploy secret; common is identical → only `value` drifts,
    // though all three settings are reported.
    expect(res.settings.map((s) => s.path)).toEqual(['common', 'token', 'value']);
    expect(res.settings.filter((s) => s.differs).map((s) => s.path)).toEqual(['value']);
    const value = res.settings.find((s) => s.path === 'value')!;
    expect(value.values.map((v) => [v.value, v.groups.length])).toEqual([
      ['A', 20],
      ['B', 3],
      ['C', 2],
    ]);
    expect(value.values[0].percent).toBe(80); // 20 of 25
  });
});

describe('crossGroupMatrix', () => {
  it('projects the diff as a settings × groups grid, flagging cells that match the majority', () => {
    const instances = [
      rec('a', 'web', { value: '41' }),
      rec('b', 'web', { value: '41' }),
      rec('c', 'web', { value: '41' }),
      rec('d', 'web', { value: '42' }),
      rec('e', 'web', {}), // has the object but not the `value` setting → absent cell
    ];
    const matrix = crossGroupMatrix(crossGroupDiff(instances, ['a', 'b', 'c', 'd', 'e']));

    expect(matrix.groups).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0].path).toBe('value');
    expect(matrix.rows[0].majorityValue).toBe('41'); // 3 of 5 groups
    expect(matrix.rows[0].cells.get('a')).toEqual({ value: '41', majority: true });
    expect(matrix.rows[0].cells.get('d')).toEqual({ value: '42', majority: false });
    expect(matrix.rows[0].cells.get('e')).toEqual({ value: null, majority: false }); // absent
    // One delta each for the two divergent groups; the baseline three are 0.
    expect(matrix.deltaByGroup.get('a')).toBe(0);
    expect(matrix.deltaByGroup.get('d')).toBe(1);
    expect(matrix.deltaByGroup.get('e')).toBe(1);
  });

  it('still shows the settings when the object is identical across groups, with zero deltas', () => {
    const instances = [rec('a', 'web', { v: '1' }), rec('b', 'web', { v: '1' })];
    const matrix = crossGroupMatrix(crossGroupDiff(instances, ['a', 'b']));
    // The grid isn't hidden just because nothing drifts — every value is still shown.
    expect(matrix.rows.map((r) => r.path)).toEqual(['v']);
    expect(matrix.rows[0].cells.get('a')).toEqual({ value: '1', majority: true });
    expect(matrix.rows[0].cells.get('b')).toEqual({ value: '1', majority: true });
    expect(matrix.groups).toEqual(['a', 'b']);
    expect([...matrix.deltaByGroup.values()]).toEqual([0, 0]);
  });
});

describe('groupInstances', () => {
  it('gathers every group instance of the same logical object', () => {
    const records = [rec('a', 'web', { x: '1' }), rec('b', 'web', { x: '2' }), rec('a', 'other', { x: '1' })];
    expect(groupInstances(records[0], records).map((r) => r.group)).toEqual(['a', 'b']);
  });
});
