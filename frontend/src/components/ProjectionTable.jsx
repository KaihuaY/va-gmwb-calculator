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
  return `${(v * 100).toFixed(2)}%`;
}

export default function ProjectionTable({ results, onExport }) {
  if (!results) return null;
  const { av_bands, survival_probs, persistency } = results;

  // Sample rows: every year up to 35, then every 5 years
  const rows = av_bands.filter((_, i) => i <= 35 || i % 5 === 0 || i === av_bands.length - 1);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-700">Projection Summary (by Year)</div>
        <button
          onClick={onExport}
          className="text-xs px-3 py-1 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 transition-colors"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto" style={{ maxHeight: 440 }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="py-1.5 text-left font-semibold">Yr</th>
              <th className="py-1.5 text-left font-semibold">Age</th>
              <th className="py-1.5 text-right font-semibold">Mean AV</th>
              <th className="py-1.5 text-right font-semibold">5th %ile</th>
              <th className="py-1.5 text-right font-semibold">Median</th>
              <th className="py-1.5 text-right font-semibold">95th %ile</th>
              <th className="py-1.5 text-right font-semibold">Survival</th>
              <th className="py-1.5 text-right font-semibold">In-Force</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1 text-slate-600">{row.year}</td>
                <td className="py-1 text-slate-600">{row.age}</td>
                <td className="py-1 text-right font-mono text-slate-800">{fmt(row.mean)}</td>
                <td className="py-1 text-right font-mono text-red-500">{fmt(row.p5)}</td>
                <td className="py-1 text-right font-mono text-slate-800">{fmt(row.median)}</td>
                <td className="py-1 text-right font-mono text-green-600">{fmt(row.p95)}</td>
                <td className="py-1 text-right font-mono text-slate-600">
                  {row.year < survival_probs.length ? pct(survival_probs[row.year]) : '—'}
                </td>
                <td className="py-1 text-right font-mono text-slate-600">
                  {row.year < persistency.length ? pct(persistency[row.year]) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
