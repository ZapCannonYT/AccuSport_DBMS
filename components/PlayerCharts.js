'use client';
// Form rating over the player's career, and any metric with its CUSUM alerts marked
import { useState } from 'react';
import { LineChartCard } from './Charts';

export default function PlayerCharts({ forms, metrics, alerts }) {
  const watched = metrics.filter((m) => m.code !== 'vlr_rating');
  const [code, setCode] = useState(watched.find((m) => m.code === 'kast_pct')?.code || watched[0]?.code);
  const metric = metrics.find((m) => m.code === code);
  const markers = alerts
    .filter((a) => a.code === code)
    .map((a) => ({ x: a.map, y: metric?.points.find((p) => p.map === a.map)?.value, direction: a.direction }))
    .filter((m) => m.y !== undefined);

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Form rating</h2>
        <p className="muted" style={{ marginTop: 0 }}>Weighted running average of vlr.gg rating x 1000, after each map (x axis = map number).</p>
        <LineChartCard data={forms} x="map" y="form" name="form" reference={1000} />
      </div>
      <div className="card">
        <div className="filters" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Metric and CUSUM alerts</h2>
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            {watched.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Red dot = decline alert, green dot = improve alert.</p>
        {metric && <LineChartCard data={metric.points} x="map" y="value" name={metric.label} markers={markers} />}
      </div>
    </div>
  );
}
