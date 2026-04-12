import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export default function ClaimHistogram({ data }) {
  if (!data || data.length === 0) return null;

  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-semibold text-slate-700 mb-3">PV(Claims) Distribution</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9 }}
            interval={Math.floor(data.length / 6)}
            label={{ value: 'PV(Claims)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            label={{ value: 'Scenarios', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11 } }}
          />
          <Tooltip
            formatter={(v) => [`${v} (${((v / total) * 100).toFixed(1)}%)`, 'Count']}
            labelFormatter={(_, payload) => {
              if (payload && payload[0]) {
                const d = payload[0].payload;
                const fmt = v => {
                  const abs = Math.abs(v);
                  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
                  return `$${(v / 1e3).toFixed(1)}K`;
                };
                return `${fmt(d.bin_start)} – ${fmt(d.bin_end)}`;
              }
              return '';
            }}
          />
          <Bar dataKey="count" fill="#ef4444" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
