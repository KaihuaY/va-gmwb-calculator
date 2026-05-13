/**
 * Horizontal bar for one sub-score (0–100) with score, label, and rationale.
 */

import React from 'react';

const LABELS = {
  tco: 'Total Cost of Ownership',
  gv:  'Guarantee Value',
  sf:  'Surrender Flexibility',
  ic:  'Insurer Credit',
  bf:  'Behavioral Fairness',
};

function barColor(score) {
  if (score >= 80) return '#15803d';   // green
  if (score >= 65) return '#65a30d';   // lime
  if (score >= 50) return '#eab308';   // yellow
  if (score >= 35) return '#ea580c';   // orange
  return '#b91c1c';                    // red
}

export default function SubscoreBar({ id, score, rationale }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div
      data-testid={`subscore-${id}`}
      style={{ marginBottom: '14px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontWeight: 600,
          fontSize: '14px',
          marginBottom: '4px',
        }}
      >
        <span>{LABELS[id] || id}</span>
        <span style={{ color: barColor(score) }}>{score.toFixed(0)} / 100</span>
      </div>
      <div
        style={{
          background: '#e5e7eb',
          height: '8px',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor(score),
            transition: 'width 200ms ease-out',
          }}
        />
      </div>
      <div style={{ fontSize: '12.5px', color: '#4b5563', marginTop: '4px' }}>
        {rationale}
      </div>
    </div>
  );
}
