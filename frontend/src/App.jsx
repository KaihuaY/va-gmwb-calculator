import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import InputPanel from './components/InputPanel';
import SnapshotComparison from './components/SnapshotComparison';
import ResultsSummary from './components/ResultsSummary';
import AVFanChart from './components/AVFanChart';
import CumulativeWithdrawalChart from './components/CumulativeWithdrawalChart';
import DeathBenefitChart from './components/DeathBenefitChart';
import ClaimHistogram from './components/ClaimHistogram';
import FeeVsClaimChart from './components/FeeVsClaimChart';
import ProjectionTable from './components/ProjectionTable';
import SensitivityChart from './components/SensitivityChart';
import Methodology from './components/Methodology';
import OptimalAgeChart from './components/OptimalAgeChart';
import { simulate, sensitivity, recordSession, optimalElectionAge } from './api/client';
import AdvancedGateModal from './components/AdvancedGateModal';

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
// Backend offline banner with countdown auto-retry
// ---------------------------------------------------------------------------
function BackendOfflineBanner({ onRetry }) {
  const [countdown, setCountdown] = useState(10);
  useEffect(() => {
    if (countdown <= 0) { onRetry(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onRetry]);

  const isDev = import.meta.env.DEV;
  const hint = isDev
    ? 'Local backend not responding. Make sure uvicorn is running on port 8000.'
    : 'The server may be cold-starting (AWS Lambda can take 5–15 s).';

  return (
    <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold mb-0.5">Backend not responding…</div>
          <div className="text-xs text-amber-700">
            {hint} Retrying in <strong>{countdown}s</strong> — or{' '}
            <button onClick={onRetry} className="underline font-semibold hover:text-amber-900">
              retry now
            </button>.
          </div>
          {isDev && (
            <div className="mt-1.5 text-xs text-amber-600 font-mono">
              cd backend &amp;&amp; python -m uvicorn main:app --port 8000
            </div>
          )}
        </div>
        <button onClick={onRetry} className="flex-shrink-0 px-3 py-1 bg-amber-600 text-white text-xs font-semibold rounded-md hover:bg-amber-700 transition-colors">
          Retry
        </button>
      </div>
    </div>
  );
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
  withdrawal_rate_bands: null,
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
  num_scenarios: 500,
  seed: 42,
};

// ---------------------------------------------------------------------------
// Real-world product presets — top VA/RILA issuers by 2024 LIMRA sales
// Parameters sourced from public prospectuses, SEC filings, and industry disclosures.
// ---------------------------------------------------------------------------
export const PRODUCT_PRESETS = [
  {
    id: 'jackson',
    label: 'Jackson National — LifeGuard Freedom Flex',
    description: '#1 issuer (2024) · 7% compound roll-up · 5% WD at 65 · 1.50% rider fee · 10-yr deferral',
    params: {
      ...DEFAULT_PARAMS,
      current_age: 60, election_age: 70,
      withdrawal_rate: 0.05,   // 5% (age 65–74 band)
      rider_fee: 0.015,        // 1.50% of BB/yr (Freedom Flex with 7% roll-up)
      me_fee: 0.013,           // 1.30% (1.15% M&E + 0.15% admin)
      rollup_rate: 0.07,       // 7% compound during deferral
      step_up: true,
      mu: 0.06, sigma: 0.20,
      gmwb_enabled: true, gmdb_enabled: false,
    },
  },
  {
    id: 'equitable',
    label: 'Equitable — Retirement Cornerstone Series B',
    description: '#2 issuer (2024) · 7% roll-up · 5% WD · 1.40% rider fee · 7-yr lock-in',
    params: {
      ...DEFAULT_PARAMS,
      current_age: 62, election_age: 72,
      withdrawal_rate: 0.05,   // 5% single-life at age 70+
      rider_fee: 0.014,        // 1.40% of benefit base/yr
      me_fee: 0.013,           // 1.30% combined ops/admin/distribution
      rollup_rate: 0.07,       // 7% (mid-point of 5–10% floating range)
      step_up: true,
      mu: 0.06, sigma: 0.20,
      gmwb_enabled: true, gmdb_enabled: false,
    },
  },
  {
    id: 'tiaa',
    label: 'TIAA — CREF Variable Annuity (GLWB)',
    description: '#3 issuer (2024) · Ultra-low fees · 5.9% payout · 0.15% M&E · institutional/educator market',
    params: {
      ...DEFAULT_PARAMS,
      current_age: 65, election_age: 65,
      withdrawal_rate: 0.059,  // 5.9% CREF single-life payout at 65 (4% AIR basis)
      rider_fee: 0.005,        // ~0.50% estimated (TIAA is very low cost)
      me_fee: 0.0015,          // 0.15% — TIAA's defining low-cost differentiator
      rollup_rate: 0.04,       // 4% AIR (Assumed Investment Return)
      step_up: false,          // CREF uses AIR accumulation, not ratchet
      mu: 0.06, sigma: 0.18,
      gmwb_enabled: true, gmdb_enabled: false,
    },
  },
  {
    id: 'nationwide',
    label: 'Nationwide — Lifetime Income Track (L.inc+)',
    description: '#4 issuer (2024) · Step-up only, no roll-up · 5% WD · 1.30% rider fee',
    params: {
      ...DEFAULT_PARAMS,
      current_age: 65, election_age: 65,
      withdrawal_rate: 0.05,   // 5% lifetime withdrawal
      rider_fee: 0.013,        // 1.30% current (max 1.50%) of income benefit base
      me_fee: 0.014,           // 1.40% standard variable annuity M&E
      rollup_rate: 0.0,        // No guaranteed roll-up — step-up only
      step_up: true,           // Annual reset to higher of benefit base or contract value
      mu: 0.07, sigma: 0.18,
      gmwb_enabled: true, gmdb_enabled: false,
    },
  },
  {
    id: 'lincoln',
    label: 'Lincoln — ChoicePlus Assurance',
    description: '#5 issuer (2024) · 6% simple roll-up · 5.5% WD · 1.00% rider fee · step-up on',
    params: {
      ...DEFAULT_PARAMS,
      current_age: 60, election_age: 70,
      withdrawal_rate: 0.055,  // 5.5% at age 65+ band
      rider_fee: 0.01,         // 1.00% of BB/yr
      me_fee: 0.013,           // 1.30% of AV/yr
      rollup_rate: 0.06,       // 6% simple roll-up during 10-yr deferral
      step_up: true,
      mu: 0.06, sigma: 0.20,
      gmwb_enabled: true, gmdb_enabled: false,
    },
  },
  {
    id: 'allianz',
    label: 'Allianz — Index Advantage Income ADV (RILA)',
    // Source: SEC EDGAR filing May 2024 (edgar.sec.gov/data/836346/000083634624000102)
    // WD rate confirmed: 5.70% @age55 → 7.50% @age73; rider fee 0.70% confirmed.
    // Product fee (M&E equivalent) estimated at 1.25% — verify against current prospectus.
    // No benefit-base roll-up; Allianz uses annual income-percentage step-ups instead.
    description: 'RILA · 6.5% WD at 65 · 0.70% rider fee · annual step-up · no roll-up · SEC filing sourced',
    params: {
      ...DEFAULT_PARAMS,
      current_age: 58, election_age: 65,
      withdrawal_rate: 0.065,  // 6.5% at age 65 (interpolated: 5.70%@55 → 7.50%@73, +0.10%/yr)
      rider_fee: 0.007,        // 0.70% of benefit base — confirmed from SEC filing
      me_fee: 0.0125,          // 1.25% product/admin fee (RILA structure, no traditional M&E)
      rollup_rate: 0.0,        // No benefit-base roll-up (income % steps up on deferral, not modeled)
      step_up: true,           // Annual ratchet to higher of income base or account value
      mu: 0.065, sigma: 0.18,
      gmwb_enabled: true, gmdb_enabled: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Share / permalink helpers — encode params into URL hash
// ---------------------------------------------------------------------------
export function encodeParamsToHash(params) {
  try {
    const json = JSON.stringify(params);
    return '#p=' + btoa(json);
  } catch { return ''; }
}

// Pre-encoded share link for the Jackson preset — used by landing page "Live Example" CTA.
function getJacksonShareHash() {
  const jackson = PRODUCT_PRESETS.find(p => p.id === 'jackson');
  if (!jackson) return '';
  return encodeParamsToHash(jackson.params);
}
export const JACKSON_SHARE_HASH = getJacksonShareHash();

function decodeParamsFromHash() {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith('#p=')) return null;
    const json = atob(hash.slice(3));
    return JSON.parse(json);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Session persistence helpers
// ---------------------------------------------------------------------------
const SAVED_PARAMS_KEY = 'va_calc_saved_params';

// Returns the verified email if the user has completed OTP flow, or falls back
// to the pre-verification key for backward compat with existing sessions.
function getStoredEmail() {
  return (
    localStorage.getItem('va_calc_verified_email') ||
    localStorage.getItem('va_calc_email') ||
    null
  );
}

function loadInitialParams() {
  // URL hash takes highest priority — shared link
  const fromHash = decodeParamsFromHash();
  if (fromHash) {
    // Remove hash from URL so refresh doesn't re-load the shared state
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return { ...DEFAULT_PARAMS, ...fromHash };
  }
  // Then check saved session (only for verified/returning users)
  if (!getStoredEmail()) return DEFAULT_PARAMS;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_PARAMS_KEY) || 'null');
    if (!saved) return DEFAULT_PARAMS;
    // Merge saved over defaults — handles new fields added since last save
    return { ...DEFAULT_PARAMS, ...saved };
  } catch {
    return DEFAULT_PARAMS;
  }
}

function saveParams(params) {
  if (!getStoredEmail()) return;
  try {
    localStorage.setItem(SAVED_PARAMS_KEY, JSON.stringify(params));
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded, etc.)
  }
}

// Parameters that are locked in standard (policyholder) mode.
// Standard mode assumes a "hold forever" policyholder who always takes full withdrawals.
// These differ from the advanced defaults (lapse_rate: 3%, benefit_utilization: 100%).
const STD_LOCKED_PARAMS = {
  lapse_rate: 0.0,
  dynamic_lapse: false,
  benefit_utilization: 1.0,
};

// Hard limits that exactly match backend Pydantic Field constraints
const PARAM_LIMITS = {
  current_age:          { min: 0,     max: 100,       int: true },
  max_age:              { min: 90,    max: 120,       int: true },
  account_value:        { min: 10000, max: 10_000_000 },
  benefit_base:         { min: 10000, max: 10_000_000 },
  election_age:         { min: 0,     max: 100,       int: true },
  withdrawal_rate:      { min: 0.01,  max: 0.10 },
  rider_fee:            { min: 0.0,   max: 0.03 },
  gmdb_benefit_base:    { min: 10000, max: 10_000_000 },
  gmdb_rider_fee:       { min: 0.0,   max: 0.03 },
  gmdb_rollup_rate:     { min: 0.0,   max: 0.08 },
  me_fee:               { min: 0.0,   max: 0.03 },
  rollup_rate:          { min: 0.0,   max: 0.08 },
  mu:                   { min: -0.05, max: 0.20 },
  sigma:                { min: 0.0,   max: 0.50 },
  discount_rate:        { min: 0.0,   max: 0.10 },
  fixed_account_pct:    { min: 0.0,   max: 1.0 },
  fixed_account_rate:   { min: 0.0,   max: 0.10 },
  mort_multiplier:      { min: 0.5,   max: 2.0 },
  lapse_rate:           { min: 0.0,   max: 0.20 },
  lapse_sensitivity:    { min: 0.0,   max: 2.0 },
  lapse_min_multiplier: { min: 0.0,   max: 1.0 },
  benefit_utilization:  { min: 0.5,   max: 1.0 },
  num_scenarios:        { min: 100,   max: 10000,     int: true },
  seed:                 { min: 1,     max: 999999,    int: true },
};

function sanitizeParams(p) {
  const out = { ...p };
  for (const [key, { min, max, int }] of Object.entries(PARAM_LIMITS)) {
    if (out[key] === undefined) continue;
    let v = out[key];
    if (isNaN(v)) v = DEFAULT_PARAMS[key];
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    if (int) v = Math.round(v);
    out[key] = v;
  }
  // Cross-field: election_age must be >= current_age
  if (out.election_age < out.current_age) out.election_age = out.current_age;
  // Cross-field: max_age must be > current_age
  if (out.max_age <= out.current_age) out.max_age = out.current_age + 1;
  return out;
}

// Returns the params that simulate() would actually be called with for a given mode.
// Used for stale-result detection so switching modes correctly marks results as outdated.
function computeEffectiveParams(p, mode) {
  return sanitizeParams(
    mode === 'standard'
      ? { ...p, num_scenarios: Math.min(p.num_scenarios, 500), frequency: 'annual', ...STD_LOCKED_PARAMS }
      : p
  );
}

const ALL_TABS = [
  { id: 'charts',      label: 'Charts' },
  { id: 'table',       label: 'Projection Table' },
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'methodology', label: 'Methodology' },
];

// Standard (free) mode only shows Charts + Methodology
const STANDARD_TABS = ALL_TABS.filter(t => t.id === 'charts' || t.id === 'table');

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
  const [params, setParams] = useState(loadInitialParams);
  const [sessionToast, setSessionToast] = useState(() => {
    // Show "Loaded your last session" only if we actually restored saved params on mount
    if (!getStoredEmail()) return false;
    try {
      return JSON.parse(localStorage.getItem(SAVED_PARAMS_KEY) || 'null') !== null;
    } catch { return false; }
  });
  const [results, setResults] = useState(null);
  const [sensitivityData, setSensitivityData] = useState(null);
  // Default: economic + behavioral assumptions only; contract terms opt-in
  const [sensitivityFields, setSensitivityFields] = useState([
    'mu', 'sigma', 'discount_rate',
    'lapse_rate', 'benefit_utilization', 'mort_multiplier',
  ]);
  // Clear stale results whenever the field selection changes
  useEffect(() => { setSensitivityData(null); }, [sensitivityFields]);
  // Clear optimal age results when any param EXCEPT election_age changes.
  // Changing election_age is what the Apply button does — we don't want the
  // sweep chart to disappear mid-flight while the re-simulation is running.
  const paramsExcludingElectionAge = useMemo(() => {
    const { election_age: _ea, ...rest } = params; // eslint-disable-line no-unused-vars
    return JSON.stringify(rest);
  }, [params]);
  useEffect(() => { setOptimalAgeData(null); }, [paramsExcludingElectionAge]);
  // Dedup guard: track params fingerprint of the last successfully recorded run
  const lastRecordedFingerprint = useRef(null);
  // Strict-mode guard: prevent double-fire of the mount auto-run in React dev mode
  const autoRunFired = useRef(false);

  const [optimalAgeData, setOptimalAgeData] = useState(null);
  const [optimalAgeRunning, setOptimalAgeRunning] = useState(false);
  const [running, setRunning] = useState(false);
  const [sensitivityRunning, setSensitivityRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('charts');
  const [viewMode, setViewMode] = useState('standard');
  const handleSetViewMode = useCallback((mode) => {
    if (mode === 'advanced' && !isAdvancedUnlocked()) {
      setShowAdvancedGate(true);
      return;
    }
    setViewMode(mode);
    if (mode === 'standard') {
      setActiveTab(t => (t === 'table' || t === 'sensitivity') ? 'charts' : t);
    }
  }, []);
  const [chartView, setChartView] = useState('av'); // standard mode chart selector
  const [runParams, setRunParams] = useState(null); // params snapshot from the last completed run

  // Median life expectancy age — age where survival_probs first drops below 50%
  const lifeExpectancyAge = useMemo(() => {
    if (!results?.survival_probs || !results?.av_bands) return null;
    const idx = results.survival_probs.findIndex(p => p < 0.5);
    return idx >= 0 ? (results.av_bands[idx]?.age ?? null) : null;
  }, [results]);

  // Advanced-mode gate
  const [showAdvancedGate, setShowAdvancedGate] = useState(false);
  // Unlocked when the user has completed OTP verification (va_calc_verified_email).
  // Falls back to the old key so existing sessions aren't broken.
  const isAdvancedUnlocked = () => !!localStorage.getItem('va_calc_verified_email') || !!localStorage.getItem('va_calc_email');

  // Resizable sidebar + collapse state (default: collapsed for a clean first-view)
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('va_sidebar_open') !== '1'
  );
  const resizing = useRef(false);
  const dragStart = useRef({ x: 0, width: 0 });

  // Auto-dismiss session-restored toast after 3 s
  useEffect(() => {
    if (!sessionToast) return;
    const timer = setTimeout(() => setSessionToast(false), 3000);
    return () => clearTimeout(timer);
  }, [sessionToast]);

  // Persist sidebar open/collapsed state
  useEffect(() => {
    localStorage.setItem('va_sidebar_open', sidebarCollapsed ? '0' : '1');
  }, [sidebarCollapsed]);

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

  const handleRun = useCallback(async (overrides = {}) => {
    setRunning(true);
    setError(null);
    setProgress(0.1);
    try {
      // Simulate progress ticks while waiting for the API
      const ticker = setInterval(() => {
        setProgress(p => Math.min(p + 0.04, 0.9));
      }, 200);
      // Merge any overrides (e.g. election_age from Apply button) before sanitizing.
      // This avoids depending on React state having already flushed the setParam call.
      const mergedParams = { ...params, ...overrides };
      // Standard (free) mode: cap compute cost regardless of what params hold
      const simParams = sanitizeParams(
        viewMode === 'standard'
          ? { ...mergedParams, num_scenarios: Math.min(mergedParams.num_scenarios, 500), frequency: 'annual', ...STD_LOCKED_PARAMS }
          : mergedParams
      );
      const res = await simulate(simParams);
      clearInterval(ticker);
      setProgress(1);
      setResults(res);
      setRunParams(simParams); // snapshot = what was actually computed (mode-locked params applied)
      saveParams(params); // persist inputs for next visit (raw params, not mode-locked)

      // Fire-and-forget session record — skip if params unchanged since last record
      const fingerprint = JSON.stringify(simParams);
      if (fingerprint !== lastRecordedFingerprint.current) {
        lastRecordedFingerprint.current = fingerprint;
        recordSession({
          email: getStoredEmail(),
          role:  localStorage.getItem('va_calc_role') || null,
          mode:  viewMode,
          params: simParams,
          results: res,
        });
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || '';
      const isNetworkError = !err?.response && (msg.includes('Network') || msg.includes('ERR_') || msg.includes('Failed to fetch') || msg === '');
      if (isNetworkError) {
        setError('__backend_offline__');
      } else {
        setError(msg || 'Simulation failed. Check console for details.');
      }
    } finally {
      setRunning(false);
    }
  }, [params, viewMode]);

  const [activePresetId, setActivePresetId] = useState(null);

  // Scenario snapshots — up to 3, stored in sessionStorage
  const [snapshots, setSnapshots] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('va_snapshots') || '[]'); } catch { return []; }
  });
  const saveSnapshot = useCallback(() => {
    if (!results || !runParams) return;
    const label = activePresetId
      ? (PRODUCT_PRESETS.find(p => p.id === activePresetId)?.label ?? `Scenario ${snapshots.length + 1}`)
      : `Scenario ${snapshots.length + 1}`;
    setSnapshots(prev => {
      if (prev.length >= 3) return prev;
      const next = [...prev, { label, results, runParams }];
      try { sessionStorage.setItem('va_snapshots', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [results, runParams, activePresetId, snapshots.length]);
  const clearSnapshot = useCallback((index) => {
    setSnapshots(prev => {
      const next = prev.filter((_, i) => i !== index);
      try { sessionStorage.setItem('va_snapshots', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const clearAllSnapshots = useCallback(() => {
    setSnapshots([]);
    try { sessionStorage.removeItem('va_snapshots'); } catch {}
  }, []);

  // Mobile bottom-sheet drawer (input panel on small screens)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('va_calc_onboarding_seen'));
  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('va_calc_onboarding_seen', '1');
  }, []);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyShareLink = useCallback(() => {
    const hash = encodeParamsToHash(params);
    const url = window.location.origin + window.location.pathname + hash;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {
      // Fallback: update URL bar so user can manually copy
      history.replaceState(null, '', hash);
    });
  }, [params]);

  const loadPreset = useCallback((presetId) => {
    const preset = PRODUCT_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setParams(preset.params);
    setActivePresetId(presetId);
    setResults(null);
    setRunParams(null);
    setSensitivityData(null);
    setOptimalAgeData(null);
    setError(null);
  }, []);

  // Clear preset badge whenever the user manually edits any parameter
  const setParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
    setActivePresetId(null);
  }, []);

  const handleOptimalAge = useCallback(async () => {
    setOptimalAgeRunning(true);
    setError(null);
    try {
      const res = await optimalElectionAge(sanitizeParams(params));
      setOptimalAgeData(res);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Optimal age analysis failed.');
    } finally {
      setOptimalAgeRunning(false);
    }
  }, [params]);

  // Sync advanced actuarial params back to standard-mode locked values.
  // Lets an actuary quickly replicate the standard-mode result from advanced mode.
  const syncToStandard = useCallback(() => {
    setParams(prev => ({ ...prev, ...STD_LOCKED_PARAMS }));
  }, []);

  const handleSensitivity = useCallback(async () => {
    setSensitivityRunning(true);
    setError(null);
    try {
      const res = await sensitivity(sanitizeParams(params), 0.10, sensitivityFields);
      setSensitivityData(res);
      setActiveTab('sensitivity');
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Sensitivity analysis failed.');
    } finally {
      setSensitivityRunning(false);
    }
  }, [params, sensitivityFields]);

  // Auto-run on first load — ref guard prevents React 18 strict-mode double-fire
  useEffect(() => {
    if (autoRunFired.current) return;
    autoRunFired.current = true;
    handleRun();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    {/* AnnuityVoice top nav strip */}
    <div data-print-hide className="bg-[#0f1f3d] border-b border-white/10 px-4 py-2 flex items-center justify-between flex-shrink-0">
      <Link to="/" className="flex items-center gap-2 group">
        <div className="w-6 h-6 rounded bg-[#0052CC] flex items-center justify-center flex-shrink-0">
          <span className="text-white font-black text-xs">AV</span>
        </div>
        <span className="text-sm font-bold text-white tracking-tight">
          Annuity<span className="text-[#0052CC]">Voice</span>
        </span>
      </Link>
      <Link to="/" className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to AnnuityVoice
      </Link>
    </div>
    {/* Mobile: content fills screen; sidebar is a bottom-sheet overlay. Desktop: side-by-side. */}
    <div data-print-layout className="flex flex-col md:flex-row overflow-hidden bg-slate-50" style={{ height: 'calc(100dvh - 38px)' }}>
      {/* SIDEBAR — desktop: flex item. Mobile: fixed bottom-sheet overlay */}
      <div
        data-print-hide
        style={{ width: window.innerWidth >= 768 ? (sidebarCollapsed ? 0 : sidebarWidth) : undefined }}
        className={`
          fixed bottom-0 left-0 right-0 z-50
          md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto
          bg-slate-900 border-t md:border-t-0 md:border-r border-slate-700
          flex flex-col flex-shrink-0 md:h-full
          transition-all duration-300 ease-in-out overflow-hidden
          ${drawerOpen ? 'h-[80vh]' : 'h-0 md:h-full'}
        `}
      >
        {/* Mobile drag handle / close row */}
        <div
          className="md:hidden flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-slate-700 cursor-pointer"
          onClick={() => setDrawerOpen(false)}
        >
          <span className="text-xs font-semibold text-slate-400">Input Panel</span>
          <div className="flex items-center gap-3">
            <div className="w-8 h-1 bg-slate-600 rounded-full" />
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
        {/* Desktop sidebar header with collapse button */}
        <div className="hidden md:flex flex-shrink-0 items-center justify-between px-4 py-2 border-b border-slate-700">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inputs</span>
          <button
            onClick={() => setSidebarCollapsed(true)}
            title="Collapse inputs panel"
            className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          <InputPanel
            params={params}
            setParam={setParam}
            onRun={handleRun}
            onSensitivity={handleSensitivity}
            onOptimalAge={handleOptimalAge}
            onSyncToStandard={syncToStandard}
            presets={PRODUCT_PRESETS}
            onLoadPreset={loadPreset}
            activePresetId={activePresetId}
            running={running}
            sensitivityRunning={sensitivityRunning}
            optimalAgeRunning={optimalAgeRunning}
            viewMode={viewMode}
            setViewMode={handleSetViewMode}
          />
        </div>
        {/* Resize handle — desktop only */}
        <div
          onMouseDown={startResize}
          className="hidden md:block absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500 active:bg-blue-400 transition-colors z-10"
          title="Drag to resize"
        />
      </div>

      {/* MAIN CONTENT — full width on mobile (sidebar is overlay), flex-1 on desktop */}
      <div data-print-main className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div data-print-scroll className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Desktop: expand sidebar button — shown when sidebar is collapsed */}
          {sidebarCollapsed && (
            <div className="hidden md:flex items-center gap-2 mb-4">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Edit Inputs
              </button>
            </div>
          )}
          {/* Session-restored toast — auto-dismisses after 3 s */}
          {sessionToast && (
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-sm text-blue-700 flex items-center justify-between">
              <span>Loaded your last session.</span>
              <button onClick={() => setSessionToast(false)} className="ml-4 text-blue-400 hover:text-blue-600"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          )}

          {/* Error banner */}
          {error && error !== '__backend_offline__' && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-600"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          )}
          {error === '__backend_offline__' && (
            <BackendOfflineBanner onRetry={() => { setError(null); handleRun(); }} />
          )}

          {/* Summary metric cards + progress */}
          <ResultsSummary
            results={results}
            running={running}
            progress={progress}
            viewMode={viewMode}
            runParams={runParams}
            onSaveSnapshot={results && !running ? saveSnapshot : null}
            snapshots={snapshots}
          />

          {/* First-visit onboarding callout — shown once, dismissed to localStorage */}
          {showOnboarding && results && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-sm font-bold text-blue-800 mb-1">Welcome — here's what you're looking at</div>
                  <ul className="text-xs text-blue-700 space-y-1 leading-relaxed">
                    <li><strong>Guarantee Value</strong> — the average insurance payout when your account runs out, across {(results.num_scenarios ?? 500).toLocaleString()} simulated market scenarios.</li>
                    <li><strong>Total Fees</strong> — M&amp;E and rider charges you pay over your lifetime, regardless of market performance.</li>
                    <li><strong>Net Benefit</strong> — guarantee value minus fees. Negative is common and expected; the rider protects against bad market scenarios, not the average one.</li>
                    <li>Try the <strong>Load a product example</strong> dropdown to compare real contracts side by side.</li>
                  </ul>
                </div>
                <button onClick={dismissOnboarding} className="flex-shrink-0 text-blue-400 hover:text-blue-600" title="Dismiss"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
              <button onClick={dismissOnboarding} className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-800 underline">
                Got it — don't show again
              </button>
            </div>
          )}

          {/* Standard mode footnote — subtle disclosure of locked assumptions */}
          {viewMode === 'standard' && (() => {
            const diffs = [];
            if (params.lapse_rate !== STD_LOCKED_PARAMS.lapse_rate)
              diffs.push(`lapse ${(params.lapse_rate * 100).toFixed(1)}% → 0%`);
            if (params.dynamic_lapse)
              diffs.push('dynamic lapse → off');
            if (params.benefit_utilization < STD_LOCKED_PARAMS.benefit_utilization)
              diffs.push(`utilization ${(params.benefit_utilization * 100).toFixed(0)}% → 100%`);
            return (
              <p className="text-xs text-slate-400 -mt-3 mb-5 pl-1">
                {diffs.length > 0
                  ? <>* Standard mode: 0% lapse, 100% utilization applied — <span className="text-amber-600">differs from your Advanced settings ({diffs.join(', ')})</span></>
                  : '* Standard mode: 0% lapse, 100% withdrawal utilization assumed'
                }
              </p>
            );
          })()}

          {/* Tab bar */}
          <div data-print-hide className="flex items-end gap-1 mb-6 border-b-2 border-slate-200">
            {(viewMode === 'standard' ? STANDARD_TABS : ALL_TABS).map(tab => (
              <button
                key={tab.id}
                data-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-0.5 transition-colors ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-blue-600'
                    : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
            <div className="ml-auto mb-0.5 flex-shrink-0 flex items-center gap-1">
              <button
                onClick={copyShareLink}
                title="Copy a shareable link with your current parameters"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              >
                {linkCopied ? '✓ Copied!' : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>Share</>}
              </button>
              {results && (
                <button
                  onClick={() => window.print()}
                  title="Print or save as PDF"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export PDF
                </button>
              )}
            </div>
          </div>

          {/* Stale results warning */}
          {(() => {
            if (!results || !runParams) return null;
            const effective = computeEffectiveParams(params, viewMode);
            if (JSON.stringify(effective) === JSON.stringify(runParams)) return null;

            // Human-readable labels for changed params
            const PARAM_LABELS = {
              current_age: 'Age', gender: 'Gender', max_age: 'Max Age',
              account_value: 'Account Value', benefit_base: 'Benefit Base',
              election_age: 'Income Start Age', withdrawal_rate: 'Withdrawal Rate',
              rider_fee: 'Rider Fee', me_fee: 'Contract Fee',
              rollup_rate: 'Roll-up Rate', step_up: 'Step-Up',
              gmwb_enabled: 'GMWB Rider', gmdb_enabled: 'GMDB Rider',
              gmdb_benefit_base: 'GMDB Benefit Base', gmdb_rider_fee: 'GMDB Rider Fee',
              gmdb_rollup_rate: 'GMDB Roll-up', gmdb_step_up: 'GMDB Step-Up',
              mu: 'Expected Return', sigma: 'Volatility', discount_rate: 'Discount Rate',
              frequency: 'Frequency', fixed_account_pct: 'Fixed Account %',
              fixed_account_rate: 'Fixed Account Rate',
              mortality_table: 'Mortality Table', mort_multiplier: 'Mortality Multiplier',
              lapse_rate: 'Lapse Rate', dynamic_lapse: 'Dynamic Lapse',
              lapse_sensitivity: 'Lapse Sensitivity', lapse_min_multiplier: 'Min Lapse',
              benefit_utilization: 'Withdrawal Utilization',
              num_scenarios: 'Scenarios', seed: 'Seed',
              withdrawal_rate_bands: 'Withdrawal Bands',
            };
            const changed = Object.keys(PARAM_LABELS).filter(k =>
              JSON.stringify(effective[k]) !== JSON.stringify(runParams[k])
            ).map(k => PARAM_LABELS[k]);

            return (
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">⚠ Results are outdated — re-run to update.</span>
                  <button
                    onClick={() => handleRun()}
                    disabled={running}
                    className="flex-shrink-0 px-3 py-1 bg-amber-600 text-white text-xs font-semibold rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    Re-run now
                  </button>
                </div>
                {changed.length > 0 && (
                  <div className="mt-1 text-xs text-amber-700">
                    Changed: {changed.join(', ')}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Tab content — dimmed when stale */}
          <div>
          {activeTab === 'charts' && results && viewMode === 'standard' && (() => {
            // Use runParams (not params) so tabs reflect what was actually computed
            const rp = runParams ?? params;
            const chartTabs = [
              { id: 'av', label: 'Account Balance' },
              ...(rp.gmwb_enabled ? [{ id: 'cw', label: 'Income Received' }] : []),
              ...(rp.gmdb_enabled ? [{ id: 'db', label: 'Death Benefit' }] : []),
            ];
            // If the current chartView is no longer valid (rider toggled off), fall back to 'av'
            const activeChartView = chartTabs.find(t => t.id === chartView) ? chartView : 'av';
            return (
              <div>
                {/* Chart selector — only show tabs when there are multiple options */}
                {chartTabs.length > 1 && (
                  <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
                    {chartTabs.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setChartView(t.id)}
                        className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                          activeChartView === t.id
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                {activeChartView === 'av' && <AVFanChart data={results.av_bands} simple lifeExpectancyAge={lifeExpectancyAge} />}
                {activeChartView === 'cw' && rp.gmwb_enabled && results.cw_bands && <CumulativeWithdrawalChart data={results.cw_bands} simple />}
                {activeChartView === 'db' && rp.gmdb_enabled && results.gmdb_bb_bands && <DeathBenefitChart avBands={results.av_bands} gmdbBands={results.gmdb_bb_bands} simple lifeExpectancyAge={lifeExpectancyAge} />}
              </div>
            );
          })()}

          {activeTab === 'charts' && results && viewMode === 'advanced' && (
            <div className="space-y-4">
              {/* Suppress standalone AV chart when GMDB is on — DB chart already contains the AV fan */}
              {!(runParams ?? params).gmdb_enabled && <AVFanChart data={results.av_bands} lifeExpectancyAge={lifeExpectancyAge} />}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {(runParams ?? params).gmwb_enabled && results.cw_bands && <CumulativeWithdrawalChart data={results.cw_bands} />}
                {(runParams ?? params).gmdb_enabled && results.gmdb_bb_bands && <DeathBenefitChart avBands={results.av_bands} gmdbBands={results.gmdb_bb_bands} lifeExpectancyAge={lifeExpectancyAge} />}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ClaimHistogram data={results.histogram} />
                <FeeVsClaimChart claimStats={results.claim_stats} feeStats={results.fee_stats} gmdbStats={results.gmdb_stats} />
              </div>
            </div>
          )}

          {activeTab === 'charts' && !results && !running && (
            <div className="text-sm text-slate-500 text-center py-16">
              Run the simulation to see charts.
            </div>
          )}

          {/* Optimal Withdrawal Age — shown in Charts tab when GMWB is enabled */}
          {activeTab === 'charts' && (runParams ?? params).gmwb_enabled && (optimalAgeData || optimalAgeRunning) && (
            <div className="mt-4">
              <OptimalAgeChart
                data={optimalAgeData}
                currentElectionAge={params.election_age}
                onApplyAge={age => {
                  setParam('election_age', age);
                  handleRun({ election_age: age }); // re-simulate immediately; overrides async state flush
                }}
                loading={optimalAgeRunning}
              />
            </div>
          )}

          {activeTab === 'table' && (
            <ProjectionTable results={results} onExport={() => results && exportCSV(results)} />
          )}

          {activeTab === 'sensitivity' && (
            <SensitivityChart
              data={sensitivityData}
              loading={sensitivityRunning}
              selectedFields={sensitivityFields}
              onFieldsChange={setSensitivityFields}
              onRun={handleSensitivity}
              simulationRunning={running}
            />
          )}

          {activeTab === 'methodology' && <Methodology />}
          </div>{/* end stale-dimming wrapper */}

          {/* Scenario comparison panel — outside stale-dimming so it's always readable */}
          <SnapshotComparison
            snapshots={snapshots}
            onClearSnapshot={clearSnapshot}
            onClearAll={clearAllSnapshots}
          />

          {/* Upgrade nudge — standard mode only, not shown once Advanced is unlocked */}
          {viewMode === 'standard' && results && !isAdvancedUnlocked() && (
            <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-5">
              <div className="text-sm font-bold text-blue-800 mb-1">Unlock Advanced Analysis</div>
              <p className="text-xs text-blue-600 mb-3">
                Switch to Advanced mode to access actuarial-grade tools used by insurance professionals.
              </p>
              <ul className="text-xs text-blue-700 space-y-1 mb-4">
                {[
                  'Sensitivity tornado chart — see which assumptions drive cost most',
                  'Year-by-year projection table with CSV export',
                  'Up to 10,000 scenarios for tail-risk precision',
                  'Monthly time-step for higher accuracy',
                  'Dynamic lapse modeling (ITM-adjusted)',
                  'Custom mortality table, multiplier & discount rate',
                  'Fixed / guaranteed account allocation',
                ].map(f => (
                  <li key={f} className="flex items-start gap-1.5">
                    <span className="mt-0.5 text-blue-400">›</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSetViewMode('advanced')}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Switch to Advanced Mode
              </button>
            </div>
          )}

          {/* Inline statistics detail (shown under charts tab when results available) */}
          {activeTab === 'charts' && results && viewMode === 'advanced' && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {([
                ...((runParams ?? params).gmwb_enabled ? [{ title: 'PV(GMWB) Statistics', stats: results.claim_stats }] : []),
                ...((runParams ?? params).gmdb_enabled && results.gmdb_stats?.mean > 0 ? [{ title: 'PV(GMDB) Statistics', stats: results.gmdb_stats }] : []),
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
          {/* Footer disclaimer — screen only */}
          <footer data-print-hide className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-500">Educational tool only.</strong> Results are model estimates based on
            Monte Carlo simulation and simplified actuarial assumptions. Not financial, investment, insurance, or
            actuarial advice. Consult a licensed professional before making annuity decisions.
            {' '}
            <button
              onClick={() => {
                document.querySelector('[data-tab="methodology"]')?.click();
              }}
              className="underline hover:text-slate-600"
            >
              Methodology &amp; full disclaimer
            </button>
          </footer>

          {/* Print-only footer — hidden on screen, shown in print */}
          <div data-print-only className="hidden mt-6 pt-3 border-t border-slate-200 text-center text-xs text-slate-500">
            Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} ·
            AnnuityVoice (annuityvoice.com) · For financial professional use only · Not financial advice
          </div>
        </div>
      </div>
    </div>

    {/* Mobile backdrop �� closes drawer when tapped */}
    {drawerOpen && (
      <div
        className="md:hidden fixed inset-0 z-40 bg-black/50"
        onClick={() => setDrawerOpen(false)}
      />
    )}

    {/* Mobile "Edit Inputs" pill — fixed at bottom, hidden when drawer is open */}
    {!drawerOpen && (
      <div className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-full shadow-xl border border-slate-600 active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          Edit Inputs
        </button>
      </div>
    )}

    {/* Advanced gate modal — shown when user clicks Advanced without verified email */}
    {showAdvancedGate && (
      <AdvancedGateModal
        onUnlock={(email, role) => {
          // Store the verified email under both keys:
          // va_calc_verified_email — proof of OTP verification (gates Advanced mode)
          // va_calc_email          — legacy key used by saveParams / recordSession
          localStorage.setItem('va_calc_verified_email', email);
          localStorage.setItem('va_calc_email', email);
          if (role) localStorage.setItem('va_calc_role', role);
          saveParams(params); // persist current inputs now that we have a verified email
          setShowAdvancedGate(false);
          setViewMode('advanced');
        }}
        onCancel={() => setShowAdvancedGate(false)}
      />
    )}

    </>
  );
}
