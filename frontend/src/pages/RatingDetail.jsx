/**
 * /ratings/:slug — single product rating page (redesigned for advisors/clients).
 *
 * Reading order, per design principles K approved:
 *   1. Hero (carrier + product + letter grade + M/F/Blended toggle)
 *   2. Synthesised one-sentence verdict (algorithmic, from sub-scores)
 *   3. SignatureBlock (REQUIRED — always rendered when signed_by present)
 *   4. ProductFeatureCard with lens tabs (Costs / Income / Carrier / Flexibility)
 *   5. Narrative paragraph
 *   6. Standardized scoring scenario summary
 *   7. Collapsible "Methodology score breakdown" — the 5 sub-score bars live
 *      inside a <details> element. They are inside-baseball and hidden by
 *      default. Crucially, they remain DOM-queryable for the Playwright
 *      smoke test (data-testid="subscore-{key}" still present).
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

function gradeColor(g) {
  if (!g) return '#6b7280';
  if (g.startsWith('A')) return '#15803d';
  if (g.startsWith('B')) return '#65a30d';
  if (g.startsWith('C')) return '#eab308';
  if (g.startsWith('D')) return '#ea580c';
  return '#b91c1c';
}

// Pick which sub-score block + composite + letter to show
// based on the user-selected gender view.
function resolveGenderView(rating, view) {
  if (view === 'M' && rating.male_scores) {
    return {
      sub: rating.male_scores,
      composite: rating.male_composite ?? rating.composite,
      letter: rating.male_letter_grade ?? rating.letter_grade,
    };
  }
  if (view === 'F' && rating.female_scores) {
    return {
      sub: rating.female_scores,
      composite: rating.female_composite ?? rating.composite,
      letter: rating.female_letter_grade ?? rating.letter_grade,
    };
  }
  return {
    sub: rating.sub_scores,
    composite: rating.composite,
    letter: rating.letter_grade,
  };
}

export default function RatingDetail() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lens, setLens] = useState('costs');
  const [genderView, setGenderView] = useState('blend');

  useEffect(() => {
    getRating(slug)
      .then(setData)
      .catch((e) => setError(e.response?.status === 404 ? 'not_found' : (e.message || 'error')));
  }, [slug]);

  if (error === 'not_found') return <NotFound slug={slug} />;
  if (error)  return <div style={pageStyle}>Error: {error}</div>;
  if (!data)  return <div data-testid="rating-detail-loading" style={pageStyle}>Loading…</div>;

  const { rating, product } = data;
  const view = resolveGenderView(rating, genderView);
  const hasGenderBlend = rating.male_scores && rating.female_scores;

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
            <br />
            <Link to="/methodology" style={{ color: '#2563eb' }}>
              Methodology {rating.methodology_version}
            </Link>
          </div>
          {hasGenderBlend && (
            <div
              data-testid="gender-toggle"
              role="tablist"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                gap: 4,
                padding: 4,
                background: '#f3f4f6',
                borderRadius: 8,
              }}
            >
              {[
                { id: 'blend', label: 'Blended' },
                { id: 'M',     label: 'Male'    },
                { id: 'F',     label: 'Female'  },
              ].map((opt) => {
                const active = genderView === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`gender-${opt.id}`}
                    onClick={() => setGenderView(opt.id)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 500,
                      fontSize: 13,
                      background: active ? '#ffffff' : 'transparent',
                      color: active ? '#111827' : '#4b5563',
                      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
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

      {/* 5. Narrative */}
      <section style={sectionStyle} data-testid="narrative">
        <h2 style={h2Style}>Why this grade</h2>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: '#1f2937' }}>
          {rating.narrative}
        </p>
      </section>

      {/* 6. Scoring scenario */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>Standardized scoring scenario</h2>
        <p style={{ fontSize: 14, color: '#4b5563' }}>
          Rated for a {rating.scoring_inputs.age}-year-old
          {rating.scoring_inputs.gender_blend === false
            ? (rating.scoring_inputs.gender === 'M' ? ' male' : ' female')
            : ' (50/50 male/female blend)'},&nbsp;
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
            {hasGenderBlend && (
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 12 }}>
                Currently showing{' '}
                {genderView === 'blend' ? '50/50 blended' :
                  genderView === 'M' ? 'male-only' : 'female-only'}{' '}
                scores. Use the gender toggle in the header to switch perspectives.
              </p>
            )}
          </div>
        </details>
      </section>

      {/* 8. Disclaimer */}
      <footer style={footerStyle}>
        <p>
          Annuity ratings are the opinion of the named signing actuary based on
          the published methodology ({rating.methodology_version}). They are
          not investment advice, do not constitute a recommendation, and do not
          create a fiduciary relationship. The default grade is a 50/50 blend
          of male and female standardized scenarios; the gender toggle above
          shows either single-gender perspective. Ratings reflect data available
          as of the rating date and may change. Contract terms vary; consult
          the product prospectus and a qualified advisor before purchase.
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
