import type { ReactNode } from 'react';
import type { MatchSpan } from '../data/search';

/** Render text with <mark> around each match span (spans are non-overlapping). */
export function Highlight({ text, spans }: { text: string; spans: MatchSpan[] }) {
  if (spans.length === 0) return <>{text}</>;
  const nodes: ReactNode[] = [];
  let pos = 0;
  spans.forEach((span, i) => {
    if (span.start > pos) nodes.push(text.slice(pos, span.start));
    nodes.push(<mark key={i}>{text.slice(span.start, span.end)}</mark>);
    pos = span.end;
  });
  if (pos < text.length) nodes.push(text.slice(pos));
  return <>{nodes}</>;
}
