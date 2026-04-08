import React from 'react';

function MetricCard({ title, value, subtitle, accentColor }) {
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100">
      <div className="h-1.5" style={{ backgroundColor: accentColor }} />
      <div className="p-5">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{title}</div>
        <div className="text-3xl font-black tabular-nums leading-none" style={{ color: accentColor }}>{value}</div>
        {subtitle && <div className="text-sm text-slate-500 mt-2 leading-snug">{subtitle}</div>}
      </div>
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

export default function ResultsSummary({ results, running, progress, viewMode = 'standard' }) {
  if (running) {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${(progress * 100).toFixed(0)}%` }}
            />
          </div>
          <span className="text-sm font-mono tabular-nums text-slate-500 w-10 text-right">
            {(progress * 100).toFixed(0)}%
          </span>
        </div>
        <div className="text-sm text-slate-400 mt-2">Running Monte Carlo simulation…</div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-5">
        <p className="text-base font-semibold text-blue-800">Ready to run</p>
        <p className="text-sm text-blue-600 mt-1">Click <strong>Run Simulation</strong> to compute present values.</p>
      </div>
    );
  }

  const { claim_stats, gmdb_stats, fee_stats, net_stats, num_scenarios, projection_years } = results;
  const netMean = net_stats.mean;
  const netColor = netMean > 0 ? '#dc2626' : '#16a34a';
  const hasGmdb = gmdb_stats?.mean > 0;

  if (viewMode === 'standard') {
    const netSubtitle = netMean > 0
      ? 'Guarantee pays more than its cost'
      : 'Fees exceed expected guarantee payouts';
    const cols = hasGmdb ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3';
    return (
      <div className={`grid ${cols} gap-4 mb-6`}>
        <MetricCard
          title="Guarantee Value"
          value={fmt(claim_stats.mean)}
          subtitle={`Median ${fmt(claim_stats.median)}`}
          accentColor="#dc2626"
        />
        {hasGmdb && (
          <MetricCard
            title="Death Benefit Value"
            value={fmt(gmdb_stats.mean)}
            subtitle={`Median ${fmt(gmdb_stats.median)}`}
            accentColor="#ea580c"
          />
        )}
        <MetricCard
          title="Total Fees"
          value={fmt(fee_stats.mean)}
          subtitle={`Median ${fmt(fee_stats.median)}`}
          accentColor="#475569"
        />
        <MetricCard
          title="Net Benefit to You"
          value={fmt(netMean)}
          subtitle={netSubtitle}
          accentColor={netColor}
        />
      </div>
    );
  }

  // Advanced mode
  const cols = hasGmdb ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 md:grid-cols-4';
  return (
    <div className={`grid ${cols} gap-4 mb-6`}>
      <MetricCard
        title="PV(GMWB)"
        value={fmt(claim_stats.mean)}
        subtitle={`Median ${fmt(claim_stats.median)}`}
        accentColor="#dc2626"
      />
      {hasGmdb && (
        <MetricCard
          title="PV(GMDB)"
          value={fmt(gmdb_stats.mean)}
          subtitle={`Median ${fmt(gmdb_stats.median)}`}
          accentColor="#ea580c"
        />
      )}
      <MetricCard
        title="PV(Rider Fees)"
        value={fmt(fee_stats.mean)}
        subtitle={`Median ${fmt(fee_stats.median)}`}
        accentColor="#16a34a"
      />
      <MetricCard
        title="Net Cost"
        value={fmt(netMean)}
        subtitle={`95th %ile ${fmt(net_stats.p95)}`}
        accentColor={netColor}
      />
      <MetricCard
        title="Scenarios"
        value={num_scenarios.toLocaleString()}
        subtitle={`${projection_years}-yr projection`}
        accentColor="#6366f1"
      />
    </div>
  );
}
