/**
 * /methodology — renders the methodology JSON as a human-readable doc.
 *
 * The methodology is the IP of the publication; every claim on a rating
 * page should be traceable to a definition here.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMethodology } from '../api/client';

const SUBSCORE_ORDER = ['tco', 'gv', 'sf', 'ic', 'bf'];
const SUBSCORE_FULL = {
  tco: 'TCO — Total Cost of Ownership',
  gv:  'GV — Guarantee Value',
  sf:  'SF — Surrender Flexibility',
  ic:  'IC — Insurer Credit',
  bf:  'BF — Behavioral Fairness',
};

export default function MethodologyPage() {
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMethodology().then(setM).catch((e) => setError(e.message || 'error'));
  }, []);

  if (error) return <div style={pageStyle}>Error: {error}</div>;
  if (!m)    return <div data-testid="methodology-loading" style={pageStyle}>Loading…</div>;

  const s = m.scoring_scenario;

  return (
    <div data-testid="methodology-page" style={pageStyle}>
      <Link to="/ratings" style={{ fontSize: 13, color: '#2563eb' }}>← All ratings</Link>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '12px 0 4px' }}>
        AnnuityVoice Rating Methodology
      </h1>
      <p style={{ color: '#4b5563', fontSize: 14, margin: 0 }}>
        Version <strong>{m.version}</strong> · Effective {m.effective_date}
      </p>

      <section style={section}>
        <h2 style={h2}>How a product is rated</h2>
        <p style={p}>
          Every product is scored on five sub-scores, each on a 0–100 scale.
          The five sub-scores are weighted into a composite, which maps to a
          letter grade. The scoring scenario is locked — every product is
          tested against the same hypothetical policyholder, premium, and
          economic assumptions, so differences in grade reflect genuine
          differences in the product, not the input.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Sub-score weights</h2>
        <table style={table}>
          <thead>
            <tr><th style={th}>Sub-score</th><th style={th}>Weight</th><th style={th}>What it measures</th></tr>
          </thead>
          <tbody>
            {SUBSCORE_ORDER.map((k) => (
              <tr key={k}>
                <td style={td}><strong>{SUBSCORE_FULL[k]}</strong></td>
                <td style={td}>{(m.weights[k] * 100).toFixed(0)}%</td>
                <td style={td}>{m.sub_score_definitions[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={section}>
        <h2 style={h2}>Standardized scoring scenario</h2>
        <table style={table}>
          <tbody>
            <tr><td style={td}>Policyholder</td><td style={td}>{s.age}-year-old {s.gender === 'M' ? 'male' : 'female'}</td></tr>
            <tr><td style={td}>Premium</td><td style={td}>${s.premium.toLocaleString()}</td></tr>
            <tr><td style={td}>Income election age</td><td style={td}>{s.election_age}</td></tr>
            <tr><td style={td}>Projection horizon</td><td style={td}>{s.horizon_years} years</td></tr>
            <tr><td style={td}>Equity drift μ</td><td style={td}>{(s.mu * 100).toFixed(1)}%</td></tr>
            <tr><td style={td}>Volatility σ</td><td style={td}>{(s.sigma * 100).toFixed(1)}%</td></tr>
            <tr><td style={td}>Discount rate</td><td style={td}>{(s.discount_rate * 100).toFixed(1)}%</td></tr>
            <tr><td style={td}>Mortality table</td><td style={td}>{s.mortality_table}</td></tr>
            <tr><td style={td}>Base lapse</td><td style={td}>{(s.base_lapse * 100).toFixed(1)}%</td></tr>
            <tr><td style={td}>Dynamic lapse</td><td style={td}>{s.dynamic_lapse ? `Yes (sens ${s.lapse_sensitivity}, floor ${(s.lapse_min_multiplier*100).toFixed(0)}%)` : 'No'}</td></tr>
            <tr><td style={td}>Monte Carlo paths</td><td style={td}>{s.num_scenarios.toLocaleString()}</td></tr>
            <tr><td style={td}>Seed</td><td style={td}>{s.seed} (fixed; reproducibility required)</td></tr>
          </tbody>
        </table>
      </section>

      <section style={section}>
        <h2 style={h2}>Letter grade bands</h2>
        <p style={p}>
          A composite score maps to a letter grade by the first band whose
          minimum it meets or exceeds. The bands are:
        </p>
        <table style={table}>
          <thead>
            <tr><th style={th}>Min composite</th><th style={th}>Grade</th></tr>
          </thead>
          <tbody>
            {m.letter_bands.map((b) => (
              <tr key={b.grade}>
                <td style={td}>{b.min}</td>
                <td style={td}><strong>{b.grade}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={section}>
        <h2 style={h2}>Reproducibility</h2>
        <p style={p}>
          For a given (product spec, methodology version, seed), the rating
          output is byte-identical on re-run. Each rating page shows the
          first/last 4 hex digits of the product spec hash; the full hash is
          recorded in the rating JSON committed to the repository. Any change
          to the product spec produces a new hash and re-rate.
        </p>
        {m.notes && <p style={p}><em>{m.notes}</em></p>}
      </section>

      <footer style={footer}>
        <p>
          Ratings are opinions of the signing actuary based on this published
          methodology. They are not investment advice and do not constitute a
          recommendation or fiduciary relationship.
        </p>
      </footer>
    </div>
  );
}

const pageStyle = {
  maxWidth: 820, margin: '0 auto', padding: '32px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#111827',
};
const section = { marginTop: 28 };
const h2 = { fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#111827' };
const p  = { fontSize: 14.5, lineHeight: 1.65, color: '#1f2937' };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8 };
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #d1d5db', background: '#f9fafb' };
const td = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' };
const footer = { fontSize: 12, color: '#6b7280', marginTop: 32, borderTop: '1px solid #e5e7eb', paddingTop: 16 };
