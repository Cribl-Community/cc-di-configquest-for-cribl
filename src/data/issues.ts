// Attach finding categories to the records they affect, so a row can badge its
// issues and the Explore view can filter by them.

import type { CoverageReport, Finding, FindingCategory, FindingsReport, KORecord } from './types';

export function issueMap(findings: FindingsReport, coverage: CoverageReport): Map<string, FindingCategory[]> {
  const map = new Map<string, FindingCategory[]>();
  const add = (list: Finding[]) => {
    for (const f of list) {
      const existing = map.get(f.recordKey);
      if (existing) {
        if (!existing.includes(f.category)) existing.push(f.category);
      } else {
        map.set(f.recordKey, [f.category]);
      }
    }
  };
  add(findings.orphanedPipelines);
  add(findings.danglingRoutes);
  add(findings.unusedLookups);
  add(findings.disabled);
  add(findings.staleObjects);
  add(coverage.deadEndSources);
  add(coverage.deadEndDestinations);
  add(coverage.unreachableRoutes);
  return map;
}

/** Return new records enriched with their issue categories. */
export function applyIssues(records: KORecord[], findings: FindingsReport, coverage: CoverageReport): KORecord[] {
  const map = issueMap(findings, coverage);
  return records.map((r) => {
    const issues = map.get(r.key);
    return issues ? { ...r, issues } : r;
  });
}
