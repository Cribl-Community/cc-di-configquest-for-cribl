import { describe, it, expect } from 'vitest';
import { fetchCommits, fetchTouchedFiles } from './log';
import type { Transport } from '../apiClient';

function json(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

describe('fetchCommits', () => {
  it('parses the envelope and skips items without a hash', async () => {
    const transport: Transport = () =>
      json({
        items: [
          { hash: 'h1', author_name: 'a', author_email: 'a@x', date: '2024-01-01', message: 'm1' },
          { author_name: 'no-hash' },
        ],
      });
    const commits = await fetchCommits(10, { transport });
    expect(commits.map((c) => c.hash)).toEqual(['h1']);
    expect(commits[0]).toMatchObject({ authorName: 'a', authorEmail: 'a@x', date: '2024-01-01', message: 'm1' });
  });
});

describe('fetchTouchedFiles', () => {
  it('flattens the /version/files tree to paths and skips deletes', async () => {
    const transport: Transport = () =>
      json({
        items: [
          {
            count: 3,
            items: [
              {
                name: 'groups',
                children: [
                  {
                    name: 'prod',
                    children: [
                      { name: 'inputs.yml', state: 'M' },
                      { name: 'gone.yml', state: 'D' },
                      { name: 'pipelines', children: [{ name: 'web_logs', children: [{ name: 'conf.yml', state: 'A' }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    const files = await fetchTouchedFiles('h', { transport });
    expect([...files].sort()).toEqual(['groups/prod/inputs.yml', 'groups/prod/pipelines/web_logs/conf.yml']);
  });

  // Kept last: this latches the session onto the /version/show fallback. Uses 404
  // (an ungranted path can answer 404, not just 403) to lock the broadened catch.
  it('falls back to /version/show when /version/files is unavailable (404)', async () => {
    const transport: Transport = (rawPath) => {
      const path = rawPath.split('?')[0];
      if (path === '/version/files') return Promise.resolve(new Response('not found', { status: 404 }));
      if (path === '/version/show') {
        return json({
          items: [
            {
              diffJson: [
                { newName: 'groups/g/local/cribl/inputs.yml' },
                { oldName: 'groups/g/local/cribl/gone.yml', isDeleted: true },
              ],
            },
          ],
        });
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    };
    const files = await fetchTouchedFiles('denied-hash', { transport });
    expect(files).toEqual(['groups/g/local/cribl/inputs.yml']);
  });
});
