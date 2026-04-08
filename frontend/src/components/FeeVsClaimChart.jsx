import React from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function fmt(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function FeeVsClaimChart({ claimStats, feeStats, gmdbStats }) {
  if (!claimStats || !feeStats) return null;

  const hasGmdb = gmdbStats?.mean > 0;
  const totalClaims = claimStats.mean + (hasGmdb ? gmdbStats.mean : 0);
  const netMean = totalClaims - feeStats.mean;

  const data = [
    { name: 'PV(Rider Fees)', value: feeStats.mean, fill: '#22c55e' },
    { name: 'PV(GMWB)', value: claimStats.mean, fill: '#ef4444' },
    ...(hasGmdb ? [{ name: 'PV(GMDB)', value: gmdbStats.mean, fill: '#f97316' }] : []),
    { name: 'Net Cost', value: netMean, fill: netMean > 0 ? '#ef4444' : '#22c55e' },
  ];

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-semibold text-slate-700 mb-3">
        Fee Income vs. Claim Cost (Mean)
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 90 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
          <Tooltip formatter={v => [fmt(v), 'Mean PV']} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-1">
        {netMean > 0
          ? `Net cost is positive: guarantee costs exceed rider fee income on average (${fmt(netMean)}).`
          : `Net cost is negative: rider fee income exceeds expected claim costs on average (${fmt(netMean)}).`}
      </p>
    </div>
  );
}
