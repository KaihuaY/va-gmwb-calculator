import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

function fmtCurrency(v) {
  if (v === undefined || v === null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Transform av_bands into a format suitable for Recharts Area overlap display.
 *
 * Recharts doesn't natively support "range areas" (band between two values)
 * using standard Area, but we can achieve it by computing:
 *   outer_low  = p5
 *   outer_high = p95 - p5        (rendered as stacked on top of outer_low)
 *   inner_low  = p25 - p5        (invisible filler)
 *   inner_high = p75 - p25       (rendered as stacked, visible band)
 *
 * This uses stackId to create three stacked layers:
 *   1. transparent base (p5)
 *   2. outer band fill  (p95 - p5) — light blue
 *   3. [reset stack]
 *   4. transparent base2 (p25)
 *   5. inner band fill   (p75 - p25) — medium blue
 */
function transformData(avBands) {
  return avBands.map(d => ({
    age: d.age,
    // Outer band (p5 → p95): stacked as [p5 transparent] + [p95-p5 visible]
    outer_base: d.p5,
    outer_fill: Math.max(0, d.p95 - d.p5),
    // Inner band (p25 → p75): separate stack
    inner_base: d.p25,
    inner_fill: Math.max(0, d.p75 - d.p25),
    mean: d.mean,
    median: d.median,
  }));
}

export default function AVFanChart({ data }) {
  if (!data || data.length === 0) return null;
  const chartData = transformData(data);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-semibold text-slate-700 mb-3">
        Account Value Projection — Fan Chart
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="age"
            label={{ value: 'Age', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={v => fmtCurrency(v)}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(v, name) => [fmtCurrency(v), name]}
            labelFormatter={l => `Age ${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />

          {/* Outer band: 5th–95th percentile */}
          <Area
            type="monotone" dataKey="outer_base" stackId="outer"
            stroke="none" fill="transparent" legendType="none" name="5th %ile base"
          />
          <Area
            type="monotone" dataKey="outer_fill" stackId="outer"
            stroke="#93c5fd" strokeWidth={0.5}
            fill="#dbeafe" fillOpacity={0.6} name="5th–95th %ile"
          />

          {/* Inner band: 25th–75th percentile */}
          <Area
            type="monotone" dataKey="inner_base" stackId="inner"
            stroke="none" fill="transparent" legendType="none" name="25th %ile base"
          />
          <Area
            type="monotone" dataKey="inner_fill" stackId="inner"
            stroke="#60a5fa" strokeWidth={0.5}
            fill="#93c5fd" fillOpacity={0.7} name="25th–75th %ile"
          />

          {/* Mean and median lines */}
          <Line type="monotone" dataKey="mean" stroke="#2563eb" strokeWidth={2} dot={false} name="Mean" />
          <Line
            type="monotone" dataKey="median"
            stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3"
            dot={false} name="Median"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-1">
        Shaded bands show 5th–95th percentile (light) and 25th–75th percentile (dark) AV across all scenarios.
      </p>
    </div>
  );
}
