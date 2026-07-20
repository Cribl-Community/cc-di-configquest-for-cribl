// Normalized diff rows, rendered by one DiffView and fed by two sources:
// git commit diffs (change history) and a semantic per-setting compare.

import type { KORecord } from './types';
import { asRecord, str } from './raw';
import { maskSecret } from './secrets';

export type DiffRowKind = 'context' | 'add' | 'del' | 'change' | 'hunk';

export interface DiffRow {
  kind: DiffRowKind;
  left?: string; // old / A side
  right?: string; // new / B side
  leftNo?: number;
  rightNo?: number;
  label?: string; // hunk header
}

/** Semantic compare of two objects' flattened `path: value` settings. */
export function diffSettings(a: KORecord, b: KORecord): DiffRow[] {
  const ma = settingsOf(a);
  const mb = settingsOf(b);
  const paths = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  const rows: DiffRow[] = [];
  for (const path of paths) {
    const va = ma.get(path);
    const vb = mb.get(path);
    if (va !== undefined && vb !== undefined) {
      rows.push({ kind: va === vb ? 'context' : 'change', left: `${path}: ${va}`, right: `${path}: ${vb}` });
    } else if (va !== undefined) {
      rows.push({ kind: 'del', left: `${path}: ${va}` });
    } else {
      rows.push({ kind: 'add', right: `${path}: ${vb}` });
    }
  }
  return rows;
}

/** How many settings differ (changed + only-A + only-B). */
export function diffStats(rows: DiffRow[]): { changed: number; onlyA: number; onlyB: number } {
  let changed = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (const r of rows) {
    if (r.kind === 'change') changed += 1;
    else if (r.kind === 'del') onlyA += 1;
    else if (r.kind === 'add') onlyB += 1;
  }
  return { changed, onlyA, onlyB };
}

/** Convert a git `/version/show` diffJson (array of files) into rows. */
export function gitToDiffRows(diffFiles: unknown): DiffRow[] {
  const rows: DiffRow[] = [];
  if (!Array.isArray(diffFiles)) return rows;
  for (const file of diffFiles) {
    const blocks = asRecord(file)?.['blocks'];
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      const b = asRecord(block);
      const header = b && str(b, 'header');
      if (header) rows.push({ kind: 'hunk', label: header });
      const lines = b?.['lines'];
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        const l = asRecord(line);
        if (!l) continue;
        const raw = typeof l['content'] === 'string' ? (l['content'] as string) : '';
        const content = /^[ +-]/.test(raw) ? raw.slice(1) : raw; // strip the diff marker
        const oldNo = num(l['oldNumber']);
        const newNo = num(l['newNumber']);
        if (l['type'] === 'insert') rows.push({ kind: 'add', right: content, rightNo: newNo });
        else if (l['type'] === 'delete') rows.push({ kind: 'del', left: content, leftNo: oldNo });
        else rows.push({ kind: 'context', left: content, right: content, leftNo: oldNo, rightNo: newNo });
      }
    }
  }
  return rows;
}

/**
 * Keep only the lines of a shared config-file diff (inputs.yml / outputs.yml /
 * route.yml — one file holding every object of a type) that belong to `record`:
 * its keyed block in a map, or its list item. Returns null when the object isn't
 * part of this file's change, so the caller can drop a sibling-only commit. The
 * hunk header is dropped since its line range no longer matches the kept slice.
 *
 * `siblings` (the other objects sharing the file) disambiguate an "orphan" edit —
 * a change deep inside one object whose `- id:`/`key:` boundary sits above the
 * 3-line diff context, so nothing in the hunk names the object. Without siblings
 * such a hunk is kept whole (legacy behavior); with them it attaches only to the
 * object whose own config values it matches.
 */
export function narrowGitFileToObject(
  file: unknown,
  record: KORecord,
  siblings: KORecord[] = [],
): Record<string, unknown> | null {
  const f = asRecord(file);
  const blocks = f?.['blocks'];
  if (!f || !Array.isArray(blocks)) return null;
  const kept: unknown[] = [];
  for (const block of blocks) {
    const b = asRecord(block);
    const lines = b?.['lines'];
    if (!b || !Array.isArray(lines)) continue;
    const narrowed = keepObjectLines(lines, record, siblings);
    if (narrowed.length > 0) kept.push({ ...b, header: undefined, lines: narrowed });
  }
  return kept.length > 0 ? { ...f, blocks: kept } : null;
}

// Segment a shared file's diff block by top-level object (a `key:` in a map, or a `- …` list
// item). Objects may be keyed at the ROOT (`sip_extract:` at column 0 — shared library tables)
// or nested under a root key (`inputs:` -> `  splunk_in:` at indent 2 — inputs/outputs/route.yml);
// the object indent is derived from where the known object ids actually appear, since a
// hard-coded indent silently dropped every root-keyed file (all library types) from change
// history. This is the RECORD-INDEPENDENT core — it segments once and records each segment's
// identifying tokens — so the per-record `keepObjectLines` and the all-records
// `changedKeysInSharedFile` share one pass instead of re-segmenting the whole diff per object.
interface SegmentedBlock {
  meta: { text: string; indent: number }[];
  objIndent: number;
  /** Segment id per line (0 = root/context/orphan region). */
  segOf: number[];
  /** Identifying tokens (a map key, or a `- id:`/`name:` value) per non-zero segment. */
  segTokens: Map<number, Set<string>>;
  /** Whether a segment contains an insert/delete line. */
  segHasChange: Map<number, boolean>;
  /** A structural root line (segment 0, indent below objIndent, e.g. `+routes:`) changed. */
  rootChange: boolean;
  /** Line indices of the orphan region: indented lines with no in-hunk boundary above them. */
  orphanIdx: number[];
  orphanChange: boolean;
}

function segmentSharedBlock(lines: unknown[], known: Set<string>): SegmentedBlock {
  const meta = parseDiffLines(lines);
  const objIndent = deriveObjectIndent(meta, known);
  const segOf = new Array<number>(meta.length).fill(0); // 0 = root/context segment
  const segTokens = new Map<number, Set<string>>();
  const segHasChange = new Map<number, boolean>();
  let rootChange = false;
  let cur = 0;
  for (let i = 0; i < meta.length; i += 1) {
    const t = meta[i].text.trim();
    const isListItem = meta[i].indent === objIndent && /^-\s/.test(t);
    const key = meta[i].indent === objIndent && !isListItem ? mapKeyOf(t) : null;
    if (isListItem || key !== null) {
      cur = i + 1; // unique, non-zero segment id
      const s = new Set<string>();
      if (key !== null) s.add(key);
      else addIdName(t, s); // a `- id: …` list marker carries the object's id/name
      segTokens.set(cur, s);
    } else if (meta[i].indent >= 0 && meta[i].indent < objIndent) {
      cur = 0; // structural root context (e.g. `routes:`)
      if (isChangeLine(lines[i])) rootChange = true;
    } else if (cur !== 0) {
      addIdName(t, segTokens.get(cur)!); // the object's id/name may sit on a deeper line
    }
    segOf[i] = cur;
    if (cur !== 0 && isChangeLine(lines[i])) segHasChange.set(cur, true);
  }
  const orphanIdx = meta.map((m, i) => (segOf[i] === 0 && m.indent > objIndent ? i : -1)).filter((i) => i >= 0);
  const orphanChange = orphanIdx.some((i) => isChangeLine(lines[i]));
  return { meta, objIndent, segOf, segTokens, segHasChange, rootChange, orphanIdx, orphanChange };
}

// Keep only the lines of a shared config-file diff that belong to `record`: its keyed block or
// list item. Returns [] when the object isn't part of this block's change, so the caller drops
// a sibling-only commit. An orphan change (deep inside an object whose boundary is above the
// hunk) is attributed to the one sibling whose config values it matches; with no siblings it's
// kept whole. A thin per-record wrapper over `segmentSharedBlock` (same output as before).
function keepObjectLines(lines: unknown[], record: KORecord, siblings: KORecord[]): unknown[] {
  const tokens = [record.id, record.name].filter((t): t is string => Boolean(t));
  const known = new Set<string>([...tokens, ...siblings.flatMap((s) => [s.id, s.name])].filter((t): t is string => Boolean(t)));
  const seg = segmentSharedBlock(lines, known);
  const owns = (s: Set<string> | undefined) => s !== undefined && tokens.some((t) => s.has(t));
  const ownsSegment = [...seg.segTokens.values()].some(owns);
  let orphanForRecord = false;
  if (seg.orphanChange) {
    const owner = siblings.length > 1 ? ownerOfOrphan(seg.orphanIdx.map((i) => seg.meta[i].text), siblings) : undefined;
    orphanForRecord = owner ? owner.key === record.key : true; // ambiguous / no siblings → keep for all
  }
  if (!ownsSegment && !orphanForRecord) return [];
  return lines.filter((_, i) => {
    const s = seg.segOf[i];
    if (s !== 0) return owns(seg.segTokens.get(s)); // another object's segment → drop
    if (seg.meta[i].indent >= 0 && seg.meta[i].indent < seg.objIndent) return true; // structural root context
    if (!isChangeLine(lines[i])) return true; // orphan-region context rides along
    return orphanForRecord; // an orphan +/- stays only on its matched owner
  });
}

/**
 * The keys of the records whose section actually changed in a shared-file diff — the point of
 * narrowing, in ONE segmentation pass over the diff rather than re-segmenting per candidate
 * (which was O(candidates × diff) — ~220× for a 220-object sds-rules.yml). A record is changed
 * iff it owns a segment that changed, OR it owns a segment in a block whose structural root line
 * changed, OR it is the sibling an orphan change is attributed to — kept exactly in step with
 * `keepObjectLines` + "has a +/- line", aggregated over every record.
 */
export function changedKeysInSharedFile(file: unknown, records: KORecord[]): Set<string> {
  const changed = new Set<string>();
  const f = asRecord(file);
  const blocks = f?.['blocks'];
  if (!f || !Array.isArray(blocks)) return changed;
  const known = new Set<string>(records.flatMap((r) => [r.id, r.name]).filter((t): t is string => Boolean(t)));
  const byToken = new Map<string, KORecord[]>(); // id/name -> the records that carry it
  for (const r of records) {
    for (const tok of [r.id, r.name]) {
      if (!tok) continue;
      const list = byToken.get(tok);
      if (list) list.push(r);
      else byToken.set(tok, [r]);
    }
  }
  for (const block of blocks) {
    const lines = asRecord(block)?.['lines'];
    if (!Array.isArray(lines)) continue;
    const seg = segmentSharedBlock(lines, known);
    for (const [id, toks] of seg.segTokens) {
      // A record owning a change-free segment still counts when the block's root line changed.
      if (!(seg.segHasChange.get(id) || seg.rootChange)) continue;
      for (const tok of toks) {
        for (const r of byToken.get(tok) ?? []) changed.add(r.key);
      }
    }
    if (seg.orphanChange) {
      const owner = records.length > 1 ? ownerOfOrphan(seg.orphanIdx.map((i) => seg.meta[i].text), records) : undefined;
      if (owner) changed.add(owner.key);
      else for (const r of records) changed.add(r.key); // ambiguous / ≤1 record → keep for all
    }
  }
  return changed;
}

/** The indent at which objects are keyed in this shared-file diff: the shallowest indent of
 *  a `<key>:` line whose key is a known object id, or of a `- ` list item. Falls back to 2
 *  (the nested-under-a-root-key layout) when the hunk shows no recognizable boundary. */
function deriveObjectIndent(meta: { text: string; indent: number }[], known: Set<string>): number {
  let min = -1;
  for (const m of meta) {
    const t = m.text.trim();
    const key = mapKeyOf(t);
    const boundary = /^-\s/.test(t) || (key !== null && known.has(key));
    if (boundary && (min < 0 || m.indent < min)) min = m.indent;
  }
  return min < 0 ? 2 : min;
}

/** The key of a `key:` map line, unquoted, or null if the line isn't a map entry. Handles a
 *  quoted key that itself contains a colon (`'Palo Alto: Traffic':`) and spaces. */
function mapKeyOf(trimmed: string): string | null {
  const quoted = /^(['"])(.*?)\1\s*:/.exec(trimmed);
  if (quoted) return quoted[2];
  const plain = /^([^:]+):/.exec(trimmed);
  return plain && !/^-\s/.test(trimmed) ? plain[1].trim() : null;
}

/** Whether a raw diff line is an insertion or deletion (vs. unchanged context). */
function isChangeLine(line: unknown): boolean {
  const t = asRecord(line)?.['type'];
  return t === 'insert' || t === 'delete';
}

// Attribute an orphan hunk to a single sibling by matching the hunk's field values
// against each sibling's flattened config. A value distinctive to exactly one sibling
// (e.g. its `pipeline`, `filter`, or the edited value itself) points at the owner;
// generic values (`true`, `false`, `[]`) shared by many count for none. The winner
// must be unambiguous, else null (caller keeps the hunk for all — the safe fallback).
function ownerOfOrphan(texts: string[], siblings: KORecord[]): KORecord | null {
  const values = new Set<string>();
  for (const text of texts) {
    const v = orphanValue(text);
    if (v) values.add(v);
  }
  if (values.size === 0) return null;
  const sets = siblings.map((r) => ({ r, vals: recordValueSet(r) }));
  const score = new Map<string, number>();
  for (const v of values) {
    const holders = sets.filter((x) => x.vals.has(v));
    if (holders.length === 1) score.set(holders[0].r.key, (score.get(holders[0].r.key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  let tie = false;
  for (const [k, n] of score) {
    if (n > bestN) {
      best = k;
      bestN = n;
      tie = false;
    } else if (n === bestN) tie = true;
  }
  return best && !tie ? siblings.find((r) => r.key === best) ?? null : null;
}

/** Normalize a config value for comparison: drop surrounding quotes a deploy may add. */
function normValue(s: string): string {
  return s.replace(/['"]/g, '').trim();
}

/** The value side of a `field: value` diff line, normalized (empty if none). */
function orphanValue(text: string): string {
  const i = text.indexOf(': ');
  return i < 0 ? '' : normValue(text.slice(i + 2));
}

/** A record's normalized config values (from its flattened settings). */
function recordValueSet(r: KORecord): Set<string> {
  const out = new Set<string>();
  for (const v of settingsOf(r).values()) {
    const n = normValue(v);
    if (n) out.add(n);
  }
  return out;
}

export interface SharedObjectSegment {
  /** Identifying tokens: a map entry's key, or a list item's `id`/`name` values. */
  ids: string[];
  /** The object's block text with diff markers stripped, for content comparison. */
  text: string;
}

/**
 * Split a shared config-file diff into its top-level object segments — a `key:` map entry or a
 * `- …` list item — capturing each object's identifying tokens and raw block text. Lets a caller
 * compare one object's block across two copies of the same file (a pack's pristine `default` vs.
 * deployed `local` copy), so a wholesale-added copy attributes a commit only to the objects whose
 * content truly differs. Built on the same `segmentSharedBlock` pass as `keepObjectLines`, so all
 * three agree on object boundaries — including root-keyed library tables (objects at column 0),
 * which need `records` to derive the object indent (`known` ids); nested inputs/outputs/route.yml
 * work with or without them.
 */
export function splitSharedFileObjects(file: unknown, records: KORecord[] = []): SharedObjectSegment[] {
  const f = asRecord(file);
  const blocks = f?.['blocks'];
  if (!f || !Array.isArray(blocks)) return [];
  const known = new Set<string>(records.flatMap((r) => [r.id, r.name]).filter((t): t is string => Boolean(t)));
  const segments: SharedObjectSegment[] = [];
  for (const block of blocks) {
    const lines = asRecord(block)?.['lines'];
    if (!Array.isArray(lines)) continue;
    const seg = segmentSharedBlock(lines, known);
    const textById = new Map<number, string[]>(); // each segment's lines, in order
    for (let i = 0; i < seg.segOf.length; i += 1) {
      const s = seg.segOf[i];
      if (s === 0) continue; // root/context/orphan lines belong to no object
      const list = textById.get(s);
      if (list) list.push(seg.meta[i].text);
      else textById.set(s, [seg.meta[i].text]);
    }
    for (const [id, toks] of seg.segTokens) {
      segments.push({ ids: [...toks], text: (textById.get(id) ?? []).join('\n') });
    }
  }
  return segments;
}

/** The `id:`/`name:` value on a line (optionally after a `- ` list marker), or null. */
function idNameValue(trimmed: string): string | null {
  const m = /^(?:-\s+)?(?:id|name):\s*(.+)$/.exec(trimmed);
  return m ? m[1].trim() : null;
}

/** Add a line's `id:`/`name:` value (if any) to a token set — the shared-block token collector. */
function addIdName(trimmed: string, into: Set<string>): void {
  const v = idNameValue(trimmed);
  if (v) into.add(v);
}

/** Strip each diff line's +/-/space marker and note its indentation — the two things
 *  shared-file segmentation keys on. */
function parseDiffLines(lines: unknown[]): { text: string; indent: number }[] {
  return lines.map((line) => {
    const rec = asRecord(line);
    const raw = rec && typeof rec['content'] === 'string' ? rec['content'] : '';
    const text = /^[ +-]/.test(raw) ? raw.slice(1) : raw; // strip the +/-/space marker
    const nonSpace = text.search(/\S/);
    return { text, indent: nonSpace < 0 ? -1 : nonSpace };
  });
}

/** A record's flattened `path → value` settings (from its searchText leaves). Shared
 *  by the per-setting compare and the cross-group difference view. */
export function settingsOf(r: KORecord): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of r.searchText) {
    const i = line.indexOf(': ');
    if (i >= 0) {
      const key = line.slice(0, i);
      // Mask secrets at this shared chokepoint, so Compare (diffSettings) and Across Worker
      // Groups (crossGroupDiff) both hide credentials and can never disagree on a secret.
      m.set(key, maskSecret(key, line.slice(i + 2)));
    }
  }
  return m;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
