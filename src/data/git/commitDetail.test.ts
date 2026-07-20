import { describe, it, expect } from 'vitest';
import { fetchCommitDiff } from './commitDetail';
import type { Transport } from '../apiClient';

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

// A one-line diff (one added line) for a given file path.
function fileShow(path: string) {
  return {
    items: [
      {
        diffJson: [
          { oldName: path, newName: path, blocks: [{ header: '@@ -0,0 +1 @@', lines: [{ content: `+${path}`, type: 'insert', newNumber: 1 }] }] },
        ],
      },
    ],
  };
}

/** Serves /version/files (flat leaves) and /version/show for the named files. Any
 *  path in `broken` responds 500 to exercise the per-file resilience. */
function transportFor(files: { name: string; state: string }[], broken: Set<string> = new Set()): Transport {
  return (rawPath) => {
    const [path, query] = rawPath.split('?');
    if (path === '/version/files') return jsonResponse({ items: [{ count: files.length, items: files }] });
    if (path === '/version/show') {
      const filename = new URLSearchParams(query).get('filename') ?? '';
      if (broken.has(filename)) return Promise.resolve(new Response('boom', { status: 500 }));
      return jsonResponse(fileShow(filename));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

describe('fetchCommitDiff', () => {
  it('returns every touched file with its diff rows', async () => {
    const files = [
      { name: 'a.yml', state: 'M' },
      { name: 'b.yml', state: 'A' },
    ];
    const res = await fetchCommitDiff('k1', { transport: transportFor(files) });
    expect(res.total).toBe(2);
    expect(res.shown).toBe(2);
    expect(res.files.map((f) => f.path)).toEqual(['a.yml', 'b.yml']);
    expect(res.files[0].state).toBe('M');
    expect(res.files[0].rows.some((r) => r.kind === 'add')).toBe(true);
  });

  it('caps at maxFiles and reports the overflow', async () => {
    const files = [
      { name: 'a.yml', state: 'M' },
      { name: 'b.yml', state: 'M' },
      { name: 'c.yml', state: 'M' },
    ];
    const res = await fetchCommitDiff('k2', { transport: transportFor(files), maxFiles: 2 });
    expect(res.total).toBe(3);
    expect(res.shown).toBe(2);
    expect(res.files).toHaveLength(2);
  });

  it('keeps a file whose diff cannot be read, with no rows', async () => {
    const files = [
      { name: 'ok.yml', state: 'M' },
      { name: 'bad.yml', state: 'M' },
    ];
    const res = await fetchCommitDiff('k3', { transport: transportFor(files, new Set(['bad.yml'])) });
    expect(res.files).toHaveLength(2);
    expect(res.files.find((f) => f.path === 'bad.yml')!.rows).toEqual([]);
    expect(res.files.find((f) => f.path === 'ok.yml')!.rows.length).toBeGreaterThan(0);
  });
});
