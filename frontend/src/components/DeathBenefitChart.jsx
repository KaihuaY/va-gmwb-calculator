import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, ReferenceArea, ReferenceLine,
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

function CustomTooltip({ active, payload, label, simple, hasVariance }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const shortfall = Math.max(0, (d.gmdb_median ?? 0) - (d.av_median ?? 0));

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-sm">
      <div className="font-semibold text-slate-700 mb-1.5">Age {label}</div>

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Account Value</div>
      {simple ? (
        <>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Most likely</span><span className="font-mono font-semibold text-blue-700">{fmtCurrency(d.av_median)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-400">Typical range</span><span className="font-mono text-slate-600">{fmtCurrency(d.av_p25)} – {fmtCurrency(d.av_p75)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-400">Unlikely range</span><span className="font-mono text-slate-500">{fmtCurrency(d.av_p5)} – {fmtCurrency(d.av_p95)}</span></div>
        </>
      ) : (
        <>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Median</span><span className="font-mono font-semibold text-blue-700">{fmtCurrency(d.av_median)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-400">5th–95th %ile</span><span className="font-mono text-slate-600">{fmtCurrency(d.av_p5)} – {fmtCurrency(d.av_p95)}</span></div>
        </>
      )}

      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-2 mb-0.5">
        {simple ? 'Guaranteed Death Benefit' : 'GMDB Benefit Base'}
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-slate-500">{hasVariance ? 'Median base' : 'Guarantee base'}</span>
        <span className="font-mono font-semibold text-amber-600">{fmtCurrency(d.gmdb_median)}</span>
      </div>
      {hasVariance && (
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Base range</span>
          <span className="font-mono text-slate-600">{fmtCurrency(d.gmdb_p5)} – {fmtCurrency(d.gmdb_p95)}</span>
        </div>
      )}

      {shortfall > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between gap-4">
          <span className="text-slate-500">{simple ? 'Benefit paid to beneficiaries' : 'Expected shortfall (median)'}</span>
          <span className="font-mono font-semibold text-amber-700">{fmtCurrency(shortfall)}</span>
        </div>
      )}
    </div>
  );
}

export default function DeathBenefitChart({ avBands, gmdbBands, simple = false, lifeExpectancyAge = null }) {
  if (!avBands || !gmdbBands || avBands.length === 0) return null;

  const hasVariance = gmdbBands.some(d => Math.abs((d.p95 || 0) - (d.p5 || 0)) > 1);

  const allChartData = avBands.map((av, idx) => {
    const gb = gmdbBands[idx] || {};
    return {
      age: av.age,
      av_p5: av.p5, av_p25: av.p25, av_median: av.median, av_p75: av.p75, av_p95: av.p95,
      av_outer_base: av.p5,
      av_outer_fill: Math.max(0, av.p95 - av.p5),
      av_inner_base: av.p25,
      av_inner_fill: Math.max(0, av.p75 - av.p25),
      gmdb_median: gb.median,
      gmdb_p5: gb.p5,
      gmdb_p95: gb.p95,
    };
  });

  const { chartHandlers, filterData, xDomain, refArea, isZoomed, reset } = useChartZoom();
  const chartData = filterData(allChartData);

  const ageMin = avBands[0].age;
  const ageMax = avBands[avBands.length - 1].age;
  const avP95Max   = Math.max(...avBands.map(d => d.p95 || 0));
  const gmdbP95Max = Math.max(...gmdbBands.map(d => d.p95 || d.median || 0));
  const yMax = Math.max(avP95Max, gmdbP95Max) * 1.08 || 1;

  const avOuterLabel  = simple ? 'Unlikely AV range (1-in-20)' : 'AV 5th–95th %ile';
  const avInnerLabel  = simple ? 'Typical AV range'            : 'AV 25th–75th %ile';
  const avMedianLabel = simple ? 'Account value (most likely)' : 'AV Median';
  const gmdbLabel     = simple ? 'Guaranteed death benefit'    : 'GMDB BB (median)';

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-sm font-semibold text-slate-700">
          {simple ? 'Death Benefit Coverage' : 'Death Benefit Coverage — GMDB BB vs AV'}
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
          ? 'The amber line is the minimum your beneficiaries receive. When the blue AV falls below it, the insurer covers the gap.'
          : 'Amber line = GMDB benefit base; blue fan = AV distribution. Shortfall (BB − AV) is paid at death when AV < BB.'}
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
            <Tooltip content={<CustomTooltip simple={simple} hasVariance={hasVariance} />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />

            <Area type="monotone" dataKey="av_outer_base" stackId="av_outer"
              stroke="none" fill="transparent" legendType="none" name="av_outer_base" />
            <Area type="monotone" dataKey="av_outer_fill" stackId="av_outer"
              stroke="#93c5fd" strokeWidth={0.5}
              fill="#dbeafe" fillOpacity={0.5} name={avOuterLabel} />

            <Area type="monotone" dataKey="av_inner_base" stackId="av_inner"
              stroke="none" fill="transparent" legendType="none" name="av_inner_base" />
            <Area type="monotone" dataKey="av_inner_fill" stackId="av_inner"
              stroke="#60a5fa" strokeWidth={0.5}
              fill="#93c5fd" fillOpacity={0.6} name={avInnerLabel} />

            <Line type="monotone" dataKey="av_median"
              stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 2"
              dot={false} name={avMedianLabel} />

            {hasVariance && (
              <Line type="monotone" dataKey="gmdb_p5"
                stroke="#fbbf24" strokeWidth={1} strokeDasharray="2 3"
                dot={false} name={simple ? 'Death benefit (low)' : 'GMDB BB 5th %ile'}
                strokeOpacity={0.7} />
            )}
            <Line type="monotone" dataKey="gmdb_median"
              stroke="#d97706" strokeWidth={2.5}
              dot={false} name={gmdbLabel} />
            {hasVariance && (
              <Line type="monotone" dataKey="gmdb_p95"
                stroke="#fbbf24" strokeWidth={1} strokeDasharray="2 3"
                dot={false} name={simple ? 'Death benefit (high)' : 'GMDB BB 95th %ile'}
                strokeOpacity={0.7} />
            )}

            {lifeExpectancyAge && (
              <ReferenceLine
                x={lifeExpectancyAge}
                stroke="#7c3aed"
                strokeDasharray="5 3"
                strokeWidth={1.5}
                label={{ value: `Life exp. ~${lifeExpectancyAge}`, position: 'insideTopRight', fontSize: 10, fill: '#7c3aed' }}
              />
            )}

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
              ? 'The guarantee base grows over time due to roll-up or market step-up — increasing your beneficiaries\' protection.'
              : 'The guarantee base is fixed. Your beneficiaries receive this amount or your account value — whichever is higher.')
          : (hasVariance
              ? 'GMDB BB varies by scenario (step-up active). Shortfall = max(0, BB − AV) paid to beneficiaries at death.'
              : 'GMDB BB is fixed. Shortfall = max(0, BB − AV) paid to beneficiaries at death.')}
        {lifeExpectancyAge && ` Violet line marks median life expectancy (age ${lifeExpectancyAge}).`}
      </p>
    </div>
  );
}
