import React from 'react';

function fmt(val) {
  if (val === undefined || val === null) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v) {
  if (v === undefined || v === null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function Delta({ a, b, invert = false }) {
  if (a == null || b == null) return null;
  const diff = b - a;
  if (Math.abs(diff) < 1) return null;
  // For most metrics, higher is better for the policyholder (more guarantee value, less fee = better)
  // invert=true means lower is better (e.g. fees)
  const positive = invert ? diff < 0 : diff > 0;
  const label = diff > 0 ? `+${fmt(diff)}` : fmt(diff);
  return (
    <span className={`ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
      positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
    }`}>
      {label}
    </span>
  );
}

function DeltaPct({ a, b }) {
  if (a == null || b == null) return null;
  const diff = b - a;
  if (Math.abs(diff) < 0.005) return null;
  const label = diff > 0 ? `+${(diff * 100).toFixed(0)}pp` : `${(diff * 100).toFixed(0)}pp`;
  const positive = diff < 0; // lower shortfall probability = better
  return (
    <span className={`ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
      positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
    }`}>
      {label}
    </span>
  );
}

function ScenarioCard({ snapshot, index, isBaseline, onClear }) {
  const { label, results, runParams } = snapshot;
  const { claim_stats, gmdb_stats, fee_stats, net_stats, shortfall_stats, num_scenarios } = results;
  const gmwbEnabled = runParams?.gmwb_enabled ?? true;
  const gmdbEnabled = runParams?.gmdb_enabled ?? false;
  const netColor = net_stats.mean > 0 ? 'text-red-600' : 'text-emerald-700';

  return (
    <div className={`rounded-xl border ${isBaseline ? 'border-blue-300 bg-blue-50/30' : 'border-slate-200 bg-white'} overflow-hidden`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${isBaseline ? 'bg-blue-600' : 'bg-slate-700'}`}>
        <div className="min-w-0">
          <div className="text-xs font-bold text-white/60 uppercase tracking-wide">
            {isBaseline ? 'Baseline' : `Scenario ${index + 1}`}
          </div>
          <div className="text-sm font-bold text-white leading-tight truncate">{label}</div>
        </div>
        <button
          onClick={() => onClear(index)}
          className="flex-shrink-0 text-white/50 hover:text-white ml-3 transition-colors"
          title="Remove snapshot"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Params summary */}
      <div className="px-4 pt-3 pb-2 text-xs text-slate-500 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span>Age: <strong className="text-slate-700">{runParams?.current_age}</strong></span>
        <span>Income at: <strong className="text-slate-700">{runParams?.election_age}</strong></span>
        <span>WD rate: <strong className="text-slate-700">{((runParams?.withdrawal_rate || 0) * 100).toFixed(1)}%</strong></span>
        <span>Roll-up: <strong className="text-slate-700">{((runParams?.rollup_rate || 0) * 100).toFixed(0)}%</strong></span>
        <span>Rider fee: <strong className="text-slate-700">{((runParams?.rider_fee || 0) * 100).toFixed(2)}%</strong></span>
        <span>M&amp;E fee: <strong className="text-slate-700">{((runParams?.me_fee || 0) * 100).toFixed(2)}%</strong></span>
      </div>

      {/* Metrics */}
      <div className="px-4 pb-4 space-y-2 border-t border-slate-100 pt-3 mt-1">
        {gmwbEnabled && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Guarantee Value</span>
            <span className="text-sm font-bold text-red-600 tabular-nums">{fmt(claim_stats.mean)}</span>
          </div>
        )}
        {gmdbEnabled && gmdb_stats?.mean > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Death Benefit Value</span>
            <span className="text-sm font-bold text-orange-600 tabular-nums">{fmt(gmdb_stats.mean)}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">Total Fees</span>
          <span className="text-sm font-bold text-slate-700 tabular-nums">{fmt(fee_stats.mean)}</span>
        </div>
        <div className="flex justify-between items-center border-t border-slate-100 pt-2 mt-1">
          <span className="text-xs font-semibold text-slate-600">Net Benefit</span>
          <span className={`text-sm font-black tabular-nums ${netColor}`}>{fmt(net_stats.mean)}</span>
        </div>
        {shortfall_stats && gmwbEnabled && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Shortfall Risk</span>
            <span className="text-sm font-bold text-slate-700 tabular-nums">{fmtPct(shortfall_stats.prob)}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">Scenarios</span>
          <span className="text-xs text-slate-500 tabular-nums">{num_scenarios?.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// Comparison row showing delta from baseline
function DeltaRow({ label, snapshots, accessor, invertDelta, isPct }) {
  const baseline = accessor(snapshots[0]);
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 px-4 text-xs text-slate-500 font-medium">{label}</td>
      {snapshots.map((s, i) => {
        const val = accessor(s);
        return (
          <td key={i} className="py-2 px-4 text-right text-sm font-semibold tabular-nums text-slate-800">
            {isPct ? fmtPct(val) : fmt(val)}
            {i > 0 && (isPct
              ? <DeltaPct a={baseline} b={val} />
              : <Delta a={baseline} b={val} invert={invertDelta} />
            )}
          </td>
        );
      })}
    </tr>
  );
}

export default function SnapshotComparison({ snapshots, onClearSnapshot, onClearAll }) {
  if (!snapshots || snapshots.length === 0) return null;

  const hasMultiple = snapshots.length >= 2;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm" data-print-hide>
      {/* Header */}
      <div className="px-5 py-3 bg-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Scenario Comparison</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {hasMultiple
              ? 'Deltas shown relative to the baseline (first) scenario'
              : 'Save a second scenario to see side-by-side comparison'}
          </p>
        </div>
        <button
          onClick={onClearAll}
          className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
        >
          Clear all
        </button>
      </div>

      {/* Cards grid */}
      <div className={`p-4 grid gap-4 ${snapshots.length === 1 ? 'grid-cols-1 max-w-sm' : snapshots.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
        {snapshots.map((s, i) => (
          <ScenarioCard
            key={i}
            snapshot={s}
            index={i}
            isBaseline={i === 0}
            onClear={onClearSnapshot}
          />
        ))}
      </div>

      {/* Delta table — only when 2+ snapshots */}
      {hasMultiple && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Metric</th>
                {snapshots.map((s, i) => (
                  <th key={i} className="py-2 px-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wide">
                    {i === 0 ? 'Baseline' : `Scenario ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <DeltaRow label="Guarantee Value" snapshots={snapshots} accessor={s => s.results.claim_stats?.mean} invertDelta={false} />
              <DeltaRow label="Total Fees" snapshots={snapshots} accessor={s => s.results.fee_stats?.mean} invertDelta={true} />
              <DeltaRow label="Net Benefit" snapshots={snapshots} accessor={s => s.results.net_stats?.mean} invertDelta={false} />
              <DeltaRow label="Shortfall Risk" snapshots={snapshots} accessor={s => s.results.shortfall_stats?.prob} invertDelta={false} isPct />
              <DeltaRow label="Net Cost (95th %ile)" snapshots={snapshots} accessor={s => s.results.net_stats?.p95} invertDelta={false} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
