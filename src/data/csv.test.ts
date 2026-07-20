import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';
import type { KORecord } from './types';

const rec = (over: Partial<KORecord>): KORecord => ({
  key: 'g/-/pipeline/x',
  type: 'pipeline',
  group: 'g',
  id: 'x',
  name: 'x',
  raw: {},
  searchText: [],
  ...over,
});

const dataRow = (csv: string) => csv.split('\n')[1];

describe('toCsv', () => {
  it('neutralizes spreadsheet formula-injection payloads', () => {
    const line = dataRow(toCsv([rec({ id: '=1+1', name: '=HYPERLINK("http://evil","x")', owner: '@SUM(A1)' })]));
    expect(line).toContain("'=1+1"); // trigger char prefixed with a quote
    expect(line).toContain("'@SUM(A1)");
    expect(line).toContain(`"'=HYPERLINK`); // still prefixed even when structurally quoted
    expect(line).not.toMatch(/(^|,)[=@+]/); // no cell begins with a raw formula trigger
  });

  it('quotes values that would break CSV structure, including a lone CR', () => {
    const line = dataRow(toCsv([rec({ name: 'a,b', id: 'c"d', owner: 'e\rf' })]));
    expect(line).toContain('"a,b"');
    expect(line).toContain('"c""d"');
    expect(line).toContain('"e\rf"');
  });

  it('leaves ordinary values unquoted and emits the header row', () => {
    const csv = toCsv([rec({ type: 'source', group: 'prod', id: 'in_1', name: 'in_1' })]);
    expect(csv.split('\n')[0]).toBe('type,group,pack,id,name,state,health,lastModifiedBy,lastTouched,flags');
    expect(csv.split('\n')[1]).toBe('source,prod,,in_1,in_1,enabled,,,,');
  });
});
