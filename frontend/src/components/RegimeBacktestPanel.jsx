/**
 * RegimeBacktestPanel — interactive "How would this contract have performed
 * in past markets?" panel on /ratings/:slug.
 *
 * For the selected regime, fetches /ratings/:slug/backtest/:regimeKey and
 * renders:
 *   1. Regime pill buttons (read from /methodology)
 *   2. Line chart of AV path, normalized starting AV = $100
 *   3. Summary cards: terminal AV, terminal multiple, max drawdown,
 *      fees paid, annualised fee drag
 *
 * This is a what-if scenario only — it does NOT affect the composite rating
 * (see methodology.scenario_backtest + methodology.regime_role).
 *
 * Required test hooks:
 *   [data-testid="regime-backtest-panel"]
 *   [data-testid="regime-pill-{regime_key}"]
 *   [data-testid="regime-backtest-terminal-av"]
 */

import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';

import { getRegimeBacktest, getMethodology } from '../api/client';

function fmtMoney(v, frac = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${Number(v).toLocaleString(undefined, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  })}`;
}

function fmtPct(v, frac = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(Number(v) * 100).toFixed(frac)}%`;
}

export default function RegimeBacktestPanel({ slug }) {
  const [regimes, setRegimes] = useState([]);
  const [selectedRegime, setSelectedRegime] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load methodology once to get the regime list
  useEffect(() => {
    let cancelled = false;
    getMethodology()
      .then((m) => {
        if (cancelled) return;
        const list = Array.isArray(m?.regimes) ? m.regimes : [];
        setRegimes(list);
        if (list.length > 0 && selectedRegime === null) {
          setSelectedRegime(list[0].key);
        }
      })
      .catch((e) => setError(e?.message || 'Failed to load methodology'));
    return () => { cancelled = true; };
    // selectedRegime intentionally NOT in deps — only set the initial default
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the backtest path whenever slug or selected regime changes
  useEffect(() => {
    if (!slug || !selectedRegime) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRegimeBacktest(slug, selectedRegime)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Failed to load backtest'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, selectedRegime]);

  return (
    <div data-testid="regime-backtest-panel" style={wrapper}>
      <div style={pillsRow}>
        {regimes.map((r) => {
          const active = r.key === selectedRegime;
          return (
            <button
              key={r.key}
              type="button"
              data-testid={`regime-pill-${r.key}`}
              onClick={() => setSelectedRegime(r.key)}
              style={active ? pillActive : pillInactive}
            >
              {r.display_name}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={errorBox}>Could not load backtest: {error}</div>
      )}

      {!result && !error && (
        <div style={placeholder}>{loading ? 'Loading regime replay…' : 'Pick a regime above.'}</div>
      )}

      {result && (
        <>
          <div style={chartBox}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={result.av_path}
                margin={{ top: 10, right: 12, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  // Show roughly 8 ticks across the path
                  interval={Math.max(1, Math.floor(result.av_path.length / 8))}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickFormatter={(v) => `$${v.toFixed(0)}`}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(v) => fmtMoney(v, 2)}
                  labelFormatter={(label) => `Month: ${label}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <ReferenceLine
                  y={result.starting_av}
                  stroke="#9ca3af"
                  strokeDasharray="4 4"
                  label={{
                    value: `Start $${result.starting_av.toFixed(0)}`,
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: '#6b7280',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="av"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={statsGrid}>
            <Stat
              label="Terminal AV"
              value={fmtMoney(result.terminal_av, 2)}
              testid="regime-backtest-terminal-av"
              hint={`After ${result.years} year${result.years === 1 ? '' : 's'}`}
            />
            <Stat
              label="Terminal multiple"
              value={`${result.terminal_av_multiple.toFixed(2)}x`}
              hint={`Of starting $${result.starting_av.toFixed(0)}`}
            />
            <Stat
              label="Max drawdown"
              value={fmtPct(result.max_drawdown_pct, 1)}
              hint={result.max_drawdown_month ? `Trough ${result.max_drawdown_month}` : null}
            />
            <Stat
              label="Fees paid (PV)"
              value={fmtMoney(result.fees_paid_total, 2)}
              hint="M&E + rider fees"
            />
            <Stat
              label="Fee drag (annualised)"
              value={fmtPct(result.fee_drag_annualized_pct, 2)}
              hint="PV(fees) / starting AV / years"
            />
          </div>

          {result.history_truncated && (
            <div style={noteBox}>
              Note: historical data ran out before the full regime window —
              path may be shorter than nominal.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, testid }) {
  return (
    <div style={statCard} data-testid={testid}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
      {hint && <div style={statHint}>{hint}</div>}
    </div>
  );
}

// --- styles ----------------------------------------------------------------

const wrapper = { marginTop: 4 };
const pillsRow = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 14,
};
const pillBase = {
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#374151',
  cursor: 'pointer',
  transition: 'background 120ms, color 120ms, border-color 120ms',
};
const pillActive = {
  ...pillBase,
  background: '#1f2937',
  borderColor: '#1f2937',
  color: '#ffffff',
  fontWeight: 600,
};
const pillInactive = { ...pillBase };
const chartBox = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 4px 4px',
  marginBottom: 14,
};
const statsGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
};
const statCard = {
  background: '#fafafa',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '12px 14px',
};
const statLabel = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#6b7280',
  marginBottom: 6,
};
const statValue = { fontSize: 18, fontWeight: 700, color: '#111827' };
const statHint = { fontSize: 11, color: '#6b7280', marginTop: 4 };
const placeholder = {
  padding: '24px 0',
  fontSize: 13,
  color: '#6b7280',
  textAlign: 'center',
};
const errorBox = {
  padding: '12px 14px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  color: '#991b1b',
  fontSize: 13,
};
const noteBox = {
  marginTop: 12,
  padding: '8px 12px',
  fontSize: 12,
  color: '#6b7280',
  background: '#f9fafb',
  borderRadius: 6,
};
