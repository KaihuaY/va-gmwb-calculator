import React from 'react';

function fmt(v) {
  if (v === undefined || v === null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function pct(v) {
  if (v === undefined || v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export default function ProjectionTable({ results, onExport }) {
  if (!results) return null;
  const { av_bands, survival_probs, persistency } = results;

  const rows = av_bands.filter((_, i) => i <= 35 || i % 5 === 0 || i === av_bands.length - 1);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
        <div>
          <div className="text-base font-bold text-slate-800">Year-by-Year Projection</div>
          <div className="text-sm text-slate-500 mt-0.5">Account value percentiles and survival statistics</div>
        </div>
        <button
          onClick={onExport}
          className="text-sm font-semibold px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto" style={{ maxHeight: 480 }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
            <tr className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Year</th>
              <th className="px-4 py-3 text-left">Age</th>
              <th className="px-4 py-3 text-right">Mean AV</th>
              <th className="px-4 py-3 text-right">5th %ile</th>
              <th className="px-4 py-3 text-right">Median</th>
              <th className="px-4 py-3 text-right">95th %ile</th>
              <th className="px-4 py-3 text-right">Survival</th>
              <th className="px-4 py-3 text-right">In-Force</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                <td className="px-4 py-3 font-semibold text-slate-700 tabular-nums">{row.year}</td>
                <td className="px-4 py-3 font-semibold text-slate-700 tabular-nums">{row.age}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">{fmt(row.mean)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-red-500">{fmt(row.p5)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">{fmt(row.median)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-green-600">{fmt(row.p95)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500">{row.year < survival_probs.length ? pct(survival_probs[row.year]) : '—'}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500">{row.year < persistency.length ? pct(persistency[row.year]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
