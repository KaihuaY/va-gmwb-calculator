import React from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts'

function fmtDollar(v) {
  if (!v && v !== 0) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toFixed(0)}`
}

function fmtDollarFull(v) {
  if (!v && v !== 0) return '—'
  return '$' + Math.round(v).toLocaleString()
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const pv = payload[0]?.value
  const gaw = payload[0]?.payload?.annual_gaw
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-md text-sm">
      <div className="font-semibold text-slate-700 mb-1">Age {label}</div>
      <div className="text-blue-600">PV(Guarantee): {fmtDollar(pv)}</div>
      {gaw != null && (
        <div className="text-slate-500">Annual Income: {fmtDollarFull(gaw)}</div>
      )}
    </div>
  )
}

export default function OptimalAgeChart({ data, currentElectionAge, onApplyAge, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center h-64">
        <span className="text-sm text-slate-400">Analyzing withdrawal ages…</span>
      </div>
    )
  }

  if (!data) return null

  const {
    sweep,
    optimal_age,
    optimal_pv_gmwb,
    optimal_annual_gaw,
    current_election_age,
    current_pv_gmwb,
  } = data

  const alreadyOptimal = optimal_age === current_election_age

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-slate-700">Optimal Withdrawal Start Age</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Sweeps every possible start age and finds which locks in the highest lifetime guarantee value.
            {' '}Rate is locked at the band covering each candidate age.
          </div>
        </div>
      </div>
      <div className="px-5 py-4">
        {/* Summary row */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {alreadyOptimal ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
              <span className="text-emerald-600 font-bold text-sm">✓</span>
              <span className="text-xs text-emerald-700 font-medium">Age {optimal_age} is already your optimal start age</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-emerald-700 font-medium">Optimal Start Age</span>
                <span className="text-sm font-bold text-emerald-700">{optimal_age}</span>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-slate-500 font-medium">vs. Current Age {current_election_age}</span>
                <span className={`text-sm font-bold ${optimal_pv_gmwb > current_pv_gmwb ? 'text-emerald-600' : 'text-red-600'}`}>
                  {optimal_pv_gmwb > current_pv_gmwb ? '+' : ''}{fmtDollar(optimal_pv_gmwb - current_pv_gmwb)}
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500 font-medium">Annual Income at {optimal_age}</span>
            <span className="text-sm font-bold text-slate-700">{fmtDollarFull(optimal_annual_gaw)}</span>
          </div>
          {!alreadyOptimal && (
            <button
              onClick={() => onApplyAge(optimal_age)}
              className="ml-auto text-xs bg-blue-600 text-white font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
              title="Sets start age to the optimal value and re-runs the simulation"
            >
              Apply Age {optimal_age} &amp; Re-run
            </button>
          )}
        </div>

        {/* Line chart */}
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={sweep} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="election_age"
              label={{ value: 'Withdrawal Start Age', position: 'insideBottom', offset: -12, fontSize: 11, fill: '#94a3b8' }}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
            />
            <YAxis
              tickFormatter={fmtDollar}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              label={{ value: 'PV(Guarantee Value)', angle: -90, position: 'insideLeft', offset: 12, fontSize: 11, fill: '#94a3b8' }}
              width={64}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
              formatter={() => 'Guarantee Value (PV)'}
            />
            <ReferenceLine
              x={current_election_age}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              label={{ value: 'Current', position: 'top', fontSize: 10, fill: '#f59e0b' }}
            />
            <ReferenceDot
              x={optimal_age}
              y={optimal_pv_gmwb}
              r={6}
              fill="#059669"
              stroke="#fff"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="pv_gmwb"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              name="Guarantee Value (PV)"
            />
          </LineChart>
        </ResponsiveContainer>

        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
          Each age uses 500 scenarios for speed — the relative ranking is stable, though absolute values
          may differ slightly from a full run. Annual time-step is used regardless of your frequency setting.
          When age-banded rates are active, the rate locking in at each candidate age is used (e.g.,
          electing at 67 locks in 5% even if a 7% band kicks in at 70).
        </p>
      </div>
    </div>
  )
}
