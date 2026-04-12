import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, ReferenceArea,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import useChartZoom from './useChartZoom';

function fmtCurrency(v) {
  if (v === undefined || v === null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function SimpleTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-sm">
      <div className="font-semibold text-slate-700 mb-1.5">Age {label} — Total received</div>
      <div className="flex justify-between gap-4"><span className="text-slate-500">Most likely</span><span className="font-mono font-semibold">{fmtCurrency(d.median)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-400">Typical range</span><span className="font-mono text-slate-600">{fmtCurrency(d.p25)} – {fmtCurrency(d.p75)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-400">Unlikely range</span><span className="font-mono text-slate-500">{fmtCurrency(d.p5)} – {fmtCurrency(d.p95)}</span></div>
    </div>
  );
}

function AdvancedTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-sm">
      <div className="font-semibold text-slate-700 mb-1.5">Age {label}</div>
      <div className="flex justify-between gap-4"><span className="text-slate-500">Mean</span><span className="font-mono font-semibold">{fmtCurrency(d.mean)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-500">Median</span><span className="font-mono font-semibold">{fmtCurrency(d.median)}</span></div>
      <div className="flex justify-between gap-4 mt-1"><span className="text-slate-400">5th %ile</span><span className="font-mono text-slate-600">{fmtCurrency(d.p5)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-slate-400">95th %ile</span><span className="font-mono text-slate-600">{fmtCurrency(d.p95)}</span></div>
    </div>
  );
}

export default function CumulativeWithdrawalChart({ data, simple = false }) {
  if (!data || data.length === 0) return null;

  const hasVariance = data.some(d => Math.abs((d.p95 ?? 0) - (d.p5 ?? 0)) > 1);

  const allChartData = data.map(d => ({
    age: d.age,
    median: d.median,
    mean: d.mean,
    p5: d.p5, p25: d.p25, p75: d.p75, p95: d.p95,
    outer_base: d.p5,
    outer_fill: Math.max(0, d.p95 - d.p5),
    inner_base: d.p25,
    inner_fill: Math.max(0, d.p75 - d.p25),
  }));

  const { chartHandlers, filterData, xDomain, refArea, isZoomed, reset } = useChartZoom();
  const chartData = filterData(allChartData);

  const ageMin = data[0].age;
  const ageMax = data[data.length - 1].age;
  const yMax   = Math.max(...data.map(d => d.p95 || 0)) * 1.08 || 1;

  const outerBandName  = simple ? 'Unlikely range (1-in-20)'   : '5th–95th %ile';
  const innerBandName  = simple ? 'Typical range (middle half)' : '25th–75th %ile';
  const medianLineName = simple ? 'Most likely outcome'         : 'Median';

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-sm font-semibold text-slate-700">
          {simple ? 'Guaranteed Income Over Time' : 'Cumulative Guaranteed Withdrawals'}
        </div>
        {isZoomed && (
          <button onClick={reset}
            className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-0.5 rounded border border-blue-200 hover:border-blue-400 transition-colors">
            Reset zoom
          </button>
        )}
      </div>
      <div className="text-xs text-slate-400 mb-2">
        {simple
          ? 'Total withdrawals you are guaranteed to receive, cumulative by age'
          : 'Total guaranteed income received from the GMWB rider over time'}
        {!isZoomed && <span className="italic ml-2">· Drag to zoom</span>}
      </div>
      <div style={{ userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 20 }}
            style={{ cursor: 'crosshair' }} {...chartHandlers}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="age"
              type="number"
              domain={xDomain ?? [ageMin, ageMax]}
              label={{ value: 'Age', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickFormatter={v => fmtCurrency(v)}
              tick={{ fontSize: 11 }}
              domain={[0, yMax]}
            />
            <Tooltip content={simple ? <SimpleTooltip /> : <AdvancedTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />

            <Area type="monotone" dataKey="outer_base" stackId="outer"
              stroke="none" fill="transparent" legendType="none" name="outer_base" />
            <Area type="monotone" dataKey="outer_fill" stackId="outer"
              stroke="#6ee7b7" strokeWidth={0.5}
              fill="#d1fae5" fillOpacity={0.7} name={outerBandName} />

            <Area type="monotone" dataKey="inner_base" stackId="inner"
              stroke="none" fill="transparent" legendType="none" name="inner_base" />
            <Area type="monotone" dataKey="inner_fill" stackId="inner"
              stroke="#34d399" strokeWidth={0.5}
              fill="#6ee7b7" fillOpacity={0.8} name={innerBandName} />

            {!simple && (
              <Line type="monotone" dataKey="mean"
                stroke="#059669" strokeWidth={2} dot={false} name="Mean" />
            )}
            <Line type="monotone" dataKey="median"
              stroke="#059669"
              strokeWidth={simple ? 2 : 1.5}
              strokeDasharray={simple ? undefined : '5 3'}
              dot={false} name={medianLineName} />

            {refArea && (
              <ReferenceArea x1={refArea.x1} x2={refArea.x2}
                fill="#6366f1" fillOpacity={0.12} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-slate-400 mt-1">
        {simple
          ? (hasVariance
              ? 'The wider range shows scenarios where your benefit base locked in market highs, boosting your annual withdrawal.'
              : 'Your annual withdrawal is fixed by your contract — income is the same regardless of market performance.')
          : (hasVariance
              ? 'Scenarios diverge where step-up ratchets the benefit base to a higher AV, increasing GAW.'
              : 'All scenarios converge to the same line — GAW is deterministic without step-up.')}
      </p>
    </div>
  );
}
