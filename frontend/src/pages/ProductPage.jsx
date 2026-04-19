import { Link } from 'react-router-dom';
import { PRODUCT_PRESETS, encodeParamsToHash } from '../App';

// ---------------------------------------------------------------------------
// Per-product SEO metadata and descriptions
// ---------------------------------------------------------------------------
const PRODUCT_META = {
  jackson: {
    slug: 'jackson-national-gmwb-calculator',
    issuer: 'Jackson National Life',
    product: 'LifeGuard Freedom Flex',
    type: 'Variable Annuity — GMWB',
    description:
      "Jackson National's LifeGuard Freedom Flex is one of the most widely sold variable annuity income riders in the U.S. It offers a 7% compound roll-up rate during deferral, an annual step-up ratchet, and guaranteed lifetime withdrawals starting at 5% per year for ages 65+. This calculator models the actuarial present value of the income guarantee across 1,000 Monte Carlo scenarios using real mortality tables.",
    highlights: [
      { label: 'Roll-up Rate', value: '7% compound' },
      { label: 'Withdrawal Rate', value: '5.0% (age 65+)' },
      { label: 'Rider Fee', value: '1.50% of benefit base/yr' },
      { label: 'Step-up Ratchet', value: 'Annual' },
    ],
    source: 'Parameters from Jackson National public prospectus and industry disclosures.',
  },
  equitable: {
    slug: 'equitable-gmwb-calculator',
    issuer: 'Equitable Financial',
    product: 'Retirement Cornerstone Series B',
    type: 'Variable Annuity — GMWB',
    description:
      "Equitable's Retirement Cornerstone Series B is a leading variable annuity with a Guaranteed Minimum Withdrawal Benefit. It features a floating 5–10% roll-up rate (modeled at 7%), a 5% lifetime withdrawal at age 70+, and an annual step-up ratchet. This calculator provides an independent, actuarial-grade analysis of the guarantee's present value across 1,000 market scenarios.",
    highlights: [
      { label: 'Roll-up Rate', value: '7% (mid-point of 5–10% range)' },
      { label: 'Withdrawal Rate', value: '5.0% (age 70+)' },
      { label: 'Rider Fee', value: '1.40% of benefit base/yr' },
      { label: 'Step-up Ratchet', value: '7-year lock-in' },
    ],
    source: 'Parameters from Equitable public prospectus and industry disclosures.',
  },
  tiaa: {
    slug: 'tiaa-cref-glwb-calculator',
    issuer: 'TIAA',
    product: 'CREF Variable Annuity (GLWB)',
    type: 'Variable Annuity — GLWB',
    description:
      "TIAA's CREF Variable Annuity is the dominant product in the 403(b) institutional market, serving educators, healthcare, and nonprofit workers. It offers ultra-low fees (0.15% M&E) and a 5.9% payout rate at age 65 using a 4% Assumed Investment Return (AIR). This calculator models expected lifetime income and the actuarial cost of the income guarantee — critical for advisors reviewing TIAA allocations.",
    highlights: [
      { label: 'Payout Rate', value: '5.9% single-life at age 65' },
      { label: 'M&E Fee', value: '0.15% — lowest in the industry' },
      { label: 'Assumed Investment Return', value: '4% AIR' },
      { label: 'Market', value: '403(b) institutional / educator' },
    ],
    source: 'Parameters from TIAA-CREF public disclosures and participant materials.',
  },
  nationwide: {
    slug: 'nationwide-lifetime-income-calculator',
    issuer: 'Nationwide Financial',
    product: 'Lifetime Income Track (L.inc+)',
    type: 'Variable Annuity — GMWB',
    description:
      "Nationwide's L.inc+ is a step-up-only GMWB rider — it carries no guaranteed roll-up rate, instead ratcheting the benefit base annually to the highest account value achieved. This structure rewards strong market performance. This calculator shows how guaranteed income value evolves across scenarios and how the ratchet compares to a traditional roll-up product.",
    highlights: [
      { label: 'Roll-up Rate', value: 'None — step-up only' },
      { label: 'Withdrawal Rate', value: '5.0% lifetime' },
      { label: 'Rider Fee', value: '1.30% current (max 1.50%)' },
      { label: 'Step-up Ratchet', value: 'Annual reset to high-water mark' },
    ],
    source: 'Parameters from Nationwide public prospectus and industry disclosures.',
  },
  lincoln: {
    slug: 'lincoln-choiceplus-gmwb-calculator',
    issuer: 'Lincoln Financial',
    product: 'ChoicePlus Assurance',
    type: 'Variable Annuity — GMWB',
    description:
      "Lincoln Financial's ChoicePlus Assurance features a 6% simple roll-up over a 10-year deferral period and a 5.5% guaranteed lifetime withdrawal rate for ages 65+. At a 1.00% rider fee — below the VA industry average — it offers competitive pricing on the income guarantee. This calculator quantifies the actuarial value of that guarantee across 1,000 simulated market paths.",
    highlights: [
      { label: 'Roll-up Rate', value: '6% simple (10-year deferral)' },
      { label: 'Withdrawal Rate', value: '5.5% (age 65+)' },
      { label: 'Rider Fee', value: '1.00% of benefit base/yr' },
      { label: 'Step-up Ratchet', value: 'Annual' },
    ],
    source: 'Parameters from Lincoln Financial public prospectus and industry disclosures.',
  },
  allianz: {
    slug: 'allianz-index-advantage-income-calculator',
    issuer: 'Allianz Life Insurance',
    product: 'Index Advantage Income ADV',
    type: 'RILA — Guaranteed Income Benefit',
    description:
      "Allianz's Index Advantage Income ADV is a registered index-linked annuity (RILA) with a guaranteed lifetime income benefit. Unlike traditional variable annuities, it provides downside protection through index buffers while still offering equity-linked growth potential. The 0.70% rider fee and age-banded withdrawal rates (5.70% at age 55, rising to 7.50% at age 73) are sourced directly from the SEC EDGAR filing (May 2024).",
    highlights: [
      { label: 'Withdrawal Rate', value: '6.5% at age 65 (SEC-sourced)' },
      { label: 'Rider Fee', value: '0.70% — confirmed from SEC filing' },
      { label: 'Income Step-up', value: 'Annual ratchet' },
      { label: 'Product Type', value: 'RILA (index buffers apply)' },
    ],
    source: 'Rider fee and WD rate confirmed: SEC EDGAR filing May 2024 (edgar.sec.gov/data/836346/000083634624000102). M&E estimated at 1.25%.',
  },
};

const ALL_SLUGS = Object.values(PRODUCT_META).map(m => m.slug);

// ---------------------------------------------------------------------------
// Shared mini-nav (lighter than LandingPage full nav)
// ---------------------------------------------------------------------------
function MiniNav() {
  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#0052CC] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">AV</span>
          </div>
          <span className="text-lg font-bold text-[#0f1f3d] tracking-tight">
            Annuity<span className="text-[#0052CC]">Voice</span>
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Home</Link>
          <Link
            to="/calculator"
            className="px-4 py-2 bg-[#0052CC] text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Launch Calculator
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------
export default function ProductPage({ productId }) {
  const meta = PRODUCT_META[productId];
  const preset = PRODUCT_PRESETS.find(p => p.id === productId);

  if (!meta || !preset) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 mb-4">Product not found.</p>
          <Link to="/" className="text-[#0052CC] hover:underline">← Back to home</Link>
        </div>
      </div>
    );
  }

  const hash = encodeParamsToHash(preset.params);
  const calcUrl = `/calculator${hash}`;

  const others = Object.entries(PRODUCT_META)
    .filter(([id]) => id !== productId)
    .slice(0, 4);

  const fmtPct = v => `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <MiniNav />

      {/* Hero */}
      <section className="bg-white border-b border-slate-200 py-12 px-5">
        <div className="max-w-5xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-6">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All Calculators
          </Link>

          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-[#0052CC] mb-4">
                {meta.type}
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-[#0f1f3d] tracking-tight leading-tight mb-2">
                {meta.issuer}
              </h1>
              <p className="text-xl font-semibold text-slate-500 mb-4">{meta.product}</p>
              <p className="text-slate-600 leading-relaxed">{meta.description}</p>
            </div>

            <div className="flex-shrink-0">
              <Link
                to={calcUrl}
                className="inline-flex items-center gap-2 px-6 py-3.5 bg-[#0052CC] text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 hover:shadow-blue-300 hover:-translate-y-0.5 whitespace-nowrap"
              >
                Run Monte Carlo Analysis
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <p className="text-xs text-slate-400 mt-2 text-center">Free · No account required</p>
            </div>
          </div>
        </div>
      </section>

      {/* Key metrics */}
      <section className="py-10 px-5">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Pre-loaded Parameters</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {meta.highlights.map(({ label, value }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-400 mb-1">{label}</div>
                <div className="text-base font-bold text-[#0f1f3d] leading-tight">{value}</div>
              </div>
            ))}
          </div>

          {/* Full parameter table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Parameter</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ['Current Age', `${preset.params.current_age}`],
                  ['Income Start Age', `${preset.params.election_age}`],
                  ['Withdrawal Rate', fmtPct(preset.params.withdrawal_rate)],
                  ['Rider Fee', fmtPct(preset.params.rider_fee)],
                  ['M&E + Admin Fee', fmtPct(preset.params.me_fee)],
                  ['Roll-up Rate', preset.params.rollup_rate > 0 ? fmtPct(preset.params.rollup_rate) : 'None'],
                  ['Step-up Ratchet', preset.params.step_up ? 'Yes' : 'No'],
                  ['Expected Return (μ)', fmtPct(preset.params.mu)],
                  ['Volatility (σ)', fmtPct(preset.params.sigma)],
                ].map(([k, v]) => (
                  <tr key={k} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-600">{k}</td>
                    <td className="px-5 py-3 font-medium text-[#0f1f3d]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-400 mt-3 leading-relaxed">{meta.source}</p>
        </div>
      </section>

      {/* CTA banner */}
      <section className="py-10 px-5">
        <div className="max-w-5xl mx-auto bg-[#0f1f3d] rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-xl font-black text-white mb-1">Run the full analysis</h2>
            <p className="text-slate-400 text-sm">1,000 Monte Carlo paths · real mortality tables · GMWB present value + fee breakdown</p>
          </div>
          <Link
            to={calcUrl}
            className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-[#0052CC] text-white font-bold rounded-xl hover:bg-blue-600 transition-all"
          >
            Open in Calculator
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Related products */}
      <section className="py-10 px-5 border-t border-slate-200">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Also Compare</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {others.map(([id, m]) => (
              <Link
                key={id}
                to={`/${m.slug}`}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:border-[#0052CC] hover:shadow-sm transition-all group"
              >
                <div className="text-xs text-slate-400 mb-1 group-hover:text-[#0052CC] transition-colors">{m.issuer}</div>
                <div className="text-sm font-semibold text-[#0f1f3d] leading-tight">{m.product}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0a1628] py-8 px-5 mt-4">
        <div className="max-w-5xl mx-auto text-xs text-slate-500 leading-relaxed space-y-2">
          <p>
            <strong className="text-slate-400">For informational purposes only.</strong>{' '}
            Parameters are sourced from public prospectuses and SEC filings; verify against the current prospectus before use.
            Results are model estimates based on Monte Carlo simulation; actual contract values will differ.
          </p>
          <p className="text-slate-600">© {new Date().getFullYear()} AnnuityVoice. All rights reserved. · <Link to="/" className="hover:text-slate-400 transition-colors">Home</Link> · <Link to="/calculator" className="hover:text-slate-400 transition-colors">Calculator</Link></p>
        </div>
      </footer>
    </div>
  );
}

export { ALL_SLUGS, PRODUCT_META };
