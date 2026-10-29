// Generic table for query results. Column headers come from the row keys
// ("avg_kast_pct" -> "avg kast pct"); numbers are right-aligned.
// Optional `links`: { columnName: (row) => href } turns cells into links.
import Link from 'next/link';

const pretty = (key) => key.replace(/_/g, ' ');
const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));

function formatCell(v) {
  if (v === null || v === undefined) return <span className="muted">-</span>;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

export default function DataTable({ rows, columns, links = {}, empty = 'No rows.' }) {
  if (!rows?.length) return <p className="muted">{empty}</p>;
  const cols = columns || Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c} className={isNum(rows[0][c]) ? 'num' : ''}>{pretty(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className={isNum(row[c]) ? 'num' : ''}>
                  {links[c] ? <Link href={links[c](row)}>{formatCell(row[c])}</Link> : formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
