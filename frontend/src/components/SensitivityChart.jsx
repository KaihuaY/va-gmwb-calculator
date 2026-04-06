import React from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

function fmt(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '+';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function SensitivityChart({ data, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-center h-64">
        <span className="text-sm text-slate-400">Running sensitivity analysis…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-center h-64">
        <span className="text-sm text-slate-400">Click "Run Sensitivity Analysis" to generate the tornado chart.</span>
      </div>
    );
  }

  const { sensitivities, base_net_cost } = data;

  // Show top 8 by absolute impact, sorted
  const top = [...sensitivities].slice(0, 8);

  // Build chart rows: one bar per parameter, showing the up-shift impact
  const chartData = top.map(s => ({
    name: s.parameter,
    up: s.impact_up,
    down: s.impact_down,
    abs: s.abs_impact,
  }));

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-semibold text-slate-700 mb-1">
        Sensitivity Analysis — Impact on PV(Net Cost)
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Each parameter shifted ±10% from baseline. Baseline net cost: <strong>{fmt(base_net_cost).replace('+','')}</strong>.
        Positive bars = net cost increases (worse for insurer); negative bars = net cost decreases.
      </p>

      <ResponsiveContainer width="100%" height={Math.max(260, top.length * 38)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 60, bottom: 5, left: 130 }}
          barCategoryGap="25%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
          <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1} />
          <Tooltip
            formatter={(v, name) => [fmt(v), name === 'up' ? 'Param +10%' : 'Param −10%']}
          />
          <Bar dataKey="up" name="up" radius={[0, 3, 3, 0]}>
            {chartData.map((d, i) => (
              <Cell key={`up-${i}`} fill={d.up >= 0 ? '#fca5a5' : '#86efac'} />
            ))}
          </Bar>
          <Bar dataKey="down" name="down" radius={[0, 3, 3, 0]}>
            {chartData.map((d, i) => (
              <Cell key={`dn-${i}`} fill={d.down >= 0 ? '#fca5a5' : '#86efac'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b">
              <th className="py-1 text-left">Parameter</th>
              <th className="py-1 text-right">Base Value</th>
              <th className="py-1 text-right">+10% Impact</th>
              <th className="py-1 text-right">−10% Impact</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-1 text-slate-700">{s.parameter}</td>
                <td className="py-1 text-right font-mono text-slate-600">
                  {s.base_value < 0.1 ? (s.base_value * 100).toFixed(2) + '%' : s.base_value.toFixed(4)}
                </td>
                <td className={`py-1 text-right font-mono ${s.impact_up >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {fmt(s.impact_up)}
                </td>
                <td className={`py-1 text-right font-mono ${s.impact_down >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {fmt(s.impact_down)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
