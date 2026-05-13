/**
 * LensTabs — audience-oriented view selector for the ratings UI.
 *
 * Four lenses, each surfacing a different slice of contract features:
 *   - costs       : fees, drag, surrender length (default — fees are universal)
 *   - income      : rider terms, roll-up, withdrawal rate, step-up
 *   - carrier     : AM Best, PE ownership, Level 3 assets, cap-cut history
 *   - flexibility : surrender schedule, free withdrawal, hardship waivers
 *
 * No tooltips — labels stand alone. The convention here matches the design
 * principles K approved (see /methodology for deeper context).
 */

import React from 'react';

export const LENSES = [
  { id: 'costs',       label: 'Costs' },
  { id: 'income',      label: 'Income' },
  { id: 'carrier',     label: 'Carrier' },
  { id: 'flexibility', label: 'Flexibility' },
  { id: 'custom',      label: 'Custom' },
];

export default function LensTabs({ value, onChange, testid = 'lens-tabs' }) {
  return (
    <div
      data-testid={testid}
      role="tablist"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        background: '#f3f4f6',
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      {LENSES.map((lens) => {
        const active = lens.id === value;
        return (
          <button
            key={lens.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`${testid}-${lens.id}`}
            onClick={() => onChange(lens.id)}
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
              transition: 'background 120ms ease-out',
            }}
          >
            {lens.label}
          </button>
        );
      })}
    </div>
  );
}
