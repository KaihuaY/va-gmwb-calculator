import React from 'react';

function MetricCard({ title, value, subtitle, color }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{title}</div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
    </div>
  );
}

function fmt(val) {
  if (val === undefined || val === null) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function ResultsSummary({ results, running, progress }) {
  if (running) {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${(progress * 100).toFixed(0)}%` }}
            />
          </div>
          <span className="text-xs w-10 text-right">{(progress * 100).toFixed(0)}%</span>
        </div>
        <div className="text-xs text-slate-400 mt-1">Running Monte Carlo simulation…</div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-600">
        Click <strong>Run Simulation</strong> to compute present values.
      </div>
    );
  }

  const { claim_stats, fee_stats, net_stats, num_scenarios, projection_years } = results;
  const netColor = net_stats.mean > 0 ? '#ef4444' : '#22c55e';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <MetricCard
        title="PV(Claims)"
        value={fmt(claim_stats.mean)}
        subtitle={`Median: ${fmt(claim_stats.median)}`}
        color="#ef4444"
      />
      <MetricCard
        title="PV(Rider Fees)"
        value={fmt(fee_stats.mean)}
        subtitle={`Median: ${fmt(fee_stats.median)}`}
        color="#22c55e"
      />
      <MetricCard
        title="Net Cost"
        value={fmt(net_stats.mean)}
        subtitle={`95th %ile: ${fmt(net_stats.p95)}`}
        color={netColor}
      />
      <MetricCard
        title="Scenarios"
        value={num_scenarios.toLocaleString()}
        subtitle={`${projection_years}-year projection`}
        color="#6366f1"
      />
    </div>
  );
}
