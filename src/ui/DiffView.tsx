import type { DiffRow } from '../data/diff';

/** Renders normalized diff rows, unified (one column) or split (A | B). In split mode,
 *  `leftLabel`/`rightLabel` name each column so it's clear which object is which side. */
export function DiffView({
  rows,
  mode,
  leftLabel,
  rightLabel,
}: {
  rows: DiffRow[];
  mode: 'unified' | 'split';
  leftLabel?: string;
  rightLabel?: string;
}) {
  if (rows.length === 0) return <div className="diff-empty">No differences.</div>;
  return mode === 'split' ? <Split rows={rows} leftLabel={leftLabel} rightLabel={rightLabel} /> : <Unified rows={rows} />;
}

function Unified({ rows }: { rows: DiffRow[] }) {
  const out: React.ReactNode[] = [];
  rows.forEach((r, i) => {
    if (r.kind === 'hunk') {
      out.push(
        <div className="diff-hunk" key={i}>
          {r.label}
        </div>,
      );
    } else if (r.kind === 'change') {
      out.push(<Line key={`${i}d`} cls="del" sign="-" no={r.leftNo} text={r.left ?? ''} />);
      out.push(<Line key={`${i}a`} cls="add" sign="+" no={r.rightNo} text={r.right ?? ''} />);
    } else if (r.kind === 'del') {
      out.push(<Line key={i} cls="del" sign="-" no={r.leftNo} text={r.left ?? ''} />);
    } else if (r.kind === 'add') {
      out.push(<Line key={i} cls="add" sign="+" no={r.rightNo} text={r.right ?? ''} />);
    } else {
      out.push(<Line key={i} cls="context" sign=" " no={r.rightNo ?? r.leftNo} text={r.left ?? r.right ?? ''} />);
    }
  });
  return <div className="diff diff-unified">{out}</div>;
}

function Line({ cls, sign, no, text }: { cls: string; sign: string; no?: number; text: string }) {
  return (
    <div className={`diff-line diff-${cls}`}>
      <span className="diff-gutter">{no ?? ''}</span>
      <span className="diff-sign">{sign}</span>
      <span className="diff-content">{text}</span>
    </div>
  );
}

function Split({ rows, leftLabel, rightLabel }: { rows: DiffRow[]; leftLabel?: string; rightLabel?: string }) {
  return (
    <div className="diff diff-split">
      {(leftLabel || rightLabel) && (
        <div className="diff-split-head">
          <div className="diff-split-h">{leftLabel}</div>
          <div className="diff-split-h">{rightLabel}</div>
        </div>
      )}
      {rows.map((r, i) =>
        r.kind === 'hunk' ? (
          <div className="diff-hunk diff-hunk-split" key={i}>
            {r.label}
          </div>
        ) : (
          <div className="diff-split-row" key={i}>
            <Cell side={r.kind === 'add' ? 'empty' : r.kind === 'change' ? 'del' : r.kind === 'del' ? 'del' : 'context'} text={r.left} />
            <Cell side={r.kind === 'del' ? 'empty' : r.kind === 'change' ? 'add' : r.kind === 'add' ? 'add' : 'context'} text={r.right} />
          </div>
        ),
      )}
    </div>
  );
}

function Cell({ side, text }: { side: 'context' | 'add' | 'del' | 'empty'; text?: string }) {
  return <div className={`diff-cell diff-${side}`}>{text ?? ''}</div>;
}
