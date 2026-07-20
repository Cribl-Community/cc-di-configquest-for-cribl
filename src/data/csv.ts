// Serialize the visible inventory to CSV. Pure and node-safe — the DOM download
// stays in the caller. Neutralizes spreadsheet formula injection so a hostile
// config value (an id, or a git-author "owner" name) can't execute as a formula
// when the export is opened in Excel/Sheets.

import { FINDING_LABELS, type KORecord } from './types';

const COLUMNS = ['type', 'group', 'pack', 'id', 'name', 'state', 'health', 'lastModifiedBy', 'lastTouched', 'flags'];

export function toCsv(records: KORecord[]): string {
  return [COLUMNS.join(','), ...records.map(row)].join('\n');
}

function row(r: KORecord): string {
  return [
    r.type,
    r.group,
    r.pack ?? '',
    r.id,
    r.name,
    r.disabled ? 'disabled' : 'enabled',
    r.health ?? '',
    r.owner ?? '',
    r.lastTouched ?? '',
    (r.issues ?? []).map((c) => FINDING_LABELS[c]).join('|'),
  ]
    .map((v) => esc(String(v)))
    .join(',');
}

/** A formula-injection-safe CSV row from arbitrary cells (shared with other exports). */
export function csvRow(cells: (string | number)[]): string {
  return cells.map((v) => esc(String(v))).join(',');
}

function esc(v: string): string {
  // Prefix a value that could open a spreadsheet formula so it's read as text, not code.
  const cell = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  // Quote when the cell would otherwise break CSV structure (a lone \r can split rows too).
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
