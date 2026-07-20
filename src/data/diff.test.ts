import { describe, it, expect } from 'vitest';
import { changedKeysInSharedFile, diffSettings, diffStats, gitToDiffRows, narrowGitFileToObject, splitSharedFileObjects } from './diff';
import type { KORecord } from './types';

const rec = (id: string, searchText: string[]): KORecord => ({
  key: `g/-/pipeline/${id}`,
  type: 'pipeline',
  group: 'g',
  id,
  name: id,
  raw: {},
  searchText,
});

const source = (id: string): KORecord => ({
  key: `g/-/source/${id}`,
  type: 'source',
  group: 'g',
  id,
  name: id,
  raw: {},
  searchText: [],
});

describe('diffSettings', () => {
  it('classifies changed / only-A / only-B / same settings', () => {
    const a = rec('a', ['conf.x: 1', 'conf.y: keep', 'conf.onlyA: yes']);
    const b = rec('b', ['conf.x: 2', 'conf.y: keep', 'conf.onlyB: yes']);
    const rows = diffSettings(a, b);

    expect(diffStats(rows)).toEqual({ changed: 1, onlyA: 1, onlyB: 1 });
    expect(rows.find((r) => r.kind === 'change')).toMatchObject({ left: 'conf.x: 1', right: 'conf.x: 2' });
    expect(rows.some((r) => r.kind === 'context' && r.left === 'conf.y: keep')).toBe(true);
    expect(rows.find((r) => r.kind === 'del')).toMatchObject({ left: 'conf.onlyA: yes' });
    expect(rows.find((r) => r.kind === 'add')).toMatchObject({ right: 'conf.onlyB: yes' });
  });

  it('masks secret values so Compare never shows a credential (and per-group tokens read as same)', () => {
    // Two deploy copies of a destination differing only on a deploy-substituted token: the
    // token must render masked on both sides and count as unchanged, not a false "1 changed".
    const a = rec('a', ['conf.authToken: #42:aQ8xR2vLp0dNc6Ty', 'conf.host: h1']);
    const b = rec('b', ['conf.authToken: #43:Kd3mZ9pQr1sWv7Bn', 'conf.host: h1']);
    const rows = diffSettings(a, b);

    expect(diffStats(rows)).toEqual({ changed: 0, onlyA: 0, onlyB: 0 });
    const token = rows.find((r) => r.left?.startsWith('conf.authToken'));
    expect(token).toMatchObject({ kind: 'context', left: 'conf.authToken: ‹secret›', right: 'conf.authToken: ‹secret›' });
    // A genuinely different secret-named field is still masked (no plaintext leaks) — the mask
    // collapses both sides to the same token, so it reads as unchanged rather than leaking.
    const c = rec('c', ['conf.password: hunter2']);
    const d = rec('d', ['conf.password: swordfish']);
    expect(diffSettings(c, d).find((r) => r.left?.startsWith('conf.password'))).toMatchObject({
      left: 'conf.password: ‹secret›',
      right: 'conf.password: ‹secret›',
    });
  });
});

describe('gitToDiffRows', () => {
  it('maps hunk headers and insert/delete/context lines, stripping the marker', () => {
    const diffJson = [
      {
        blocks: [
          {
            header: '@@ -1 +1 @@',
            lines: [
              { content: ' ctx', type: 'context', oldNumber: 1, newNumber: 1 },
              { content: '-old', type: 'delete', oldNumber: 2 },
              { content: '+new', type: 'insert', newNumber: 2 },
            ],
          },
        ],
      },
    ];
    const rows = gitToDiffRows(diffJson);
    expect(rows[0]).toMatchObject({ kind: 'hunk', label: '@@ -1 +1 @@' });
    expect(rows[1]).toMatchObject({ kind: 'context', left: 'ctx' });
    expect(rows[2]).toMatchObject({ kind: 'del', left: 'old', leftNo: 2 });
    expect(rows[3]).toMatchObject({ kind: 'add', right: 'new', rightNo: 2 });
  });
});

describe('narrowGitFileToObject', () => {
  // A whole-file write of a shared inputs.yml: one hunk holding two sources.
  const sharedInputs = {
    newName: 'groups/g/local/cribl/inputs.yml',
    blocks: [
      {
        header: '@@ -0,0 +1,7 @@',
        lines: [
          { content: '+inputs:', type: 'insert', newNumber: 1 },
          { content: '+  splunk_in:', type: 'insert', newNumber: 2 },
          { content: '+    type: splunk', type: 'insert', newNumber: 3 },
          { content: '+    port: 9997', type: 'insert', newNumber: 4 },
          { content: '+  dead_input:', type: 'insert', newNumber: 5 },
          { content: '+    type: tcp', type: 'insert', newNumber: 6 },
          { content: '+    port: 6000', type: 'insert', newNumber: 7 },
        ],
      },
    ],
  };

  it("keeps only the target object's lines within a shared file's hunk", () => {
    const narrowed = narrowGitFileToObject(sharedInputs, source('splunk_in'));
    expect(narrowed).not.toBeNull();
    const text = gitToDiffRows([narrowed])
      .map((r) => r.right ?? r.left ?? '')
      .join('\n');
    expect(text).toContain('inputs:'); // root context kept
    expect(text).toContain('splunk_in:');
    expect(text).toContain('port: 9997');
    expect(text).not.toContain('dead_input');
    expect(text).not.toContain('6000');
  });

  it('returns null when the object is not part of the file change', () => {
    expect(narrowGitFileToObject(sharedInputs, source('absent_input'))).toBeNull();
  });

  it('keeps a property-only edit whose hunk lacks the object id/name boundary', () => {
    const route = (id: string): KORecord => ({
      key: `g/-/route/${id}`,
      type: 'route',
      group: 'g',
      id,
      name: id,
      raw: {},
      searchText: [],
    });
    // A description change deep inside a route item — the `- id:` line is above the
    // hunk's context window, so nothing here identifies the route.
    const routeFile = {
      newName: 'groups/g/local/cribl/pipelines/route.yml',
      blocks: [
        {
          header: '@@ -8,5 +8,5 @@',
          lines: [
            { content: '     final: true', type: 'context' },
            { content: '     disabled: false', type: 'context' },
            { content: "-    description: ''", type: 'delete' },
            { content: '+    description: putter', type: 'insert' },
            { content: '     clones: []', type: 'context' },
          ],
        },
      ],
    };
    const narrowed = narrowGitFileToObject(routeFile, route('zscalernss_web_lake'));
    expect(narrowed).not.toBeNull();
    const text = gitToDiffRows([narrowed])
      .map((r) => r.right ?? r.left ?? '')
      .join('\n');
    expect(text).toContain('description: putter');
  });

  it('attributes an orphan property edit to the sibling whose config values match', () => {
    const route = (id: string, pipeline: string): KORecord => ({
      key: `g/-/route/${id}`,
      type: 'route',
      group: 'g',
      id,
      name: id,
      raw: {},
      searchText: [`pipeline: ${pipeline}`, `filter: sourcetype=='${id}'`],
    });
    const owner = route('web', 'web_parse');
    const other = route('api', 'api_parse');
    // A description edit deep in the `web` route: no `- id:` boundary in the hunk, but the
    // context carries `pipeline: web_parse` / `filter: …=='web'`, distinctive to `web`.
    const routeFile = {
      newName: 'groups/g/local/cribl/pipelines/route.yml',
      blocks: [
        {
          header: '@@ -8,4 +8,4 @@',
          lines: [
            { content: '     pipeline: web_parse', type: 'context' },
            { content: "     filter: sourcetype=='web'", type: 'context' },
            { content: "-    description: ''", type: 'delete' },
            { content: '+    description: putter', type: 'insert' },
          ],
        },
      ],
    };
    // With siblings, the edit lands only on `web` — `api` is not tainted by sharing the file.
    expect(narrowGitFileToObject(routeFile, owner, [owner, other])).not.toBeNull();
    expect(narrowGitFileToObject(routeFile, other, [owner, other])).toBeNull();
  });

  it('does not attribute a sibling whose field value equals this object id/name', () => {
    const route = (id: string, name: string): KORecord => ({ key: `g/-/route/${id}`, type: 'route', group: 'g', id, name, raw: {}, searchText: [] });
    const added = route('mI74gT', 'test_route');
    const def = route('default', 'default');
    // Adding `test_route` (whose `output: default` carries the value "default") must not
    // read as a change to the route literally named `default`, which is only context here.
    const routeFile = {
      newName: 'groups/g/local/cribl/pipelines/route.yml',
      blocks: [
        {
          header: '@@ -12,6 +12,9 @@',
          lines: [
            { content: '     output: zscaler_lake', type: 'context' },
            { content: '+  - id: mI74gT', type: 'insert' },
            { content: '+    name: test_route', type: 'insert' },
            { content: '+    output: default', type: 'insert' },
            { content: '   - id: default', type: 'context' },
            { content: '     name: default', type: 'context' },
          ],
        },
      ],
    };
    const sibs = [added, def];
    const changeCount = (rec: KORecord) => {
      const n = narrowGitFileToObject(routeFile, rec, sibs);
      return n ? gitToDiffRows([n]).filter((r) => r.kind === 'add' || r.kind === 'del').length : 0;
    };
    expect(changeCount(added)).toBeGreaterThan(0); // the added route is attributed
    expect(changeCount(def)).toBe(0); // the `default` route is not
  });
});

// The single-pass `changedKeysInSharedFile` must return EXACTLY the set of records the old
// per-candidate path (narrowGitFileToObject → "has a +/- line") would attribute. This runs both
// over the same fixtures and asserts identical key sets — the primary guard for the O(n²)→O(n)
// rewrite, including the two subtle cases (a change-free segment under a changed root line; a
// no-segment record with a root change + ambiguous orphan).
describe('changedKeysInSharedFile matches the per-candidate oracle', () => {
  const sds = (id: string): KORecord => ({ key: `g/-/sds-rule/${id}`, type: 'sds-rule', group: 'g', id, name: id, raw: {}, searchText: [] });
  const route = (id: string, searchText: string[] = []): KORecord => ({ key: `g/-/route/${id}`, type: 'route', group: 'g', id, name: id, raw: {}, searchText });
  const src = (id: string): KORecord => ({ key: `g/-/source/${id}`, type: 'source', group: 'g', id, name: id, raw: {}, searchText: [] });

  // The old path: attribute a record iff its narrowed slice has any add/delete row.
  const oracle = (entry: unknown, records: KORecord[]): string[] => {
    const out: string[] = [];
    for (const r of records) {
      const n = narrowGitFileToObject(entry, r, records);
      if (n && gitToDiffRows([n]).some((row) => row.kind === 'add' || row.kind === 'del')) out.push(r.key);
    }
    return out.sort();
  };
  const line = (content: string, type: string) => ({ content, type });

  const cases: { name: string; entry: unknown; records: KORecord[] }[] = [
    {
      name: 'root-keyed library table — one of three rules edited',
      entry: { newName: 'g/sds-rules.yml', blocks: [{ lines: [
        line(' rule_a:', 'context'), line('   regex: /x/', 'context'),
        line(' rule_b:', 'context'), line('-  regex: /y/', 'delete'), line('+  regex: /z/', 'insert'),
        line(' rule_c:', 'context'), line('   regex: /w/', 'context'),
      ] }] },
      records: [sds('rule_a'), sds('rule_b'), sds('rule_c')],
    },
    {
      name: 'wholesale add of a shared inputs.yml — every object inserted',
      entry: { newName: 'g/inputs.yml', blocks: [{ lines: [
        line('+inputs:', 'insert'),
        line('+  splunk_in:', 'insert'), line('+    port: 9997', 'insert'),
        line('+  dead_input:', 'insert'), line('+    port: 6000', 'insert'),
      ] }] },
      records: [src('splunk_in'), src('dead_input')],
    },
    {
      name: 'orphan edit disambiguated to the matching sibling',
      entry: { newName: 'g/route.yml', blocks: [{ lines: [
        line('     pipeline: web_parse', 'context'), line("     filter: sourcetype=='web'", 'context'),
        line("-    description: ''", 'delete'), line('+    description: putter', 'insert'),
      ] }] },
      records: [route('web', ['pipeline: web_parse', "filter: sourcetype=='web'"]), route('api', ['pipeline: api_parse'])],
    },
    {
      name: 'change-free segment under a CHANGED root line (rootChange term)',
      entry: { newName: 'g/route.yml', blocks: [{ lines: [
        line('+routes:', 'insert'), // structural root inserted…
        line('   - id: ra', 'context'), line('     pipeline: pa', 'context'), // …but this object is unchanged context
      ] }] },
      records: [route('ra')],
    },
    {
      name: 'no-segment records + root change + AMBIGUOUS orphan (kept for all)',
      entry: { newName: 'g/route.yml', blocks: [{ lines: [
        line('+routes:', 'insert'),
        line('     final: true', 'context'),
        line("-    description: ''", 'delete'), line('+    description: putter', 'insert'),
      ] }] },
      records: [route('web'), route('api')], // neither has a distinctive value → orphan is ambiguous
    },
    {
      name: 'field value equals a sibling id — the sibling is not tainted',
      entry: { newName: 'g/route.yml', blocks: [{ lines: [
        line('     output: zscaler_lake', 'context'),
        line('+  - id: mI74gT', 'insert'), line('+    name: test_route', 'insert'), line('+    output: default', 'insert'),
        line('   - id: default', 'context'), line('     name: default', 'context'),
      ] }] },
      records: [route('mI74gT'), route('default')],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect([...changedKeysInSharedFile(c.entry, c.records)].sort()).toEqual(oracle(c.entry, c.records));
    });
  }

  // Asserted explicitly (not just against the oracle): a shared `mapKeyOf` bug would break both
  // paths identically and slip past an equivalence check. Library tables key objects by display
  // names that can contain a colon, e.g. `'Palo Alto: Traffic':`.
  it('attributes a change under a quoted key containing a colon', () => {
    const entry = { newName: 'g/sds-rules.yml', blocks: [{ lines: [
      line("'Palo Alto: Traffic':", 'context'), line('-  regex: /a/', 'delete'), line('+  regex: /b/', 'insert'),
      line("'Other Rule':", 'context'), line('   regex: /c/', 'context'),
    ] }] };
    expect([...changedKeysInSharedFile(entry, [sds('Palo Alto: Traffic'), sds('Other Rule')])]).toEqual([sds('Palo Alto: Traffic').key]);
  });

  // splitSharedFileObjects (wholesale-add dedup) now shares segmentSharedBlock, so it segments a
  // ROOT-keyed library table (objects at column 0) given the records — the old hard-coded indent 2
  // returned zero segments there, silently disabling the pack dedup for library objects.
  it('segments a root-keyed library table given the records (was empty before)', () => {
    const entry = { blocks: [{ lines: [
      line('+rule_a:', 'insert'), line('+  regex: /x/', 'insert'),
      line('+rule_b:', 'insert'), line('+  regex: /y/', 'insert'),
    ] }] };
    const segs = splitSharedFileObjects(entry, [sds('rule_a'), sds('rule_b')]);
    expect(segs.flatMap((s) => s.ids).sort()).toEqual(['rule_a', 'rule_b']);
    expect(segs.find((s) => s.ids.includes('rule_a'))?.text).toContain('regex: /x/');
  });

  it('still segments nested indent-2 list items (route.yml) without records', () => {
    const entry = { blocks: [{ lines: [
      line('+routes:', 'insert'), line('+  - id: r_a', 'insert'), line('+    pipeline: p', 'insert'),
    ] }] };
    expect(splitSharedFileObjects(entry).some((s) => s.ids.includes('r_a'))).toBe(true);
  });
});
