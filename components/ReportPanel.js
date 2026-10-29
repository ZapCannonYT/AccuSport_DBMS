'use client';
// Loads one report from /api/reports/<name> and shows it as a chart and/or table.
// With `byYear`, a season selector re-queries the view filtered by year.
import { useEffect, useState } from 'react';
import DataTable from './DataTable';
import { BarChartCard } from './Charts';
import { YEARS } from '@/lib/reports';

export default function ReportPanel({ name, title, note, byYear, chart, columns, links, showTable = true, maxRows }) {
  const [year, setYear] = useState(byYear ? YEARS[1] : null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    fetch(`/api/reports/${name}${year ? `?year=${year}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setRows)
      .catch(() => setError('Could not load this report.'));
  }, [name, year]);

  const shown = rows && maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <div className="card">
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {byYear && (
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{y}{y === 2026 ? ' (partial)' : ''}</option>)}
          </select>
        )}
      </div>
      {note && <p className="muted" style={{ marginTop: 0 }}>{note}</p>}
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Loading...</p>}
      {rows && chart && <BarChartCard data={(chart.top ? rows.slice(0, chart.top) : rows)} x={chart.x} bars={chart.bars} domain={chart.domain} />}
      {rows && showTable && <DataTable rows={shown} columns={columns} links={links} />}
    </div>
  );
}
