'use client';
// Small wrappers around recharts so pages only pass data and keys.
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, ReferenceDot, ReferenceLine,
} from 'recharts';

const AXIS = { stroke: '#aeb9c4', fontSize: 12 };
const GRID = { stroke: '#2f4256', strokeDasharray: '3 3' };
const TOOLTIP = { contentStyle: { background: '#1b2836', border: '1px solid #3a5068', borderRadius: 4, color: '#ece8e1' } };
// Valorant-style: red, teal, amber, violet, green, pink
export const COLORS = ['#ff4655', '#2ed9c3', '#ffc857', '#9b8cff', '#3ddc97', '#ff8fb8'];

// bars: [{ key, name }]
export function BarChartCard({ data, x, bars, height = 260, domain }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey={x} {...AXIS} interval={0} angle={data.length > 8 ? -35 : 0}
               textAnchor={data.length > 8 ? 'end' : 'middle'} height={data.length > 8 ? 60 : 30} />
        <YAxis {...AXIS} domain={domain || ['auto', 'auto']} />
        <Tooltip {...TOOLTIP} />
        {bars.length > 1 && <Legend />}
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.name || b.key} fill={COLORS[i % COLORS.length]}
                                 radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

// A line over a player's maps, with optional alert markers and a reference line
export function LineChartCard({ data, x, y, name, markers = [], reference, height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={x} {...AXIS} />
        <YAxis {...AXIS} domain={['auto', 'auto']} />
        <Tooltip {...TOOLTIP} />
        {reference !== undefined && <ReferenceLine y={reference} stroke="#aeb9c4" strokeDasharray="4 4" />}
        <Line type="monotone" dataKey={y} name={name || y} stroke={COLORS[1]} dot={false} strokeWidth={2}
              isAnimationActive={false} />
        {markers.map((m, i) => (
          <ReferenceDot key={i} x={m.x} y={m.y} r={6} fill={m.direction === 'decline' ? COLORS[0] : COLORS[4]} stroke="none" />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
