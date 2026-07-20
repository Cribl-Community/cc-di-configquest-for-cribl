import { describe, it, expect } from 'vitest';
import { toActivity } from './activity';
import type { Commit } from './log';

const commit = (over: Partial<Commit>): Commit => ({
  hash: 'abc1234def',
  authorName: 'git author',
  authorEmail: 'a@x',
  date: '2026-01-01T00:00:00Z',
  message: 'a message',
  ...over,
});

describe('toActivity', () => {
  it('pulls the real user + change out of a Cribl System commit', () => {
    const a = toActivity(
      commit({ authorName: 'Cribl System', message: 'Grace Hopper: Added a description to the web_logs pipeline' }),
    );
    expect(a.author).toBe('Grace Hopper');
    expect(a.summary).toBe('Added a description to the web_logs pipeline');
    expect(a.hash).toBe('abc1234def');
  });

  it('keeps the git author and full message for on-prem commits', () => {
    const a = toActivity(commit({ authorName: 'Ada Lovelace', message: 'Bump token to 42' }));
    expect(a.author).toBe('Ada Lovelace');
    expect(a.summary).toBe('Bump token to 42');
  });

  it('falls back gracefully on a Cribl System commit with no "user:" prefix', () => {
    const a = toActivity(commit({ authorName: 'Cribl System', message: 'automated snapshot' }));
    expect(a.author).toBe('Cribl System');
    expect(a.summary).toBe('automated snapshot');
  });
});
