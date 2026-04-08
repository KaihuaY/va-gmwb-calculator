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
 * Fan chart of cumulative guaranteed withdrawals over time.
 * Shows total income stream the policyholder is expected to receive
 * across the percentile distribution of scenarios.
 */
export default function CumulativeWithdrawalChart({ data }) {
  if (!data || data.length === 0) return null;

  const chartData = data.map(d => ({
    age: d.age,
    // Outer band: p5 → p95
    outer_base: d.p5,
    outer_fill: Math.max(0, d.p95 - d.p5),
    // Inner band: p25 → p75
    inner_base: d.p25,
    inner_fill: Math.max(0, d.p75 - d.p25),
    mean: d.mean,
    median: d.median,
  }));

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-semibold text-slate-700 mb-0.5">
        Cumulative Guaranteed Withdrawals
      </div>
      <div className="text-xs text-slate-400 mb-3">
        Total guaranteed income received from the GMWB rider over time
      </div>
      <ResponsiveContainer width="100%" height={280}>
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
            stroke="#6ee7b7" strokeWidth={0.5}
            fill="#d1fae5" fillOpacity={0.7} name="5th–95th %ile"
          />

          {/* Inner band: 25th–75th percentile */}
          <Area
            type="monotone" dataKey="inner_base" stackId="inner"
            stroke="none" fill="transparent" legendType="none" name="25th %ile base"
          />
          <Area
            type="monotone" dataKey="inner_fill" stackId="inner"
            stroke="#34d399" strokeWidth={0.5}
            fill="#6ee7b7" fillOpacity={0.8} name="25th–75th %ile"
          />

          <Line type="monotone" dataKey="mean" stroke="#059669" strokeWidth={2} dot={false} name="Mean" />
          <Line
            type="monotone" dataKey="median"
            stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3"
            dot={false} name="Median"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-1">
        Cumulative sum of guaranteed annual withdrawals (GAW) paid. Scenarios diverge based on when AV is exhausted.
      </p>
    </div>
  );
}
