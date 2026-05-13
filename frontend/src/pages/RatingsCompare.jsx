/**
 * /ratings/compare?slugs=a,b,c — side-by-side comparison of 2-3 product ratings.
 *
 * Reuses SubscoreBar and ProductFeatureCard from the detail page. Each column
 * shows: hero grade, composite, all 5 sub-score bars (always expanded — not
 * collapsed), and the contract-feature snapshot for all 4 lenses (stacked
 * vertically so the rows align across columns).
 *
 * Required test hooks:
 *   [data-testid="compare-page"]
 *   [data-testid="compare-col-<slug>"]
 *   [data-testid="subscore-<id>"] (5 per product — reused from SubscoreBar)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getRating } from '../api/client';
import SubscoreBar from '../components/SubscoreBar';
import ProductFeatureCard from '../components/ProductFeatureCard';
import { LENSES } from '../components/LensTabs';

function gradeColor(g) {
  if (!g) return '#6b7280';
  if (g.startsWith('A')) return '#15803d';
  if (g.startsWith('B')) return '#65a30d';
  if (g.startsWith('C')) return '#eab308';
  if (g.startsWith('D')) return '#ea580c';
  return '#b91c1c';
}

export default function RatingsCompare() {
  const [params] = useSearchParams();
  const slugs = useMemo(() => {
    const raw = params.get('slugs') || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  }, [params]);

  const [columns, setColumns] = useState([]); // [{ slug, rating, product, error }]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      slugs.map((slug) =>
        getRating(slug)
          .then((d) => ({ slug, rating: d.rating, product: d.product, error: null }))
          .catch((e) => ({ slug, rating: null, product: null, error: e.message || 'error' })),
      ),
    ).then((cols) => {
      if (cancelled) return;
      setColumns(cols);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [slugs.join('|')]);

  if (slugs.length === 0) {
    return (
      <div data-testid="compare-page" style={pageStyle}>
        <Link to="/ratings" style={{ fontSize: 13, color: '#2563eb' }}>← All ratings</Link>
        <h1 style={h1Style}>Compare ratings</h1>
        <p style={{ color: '#4b5563' }}>
          No products selected. Return to <Link to="/ratings">the ratings index</Link> and
          tick 2 or 3 boxes to compare.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div data-testid="compare-page" style={pageStyle}>
        <div data-testid="compare-loading">Loading {slugs.length} ratings…</div>
      </div>
    );
  }

  const colCount = columns.length;
  const colMinWidth = colCount === 2 ? 320 : 280;

  return (
    <div data-testid="compare-page" style={pageStyle}>
      <Link to="/ratings" style={{ fontSize: 13, color: '#2563eb' }}>← All ratings</Link>
      <h1 style={h1Style}>Side-by-side comparison</h1>
      <p style={{ color: '#4b5563', fontSize: 14, margin: '0 0 18px' }}>
        Comparing {colCount} product{colCount === 1 ? '' : 's'} against the same
        standardized scoring scenario (60-year-old, $250K premium, election age 65,
        30-year horizon). All five sub-scores are shown for each product.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${colCount}, minmax(${colMinWidth}px, 1fr))`,
          gap: 18,
        }}
      >
        {columns.map((col) => (
          <CompareColumn key={col.slug} col={col} />
        ))}
      </div>

      <footer style={footerStyle}>
        <p>
          Each rating reflects the published methodology and the named signing
          actuary's opinion. Differences between products in this view reflect
          differences in the contract, not in the scoring inputs (those are held
          constant). Not investment advice.
        </p>
      </footer>
    </div>
  );
}

function CompareColumn({ col }) {
  const { slug, rating, product, error } = col;
  if (error || !rating) {
    return (
      <div
        data-testid={`compare-col-${slug}`}
        style={{ ...colStyle, padding: 18 }}
      >
        <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600 }}>
          Rating not found
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
          <code>{slug}</code>
        </div>
      </div>
    );
  }

  const sub = rating.sub_scores || {};

  return (
    <div data-testid={`compare-col-${slug}`} style={colStyle}>
      {/* Hero */}
      <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {rating.carrier}
        </div>
        <Link
          to={`/ratings/${slug}`}
          style={{
            display: 'block',
            fontSize: 18,
            fontWeight: 700,
            color: '#111827',
            textDecoration: 'none',
            margin: '4px 0 10px',
          }}
        >
          {rating.product_name}
        </Link>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div
            data-testid={`compare-grade-${slug}`}
            style={{
              fontSize: 44,
              fontWeight: 800,
              lineHeight: 1,
              color: gradeColor(rating.letter_grade),
            }}
          >
            {rating.letter_grade}
          </div>
          <div style={{ fontSize: 13, color: '#4b5563' }}>
            Composite&nbsp;
            <strong style={{ color: '#111827' }}>
              {typeof rating.composite === 'number' ? rating.composite.toFixed(1) : '—'}
            </strong>
            &nbsp;/&nbsp;100
          </div>
        </div>
      </div>

      {/* Sub-scores — all 5, always visible */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <h3 style={h3Style}>Sub-scores</h3>
        {['tco', 'gv', 'sf', 'ic', 'bf'].map((id) => (
          <SubscoreBar
            key={id}
            id={id}
            score={(sub[id] && sub[id].score) ?? 0}
            rationale={(sub[id] && sub[id].rationale) ?? ''}
          />
        ))}
      </div>

      {/* Contract features — all 4 lenses stacked */}
      <div style={{ padding: '14px 16px' }}>
        <h3 style={h3Style}>Contract features</h3>
        {LENSES.map((lens) => (
          <ProductFeatureCard
            key={lens.id}
            product={product}
            lens={lens.id}
          />
        ))}
      </div>
    </div>
  );
}

const pageStyle = {
  maxWidth: 1280, margin: '0 auto', padding: '32px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#111827',
};
const h1Style = { fontSize: 28, fontWeight: 700, margin: '12px 0 6px' };
const h3Style = {
  fontSize: 12, fontWeight: 700, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: 0.6,
  margin: '0 0 10px',
};
const colStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#ffffff',
  overflow: 'hidden',
};
const footerStyle = {
  fontSize: 12, color: '#6b7280', marginTop: 32,
  borderTop: '1px solid #e5e7eb', paddingTop: 16,
};
