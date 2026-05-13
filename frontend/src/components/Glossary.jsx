/**
 * Glossary — inline tooltip for actuarial / annuity acronyms.
 *
 * Usage:
 *   <Glossary term="GLWB">GLWB</Glossary>
 *   <Glossary term="M&E">M&E</Glossary>
 *
 * Renders an <abbr> with a `title` attribute so the definition shows on hover
 * (native browser tooltip — no JS popper dependency, works on SSG static HTML).
 *
 * Export `GlossaryList` to render the full term list at the bottom of the
 * methodology page (data-testid="glossary-list").
 */

import React from 'react';

export const GLOSSARY_TERMS = {
  GLWB: 'Guaranteed Lifetime Withdrawal Benefit — an optional rider that pays the policyholder a fixed annual withdrawal amount for life, even after the account value is depleted.',
  GMDB: 'Guaranteed Minimum Death Benefit — pays beneficiaries the greater of the account value or the benefit base (a contractually defined floor) at death.',
  'M&E': 'Mortality & Expense fee — annual base-contract charge as a percentage of account value, covering insurance risk and administrative cost.',
  buffer: 'Buffer — the insurer absorbs index losses up to a stated percentage (e.g. 10%); losses beyond the buffer pass to the policyholder.',
  floor: 'Floor — the insurer absorbs all losses beyond a stated negative percentage (e.g. losses worse than -10% are absorbed); upside is typically capped or spread-reduced.',
  'cap rate': 'Cap rate — the maximum index credit the policyholder can receive in a segment period (e.g. 10% cap means upside above 10% is forfeited).',
  'participation rate': 'Participation rate — the percentage of index gain credited to the policyholder (e.g. 90% participation on a 10% index gain credits 9%).',
  spread: 'Spread — a fixed deduction from the index return before crediting (e.g. a 2% spread on a 10% index return credits 8%).',
  trigger: 'Trigger rate — a fixed credit paid if the index return is at or above zero (or any positive threshold); zero crediting otherwise.',
  'surrender period': 'Surrender period — the number of years during which withdrawals above the free corridor incur a contingent deferred sales charge.',
  'free-withdrawal corridor': 'Free-withdrawal corridor — the annual percentage of account value (typically 10%) that can be withdrawn without triggering a surrender charge.',
  'AM Best': 'AM Best — an independent credit rating agency specialising in the insurance industry; ratings range from A++ (Superior) to D (Poor).',
  'Scale G2': 'Scale G2 — the Society of Actuaries’ mortality-improvement projection scale applied to the 2012 IAM base table to reflect future longevity improvements.',
  'Monte Carlo': 'Monte Carlo — a simulation method that generates thousands of random scenarios and averages outcomes to estimate the expected value of a path-dependent guarantee.',
};

// Build a case-insensitive lookup map for matching.
const LOWER_MAP = Object.fromEntries(
  Object.entries(GLOSSARY_TERMS).map(([k, v]) => [k.toLowerCase(), { canonical: k, def: v }]),
);

export default function Glossary({ term, children }) {
  const key = (term || (typeof children === 'string' ? children : '')).toLowerCase();
  const entry = LOWER_MAP[key];
  if (!entry) {
    return <>{children ?? term}</>;
  }
  return (
    <abbr
      title={entry.def}
      data-glossary-term={entry.canonical}
      style={{
        textDecoration: 'underline dotted',
        textDecorationColor: '#9ca3af',
        textUnderlineOffset: 2,
        cursor: 'help',
      }}
    >
      {children ?? term}
    </abbr>
  );
}

export function GlossaryList() {
  const entries = Object.entries(GLOSSARY_TERMS);
  return (
    <dl
      data-testid="glossary-list"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, max-content) 1fr',
        gap: '6px 18px',
        fontSize: 13.5,
        margin: 0,
      }}
    >
      {entries.map(([term, def]) => (
        <React.Fragment key={term}>
          <dt style={{ fontWeight: 700, color: '#111827' }}>{term}</dt>
          <dd style={{ margin: 0, color: '#374151', lineHeight: 1.55 }}>{def}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
