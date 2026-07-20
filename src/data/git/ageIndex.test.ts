import { describe, it, expect } from 'vitest';
import { applyAgeMap, buildAgeMap, mergeAgeMap, staleFindings } from './ageIndex';
import type { Commit } from './log';
import type { Transport } from '../apiClient';
import type { AgeMap, KORecord } from '../types';

// FILES below holds the record keys each commit changed (already resolved),
// isolating the merge logic from path parsing and diff narrowing.
const commit = (hash: string, author: string, date: string): Commit => ({
  hash,
  authorName: author,
  authorEmail: `${author}@x`,
  date,
  message: hash,
});

const HISTORY: Commit[] = [
  commit('c3', 'alice', '2024-03-03T00:00:00Z'),
  commit('c2', 'bob', '2024-02-02T00:00:00Z'),
  commit('c1', 'carol', '2024-01-01T00:00:00Z'),
];

const FILES = new Map<string, string[]>([
  ['c3', ['prod/-/pipeline/web_logs']],
  ['c2', ['prod/-/route/r_web', 'prod/-/pipeline/web_logs']],
  ['c1', ['prod/-/source/splunk_in']],
]);

describe('mergeAgeMap', () => {
  it('keeps the newest commit per record key on a full build', () => {
    const result = mergeAgeMap(HISTORY, FILES);
    expect(result.processed).toBe(3);
    expect(result.lastCommit).toBe('c3');
    // web_logs touched by c3 (newest) and c2 (older) — the newer author wins.
    expect(result.map['prod/-/pipeline/web_logs']).toEqual({
      lastTouched: '2024-03-03T00:00:00.000Z',
      author: 'alice',
      email: 'alice@x',
    });
    expect(result.map['prod/-/route/r_web'].author).toBe('bob');
    expect(result.map['prod/-/source/splunk_in'].author).toBe('carol');
  });

  it('processes only commits newer than the stored marker on refresh', () => {
    const first = mergeAgeMap(HISTORY, FILES);

    const c4 = commit('c4', 'dave', '2024-04-04T00:00:00Z');
    const commits = [c4, ...HISTORY];
    const files = new Map<string, string[]>([['c4', ['prod/-/pipeline/web_logs']]]);

    const second = mergeAgeMap(commits, files, { map: first.map, lastCommit: 'c3' });
    expect(second.processed).toBe(1);
    expect(second.lastCommit).toBe('c4');
    expect(second.map['prod/-/pipeline/web_logs']).toEqual({
      lastTouched: '2024-04-04T00:00:00.000Z',
      author: 'dave',
      email: 'dave@x',
    });
    // Untouched keys are retained from the previous run.
    expect(second.map['prod/-/source/splunk_in'].author).toBe('carol');
  });

  it('is a no-op when the marker is the newest commit', () => {
    const first = mergeAgeMap(HISTORY, FILES);
    const again = mergeAgeMap(HISTORY, FILES, { map: first.map, lastCommit: 'c3' });
    expect(again.processed).toBe(0);
    expect(again.lastCommit).toBe('c3');
  });

  it('attributes "Cribl System" commits to the user named in the message', () => {
    const commits: Commit[] = [
      {
        hash: 'x1',
        authorName: 'Cribl System',
        authorEmail: 'cribl@host',
        date: '2024-05-05T00:00:00Z',
        message: 'Katherine Johnson: Updated the zscalernss-web input',
      },
    ];
    const files = new Map<string, string[]>([['x1', ['g/-/pipeline/p']]]);
    const res = mergeAgeMap(commits, files);
    expect(res.map['g/-/pipeline/p'].author).toBe('Katherine Johnson');
    expect(res.map['g/-/pipeline/p'].email).toBe('');
  });
});

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

/** Serves /version and /version/files from in-memory commit + file data. Each
 *  touched path is emitted as a flat leaf (the tree flatten joins names, so a leaf
 *  whose name is the full path round-trips to that path). */
function gitTransport(commits: Commit[], files: Record<string, string[]>): Transport {
  return (rawPath) => {
    const [path, query] = rawPath.split('?');
    if (path === '/version') {
      return jsonResponse({
        items: commits.map((c) => ({
          hash: c.hash,
          author_name: c.authorName,
          author_email: c.authorEmail,
          date: c.date,
          message: c.message,
        })),
      });
    }
    if (path === '/version/files') {
      const hash = new URLSearchParams(query).get('commit') ?? '';
      const names = files[hash] ?? [];
      return jsonResponse({ items: [{ count: names.length, items: names.map((name) => ({ name, state: 'M' })) }] });
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

describe('buildAgeMap', () => {
  const pipe = (id: string): KORecord => ({
    key: `g/-/pipeline/${id}`,
    type: 'pipeline',
    group: 'g',
    id,
    name: id,
    raw: {},
    searchText: [],
  });

  it('reports unavailable and preserves the previous map on a /version 403', async () => {
    const deny: Transport = () => Promise.resolve(new Response('forbidden', { status: 403 }));
    const previous = {
      map: { 'g/-/pipeline/p': { lastTouched: '2024-01-01T00:00:00.000Z', author: 'a', email: 'a@x' } },
      lastCommit: 'c1',
    };
    const res = await buildAgeMap({ records: [pipe('p')], previous, transport: deny });
    expect(res.available).toBe(false);
    expect(res.map).toEqual(previous.map);
    expect(res.lastCommit).toBe('c1');
  });

  it('merges onto the previous map when the marker fell out of the window', async () => {
    const commits: Commit[] = [commit('c9', 'dave', '2024-09-09T00:00:00Z')];
    const files = { c9: ['groups/g/local/cribl/pipelines/keep/conf.yml'] };
    const previous = {
      map: { 'g/-/pipeline/old': { lastTouched: '2020-01-01T00:00:00.000Z', author: 'ancient', email: 'x@x' } },
      lastCommit: 'c1_gone', // not present in the fetched window
    };
    const res = await buildAgeMap({
      records: [pipe('keep'), pipe('old')],
      previous,
      transport: gitTransport(commits, files),
      maxCommits: 1,
    });
    expect(res.available).toBe(true);
    expect(res.lastCommit).toBe('c9');
    // previously-known older record is retained, not discarded
    expect(res.map['g/-/pipeline/old'].author).toBe('ancient');
    // new commit is applied
    expect(res.map['g/-/pipeline/keep'].author).toBe('dave');
  });

  it('stops fetching once every record is attributed (early exit)', async () => {
    // 10 commits (et10 newest → et1); the newest touches both objects, so once the
    // first batch of 8 is in, the older two commits are never fetched.
    const many = Array.from({ length: 10 }, (_, i) =>
      commit(`et${10 - i}`, 'a', `2024-02-${String(10 - i).padStart(2, '0')}T00:00:00Z`),
    );
    const files: Record<string, string[]> = {};
    for (const c of many) files[c.hash] = ['groups/g/local/cribl/pipelines/keep/conf.yml'];
    files['et10'] = ['groups/g/local/cribl/pipelines/keep/conf.yml', 'groups/g/local/cribl/pipelines/old/conf.yml'];

    let calls = 0;
    const inner = gitTransport(many, files);
    const counting: Transport = (path, init) => {
      if (path.startsWith('/version/files')) calls += 1;
      return inner(path, init);
    };
    const res = await buildAgeMap({ records: [pipe('keep'), pipe('old')], transport: counting, maxCommits: 100 });
    expect(res.available).toBe(true);
    expect(calls).toBe(8); // only the first batch — the older two commits are never fetched
  });

  it('emits a progressive partial map after the newest commits, before finishing', async () => {
    // 20 commits, each touching a distinct object, so `pending` doesn't empty on the
    // first batch — the partial still fires once (after PROGRESS_AT), then the walk
    // continues to completion.
    const many = Array.from({ length: 20 }, (_, i) =>
      commit(`pg${20 - i}`, 'a', `2024-03-${String(20 - i).padStart(2, '0')}T00:00:00Z`),
    );
    const files: Record<string, string[]> = {};
    many.forEach((c, i) => (files[c.hash] = [`groups/g/local/cribl/pipelines/p${20 - i}/conf.yml`]));
    const recs = Array.from({ length: 20 }, (_, i) => pipe(`p${i + 1}`));

    const partials: AgeMap[] = [];
    const res = await buildAgeMap({
      records: recs,
      transport: gitTransport(many, files),
      maxCommits: 100,
      onProgress: (m) => partials.push(m),
    });
    expect(partials).toHaveLength(1);
    expect(Object.keys(partials[0]).length).toBeGreaterThan(0);
    expect(Object.keys(res.map)).toHaveLength(20);
  });

  it('narrows a shared-file commit to only the object that changed', async () => {
    // Both routes live in one route.yml; the commit edits r_a only. r_b must NOT be
    // attributed the change just for appearing (as context) in the same file's diff.
    const route = (id: string): KORecord => ({
      key: `g/-/route/${id}`,
      type: 'route',
      group: 'g',
      id,
      name: id,
      raw: {},
      searchText: [],
    });
    const routePath = 'groups/g/local/cribl/pipelines/route.yml';
    const routeDiff = {
      items: [
        {
          diffJson: [
            {
              oldName: routePath,
              newName: routePath,
              blocks: [
                {
                  header: '@@ -1,6 +1,6 @@',
                  lines: [
                    { content: ' routes:', type: 'context', oldNumber: 1, newNumber: 1 },
                    { content: '   - id: r_a', type: 'context', oldNumber: 2, newNumber: 2 },
                    { content: '-    description: old', type: 'delete', oldNumber: 3 },
                    { content: '+    description: new', type: 'insert', newNumber: 3 },
                    { content: '   - id: r_b', type: 'context', oldNumber: 4, newNumber: 4 },
                    { content: "     filter: 'true'", type: 'context', oldNumber: 5, newNumber: 5 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const transport: Transport = (rawPath) => {
      const [p] = rawPath.split('?');
      if (p === '/version')
        return jsonResponse({
          items: [{ hash: 'rc1', author_name: 'ada', author_email: 'ada@x', date: '2024-06-06T00:00:00Z', message: 'edit r_a' }],
        });
      if (p === '/version/files') return jsonResponse({ items: [{ count: 1, items: [{ name: routePath, state: 'M' }] }] });
      if (p === '/version/show') return jsonResponse(routeDiff);
      return Promise.resolve(new Response('not found', { status: 404 }));
    };

    const res = await buildAgeMap({ records: [route('r_a'), route('r_b')], transport, maxCommits: 10 });
    expect(res.map['g/-/route/r_a']?.author).toBe('ada'); // the edited route is attributed
    expect(res.map['g/-/route/r_a']?.approx).toBeFalsy(); // …as a real edit, not a fallback
    // The untouched sibling is NOT attributed the change; it falls back to a "created / first
    // seen" date (flagged approx) from the earliest commit its file appeared in.
    expect(res.map['g/-/route/r_b']?.approx).toBe(true);
    expect(res.map['g/-/route/r_b']?.author).toBe('ada');
  });

  it('dates an object with no attributable edit from the earliest commit that touched its file', async () => {
    // r_keep is edited in the newer commit; r_cold never changes but its file (route.yml) was
    // first added in the older commit — that install/creation date is its fallback, flagged
    // approx (a "created / first seen" date, not an edit), and it's excluded from stale checks.
    const route = (id: string): KORecord => ({ key: `g/-/route/${id}`, type: 'route', group: 'g', id, name: id, raw: {}, searchText: [] });
    const commits: Commit[] = [
      commit('newer', 'ida', '2024-08-08T00:00:00Z'),
      commit('older', 'Cribl System', '2024-01-01T00:00:00Z'), // author stays "Cribl System" (message has no "User:" prefix)
    ];
    // Both commits touch route.yml (a shared table listing both routes); neither diff is
    // fetched to insert/delete r_cold, so it's never a real attribution.
    const files = { newer: ['groups/g/local/cribl/pipelines/route.yml'], older: ['groups/g/local/cribl/pipelines/route.yml'] };
    const emptyDiff = { items: [{ diffJson: [{ oldName: 'groups/g/local/cribl/pipelines/route.yml', newName: 'groups/g/local/cribl/pipelines/route.yml', blocks: [] }] }] };
    const inner = gitTransport(commits, files);
    const transport: Transport = (rawPath, init) => (rawPath.split('?')[0] === '/version/show' ? jsonResponse(emptyDiff) : inner(rawPath, init));

    const res = await buildAgeMap({ records: [route('r_keep'), route('r_cold')], transport, maxCommits: 10 });
    expect(res.map['g/-/route/r_cold']?.approx).toBe(true);
    expect(res.map['g/-/route/r_cold']?.lastTouched.slice(0, 10)).toBe('2024-01-01'); // the OLDER (creation) commit
    expect(res.map['g/-/route/r_cold']?.author).toBe('Cribl System');
    expect(staleFindings(applyAgeMap([route('r_cold')], res.map), 30)).toHaveLength(0); // approx dates don't age out
  });

  it('attributes a wholesale local pack copy only to the object that differs from default', async () => {
    // First edit of any pack object writes the whole `local/<pack>/…/route.yml`, which
    // git shows as an all-new file. Both routes look added, but only r_a's content
    // actually differs from the pristine `default` copy — r_b is an unchanged carry-over
    // and must stay attributed to the older pack-install commit, not the local edit.
    const route = (id: string): KORecord => ({
      key: `g/mypack/route/${id}`,
      type: 'route',
      group: 'g',
      pack: 'mypack',
      id,
      name: `${id}_name`,
      raw: {},
      searchText: [],
    });
    const localPath = 'groups/g/local/mypack/pipelines/route.yml';
    const defaultPath = 'groups/g/default/mypack/pipelines/route.yml';
    const wholesale = (path: string, aDesc: string) => ({
      items: [
        {
          diffJson: [
            {
              oldName: path,
              newName: path,
              blocks: [
                {
                  header: '@@ -0,0 +1,7 @@',
                  lines: [
                    { content: '+routes:', type: 'insert', newNumber: 1 },
                    { content: '+  - id: r_a', type: 'insert', newNumber: 2 },
                    { content: '+    name: r_a_name', type: 'insert', newNumber: 3 },
                    { content: `+    description: ${aDesc}`, type: 'insert', newNumber: 4 },
                    { content: '+  - id: r_b', type: 'insert', newNumber: 5 },
                    { content: '+    name: r_b_name', type: 'insert', newNumber: 6 },
                    { content: '+    description: unchanged', type: 'insert', newNumber: 7 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    // local add (newer) edits r_a's description; default add (older) is the pristine copy.
    const diffs: Record<string, unknown> = { [localPath]: wholesale(localPath, 'edited'), [defaultPath]: wholesale(defaultPath, 'original') };
    const transport: Transport = (rawPath) => {
      const [p, query] = rawPath.split('?');
      const params = new URLSearchParams(query);
      if (p === '/version')
        return jsonResponse({
          items: [
            { hash: 'lc1', author_name: 'liam', author_email: 'liam@x', date: '2024-06-06T00:00:00Z', message: 'edit pan traffic route' },
            { hash: 'dc1', author_name: 'dana', author_email: 'dana@x', date: '2024-05-05T00:00:00Z', message: 'install mypack' },
          ],
        });
      if (p === '/version/files') {
        const path = params.get('commit') === 'lc1' ? localPath : defaultPath;
        return jsonResponse({ items: [{ count: 1, items: [{ name: path, state: 'A' }] }] });
      }
      if (p === '/version/show') return jsonResponse(diffs[params.get('filename') ?? '']);
      return Promise.resolve(new Response('not found', { status: 404 }));
    };

    const res = await buildAgeMap({ records: [route('r_a'), route('r_b')], transport, maxCommits: 10 });
    expect(res.map['g/mypack/route/r_a']?.author).toBe('liam'); // the edited route → the local commit
    expect(res.map['g/mypack/route/r_b']?.author).toBe('dana'); // the carry-over → the install commit
  });

  it('ignores deploy-substituted secrets when diffing a wholesale local pack copy', async () => {
    // Deploying fills real secrets into the `local` copy — every destination's `token`
    // differs from the `default` placeholder — so a naive block compare marks them all
    // changed. Only d_a has a real edit (a description); d_b differs solely by its token
    // and must stay attributed to the install commit.
    const dest = (id: string): KORecord => ({
      key: `g/mypack/destination/${id}`,
      type: 'destination',
      group: 'g',
      pack: 'mypack',
      id,
      name: id,
      raw: {},
      searchText: [],
    });
    const localPath = 'groups/g/local/mypack/outputs.yml';
    const defaultPath = 'groups/g/default/mypack/outputs.yml';
    const outputs = (path: string, token: string, aDesc: string | null) => ({
      items: [
        {
          diffJson: [
            {
              oldName: path,
              newName: path,
              blocks: [
                {
                  header: '@@ -0,0 +1,8 @@',
                  lines: [
                    { content: '+outputs:', type: 'insert', newNumber: 1 },
                    { content: '+  d_a:', type: 'insert', newNumber: 2 },
                    { content: `+    token: ${token}`, type: 'insert', newNumber: 3 },
                    ...(aDesc ? [{ content: `+    description: ${aDesc}`, type: 'insert', newNumber: 4 }] : []),
                    { content: '+  d_b:', type: 'insert', newNumber: 5 },
                    { content: `+    token: ${token}`, type: 'insert', newNumber: 6 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    // local (newer): real tokens + a description edit on d_a; default (older): placeholders.
    const diffs: Record<string, unknown> = {
      [localPath]: outputs(localPath, '"#42:cEycyBjMoxVhm4AiBVQ9"', 'edited'),
      [defaultPath]: outputs(defaultPath, 'YOUR_TOKEN', null),
    };
    const transport: Transport = (rawPath) => {
      const [p, query] = rawPath.split('?');
      const params = new URLSearchParams(query);
      if (p === '/version')
        return jsonResponse({
          items: [
            { hash: 'olc1', author_name: 'liam', author_email: 'liam@x', date: '2024-06-06T00:00:00Z', message: 'edit d_a description' },
            { hash: 'odc1', author_name: 'dana', author_email: 'dana@x', date: '2024-05-05T00:00:00Z', message: 'install mypack' },
          ],
        });
      if (p === '/version/files') {
        const path = params.get('commit') === 'olc1' ? localPath : defaultPath;
        return jsonResponse({ items: [{ count: 1, items: [{ name: path, state: 'A' }] }] });
      }
      if (p === '/version/show') return jsonResponse(diffs[params.get('filename') ?? '']);
      return Promise.resolve(new Response('not found', { status: 404 }));
    };

    const res = await buildAgeMap({ records: [dest('d_a'), dest('d_b')], transport, maxCommits: 10 });
    expect(res.map['g/mypack/destination/d_a']?.author).toBe('liam'); // real edit → the local commit
    expect(res.map['g/mypack/destination/d_b']?.author).toBe('dana'); // token-only diff → the install commit
  });
});
