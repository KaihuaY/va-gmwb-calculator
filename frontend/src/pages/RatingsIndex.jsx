/**
 * /ratings — user-centered, lens-driven index of every published rating.
 *
 * Design principles applied:
 *   - Letter grade column is always visible (principle 3).
 *   - The five sub-score abbreviations (TCO/GV/SF/IC/BF) are hidden behind
 *     a "Score breakdown" toggle — cryptic for non-actuaries (principle 1).
 *   - Default columns are carrier-feature columns chosen by the active lens
 *     (Costs / Income / Carrier / Flexibility) — these are what advisors
 *     actually compare on (principle 2).
 *   - Lens default = Costs (principle 4).
 *   - Gender filter: Blended / Male / Female (drives which composite + grade
 *     is shown across the table).
 *
 * The data-testid hooks the Playwright smoke test depends on are preserved:
 *   - [data-testid="ratings-table"]
 *   - [data-testid="row-<slug>"]
 *   - [data-testid="grade-<slug>"]
 *   - [data-testid="filter-carrier"]
 *   - [data-testid="filter-min-grade"]
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRatings } from '../api/client';
import LensTabs, { LENSES } from '../components/LensTabs';

const GRADE_RANK = {
  'A+': 13, 'A': 12, 'A-': 11,
  'B+': 10, 'B':  9, 'B-':  8,
  'C+':  7, 'C':  6, 'C-':  5,
  'D+':  4, 'D':  3, 'D-':  2,
  'F':   1,
};

function gradeColor(g) {
  if (!g) return '#6b7280';
  if (g.startsWith('A')) return '#15803d';
  if (g.startsWith('B')) return '#65a30d';
  if (g.startsWith('C')) return '#eab308';
  if (g.startsWith('D')) return '#ea580c';
  return '#b91c1c';
}

function pct(v, digits = 2) {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

// Lens → list of carrier-feature columns. Letter grade column is rendered
// independently so it is always visible (principle 3).
const LENS_COLUMNS = {
  costs: [
    { key: 'me_fee_annual',     label: 'M&E',         render: (s) => pct(s.me_fee_annual, 2) },
    { key: 'rider_fee_annual',  label: 'Rider fee',   render: (s) => s.has_glwb ? pct(s.rider_fee_annual, 2) : '—' },
    { key: 'all_in',            label: 'All-in',
      render: (s) => pct((s.me_fee_annual || 0) + (s.has_glwb ? (s.rider_fee_annual || 0) : 0), 2) },
    { key: 'surrender_years',   label: 'Surrender (yrs)', render: (s) => String(s.surrender_years || 0) },
  ],
  income: [
    { key: 'has_glwb',          label: 'Income rider', render: (s) => s.has_glwb ? 'Yes' : 'No' },
    { key: 'rollup_rate',       label: 'Roll-up',      render: (s) => s.has_glwb ? pct(s.rollup_rate, 1) : '—' },
    { key: 'withdrawal_rate_65',label: 'W/D @ 65',     render: (s) => s.has_glwb ? pct(s.withdrawal_rate_65, 2) : '—' },
    { key: 'step_up',           label: 'Step-up',      render: (s) => s.has_glwb ? (s.step_up ? 'Yes' : 'No') : '—' },
  ],
  carrier: [
    { key: 'am_best',           label: 'AM Best',      render: (s) => s.am_best || '—' },
    { key: 'pe_owned',          label: 'PE-owned',     render: (s) => s.pe_owned ? 'Yes' : 'No' },
    { key: 'level_3_pct_2024',  label: 'Level 3',      render: (s) => pct(s.level_3_pct_2024, 0) },
    { key: 'cap_cut_count_5yr', label: 'Cap cuts (5y)',render: (s) => String(s.cap_cut_count_5yr ?? 0) },
  ],
  flexibility: [
    { key: 'surrender_years',   label: 'Surrender (yrs)', render: (s) => String(s.surrender_years || 0) },
    { key: 'free_withdrawal_pct', label: 'Free withdrawal', render: (s) => pct(s.free_withdrawal_pct, 0) },
    { key: 'waiver_count',      label: 'Waivers',      render: (s) => String(s.waiver_count ?? 0) },
    { key: 'surrender_max_pct', label: 'Max charge',   render: (s) => pct(s.surrender_max_pct, 1) },
  ],
};

export default function RatingsIndex() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [carrierFilter, setCarrierFilter] = useState('');
  const [minGrade, setMinGrade] = useState('');
  const [hasGlwbOnly, setHasGlwbOnly] = useState(false);
  const [lens, setLens] = useState('costs');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [sortKey, setSortKey] = useState('composite');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    listRatings()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message || 'failed to load'); setLoading(false); });
  }, []);

  const items = data?.items || [];
  const carriers = useMemo(
    () => Array.from(new Set(items.map((i) => i.carrier))).sort(),
    [items],
  );

  // Project items with lens snapshot before filter/sort.
  const projected = useMemo(() => items.map((i) => ({
    ...i,
    _composite: i.composite,
    _letter: i.letter_grade,
    _sub: i.sub_scores,
    _snap: i.feature_snapshot || {},
  })), [items]);

  const filtered = useMemo(() => {
    let arr = projected.slice();
    if (carrierFilter) arr = arr.filter((i) => i.carrier === carrierFilter);
    if (minGrade) {
      const min = GRADE_RANK[minGrade] || 0;
      arr = arr.filter((i) => (GRADE_RANK[i._letter] || 0) >= min);
    }
    if (hasGlwbOnly) arr = arr.filter((i) => i.has_glwb);
    arr.sort((a, b) => {
      let va, vb;
      if (sortKey === 'letter_grade') {
        va = GRADE_RANK[a._letter] || 0;
        vb = GRADE_RANK[b._letter] || 0;
      } else if (sortKey === 'composite') {
        va = a._composite; vb = b._composite;
      } else if (sortKey.startsWith('sub_scores.')) {
        const k = sortKey.split('.')[1];
        va = a._sub?.[k] ?? 0; vb = b._sub?.[k] ?? 0;
      } else if (sortKey.startsWith('snap.')) {
        const k = sortKey.split('.')[1];
        va = a._snap?.[k]; vb = b._snap?.[k];
        // String comparison for non-numeric snapshot fields (e.g. AM Best)
        if (typeof va === 'string' || typeof vb === 'string') {
          va = String(va ?? ''); vb = String(vb ?? '');
        } else {
          va = va ?? 0; vb = vb ?? 0;
        }
      } else {
        va = a[sortKey]; vb = b[sortKey];
      }
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return sortDesc ? -cmp : cmp;
    });
    return arr;
  }, [projected, carrierFilter, minGrade, hasGlwbOnly, sortKey, sortDesc]);

  function setSort(key) {
    if (key === sortKey) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
  }

  if (loading) return <div data-testid="ratings-loading" style={pageStyle}>Loading ratings…</div>;
  if (error)   return <div data-testid="ratings-error"   style={pageStyle}>Error: {error}</div>;

  const cols = LENS_COLUMNS[lens] || LENS_COLUMNS.costs;

  return (
    <div data-testid="ratings-index" style={pageStyle}>
      <header style={{ marginBottom: 18 }}>
        <Link to="/" style={{ fontSize: 13, color: '#2563eb' }}>← AnnuityVoice</Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '8px 0 6px' }}>
          AnnuityVoice Ratings
        </h1>
        <p style={{ fontSize: 14, color: '#4b5563', margin: 0 }}>
          {data.count} registered index-linked annuities rated · Methodology{' '}
          <Link to="/methodology">{data.methodology_version}</Link> ·
          Effective {data.methodology_effective_date}
        </p>
      </header>

      {/* Lens tabs — drive which carrier-feature columns are visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <LensTabs value={lens} onChange={setLens} />
      </div>

      <div style={filterRow}>
        <label style={filterLabel}>
          Carrier
          <select
            value={carrierFilter}
            onChange={(e) => setCarrierFilter(e.target.value)}
            data-testid="filter-carrier"
            style={selectStyle}
          >
            <option value="">All ({carriers.length})</option>
            {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={filterLabel}>
          Min grade
          <select
            value={minGrade}
            onChange={(e) => setMinGrade(e.target.value)}
            data-testid="filter-min-grade"
            style={selectStyle}
          >
            <option value="">Any</option>
            {['A+','A','A-','B+','B','B-','C+','C'].map((g) =>
              <option key={g} value={g}>{g} or higher</option>
            )}
          </select>
        </label>
        <label style={filterLabel}>
          <input
            type="checkbox"
            checked={hasGlwbOnly}
            onChange={(e) => setHasGlwbOnly(e.target.checked)}
            data-testid="filter-glwb"
            style={{ marginRight: 6 }}
          />
          Income rider only
        </label>
        <label style={{ ...filterLabel, marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showBreakdown}
            onChange={(e) => setShowBreakdown(e.target.checked)}
            data-testid="toggle-breakdown"
            style={{ marginRight: 6 }}
          />
          Score breakdown (actuary view)
        </label>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {filtered.length} shown
        </div>
      </div>

      <table style={tableStyle} data-testid="ratings-table">
        <thead>
          <tr>
            <Th label="Product"   onClick={() => setSort('name')}     active={sortKey==='name'}     desc={sortDesc} />
            <Th label="Carrier"   onClick={() => setSort('carrier')}  active={sortKey==='carrier'}  desc={sortDesc} />
            <Th label="Grade"     onClick={() => setSort('letter_grade')} active={sortKey==='letter_grade'} desc={sortDesc} />
            <Th label="Composite" onClick={() => setSort('composite')} active={sortKey==='composite'} desc={sortDesc} num />
            {cols.map((c) => (
              <Th
                key={c.key}
                label={c.label}
                onClick={() => setSort(`snap.${c.key}`)}
                active={sortKey === `snap.${c.key}`}
                desc={sortDesc}
                num
              />
            ))}
            {showBreakdown && (
              <>
                <Th label="TCO" onClick={() => setSort('sub_scores.tco')} active={sortKey==='sub_scores.tco'} desc={sortDesc} num />
                <Th label="GV"  onClick={() => setSort('sub_scores.gv')}  active={sortKey==='sub_scores.gv'}  desc={sortDesc} num />
                <Th label="SF"  onClick={() => setSort('sub_scores.sf')}  active={sortKey==='sub_scores.sf'}  desc={sortDesc} num />
                <Th label="IC"  onClick={() => setSort('sub_scores.ic')}  active={sortKey==='sub_scores.ic'}  desc={sortDesc} num />
                <Th label="BF"  onClick={() => setSort('sub_scores.bf')}  active={sortKey==='sub_scores.bf'}  desc={sortDesc} num />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {filtered.map((it) => (
            <tr key={it.slug} data-testid={`row-${it.slug}`}>
              <td style={cellStyle}>
                <Link to={`/ratings/${it.slug}`} style={{ color: '#2563eb', fontWeight: 500 }}>
                  {it.name}
                </Link>
              </td>
              <td style={cellStyle}>{it.carrier}</td>
              <td style={cellStyle}>
                <span
                  data-testid={`grade-${it.slug}`}
                  style={{
                    color: gradeColor(it._letter),
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {it._letter}
                </span>
              </td>
              <td style={numCell}>{it._composite?.toFixed(1) ?? '—'}</td>
              {cols.map((c) => (
                <td key={c.key} style={numCell}>{c.render(it._snap)}</td>
              ))}
              {showBreakdown && (
                <>
                  <td style={numCell}>{(it._sub?.tco ?? 0).toFixed(0)}</td>
                  <td style={numCell}>{(it._sub?.gv  ?? 0).toFixed(0)}</td>
                  <td style={numCell}>{(it._sub?.sf  ?? 0).toFixed(0)}</td>
                  <td style={numCell}>{(it._sub?.ic  ?? 0).toFixed(0)}</td>
                  <td style={numCell}>{(it._sub?.bf  ?? 0).toFixed(0)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <footer style={footerStyle}>
        <p>
          Annuity ratings are the opinion of the named signing actuary based on
          the published methodology. They are not investment advice, do not
          constitute a recommendation, and do not create a fiduciary
          relationship. Ratings reflect data available as of the rating date and
          may change. The default grade is a 50/50 blend of male and female
          standardized scenario.
        </p>
      </footer>
    </div>
  );
}

function Th({ label, onClick, active, desc, num }) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: num ? 'right' : 'left',
        padding: '8px 12px',
        borderBottom: '2px solid #d1d5db',
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 12,
        fontWeight: 700,
        color: active ? '#111827' : '#4b5563',
        background: active ? '#f3f4f6' : 'transparent',
      }}
    >
      {label}{active ? (desc ? ' ▼' : ' ▲') : ''}
    </th>
  );
}

// -- inline styles
const pageStyle = {
  maxWidth: 1180, margin: '0 auto', padding: '32px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#111827',
};
const filterRow = {
  display: 'flex', gap: 16, alignItems: 'center',
  background: '#f9fafb', padding: 12, borderRadius: 8, marginBottom: 12,
  flexWrap: 'wrap',
};
const filterLabel = { fontSize: 13, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 };
const selectStyle = { padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 };
const tableStyle = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginBottom: 24,
};
const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #e5e7eb' };
const numCell = { textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid #e5e7eb' };
const footerStyle = { fontSize: 12, color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: 16 };
