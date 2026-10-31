'use client';
// Loads one report from /api/reports/<name> and shows it as a chart and/or table.
// With `byYear`, a season selector re-queries the view filtered by year.
// Optional `controls` add filters and sorting that run in the browser on the loaded rows:
//   filters: [{ key, label, type: 'min' | 'max' | 'select' }]
//   sorts:   [{ key, label, dir: 'asc' | 'desc' }]   (first one is the default)
//   tops:    [10, 25, 50]                            (how many rows to show; first is the default)
//   rank:    true                                    (adds a # column after filtering and sorting)
import { useEffect, useMemo, useState } from 'react';
import DataTable from './DataTable';
import Info from './Info';
import { BarChartCard } from './Charts';
import { YEARS, SLOW_REPORTS } from '@/lib/reports';

// Filters on the same column (min and max maps) need separate state keys
const fid = (f) => `${f.key}:${f.type}`;

export default function ReportPanel({ name, title, note, info, byYear, initialYear, chart, columns, links, showTable = true, maxRows, controls }) {
  const [year, setYear] = useState(byYear ? (initialYear ?? YEARS[1]) : null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [fv, setFv] = useState({});
  const [sortIdx, setSortIdx] = useState(0);
  const [top, setTop] = useState(controls?.tops?.[0] ?? null);

  useEffect(() => {
    setRows(null);
    fetch(`/api/reports/${name}${year ? `?year=${year}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setRows)
      .catch(() => setError('Could not load this report.'));
  }, [name, year]);

  const shown = useMemo(() => {
    if (!rows) return null;
    let out = rows;
    for (const f of controls?.filters || []) {
      const v = fv[fid(f)];
      if (v === undefined || v === '') continue;
      out = out.filter((r) => (f.type === 'select' ? String(r[f.key]) === v
        : f.type === 'max' ? Number(r[f.key]) <= Number(v)
        : Number(r[f.key]) >= Number(v)));
    }
    const s = controls?.sorts?.[sortIdx];
    if (s) out = [...out].sort((a, b) => (s.dir === 'asc' ? 1 : -1) * (Number(a[s.key]) - Number(b[s.key])));
    const limit = top ?? maxRows;
    if (limit) out = out.slice(0, limit);
    if (controls?.rank) out = out.map((r, i) => ({ '#': i + 1, ...r }));
    return out;
  }, [rows, fv, sortIdx, top, controls, maxRows]);

  const setFilter = (f) => (e) => setFv({ ...fv, [fid(f)]: e.target.value });
  return (
    <div className="card">
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{title}{info && <Info>{info}</Info>}</h2>
        {byYear && (
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{y}{y === 2026 ? ' (partial)' : ''}</option>)}
          </select>
        )}
      </div>
      {note && <div className="muted note">{note}</div>}
      {controls && rows && (
        <div className="filters">
          {(controls.filters || []).map((f) => f.type === 'select' ? (
            <label className="inline" key={fid(f)}>{f.label}
              <select value={fv[fid(f)] ?? ''} onChange={setFilter(f)}>
                <option value="">All</option>
                {[...new Set(rows.map((r) => String(r[f.key])))].sort().map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          ) : (
            <label className="inline" key={fid(f)}>{f.label}
              <input type="number" min="0" style={{ width: 80 }} value={fv[fid(f)] ?? ''} onChange={setFilter(f)} />
            </label>
          ))}
          {controls.sorts && (
            <label className="inline">Sort
              <select value={sortIdx} onChange={(e) => setSortIdx(Number(e.target.value))}>
                {controls.sorts.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
              </select>
            </label>
          )}
          {controls.tops && (
            <label className="inline">Show
              <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
                {controls.tops.map((n) => <option key={n} value={n}>top {n}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">{SLOW_REPORTS.includes(name) ? 'Calculating over every map... the first load can take a few seconds, then it is cached.' : 'Loading...'}</p>}
      {shown && chart && <BarChartCard data={(chart.top ? shown.slice(0, chart.top) : shown)} x={chart.x} bars={chart.bars} domain={chart.domain} />}
      {shown && showTable && <DataTable rows={shown} columns={columns} links={links} empty="No rows match these filters." />}
    </div>
  );
}
