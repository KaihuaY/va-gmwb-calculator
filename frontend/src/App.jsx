import React, { useState, useCallback, useRef, useEffect } from 'react';
import InputPanel from './components/InputPanel';
import ResultsSummary from './components/ResultsSummary';
import AVFanChart from './components/AVFanChart';
import CumulativeWithdrawalChart from './components/CumulativeWithdrawalChart';
import DeathBenefitChart from './components/DeathBenefitChart';
import ClaimHistogram from './components/ClaimHistogram';
import FeeVsClaimChart from './components/FeeVsClaimChart';
import ProjectionTable from './components/ProjectionTable';
import SensitivityChart from './components/SensitivityChart';
import Methodology from './components/Methodology';
import { simulate, sensitivity } from './api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDollar(v) {
  if (v === undefined || v === null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Default parameter state — matches SimulateRequest Pydantic model
// ---------------------------------------------------------------------------
const DEFAULT_PARAMS = {
  current_age: 65,
  gender: 'male',
  max_age: 100,
  mortality_table: '2012iam',
  mort_multiplier: 1.0,
  account_value: 500000,
  gmwb_enabled: true,
  benefit_base: 500000,
  election_age: 65,
  withdrawal_rate: 0.05,
  rider_fee: 0.01,
  gmdb_enabled: false,
  gmdb_benefit_base: 500000,
  gmdb_rider_fee: 0.005,
  gmdb_rollup_rate: 0.0,
  gmdb_step_up: false,
  me_fee: 0.014,
  rollup_rate: 0.0,
  step_up: false,
  mu: 0.07,
  sigma: 0.18,
  discount_rate: 0.04,
  frequency: 'annual',
  fixed_account_pct: 0.0,
  fixed_account_rate: 0.03,
  lapse_rate: 0.03,
  benefit_utilization: 1.0,
  dynamic_lapse: false,
  lapse_sensitivity: 0.5,
  lapse_min_multiplier: 0.1,
  num_scenarios: 1000,
  seed: 42,
};

const TABS = [
  { id: 'charts',      label: 'Charts' },
  { id: 'table',       label: 'Projection Table' },
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'methodology', label: 'Methodology' },
];

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------
function exportCSV(results) {
  const { av_bands, survival_probs, persistency } = results;
  const header = ['Year', 'Age', 'Mean_AV', 'P5_AV', 'P25_AV', 'Median_AV', 'P75_AV', 'P95_AV', 'Survival', 'InForce'];
  const rows = av_bands.map((r, i) => [
    r.year, r.age,
    r.mean.toFixed(2), r.p5.toFixed(2), r.p25.toFixed(2),
    r.median.toFixed(2), r.p75.toFixed(2), r.p95.toFixed(2),
    i < survival_probs.length ? survival_probs[i].toFixed(6) : '',
    i < persistency.length ? persistency[i].toFixed(6) : '',
  ]);
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gmwb_projection.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [results, setResults] = useState(null);
  const [sensitivityData, setSensitivityData] = useState(null);
  const [running, setRunning] = useState(false);
  const [sensitivityRunning, setSensitivityRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('charts');
  const [viewMode, setViewMode] = useState('standard');

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const resizing = useRef(false);
  const dragStart = useRef({ x: 0, width: 0 });

  const startResize = useCallback((e) => {
    resizing.current = true;
    dragStart.current = { x: e.clientX, width: sidebarWidth };
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizing.current) return;
      const dx = e.clientX - dragStart.current.x;
      setSidebarWidth(Math.max(220, Math.min(520, dragStart.current.width + dx)));
    };
    const onUp = () => { resizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const setParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setProgress(0.1);
    try {
      // Simulate progress ticks while waiting for the API
      const ticker = setInterval(() => {
        setProgress(p => Math.min(p + 0.04, 0.9));
      }, 200);
      const res = await simulate(params);
      clearInterval(ticker);
      setProgress(1);
      setResults(res);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Simulation failed. Is the backend running?');
    } finally {
      setRunning(false);
    }
  }, [params]);

  const handleSensitivity = useCallback(async () => {
    setSensitivityRunning(true);
    setError(null);
    try {
      const res = await sensitivity(params, 0.10);
      setSensitivityData(res);
      setActiveTab('sensitivity');
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Sensitivity analysis failed.');
    } finally {
      setSensitivityRunning(false);
    }
  }, [params]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* LEFT SIDEBAR */}
      <div
        style={{ width: sidebarWidth }}
        className="relative bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden flex-shrink-0"
      >
        <div className="flex-1 overflow-y-auto p-5">
          <InputPanel
            params={params}
            setParam={setParam}
            onRun={handleRun}
            onSensitivity={handleSensitivity}
            running={running}
            sensitivityRunning={sensitivityRunning}
            viewMode={viewMode}
            setViewMode={setViewMode}
          />
        </div>
        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500 active:bg-blue-400 transition-colors z-10"
          title="Drag to resize"
        />
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error banner */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* Summary metric cards + progress */}
          <ResultsSummary results={results} running={running} progress={progress} viewMode={viewMode} />

          {/* Tab bar */}
          <div className="flex gap-1 mb-6 border-b-2 border-slate-200">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-0.5 transition-colors ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-blue-600'
                    : 'text-slate-400 border-transparent hover:text-slate-600 hover:border-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'charts' && results && (
            <div className="space-y-4">
              <AVFanChart data={results.av_bands} />
              {/* Rider-specific charts — only rendered when the rider is active */}
              {(params.gmwb_enabled || params.gmdb_enabled) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {params.gmwb_enabled && results.cw_bands && (
                    <CumulativeWithdrawalChart data={results.cw_bands} />
                  )}
                  {params.gmdb_enabled && results.gmdb_bb_bands && (
                    <DeathBenefitChart avBands={results.av_bands} gmdbBands={results.gmdb_bb_bands} />
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ClaimHistogram data={results.histogram} />
                <FeeVsClaimChart claimStats={results.claim_stats} feeStats={results.fee_stats} gmdbStats={results.gmdb_stats} />
              </div>
            </div>
          )}

          {activeTab === 'charts' && !results && !running && (
            <div className="text-sm text-slate-400 text-center py-16">
              Run the simulation to see charts.
            </div>
          )}

          {activeTab === 'table' && (
            <ProjectionTable results={results} onExport={() => results && exportCSV(results)} />
          )}

          {activeTab === 'sensitivity' && (
            <SensitivityChart data={sensitivityData} loading={sensitivityRunning} />
          )}

          {activeTab === 'methodology' && <Methodology />}

          {/* Inline statistics detail (shown under charts tab when results available) */}
          {activeTab === 'charts' && results && (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(viewMode === 'standard' ? [
                { title: 'Guarantee Value', stats: results.claim_stats },
                ...(results.gmdb_stats?.mean > 0 ? [{ title: 'Death Benefit Value', stats: results.gmdb_stats }] : []),
                { title: 'Total Fees', stats: results.fee_stats },
              ] : [
                { title: 'PV(GMWB) Statistics', stats: results.claim_stats },
                ...(results.gmdb_stats?.mean > 0 ? [{ title: 'PV(GMDB) Statistics', stats: results.gmdb_stats }] : []),
                { title: 'PV(Fees) Statistics', stats: results.fee_stats },
                { title: 'Net Cost Statistics', stats: results.net_stats },
              ]).map(({ title, stats }) => (
                <div key={title} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-700">{title}</div>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(stats).map(([k, v]) => (
                        <tr key={k} className="border-b border-slate-50 last:border-0">
                          <td className="px-5 py-2.5 text-slate-500 font-medium">
                            {{ mean: 'Mean', median: 'Median', std: 'Std Dev', p5: '5th %ile', p25: '25th %ile', p75: '75th %ile', p95: '95th %ile' }[k] ?? k}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                            {fmtDollar(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
