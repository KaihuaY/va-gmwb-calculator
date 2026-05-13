import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// CarrierComparison — collapsed accordion under the stat strip in Standard mode.
// Side-by-side: what the carrier illustration emphasizes vs. what an
// independent actuarial valuation actually shows.
// ---------------------------------------------------------------------------

function fmt(val) {
  if (val == null) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

// Compute the deterministic guaranteed-income figure a carrier would print
// on its illustration: BB grown by roll-up over the deferral period × WD rate.
// Matches the math every carrier puts on the front page of its product brochure.
function carrierIllustration(runParams) {
  const bb = runParams.benefit_base ?? 0;
  const rollup = runParams.rollup_rate ?? 0;
  const deferYears = Math.max(0, (runParams.election_age ?? runParams.current_age ?? 0) - (runParams.current_age ?? 0));
  const wdRate = runParams.withdrawal_rate ?? 0;
  // Compound roll-up — most carriers (Jackson, Equitable, Lincoln) advertise compound;
  // Lincoln is technically simple but the difference is minor for illustration framing.
  const grownBB = bb * Math.pow(1 + rollup, deferYears);
  const annualIncome = grownBB * wdRate;
  return { grownBB, annualIncome, deferYears };
}

export default function CarrierComparison({ results, runParams, preset }) {
  const [open, setOpen] = useState(false);
  if (!results || !runParams || !preset) return null;
  const { claim_stats, fee_stats, net_stats, shortfall_stats } = results;
  if (!runParams.gmwb_enabled) return null;

  const { annualIncome, deferYears } = carrierIllustration(runParams);
  const carrierName = preset.label.split(/\s+[—-]\s+/)[0];

  return (
    <div className="mt-3" data-print-hide>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
      >
        <span className="flex items-center gap-2">
          Compare to carrier illustration
          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold uppercase tracking-wide">
            {carrierName}
          </span>
        </span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Carrier illustration card */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              {carrierName} illustrates
            </div>
            <div className="text-2xl font-black tabular-nums text-slate-800 leading-tight">
              {fmt(annualIncome)}<span className="text-base font-semibold text-slate-500">/yr for life</span>
            </div>
            {deferYears > 0 && (
              <div className="text-xs text-slate-500 mt-1">
                Starting age {runParams.election_age} after a {deferYears}-yr deferral
              </div>
            )}
            {preset.marketingTagline && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 leading-relaxed italic">
                “{preset.marketingTagline}”
              </div>
            )}
          </div>

          {/* Independent valuation card */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
            <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2">
              Independent actuarial value
            </div>
            <div className="text-2xl font-black tabular-nums text-slate-800 leading-tight">
              {fmt(net_stats.mean)}<span className="text-base font-semibold text-slate-500"> net</span>
            </div>
            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
              <div>+{fmt(claim_stats.mean)} guarantee · −{fmt(fee_stats.mean)} fees</div>
              {shortfall_stats && (
                <div>
                  <strong className="text-slate-700">{fmtPct(shortfall_stats.prob)}</strong> chance account is depleted
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-blue-100 text-xs text-slate-600 leading-relaxed">
              After {(results.num_scenarios ?? 500).toLocaleString()} simulated markets, mortality, and fee drag — the guarantee’s value is the insurance against bad outcomes, not the headline income figure.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
