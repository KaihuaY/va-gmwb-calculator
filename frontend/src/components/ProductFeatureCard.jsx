/**
 * ProductFeatureCard — surfaces contract terms for the active lens
 * (Costs / Income / Carrier / Flexibility) on the rating detail page.
 *
 * Receives the full product spec + the active lens; renders a focused list of
 * plain-English contract features. This is what advisors actually compare on
 * (per design-principle 2: contract features over sub-scores).
 */

import React from 'react';

function pct(v, digits = 2) {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function describeSegment(s) {
  const parts = [`${s.term_years}-yr ${s.crediting_method}`];
  if (s.cap_rate != null)           parts.push(`cap ${pct(s.cap_rate, 1)}`);
  if (s.participation_rate != null) parts.push(`par ${pct(s.participation_rate, 0)}`);
  if (s.spread != null)             parts.push(`spread ${pct(s.spread, 1)}`);
  if (s.trigger_rate != null)       parts.push(`trigger ${pct(s.trigger_rate, 1)}`);
  parts.push(`${pct(s.protection_level, 0)} ${s.protection_type}`);
  return parts.join(', ');
}

function Row({ label, value, emphasis }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '8px 0',
        borderBottom: '1px solid #f3f4f6',
        fontSize: 14,
      }}
    >
      <span style={{ color: '#4b5563' }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: emphasis ? 700 : 500, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

export default function ProductFeatureCard({ product, lens }) {
  if (!product) return null;
  const base = product.base || {};
  const rider = product.rider || {};
  const insurer = product.insurer || {};
  const behavioral = product.behavioral_data || {};
  const hasGlwb = rider.type === 'glwb';
  const schedule = base.surrender_schedule || [];

  let rows = [];
  let title = '';

  if (lens === 'costs') {
    title = 'Cost summary';
    rows = [
      { label: 'M&E + admin fee',       value: pct(base.me_fee_annual, 2), emphasis: true },
      { label: 'Income rider fee',      value: hasGlwb ? pct(rider.rider_fee_annual, 2) : 'No income rider' },
      { label: 'All-in annual cost',    value: pct((base.me_fee_annual || 0) + (hasGlwb ? (rider.rider_fee_annual || 0) : 0), 2), emphasis: true },
      { label: 'Surrender period',      value: schedule.length ? `${schedule.length} years` : 'None' },
      { label: 'Max surrender charge',  value: schedule.length ? pct(Math.max(...schedule), 1) : '—' },
      { label: 'Free withdrawal',       value: pct(base.free_withdrawal_pct, 0) + ' per year' },
    ];
  } else if (lens === 'income') {
    title = hasGlwb ? 'Income rider terms' : 'Income rider terms';
    if (!hasGlwb) {
      rows = [
        { label: 'Income rider', value: 'Not available on this product' },
        { label: 'M&E + admin fee', value: pct(base.me_fee_annual, 2) },
      ];
    } else {
      const wd = rider.withdrawal_rate_by_age || {};
      rows = [
        { label: 'Rider fee',           value: pct(rider.rider_fee_annual, 2), emphasis: true },
        { label: 'Roll-up rate',        value: pct(rider.rollup_rate, 2) },
        { label: 'Withdrawal @ age 65', value: pct(wd['65+'] ?? 0.05, 2), emphasis: true },
        { label: 'Withdrawal @ age 60', value: pct(wd['60-64'] ?? 0.05, 2) },
        { label: 'Withdrawal @ age 55', value: pct(wd['55-59'] ?? 0.04, 2) },
        { label: 'Step-up (ratchet)',   value: rider.step_up ? 'Yes' : 'No' },
      ];
    }
  } else if (lens === 'carrier') {
    title = 'Carrier & credit';
    rows = [
      { label: 'Carrier',           value: product.carrier, emphasis: true },
      { label: 'AM Best',           value: insurer.am_best || '—', emphasis: true },
      { label: 'S&P',               value: insurer.sp || '—' },
      { label: "Moody's",           value: insurer.moodys || '—' },
      { label: 'PE-owned',          value: insurer.pe_owned ? 'Yes' : 'No' },
      { label: 'Level 3 assets',    value: pct(insurer.level_3_pct_2024, 0) },
      { label: 'Cap-rate cuts (5y)',value: String(Math.max(0, (behavioral.cap_history || []).length - 1)) },
      { label: 'Regulatory fines (5y)', value: String(behavioral.regulatory_fines_5yr ?? 0) },
    ];
  } else if (lens === 'flexibility') {
    title = 'Flexibility & exit terms';
    const waivers = [];
    if (base.nursing_home_waiver)    waivers.push('nursing-home');
    if (base.terminal_illness_waiver) waivers.push('terminal-illness');
    if (base.disability_waiver)      waivers.push('disability');
    rows = [
      { label: 'Surrender period',      value: schedule.length ? `${schedule.length} years` : 'None', emphasis: true },
      {
        label: 'Surrender schedule',
        value: schedule.length
          ? schedule.map((p, i) => `Y${i+1} ${(p*100).toFixed(0)}%`).join(' · ')
          : 'No surrender charges',
      },
      { label: 'Free withdrawal', value: pct(base.free_withdrawal_pct, 0) + ' per year', emphasis: true },
      { label: 'Hardship waivers', value: waivers.length ? waivers.join(', ') : 'None' },
      {
        label: 'Investment segments',
        value: (product.segments_available || []).map(describeSegment).join(' · ') || '—',
      },
    ];
  }

  return (
    <section
      data-testid={`feature-card-${lens}`}
      style={{
        marginTop: 18,
        padding: 18,
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        background: '#ffffff',
      }}
    >
      <h2 style={{
        fontSize: 14,
        fontWeight: 700,
        margin: 0,
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: '#6b7280',
      }}>
        {title}
      </h2>
      <div>
        {rows.map((r, i) => (
          <Row key={i} label={r.label} value={r.value} emphasis={r.emphasis} />
        ))}
      </div>
    </section>
  );
}
