import React from 'react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

// ---------------------------------------------------------------------------
// Parameter catalogue — mirrors backend SHIFTABLE, grouped by category
// ---------------------------------------------------------------------------
const PARAM_GROUPS = [
  {
    id: 'economic',
    label: 'Economic assumptions',
    description: 'Market and discount rate uncertainty',
    params: [
      { field: 'mu',            label: 'Expected Return (μ)' },
      { field: 'sigma',         label: 'Volatility (σ)' },
      { field: 'discount_rate', label: 'Discount Rate' },
    ],
  },
  {
    id: 'behavioral',
    label: 'Behavioral assumptions',
    description: 'How policyholders behave',
    params: [
      { field: 'lapse_rate',          label: 'Lapse Rate' },
      { field: 'lapse_sensitivity',   label: 'Lapse Sensitivity', note: 'only relevant when dynamic lapse is on' },
      { field: 'benefit_utilization', label: 'Benefit Utilization' },
      { field: 'mort_multiplier',     label: 'Mortality Multiplier' },
    ],
  },
  {
    id: 'contract',
    label: 'Contract terms',
    description: 'Factual policy terms — useful for product design, not uncertainty',
    params: [
      { field: 'withdrawal_rate',  label: 'Withdrawal Rate' },
      { field: 'rider_fee',        label: 'GMWB Rider Fee' },
      { field: 'me_fee',           label: 'M&E Fee' },
      { field: 'gmdb_rider_fee',   label: 'GMDB Rider Fee' },
      { field: 'rollup_rate',      label: 'GMWB Roll-up Rate' },
      { field: 'fixed_account_rate', label: 'Fixed SA Rate' },
    ],
  },
];

const ALL_FIELDS = PARAM_GROUPS.flatMap(g => g.params.map(p => p.field));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '+';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Parameter selection panel
// ---------------------------------------------------------------------------
const GROUP_COLORS = {
  economic:   'bg-blue-50 border-blue-200 text-blue-700',
  behavioral: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  contract:   'bg-amber-50 border-amber-200 text-amber-700',
};

function SelectionPanel({ selectedFields, onFieldsChange, onRun, loading, simulationRunning }) {
  const toggle = (field) => {
    onFieldsChange(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    );
  };

  const toggleGroup = (group) => {
    const groupFields = group.params.map(p => p.field);
    const allSelected = groupFields.every(f => selectedFields.includes(f));
    if (allSelected) {
      onFieldsChange(prev => prev.filter(f => !groupFields.includes(f)));
    } else {
      onFieldsChange(prev => [...new Set([...prev, ...groupFields])]);
    }
  };

  const selectAll  = () => onFieldsChange(ALL_FIELDS);
  const selectNone = () => onFieldsChange([]);

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-700">Select parameters to stress-test</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {selectedFields.length} of {ALL_FIELDS.length} selected
            {selectedFields.length === 0 && (
              <span className="ml-1.5 text-amber-600 font-medium">— select at least one to run</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2 text-xs">
            <button onClick={selectAll}  className="text-slate-500 hover:text-slate-700 underline">All</button>
            <button onClick={selectNone} className="text-slate-500 hover:text-slate-700 underline">None</button>
          </div>
          <button
            onClick={onRun}
            disabled={loading || simulationRunning || selectedFields.length === 0}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {loading ? 'Running…' : 'Run Sensitivity'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {PARAM_GROUPS.map(group => {
          const groupFields = group.params.map(p => p.field);
          const selectedCount = groupFields.filter(f => selectedFields.includes(f)).length;
          const allSelected = selectedCount === groupFields.length;
          const colorCls = GROUP_COLORS[group.id];

          return (
            <div key={group.id} className={`rounded-lg border p-3 ${colorCls}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide">{group.label}</span>
                  <span className="ml-2 text-xs font-normal opacity-70">— {group.description}</span>
                </div>
                <button
                  onClick={() => toggleGroup(group)}
                  className="text-xs underline opacity-60 hover:opacity-100 flex-shrink-0 ml-2"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.params.map(({ field, label, note }) => (
                  <label
                    key={field}
                    className="flex items-center gap-1.5 cursor-pointer bg-white/60 hover:bg-white/90 rounded-md px-2.5 py-1 text-xs font-medium transition-colors select-none"
                    title={note}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.includes(field)}
                      onChange={() => toggle(field)}
                      className="rounded"
                    />
                    {label}
                    {note && <span className="text-slate-400 font-normal italic">*</span>}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400 mt-2.5">
        * Lapse Sensitivity only has impact when dynamic lapse is enabled.
        Contract terms are fixed by policy — stress-test them to explore product design trade-offs.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main chart component
// ---------------------------------------------------------------------------
export default function SensitivityChart({ data, loading, selectedFields, onFieldsChange, onRun, simulationRunning }) {
  return (
    <div>
      <SelectionPanel
        selectedFields={selectedFields}
        onFieldsChange={onFieldsChange}
        onRun={onRun}
        loading={loading}
        simulationRunning={simulationRunning}
      />

      {loading && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-center h-48">
          <span className="text-sm text-slate-500">Running sensitivity analysis…</span>
        </div>
      )}

      {!loading && !data && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-center h-48">
          <span className="text-sm text-slate-400">
            {selectedFields.length === 0
              ? 'Select at least one parameter above, then click "Run Sensitivity Analysis".'
              : 'Click "Run Sensitivity Analysis" in the sidebar to generate the tornado chart.'}
          </span>
        </div>
      )}

      {!loading && data && (() => {
        const { base_net_cost } = data;
        // Only display rows for fields that were selected when this run was triggered
        const sensitivities = (data.sensitivities ?? []).filter(s => selectedFields.includes(s.field));
        if (!sensitivities || sensitivities.length === 0) {
          return (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-center h-48">
              <span className="text-sm text-slate-400">No results — re-run after selecting parameters.</span>
            </div>
          );
        }

        const chartData = sensitivities.map(s => ({
          name: s.parameter,
          field: s.field,
          category: s.category,
          up: s.impact_up,
          down: s.impact_down,
          abs: s.abs_impact,
        }));

        const BAR_COLORS = {
          economic:   { pos: '#bfdbfe', neg: '#bbf7d0' },
          behavioral: { pos: '#a7f3d0', neg: '#d9f99d' },
          contract:   { pos: '#fde68a', neg: '#d9f99d' },
        };

        return (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <div className="text-sm font-semibold text-slate-700 mb-1">
              Sensitivity Analysis — Impact on PV(Net Cost)
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Each parameter shifted ±10% from baseline. Baseline net cost:{' '}
              <strong>{fmt(base_net_cost).replace('+', '')}</strong>.
              Positive bars = cost increases (worse for insurer); negative = cost decreases.
            </p>

            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 44)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 60, bottom: 5, left: 140 }}
                barCategoryGap="25%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1} />
                <Tooltip formatter={(v, name) => [fmt(v), name === 'up' ? 'Param +10%' : 'Param −10%']} />
                <Bar dataKey="up" name="up" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={`up-${i}`} fill={d.up >= 0 ? '#fca5a5' : '#6ee7b7'} />
                  ))}
                </Bar>
                <Bar dataKey="down" name="down" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={`dn-${i}`} fill={d.down >= 0 ? '#fca5a5' : '#6ee7b7'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b">
                    <th className="py-1 text-left">Parameter</th>
                    <th className="py-1 text-left">Category</th>
                    <th className="py-1 text-right">Base Value</th>
                    <th className="py-1 text-right">+10% Impact</th>
                    <th className="py-1 text-right">−10% Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {sensitivities.map((s, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1 text-slate-700">{s.parameter}</td>
                      <td className="py-1">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          s.category === 'economic'   ? 'bg-blue-100 text-blue-700' :
                          s.category === 'behavioral' ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-amber-100 text-amber-700'
                        }`}>
                          {s.category}
                        </span>
                      </td>
                      <td className="py-1 text-right font-mono text-slate-600">
                        {s.base_value < 0.1 ? (s.base_value * 100).toFixed(2) + '%' : s.base_value.toFixed(4)}
                      </td>
                      <td className={`py-1 text-right font-mono ${s.impact_up >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {fmt(s.impact_up)}
                      </td>
                      <td className={`py-1 text-right font-mono ${s.impact_down >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {fmt(s.impact_down)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
