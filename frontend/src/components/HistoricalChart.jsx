import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, CartesianGrid,
} from 'recharts';

// ---------------------------------------------------------------------------
// HistoricalChart — single-path AV trajectory under actual market history
// (replaces AVFanChart when engine = 'historical')
// ---------------------------------------------------------------------------

function fmt(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Major market stress events to annotate when in range.
const EVENTS = [
  { year: '1987', label: 'Black Monday' },
  { year: '2000', label: 'Dotcom peak' },
  { year: '2008', label: 'GFC' },
  { year: '2020', label: 'COVID' },
];

export default function HistoricalChart({ result, runParams }) {
  if (!result || !result.av_path) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 text-center text-sm text-slate-400">
        Run a historical replay to see the AV trajectory.
      </div>
    );
  }

  const { av_path, bb_path, year_labels, claim_pv, fee_pv, net, depletion_age, history_truncated, projection_years, start_month, end_month, annual_income } = result;

  const showBB = Array.isArray(bb_path) && (runParams?.gmwb_enabled ?? true);
  const data = av_path.map((av, i) => ({
    label: year_labels[i] || String(i),
    av,
    ...(showBB ? { bb: bb_path[i] } : {}),
  }));

  // Election age vertical marker (where withdrawals begin)
  const electionYear = year_labels[Math.max(0, (runParams.election_age ?? 0) - (runParams.current_age ?? 0))] || null;

  // Filter events to those that fall within the displayed range
  const displayedYears = new Set(year_labels);
  const visibleEvents = EVENTS.filter(e => displayedYears.has(e.year));

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-700">Account Value vs. Benefit Base — Historical Replay</div>
          <div className="text-xs text-slate-500 mt-0.5">
            S&amp;P 500 returns from {start_month} to {end_month} ({projection_years} yrs)
            {history_truncated && <span className="text-amber-600 ml-2">· truncated by available history</span>}
          </div>
          {showBB && (
            <div className="flex gap-4 mt-1.5 text-[11px]">
              <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-blue-700"></span><span className="text-slate-600">Account Value</span></span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-amber-600 border-dashed"></span><span className="text-slate-600">Benefit Base (guaranteed notional)</span></span>
            </div>
          )}
        </div>
        <div className="flex gap-3 text-xs">
          <div>
            <span className="text-slate-400">Net:</span>{' '}
            <span className={`font-bold tabular-nums ${net > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt(net)}</span>
          </div>
          <div>
            <span className="text-slate-400">Income:</span>{' '}
            <span className="font-bold tabular-nums text-slate-700">{fmt(annual_income)}/yr</span>
          </div>
          {depletion_age && (
            <div>
              <span className="text-slate-400">Depleted at:</span>{' '}
              <span className="font-bold tabular-nums text-amber-700">age {depletion_age}</span>
            </div>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={32} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v, name) => [fmt(v), name === 'bb' ? 'Benefit Base' : 'Account Value']}
            labelFormatter={(l) => `Year ${l}`}
            contentStyle={{ fontSize: '12px', borderRadius: '6px' }}
          />
          {electionYear && (
            <ReferenceLine x={electionYear} stroke="#0ea5e9" strokeDasharray="4 4" label={{ value: 'Income starts', position: 'insideTopRight', fontSize: 10, fill: '#0369a1' }} />
          )}
          {visibleEvents.map(e => (
            <ReferenceLine key={e.year} x={e.year} stroke="#94a3b8" strokeDasharray="2 2"
              label={{ value: e.label, position: 'insideTop', fontSize: 9, fill: '#64748b' }} />
          ))}
          {showBB && (
            <Line type="monotone" dataKey="bb" stroke="#d97706" strokeWidth={1.75} strokeDasharray="5 4" dot={false} name="bb" />
          )}
          <Line type="monotone" dataKey="av" stroke="#1d4ed8" strokeWidth={2.5} dot={false} name="av" />
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
          <div className="text-slate-400 uppercase tracking-wide font-bold text-[10px]">PV(Guarantee)</div>
          <div className="text-base font-black tabular-nums text-slate-700">{fmt(claim_pv)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
          <div className="text-slate-400 uppercase tracking-wide font-bold text-[10px]">PV(Fees)</div>
          <div className="text-base font-black tabular-nums text-slate-700">{fmt(fee_pv)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
          <div className="text-slate-400 uppercase tracking-wide font-bold text-[10px]">Net</div>
          <div className={`text-base font-black tabular-nums ${net > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt(net)}</div>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
        Single deterministic path — what your contract <em>would have</em> done if invested in the S&amp;P 500 from {start_month}.
        Mortality, lapse, and fees applied identically to Monte Carlo mode; only market returns differ.
      </div>
    </div>
  );
}
