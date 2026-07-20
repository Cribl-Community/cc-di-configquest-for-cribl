// The inventory table's sort model — the single source of truth for the sortable columns,
// shared by the table (ConfigTable), the sort logic (App), and the URL sort-param validation
// (useUrlState), so adding a column can't drift between the type and the runtime allow-list.

export const SORT_COLS = ['relevance', 'name', 'type', 'group', 'modified'] as const;
export type SortCol = (typeof SORT_COLS)[number];
export interface SortState {
  col: SortCol;
  dir: 'asc' | 'desc';
}
