/**
 * FreshnessBadge — pill showing how recently the cap rate (or other source-
 * dependent field) was verified against its public source. Color-coded:
 *   green  ≤ 30 days
 *   yellow ≤ 90 days
 *   red    > 90 days or never verified
 *
 * Props:
 *   verified  ISO date string ('YYYY-MM-DD'), nullable
 *   sourceUrl optional URL that opens in a new tab when clicked
 *   asOf      reference date for the age calc; defaults to today
 *   compact   if true, render just the dot + age (no "verified" word)
 */
import React from 'react';

function daysBetween(a, b) {
  return Math.floor((+a - +b) / 86_400_000);
}

function bandColors(status) {
  switch (status) {
    case 'green':  return { dot: '#16a34a', bg: '#dcfce7', text: '#166534' };
    case 'yellow': return { dot: '#ca8a04', bg: '#fef9c3', text: '#854d0e' };
    default:       return { dot: '#dc2626', bg: '#fee2e2', text: '#991b1b' };
  }
}

export default function FreshnessBadge({ verified, sourceUrl, asOf, compact = false }) {
  let status = 'red';
  let label = 'unverified';
  let title = 'No verification date recorded for this cap rate.';
  if (verified) {
    const d = new Date(verified + 'T00:00:00Z');
    const base = asOf ? new Date(asOf + 'T00:00:00Z') : new Date();
    const age = Math.max(0, daysBetween(base, d));
    if (age <= 30)      status = 'green';
    else if (age <= 90) status = 'yellow';
    else                status = 'red';
    label = age === 0 ? 'today' : age === 1 ? '1 day' : `${age} days`;
    title = `Cap rate last verified ${verified} (${age} days ago)`;
  }
  const c = bandColors(status);
  const inner = (
    <span
      data-testid="freshness-badge"
      data-status={status}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '1px 6px' : '2px 8px',
        background: c.bg,
        color: c.text,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        display: 'inline-block', width: 6, height: 6,
        borderRadius: 999, background: c.dot,
      }} />
      {compact ? label : `verified ${label}`}
    </span>
  );
  if (sourceUrl) {
    return (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: 'none' }}
      >
        {inner}
      </a>
    );
  }
  return inner;
}
