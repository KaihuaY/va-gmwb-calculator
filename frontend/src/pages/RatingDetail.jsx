/**
 * /ratings/:slug — single product rating page (redesigned for advisors/clients).
 *
 * Reading order:
 *   1. Hero (carrier + product + letter grade)
 *   2. Synthesised one-sentence verdict (algorithmic, from sub-scores)
 *   3. SignatureBlock (REQUIRED — always rendered when signed_by present)
 *   4. ProductFeatureCard with lens tabs (Costs / Income / Carrier / Flexibility)
 *   5. Narrative paragraph
 *   6. Standardized scoring scenario summary
 *   7. Collapsible "Methodology score breakdown" — the 5 sub-score bars live
 *      inside a <details> element, hidden by default. They remain
 *      DOM-queryable for the Playwright smoke test.
 *
 * Required test hooks (do not remove):
 *   [data-testid="rating-detail"]
 *   [data-testid="hero-grade"]
 *   [data-testid="signature-block"]
 *   [data-testid="signed-by"]
 *   [data-testid="subscore-tco"|"gv"|"sf"|"ic"|"bf"]
 */

import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRating } from '../api/client';
import SignatureBlock from '../components/SignatureBlock';
import SubscoreBar from '../components/SubscoreBar';
import LensTabs from '../components/LensTabs';
import ProductFeatureCard from '../components/ProductFeatureCard';
import RegimeBacktestPanel from '../components/RegimeBacktestPanel';
import Glossary, { GLOSSARY_TERMS } from '../components/Glossary';

// Sort longest-first so e.g. "free-withdrawal corridor" matches before
// "buffer". Build a single case-insensitive regex with word boundaries
// (allowing for & in M&E and hyphens in compound terms).
const GLOSSARY_KEYS = Object.keys(GLOSSARY_TERMS).sort((a, b) => b.length - a.length);
const GLOSSARY_REGEX = new RegExp(
  '\\b(' + GLOSSARY_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'gi',
);

/**
 * Walks plain narrative text and wraps any known acronym in <Glossary>. Returns
 * an array of React nodes safe to render inline.
 */
function glossifyText(text) {
  if (!text) return text;
  const parts = [];
  let lastIdx = 0;
  let m;
  GLOSSARY_REGEX.lastIndex = 0;
  while ((m = GLOSSARY_REGEX.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(
      <Glossary key={`g-${m.index}`} term={m[0]}>{m[0]}</Glossary>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function gradeColor(g) {
  if (!g) return '#6b7280';
  if (g.startsWith('A')) return '#15803d';
  if (g.startsWith('B')) return '#65a30d';
  if (g.startsWith('C')) return '#eab308';
  if (g.startsWith('D')) return '#ea580c';
  return '#b91c1c';
}

export default function RatingDetail() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lens, setLens] = useState('costs');

  useEffect(() => {
    getRating(slug)
      .then(setData)
      .catch((e) => setError(e.response?.status === 404 ? 'not_found' : (e.message || 'error')));
  }, [slug]);

  if (error === 'not_found') return <NotFound slug={slug} />;
  if (error)  return <div style={pageStyle}>Error: {error}</div>;
  if (!data)  return <div data-testid="rating-detail-loading" style={pageStyle}>Loading…</div>;

  const { rating, product } = data;
  const view = {
    sub: rating.sub_scores,
    composite: rating.composite,
    letter: rating.letter_grade,
  };

  // Schema.org Review JSON-LD for SEO — always references the published
  // (blended) composite, not the user-toggle view.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Review',
    itemReviewed: {
      '@type': 'FinancialProduct',
      name: rating.product_name,
      brand: rating.carrier,
    },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: rating.letter_grade,
      bestRating: 'A+',
      worstRating: 'F',
    },
    author: {
      '@type': 'Person',
      name: rating.signed_by,
      jobTitle: rating.signed_credentials,
    },
    datePublished: rating.signed_at,
    reviewBody: rating.narrative,
  };

  return (
    <div data-testid="rating-detail" style={pageStyle}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link to="/ratings" style={{ fontSize: 13, color: '#2563eb' }}>← All ratings</Link>

      {/* 1. Hero */}
      <header style={{ marginTop: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {rating.carrier}
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, margin: '4px 0 12px' }}>
          {rating.product_name}
        </h1>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            data-testid="hero-grade"
            style={{
              fontSize: 72, fontWeight: 800, lineHeight: 1, color: gradeColor(view.letter),
            }}
          >
            {view.letter}
          </div>
          <div style={{ fontSize: 14, color: '#4b5563' }}>
            Composite&nbsp;
            <strong style={{ color: '#111827' }}>{view.composite?.toFixed(1)}</strong>&nbsp;/&nbsp;100
            {rating.allocation_range && rating.allocation_range.spread_points >= 2 && (
              <span data-testid="allocation-range" style={{
                marginLeft: 8, fontSize: 12, color: '#6b7280',
                background: '#f3f4f6', padding: '2px 8px', borderRadius: 999,
              }}
              title="Range across the three allocation profiles. Conservative = 100% in most-protected segment; Balanced (published) = equal weight; Growth = 100% in least-protected segment.">
                Range {rating.allocation_range.min_composite.toFixed(0)}–{rating.allocation_range.max_composite.toFixed(0)}
              </span>
            )}
            <br />
            <Link to="/methodology" style={{ color: '#2563eb' }}>
              Methodology {rating.methodology_version}
            </Link>
          </div>
          {rating.stress_score != null && (
            <div
              data-testid="stress-score"
              title={`Worst of the 5 historical regime scores — supplementary detail. NOT in the composite.${rating.worst_regime_key ? ' Worst regime: ' + rating.worst_regime_key : ''}`}
              style={{
                marginLeft: 'auto',
                fontSize: 13,
                color: '#4b5563',
                background: '#f3f4f6',
                padding: '10px 14px',
                borderRadius: 10,
                lineHeight: 1.4,
                minWidth: 160,
              }}
            >
              <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Stress score (worst regime)
              </div>
              <div style={{ marginTop: 2 }}>
                <strong style={{ color: gradeColor(rating.stress_letter_grade), fontSize: 18 }}>
                  {rating.stress_letter_grade}
                </strong>{' '}
                <span style={{ color: '#111827' }}>{rating.stress_score.toFixed(1)}</span>
                <span style={{ color: '#6b7280' }}> / 100</span>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                Not in composite
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 2. Synthesised verdict — algorithmic, one sentence */}
      <p
        data-testid="verdict"
        style={{
          fontSize: 17,
          lineHeight: 1.5,
          color: '#111827',
          margin: '4px 0 22px',
          padding: '14px 18px',
          background: '#fafafa',
          borderLeft: `3px solid ${gradeColor(view.letter)}`,
          borderRadius: 4,
        }}
      >
        {rating.verdict ||
          'Letter grade reflects the standardized scoring scenario; toggle a lens below to compare contract terms.'}
      </p>

      {/* 3. Signature Block — REQUIRED */}
      <SignatureBlock
        signedBy={rating.signed_by}
        credentials={rating.signed_credentials}
        signedAt={rating.signed_at}
        methodologyVersion={rating.methodology_version}
        productSpecHash={rating.product_spec_hash}
      />

      {/* 4. Contract-feature card with lens tabs */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={h2Style}>Contract terms</h2>
          <LensTabs value={lens} onChange={setLens} testid="detail-lens-tabs" />
        </div>
        <ProductFeatureCard product={product} lens={lens} />
      </section>

      {/* 4a. Allocation profile composites — surfaces dispersion across the
          conservative/balanced/growth allocation choices. The PUBLISHED
          composite (hero number above) is the balanced profile. */}
      {rating.allocation_scores && (
        <section style={sectionStyle} data-testid="allocation-profiles">
          <h2 style={h2Style}>Score by allocation choice</h2>
          <p style={{ fontSize: 13.5, color: '#4b5563', margin: '0 0 12px', lineHeight: 1.55 }}>
            Buyers can mix across the available segments. Headline grade above
            is the <strong>balanced</strong> profile (equal weight). Conservative
            loads 100% into the most-protected segment; growth loads 100% into
            the least-protected. Spread:&nbsp;
            <strong>{rating.allocation_range.spread_points.toFixed(1)}</strong> points.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {['conservative', 'balanced', 'growth'].map((name) => {
              const p = rating.allocation_scores[name];
              if (!p) return null;
              const isPublished = name === 'balanced';
              return (
                <div
                  key={name}
                  data-testid={`alloc-${name}`}
                  style={{
                    padding: '12px 14px',
                    border: `1px solid ${isPublished ? '#2563eb' : '#e5e7eb'}`,
                    background: isPublished ? '#eff6ff' : '#ffffff',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {name}{isPublished ? ' · published' : ''}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14 }}>
                    <strong style={{ color: gradeColor(p.letter_grade), fontSize: 22 }}>
                      {p.letter_grade}
                    </strong>
                    &nbsp;<span style={{ color: '#111827' }}>{p.composite.toFixed(1)}</span>
                    <span style={{ color: '#6b7280' }}> / 100</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: '#6b7280', lineHeight: 1.4 }}>
                    {name === 'conservative' && '100% in most-protected segment'}
                    {name === 'balanced' && 'Equal weight across all segments'}
                    {name === 'growth' && '100% in least-protected segment'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4b. Historical regime backtest — interactive what-if. NOT scored. */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>How this contract would have performed in past markets</h2>
        <p style={{ fontSize: 13.5, color: '#4b5563', margin: '0 0 14px', lineHeight: 1.55 }}>
          Deterministic replay of this contract against actual S&amp;P 500 monthly
          returns, starting from the same $250K premium used in the composite
          rating above. Same dollar basis means the trajectory, terminal AV, and
          PV(rider claims) shown elsewhere on this page all line up. This is a
          what-if scenario — it does <strong>not</strong> enter the composite
          rating score.
        </p>
        <RegimeBacktestPanel slug={slug} />
      </section>

      {/* 5. Narrative — acronyms get an inline glossary tooltip */}
      <section style={sectionStyle} data-testid="narrative">
        <h2 style={h2Style}>Why this grade</h2>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: '#1f2937' }}>
          {glossifyText(rating.narrative)}
        </p>
      </section>

      {/* 6. Scoring scenario */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Standardized scoring scenario</h2>
        <p style={{ fontSize: 14, color: '#4b5563' }}>
          Rated for a {rating.scoring_inputs.age}-year-old
          {' '}(50/50 blended-gender mortality),&nbsp;
          ${rating.scoring_inputs.premium.toLocaleString()} premium, planning
          to draw income at age 65, over {rating.scoring_inputs.horizon_years} years.
          All products are rated against this identical scenario.
        </p>
        <table style={specsTable} data-testid="monte-carlo-table">
          <tbody>
            <tr><td>PV(rider claims)</td><td>${rating.monte_carlo.glwb_pv_mean.toLocaleString()}</td></tr>
            <tr><td>PV(all fees)</td><td>${rating.monte_carlo.fees_pv_mean.toLocaleString()}</td></tr>
            <tr><td>Terminal AV (p50)</td><td>${rating.monte_carlo.av_end_p50.toLocaleString()}</td></tr>
            <tr><td>Terminal AV (p95)</td><td>${rating.monte_carlo.av_end_p95.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </section>

      {/* 7. Methodology score breakdown — collapsed by default. Sub-score bars
          (TCO/GV/SF/IC/BF) remain queryable in the DOM so the Playwright
          smoke test can find them by data-testid. */}
      <section style={sectionStyle}>
        <details data-testid="score-breakdown">
          <summary style={{
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            color: '#1f2937',
            padding: '10px 14px',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            userSelect: 'none',
          }}>
            Methodology score breakdown <span style={{ color: '#6b7280', fontWeight: 400 }}>(actuary view)</span>
          </summary>
          <div style={{ padding: '16px 4px 4px' }}>
            <p style={{ fontSize: 13, color: '#4b5563', marginTop: 0, marginBottom: 14 }}>
              Each axis runs 0–100. The composite is the equal-weighted average.
              See <Link to="/methodology" style={{ color: '#2563eb' }}>methodology {rating.methodology_version}</Link>
              {' '}for the formulas behind each axis.
            </p>
            {['tco', 'gv', 'sf', 'ic', 'bf'].map((id) => (
              <SubscoreBar
                key={id}
                id={id}
                score={view.sub[id].score}
                rationale={view.sub[id].rationale}
              />
            ))}
          </div>
        </details>
      </section>

      {/* 8. Disclaimer */}
      <footer style={footerStyle}>
        <p>
          Annuity ratings are the opinion of the named signing actuary based on
          the published methodology ({rating.methodology_version}). They are
          not investment advice, do not constitute a recommendation, and do not
          create a fiduciary relationship. Mortality is a 50/50 blended-gender
          cohort. Ratings reflect data available as of the rating date and may
          change. Contract terms vary; consult the product prospectus and a
          qualified advisor before purchase.
        </p>
      </footer>
    </div>
  );
}

function NotFound({ slug }) {
  return (
    <div data-testid="rating-not-found" style={pageStyle}>
      <Link to="/ratings" style={{ color: '#2563eb' }}>← All ratings</Link>
      <h1 style={{ fontSize: 28, marginTop: 16 }}>Rating not found</h1>
      <p style={{ color: '#4b5563' }}>
        No published rating found for <code>{slug}</code>. It may not yet be
        signed and published.
      </p>
    </div>
  );
}

const pageStyle = {
  maxWidth: 920, margin: '0 auto', padding: '32px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#111827',
};
const sectionStyle = { marginTop: 28 };
const h2Style = { fontSize: 18, fontWeight: 700, marginBottom: 12, color: '#111827' };
const specsTable = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const footerStyle = {
  fontSize: 12, color: '#6b7280', marginTop: 32,
  borderTop: '1px solid #e5e7eb', paddingTop: 16,
};
