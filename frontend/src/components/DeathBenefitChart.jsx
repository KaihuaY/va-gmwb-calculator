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
 * Shows the GMDB benefit base trajectory against the AV fan chart.
 *
 * The gap between the GMDB BB (amber line) and low AV percentiles (blue bands)
 * is the "protection zone" — what beneficiaries would receive above and beyond AV.
 *
 * If GMDB BB is static, the median line is flat. With roll-up or step-up it grows.
 */
export default function DeathBenefitChart({ avBands, gmdbBands }) {
  if (!avBands || !gmdbBands || avBands.length === 0) return null;

  const chartData = avBands.map((av, idx) => {
    const gb = gmdbBands[idx] || {};
    return {
      age: av.age,
      // AV fan bands
      av_outer_base: av.p5,
      av_outer_fill: Math.max(0, av.p95 - av.p5),
      av_inner_base: av.p25,
      av_inner_fill: Math.max(0, av.p75 - av.p25),
      av_median: av.median,
      // GMDB BB lines
      gmdb_median: gb.median,
      gmdb_p5: gb.p5,
      gmdb_p95: gb.p95,
    };
  });

  // Detect if GMDB BB varies across scenarios (step-up or dynamic)
  const hasVariance = gmdbBands.some(d => Math.abs((d.p95 || 0) - (d.p5 || 0)) > 1);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-semibold text-slate-700 mb-0.5">
        Death Benefit Coverage
      </div>
      <div className="text-xs text-slate-400 mb-3">
        GMDB benefit base vs account value — gap above the base shows beneficiary protection
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

          {/* AV outer band: 5th–95th */}
          <Area
            type="monotone" dataKey="av_outer_base" stackId="av_outer"
            stroke="none" fill="transparent" legendType="none" name="AV 5th %ile base"
          />
          <Area
            type="monotone" dataKey="av_outer_fill" stackId="av_outer"
            stroke="#93c5fd" strokeWidth={0.5}
            fill="#dbeafe" fillOpacity={0.5} name="AV 5th–95th %ile"
          />

          {/* AV inner band: 25th–75th */}
          <Area
            type="monotone" dataKey="av_inner_base" stackId="av_inner"
            stroke="none" fill="transparent" legendType="none" name="AV 25th %ile base"
          />
          <Area
            type="monotone" dataKey="av_inner_fill" stackId="av_inner"
            stroke="#60a5fa" strokeWidth={0.5}
            fill="#93c5fd" fillOpacity={0.6} name="AV 25th–75th %ile"
          />

          {/* AV median */}
          <Line
            type="monotone" dataKey="av_median"
            stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2"
            dot={false} name="AV Median"
          />

          {/* GMDB BB lines — amber/orange to contrast with blue AV */}
          {hasVariance && (
            <Line
              type="monotone" dataKey="gmdb_p5"
              stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 3"
              dot={false} name="GMDB BB 5th %ile" strokeOpacity={0.6}
            />
          )}
          <Line
            type="monotone" dataKey="gmdb_median"
            stroke="#d97706" strokeWidth={2.5}
            dot={false} name="GMDB BB (median)"
          />
          {hasVariance && (
            <Line
              type="monotone" dataKey="gmdb_p95"
              stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 3"
              dot={false} name="GMDB BB 95th %ile" strokeOpacity={0.6}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-1">
        When the amber GMDB base exceeds the blue AV range, beneficiaries receive the guaranteed shortfall at death.
        {hasVariance ? ' BB varies by scenario due to step-up.' : ''}
      </p>
    </div>
  );
}
