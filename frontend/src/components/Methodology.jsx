import React, { useState } from 'react';

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <span className="text-slate-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-slate-600 leading-relaxed space-y-3 border-t border-slate-50">
          {children}
        </div>
      )}
    </div>
  );
}

function Formula({ children }) {
  return (
    <div className="my-2 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 font-mono text-sm text-slate-800 overflow-x-auto whitespace-pre">
      {children}
    </div>
  );
}

function Def({ term, children }) {
  return (
    <div className="flex gap-2">
      <span className="font-semibold text-slate-700 w-40 shrink-0">{term}</span>
      <span>{children}</span>
    </div>
  );
}

export default function Methodology() {
  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-slate-800">Methodology</h2>
        <p className="text-sm text-slate-500 mt-1">
          Technical documentation of the actuarial model underlying this calculator.
          All calculations run server-side in Python; this page explains the math.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
        <strong>Disclaimer:</strong> This calculator is provided by AnnuityVoice for educational and
        informational purposes only. It does not constitute financial, investment, insurance, or actuarial
        advice. Output is based on a simplified stochastic model with user-supplied assumptions; actual
        contract values will differ based on your specific policy terms, insurer pricing, and market
        conditions. For financial professional use — consult a licensed advisor or actuary before making
        annuity decisions. Past model outputs are not a guarantee of future results.
      </div>

      <Section title="1. What is a GMWB?">
        <p>
          A <strong>Guaranteed Minimum Withdrawal Benefit (GMWB)</strong> is a rider attached to a variable
          annuity contract. It guarantees the policyholder can withdraw a fixed annual amount — typically 4–6%
          of a notional <em>Benefit Base</em> — for the rest of their life, regardless of how the underlying
          investment account performs.
        </p>
        <p>
          The key risk for the insurer arises when the <strong>Account Value (AV)</strong> is depleted by poor
          market performance, yet the policyholder is still alive and entitled to guaranteed withdrawals. At
          that point the insurer must fund the shortfall out of its own capital.
        </p>
        <p>
          This calculator estimates the <strong>present value</strong> of those insurer obligations (claims)
          and the corresponding rider fee income, across thousands of simulated market scenarios.
        </p>
      </Section>

      <Section title="2. Projection Mechanics">
        <p>For each time step <em>t</em> (annual or monthly), the model applies the following steps in order:</p>
        <ol className="list-decimal pl-5 space-y-2 mt-2">
          <li>
            <strong>Investment Return</strong> — the account value grows by a stochastic return drawn from
            the GBM model (see Section 3).
          </li>
          <li>
            <strong>Fee Deduction</strong> — the rider fee (% of BB) and M&amp;E fee (% of AV) are deducted
            from the account value.
            <Formula>
{`fees_t = rider_fee × BB × Δt  +  me_fee × AV × Δt`}
            </Formula>
          </li>
          <li>
            <strong>Guaranteed Annual Withdrawal (GAW)</strong> — the policyholder withdraws up to the
            guaranteed amount. Actual withdrawal is the lesser of GAW and remaining AV.
            <Formula>
{`GAW_t  = BB × withdrawal_rate × Δt × utilization
paid_t = min(GAW_t, AV_t)`}
            </Formula>
          </li>
          <li>
            <strong>GMWB Claim</strong> — if the account cannot fund the full GAW, the insurer covers the
            shortfall.
            <Formula>
{`claim_t = max(0, GAW_t − AV_before_withdrawal_t)`}
            </Formula>
          </li>
          <li>
            <strong>Benefit Base Update</strong> — at each policy anniversary:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li><em>Roll-up:</em> BB × (1 + roll-up rate)</li>
              <li><em>Step-up:</em> BB = max(BB, AV) if step-up is enabled</li>
            </ul>
          </li>
          <li>
            <strong>Present Value</strong> — claims and fees are discounted by both the time value of money
            and the probability the policy is still in force.
            <Formula>
{`PV_claim_t = claim_t × persistency_t × v^t
PV_fee_t   = riderFee_t × persistency_t × v^t
v = 1 / (1 + discount_rate)`}
            </Formula>
          </li>
        </ol>
      </Section>

      <Section title="3. Stochastic Return Model (GBM)">
        <p>
          Equity subaccount returns are modelled using <strong>Geometric Brownian Motion</strong>, the
          same framework underlying the Black-Scholes option pricing model:
        </p>
        <Formula>
{`r_t = exp((μ − ½σ²)·Δt  +  σ·√Δt · Z_t) − 1

where:
  Z_t ~ N(0, 1)   (standard normal random variate)
  μ   = expected annual return (drift)
  σ   = annual volatility
  Δt  = time step (1 for annual, 1/12 for monthly)`}
        </Formula>
        <p>
          The <em>(μ − ½σ²)</em> term is the Itô correction that ensures the <em>expected</em> growth
          rate of the account equals μ (not μ − ½σ²). This is the standard log-normal model.
        </p>
        <p>
          <strong>Reproducibility:</strong> A seeded random number generator (numpy SFC64) is used, so the
          same seed always produces the same results. This allows you to isolate the effect of changing a
          single assumption.
        </p>
      </Section>

      <Section title="4. Mortality & Persistency">
        <p>
          The model uses two annuity mortality tables: <strong>2012 IAM Basic</strong> (the current industry
          standard) and <strong>Annuity 2000</strong> (an older reference table). The 2012 IAM table is
          paired with <strong>Scale G2</strong> improvement factors that project mortality improvements forward
          from the 2012 base year.
        </p>
        <Formula>
{`q(x, year) = q(x, 2012) × (1 − G2(x))^(year − 2012) × multiplier`}
        </Formula>
        <p>
          <strong>Cumulative survival probability</strong> (probability alive at time <em>t</em>):
        </p>
        <Formula>
{`ₜpₓ = ∏ₛ₌₀ᵗ⁻¹ (1 − q(x+s, base_year+s))`}
        </Formula>
        <p>
          <strong>Persistency</strong> combines survival with lapse:
        </p>
        <Formula>
{`persist_t = ₜpₓ × (1 − lapse_rate)^t`}
        </Formula>
        <p>
          The persistency factor represents the fraction of original policyholders still alive and in-force at
          time <em>t</em>. It weights each period's cash flows.
        </p>
      </Section>

      <Section title="5. Outputs Explained">
        <div className="space-y-3">
          <Def term="PV(Claims)">
            Expected present value of all payments the insurer must make to cover guaranteed withdrawals when
            account values are depleted. This is the primary cost metric. A higher number means the guarantee
            is more expensive for the insurer.
          </Def>
          <Def term="PV(Rider Fees)">
            Expected present value of GMWB rider fee income over the life of all policies. This is the
            revenue the insurer earns to offset claim costs.
          </Def>
          <Def term="Net Cost">
            PV(Claims) − PV(Rider Fees). Positive = insurer loses money on average; negative = insurer
            profits. Actuaries use this to price the rider fee or assess reserve adequacy.
          </Def>
          <Def term="95th Percentile">
            A tail risk measure: there is a 5% chance the net cost exceeds this value across the simulated
            scenario set. Important for capital planning and stress testing.
          </Def>
          <Def term="Fan Chart Bands">
            The 5th–95th percentile band shows the range of outcomes across 95% of scenarios. The narrower
            25th–75th band is the interquartile range. The mean and median lines show the central tendency.
          </Def>
        </div>
      </Section>

      <Section title="6. Sensitivity Analysis">
        <p>
          The tornado chart measures how sensitive PV(net cost) is to each input parameter. For each
          parameter, the model runs two simulations with the parameter shifted ±10% from baseline,
          holding everything else constant.
        </p>
        <Formula>
{`ΔNetCost_up   = NetCost(param × 1.10) − NetCost(baseline)
ΔNetCost_down = NetCost(param × 0.90) − NetCost(baseline)`}
        </Formula>
        <p>
          Parameters are ranked by absolute impact. The chart helps identify which assumptions most affect
          the valuation — typically volatility (σ), expected return (μ), and the withdrawal rate.
        </p>
      </Section>

      <Section title="7. Limitations & Assumptions">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Real-world measure only.</strong> This calculator uses real-world (physical) probabilities
            and drift. Fair-value (risk-neutral) pricing would require calibrating to market-implied volatility
            and using a risk-free drift. For GAAP ASC 944 or IFRS 17 reserving, use risk-neutral scenarios.
          </li>
          <li>
            <strong>Single asset class.</strong> All subaccount assets are modelled as a single equity-like
            asset. Multi-asset allocation (equity + bond glide paths) is not currently supported.
          </li>
          <li>
            <strong>Flat lapse rate.</strong> The lapse rate is applied uniformly each year. In practice,
            lapses are lower when the guarantee is deeply in-the-money (dynamic lapse behaviour).
          </li>
          <li>
            <strong>No taxes, surrender charges, or other riders.</strong> The model focuses solely on the
            GMWB mechanic; it does not include GMDB, GMIB, surrender charge schedules, or income taxes.
          </li>
          <li>
            <strong>Independence of scenarios.</strong> Each scenario is an independent GBM path. Regime
            switching, mean reversion, or stochastic volatility models would produce different tail behaviour.
          </li>
        </ul>
      </Section>

      <Section title="8. References">
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Society of Actuaries — <em>2012 Individual Annuity Reserving Table (IAM)</em>, 2012.</li>
          <li>Society of Actuaries — <em>Mortality Improvement Scale G2</em>, 2012.</li>
          <li>Society of Actuaries — <em>Annuity 2000 Mortality Table</em>, 1996.</li>
          <li>Bauer, D., Kling, A., &amp; Russ, J. — "A Universal Pricing Framework for Guaranteed Minimum Benefits in Variable Annuities", <em>ASTIN Bulletin</em> 38(2), 2008.</li>
          <li>Hull, J. — <em>Options, Futures, and Other Derivatives</em>, 11th ed., Prentice Hall.</li>
        </ul>
      </Section>
    </div>
  );
}
