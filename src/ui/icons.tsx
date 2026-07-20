// Small shared inline icons, so the same glyph reads identically wherever it appears
// (e.g. every dropdown uses one chevron, not a mix of an SVG here and a text ▾ there).

/** Downward chevron used by every menu/dropdown trigger. Decorative (aria-hidden);
 *  rotate it via CSS on the open state. */
export function ChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
