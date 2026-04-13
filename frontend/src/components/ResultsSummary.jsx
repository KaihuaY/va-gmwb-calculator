import React, { useState } from 'react';

function MetricCard({ title, value, subtitle, accentColor }) {
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-slate-100">
      <div className="h-1.5" style={{ backgroundColor: accentColor }} />
      <div className="p-5">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{title}</div>
        <div className="text-3xl font-black tabular-nums leading-none" style={{ color: accentColor }}>{value}</div>
        {subtitle && <div className="text-sm text-slate-500 mt-2 leading-snug">{subtitle}</div>}
      </div>
    </div>
  );
}

// Compact horizontal stat strip — replaces large MetricCard grid in standard mode
function StatStrip({ items }) {
  return (
    <div className="flex flex-wrap bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden mb-3">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex-1 min-w-[110px] px-4 py-3 ${i > 0 ? 'border-l border-slate-100' : ''}`}
        >
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</div>
          <div className="text-xl font-black tabular-nums leading-none mt-1" style={{ color: item.color }}>{item.value}</div>
          {item.sub && <div className="text-[10px] text-slate-400 mt-1">{item.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// Collapsible "How to read this" explanation
function HowToReadThis({ netMean, num_scenarios }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        How to read these numbers
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600 leading-relaxed">
          <strong className="text-slate-700">How to read this:</strong>{' '}
          <strong>Guarantee Value</strong> is the present value of insurance payments you would receive
          when your account balance runs out — averaged across {num_scenarios.toLocaleString()} simulated
          market scenarios. <strong>Total Fees</strong> are M&amp;E and rider fees paid over your lifetime.{' '}
          {netMean > 0
            ? <><strong className="text-emerald-700">Net Benefit is positive</strong>, meaning on average the guarantee pays back more than you pay in fees — the rider is expected to deliver value.</>
            : <><strong className="text-red-700">Net Benefit is negative</strong>, meaning fees are expected to exceed guarantee payouts on average. This is common — the guarantee's value lies in the <em>protection against bad outcomes</em>, not the average case. See the shortfall risk above.</>
          }
        </div>
      )}
    </div>
  );
}

function fmt(val) {
  if (val === undefined || val === null) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v) {
  if (v === undefined || v === null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Shortfall risk callout — shown when GMWB is active and shortfall_stats exist
// ---------------------------------------------------------------------------
function ShortfallCallout({ shortfall_stats, num_scenarios, simple }) {
  const { prob, count, median_depletion_age } = shortfall_stats;

  // No shortfall in any simulated scenario — positive outcome
  if (prob === 0) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
        <span className="text-2xl font-black text-emerald-600">0%</span>
        <div>
          <div className="text-sm font-bold text-emerald-800">No account depletion in any scenario</div>
          <div className="text-xs text-emerald-700 mt-0.5">
            Across all {num_scenarios.toLocaleString()} simulated market paths, your account balance never
            reached $0 during your lifetime — your guarantee was not needed in any simulated scenario.
          </div>
        </div>
      </div>
    );
  }

  // Risk level theming
  const isHigh   = prob >= 0.40;
  const isMedium = prob >= 0.15 && prob < 0.40;
  const colors = isHigh
    ? { bg: 'bg-red-50',    border: 'border-red-200',   head: 'text-red-800',   body: 'text-red-700',   big: 'text-red-700'   }
    : isMedium
    ? { bg: 'bg-amber-50',  border: 'border-amber-200', head: 'text-amber-800', body: 'text-amber-700', big: 'text-amber-700' }
    : { bg: 'bg-blue-50',   border: 'border-blue-200',  head: 'text-blue-800',  body: 'text-blue-700',  big: 'text-blue-600'  };

  const ageNote = median_depletion_age
    ? ` — typically around age ${median_depletion_age}`
    : '';

  if (simple) {
    // Standard mode: plain-English narrative
    return (
      <div className={`mt-4 rounded-xl border ${colors.border} ${colors.bg} p-4`}>
        <div className="flex items-start gap-4">
          <div className={`text-3xl font-black tabular-nums leading-none flex-shrink-0 ${colors.big}`}>
            {fmtPct(prob)}
          </div>
          <div>
            <div className={`text-sm font-bold ${colors.head} mb-1`}>
              of simulated scenarios would have exhausted your account balance
            </div>
            <div className={`text-xs ${colors.body} leading-relaxed`}>
              In {count.toLocaleString()} of {num_scenarios.toLocaleString()} market scenarios, your
              account balance reached $0 while you were still alive{ageNote}. Without the
              lifetime withdrawal guarantee, your income would have stopped at that point.
              The guarantee ensures payments continue for as long as you live.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Advanced mode: compact technical row
  return (
    <div className={`mt-3 rounded-lg border ${colors.border} ${colors.bg} px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm`}>
      <span className={`font-bold ${colors.head}`}>GMWB invoked in</span>
      <span className={`font-black tabular-nums text-lg ${colors.big}`}>{fmtPct(prob)}</span>
      <span className={`text-xs ${colors.body}`}>
        ({count.toLocaleString()} / {num_scenarios.toLocaleString()} scenarios)
      </span>
      {median_depletion_age && (
        <span className={`text-xs ${colors.body}`}>
          · Median depletion age: <strong>{median_depletion_age}</strong>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SPIA comparison — computed from survival probs already returned by backend
// ---------------------------------------------------------------------------
function computeSPIAFactor(survivalProbs, discountRate) {
  // Life annuity-immediate: a_x = Σ_{t=0}^{T-1} survivalProbs[t] * v^(t+1)
  const v = 1 / (1 + (discountRate || 0.04));
  let factor = 0;
  for (let t = 0; t < survivalProbs.length; t++) {
    factor += survivalProbs[t] * Math.pow(v, t + 1);
  }
  return factor;
}

function SPIAComparison({ results, runParams }) {
  const [open, setOpen] = useState(false);
  if (!results?.survival_probs?.length || !runParams) return null;
  const factor = computeSPIAFactor(results.survival_probs, runParams.discount_rate);
  if (factor <= 0) return null;

  const av = runParams.account_value || 500000;
  const spiaAnnual = av / factor;
  const spiaRate = (1 / factor) * 100;

  const deferralYears = Math.max(0, (runParams.election_age || runParams.current_age) - runParams.current_age);
  const rolledUpBB = (runParams.benefit_base || av) * Math.pow(1 + (runParams.rollup_rate || 0), deferralYears);
  const gaw = rolledUpBB * (runParams.withdrawal_rate || 0.05);
  const gawRate = (gaw / av) * 100;

  const spiaIsBetter = spiaAnnual > gaw;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
      >
        <span>SPIA Comparison</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">SPIA equivalent payout</div>
              <div className="text-lg font-black tabular-nums text-slate-800">{fmt(spiaAnnual)}<span className="text-sm font-semibold text-slate-500">/yr</span></div>
              <div className="text-xs text-slate-500">{spiaRate.toFixed(1)}% of premium · no deferral</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Your guaranteed withdrawal</div>
              <div className="text-lg font-black tabular-nums text-slate-800">{fmt(gaw)}<span className="text-sm font-semibold text-slate-500">/yr</span></div>
              <div className="text-xs text-slate-500">{gawRate.toFixed(1)}% of premium · starts age {runParams.election_age}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
            {spiaIsBetter
              ? <>A <strong>SPIA</strong> (Single Premium Immediate Annuity) would pay <strong className="text-slate-700">{fmt(spiaAnnual - gaw)} more per year</strong> for the same premium — but offers no market upside or death benefit.</>
              : <>Your VA guarantee pays <strong className="text-slate-700">{fmt(gaw - spiaAnnual)} more per year</strong> than a comparable SPIA — reflecting the rollup benefit from the {deferralYears}-year deferral period.</>
            }
            {' '}SPIA rates are actuarial estimates; market quotes vary by insurer and include profit margins (~10–15% lower).
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smart Insight Cards — triggered conditions turn numbers into action items
// ---------------------------------------------------------------------------
function InsightCards({ results, runParams }) {
  const [open, setOpen] = useState(false);
  if (!results || !runParams) return null;

  const { shortfall_stats, net_stats } = results;
  const shortfallProb = shortfall_stats?.prob ?? 0;
  const netMean = net_stats?.mean ?? 0;
  const deferralYears = Math.max(0, (runParams.election_age || runParams.current_age) - runParams.current_age);
  const rollup = runParams.rollup_rate || 0;
  const gmwbEnabled = runParams.gmwb_enabled ?? true;

  const insights = [];

  if (gmwbEnabled && shortfallProb >= 0.40) {
    insights.push({
      icon: '⚠️',
      color: 'red',
      text: `Your account runs out while you\'re still alive in ${Math.round(shortfallProb * 100)}% of scenarios — that\'s high. Consider reducing the annual withdrawal rate or deferring income to a later age.`,
    });
  } else if (gmwbEnabled && shortfallProb === 0) {
    insights.push({
      icon: '✓',
      color: 'emerald',
      text: 'Strong outlook — your account is unlikely to be depleted in any of the simulated market scenarios. The guarantee provides a safety net you may not need, but it\'s there if markets turn.',
    });
  }

  if (netMean < -50000) {
    insights.push({
      icon: 'ℹ',
      color: 'slate',
      text: 'Fees are expected to exceed guarantee payouts on average — this is normal for VA riders. The guarantee\'s value is downside protection in bad markets, not average-case return. Focus on the shortfall probability above, not the net number.',
    });
  }

  if (deferralYears > 0 && rollup === 0) {
    insights.push({
      icon: '💡',
      color: 'amber',
      text: `You have a ${deferralYears}-year deferral period but no roll-up rate — your benefit base won\'t grow during accumulation. Unless the contract has a step-up provision, consider whether deferring income still makes sense.`,
    });
  }

  if (deferralYears === 0 && rollup > 0) {
    insights.push({
      icon: '💡',
      color: 'amber',
      text: `Roll-up only applies during deferral, but your Income Start Age equals your current age — there\'s no deferral period to earn it. Set Income Start Age above your current age to benefit from the ${(rollup * 100).toFixed(0)}% guaranteed growth.`,
    });
  }

  if (insights.length === 0) return null;

  const colorMap = {
    red:     { bg: 'bg-red-50',    border: 'border-red-200',    icon: 'text-red-500',    text: 'text-red-800'    },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600', text: 'text-emerald-800' },
    slate:   { bg: 'bg-slate-50',  border: 'border-slate-200',  icon: 'text-slate-500',  text: 'text-slate-700'  },
    amber:   { bg: 'bg-amber-50',  border: 'border-amber-200',  icon: 'text-amber-500',  text: 'text-amber-800'  },
  };

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
      >
        <span className="flex items-center gap-2">
          Insights
          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-bold">{insights.length}</span>
        </span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {insights.map((ins, i) => {
            const c = colorMap[ins.color];
            return (
              <div key={i} className={`rounded-lg border ${c.border} ${c.bg} px-4 py-3 flex items-start gap-3`}>
                <span className={`text-base flex-shrink-0 mt-0.5 ${c.icon}`}>{ins.icon}</span>
                <p className={`text-xs leading-relaxed ${c.text}`}>{ins.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ResultsSummary({ results, running, progress, viewMode = 'standard', runParams, onSaveSnapshot, snapshots = [] }) {
  if (running) {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${(progress * 100).toFixed(0)}%` }}
            />
          </div>
          <span className="text-sm font-mono tabular-nums text-slate-500 w-10 text-right">
            {(progress * 100).toFixed(0)}%
          </span>
        </div>
        <div className="text-sm text-slate-400 mt-2">Running Monte Carlo simulation…</div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-5">
        <p className="text-base font-semibold text-blue-800">Ready to run</p>
        <p className="text-sm text-blue-600 mt-1">Click <strong>Run Simulation</strong> to compute present values.</p>
      </div>
    );
  }

  const { claim_stats, gmdb_stats, fee_stats, net_stats, num_scenarios, projection_years, shortfall_stats } = results;
  const netMean = net_stats.mean;
  const netColor = netMean > 0 ? '#dc2626' : '#059669';

  const gmwbEnabled = runParams?.gmwb_enabled ?? true;
  const gmdbEnabled = runParams?.gmdb_enabled ?? false;
  const hasGmwb = gmwbEnabled;
  const hasGmdb = gmdbEnabled && gmdb_stats?.mean > 0;

  if (viewMode === 'standard') {
    const stripItems = [];
    if (hasGmwb) {
      stripItems.push({ label: 'Guarantee Value', value: fmt(claim_stats.mean), sub: `Median ${fmt(claim_stats.median)}`, color: '#dc2626' });
    }
    if (hasGmdb) {
      stripItems.push({ label: 'Death Benefit', value: fmt(gmdb_stats.mean), sub: `Median ${fmt(gmdb_stats.median)}`, color: '#ea580c' });
    }
    if (!hasGmwb && !hasGmdb) {
      stripItems.push({ label: 'Guarantee Value', value: '—', sub: 'No rider selected', color: '#94a3b8' });
    }
    stripItems.push({ label: 'Total Fees', value: fmt(fee_stats.mean), sub: `Median ${fmt(fee_stats.median)}`, color: '#475569' });
    stripItems.push({ label: 'Net Benefit', value: fmt(netMean), sub: netMean > 0 ? 'Payouts > fees' : 'Fees > payouts', color: netColor });

    return (
      <div className="mb-6">
        <StatStrip items={stripItems} />
        {shortfall_stats && hasGmwb && (
          <ShortfallCallout
            shortfall_stats={shortfall_stats}
            num_scenarios={num_scenarios}
            simple
          />
        )}

        <HowToReadThis netMean={netMean} num_scenarios={num_scenarios} />
        <SPIAComparison results={results} runParams={runParams} />
        <InsightCards results={results} runParams={runParams} />

        {/* Save Snapshot button */}
        {onSaveSnapshot && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              onClick={onSaveSnapshot}
              disabled={snapshots.length >= 3}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={snapshots.length >= 3 ? 'Maximum 3 snapshots — clear one to save another' : 'Save this scenario to compare later'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              {snapshots.length >= 3 ? 'Max snapshots saved' : 'Save snapshot'}
            </button>
            {snapshots.length > 0 && (
              <span className="text-xs text-slate-400">{snapshots.length}/3 saved</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Advanced mode
  const advCards = [];
  if (hasGmwb) {
    advCards.push(
      <MetricCard key="gmwb" title="PV(GMWB)"
        value={fmt(claim_stats.mean)} subtitle={`Median ${fmt(claim_stats.median)}`}
        accentColor="#dc2626" />
    );
  }
  if (hasGmdb) {
    advCards.push(
      <MetricCard key="gmdb" title="PV(GMDB)"
        value={fmt(gmdb_stats.mean)} subtitle={`Median ${fmt(gmdb_stats.median)}`}
        accentColor="#ea580c" />
    );
  }
  advCards.push(
    <MetricCard key="fees" title="PV(Rider Fees)"
      value={fmt(fee_stats.mean)} subtitle={`Median ${fmt(fee_stats.median)}`}
      accentColor="#64748b" />
  );
  advCards.push(
    <MetricCard key="net" title="Net Cost"
      value={fmt(netMean)} subtitle={`95th %ile ${fmt(net_stats.p95)}`}
      accentColor={netColor} />
  );
  advCards.push(
    <MetricCard key="scenarios" title="Scenarios"
      value={num_scenarios.toLocaleString()} subtitle={`${projection_years}-yr projection`}
      accentColor="#6366f1" />
  );

  const advColCount = advCards.length;
  const advCols = advColCount >= 5
    ? 'grid-cols-2 lg:grid-cols-5'
    : advColCount === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3';

  return (
    <div className="mb-6">
      <div className={`grid ${advCols} gap-4`}>
        {advCards}
      </div>
      {shortfall_stats && hasGmwb && (
        <ShortfallCallout
          shortfall_stats={shortfall_stats}
          num_scenarios={num_scenarios}
          simple={false}
        />
      )}
    </div>
  );
}
