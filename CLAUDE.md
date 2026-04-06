# Variable Annuity GMWB Present Value Calculator

## Project Overview

An interactive, client-side actuarial present value calculator for **Guaranteed Minimum Withdrawal Benefits (GMWB)** on variable annuity contracts. Hosted publicly on GitHub Pages as an educational and professional tool for practicing actuaries and anyone learning about VA guarantees.

**Repo name**: `va-gmwb-calculator`
**Tech stack**: React (single-file JSX or bundled), Tailwind CSS, Recharts for charting — all client-side, no backend.
**Deployment**: GitHub Pages (static site from `/docs` folder or root `index.html`)

---

## Audience

- **Practicing actuaries** — need precise, auditable calculations; want to see projection details and sensitivity analysis
- **General/educational** — students, financial professionals, or curious individuals learning how VA guarantees work; need clear explanations and intuitive UI

The UI should balance professional rigor (show your work, expose assumptions) with accessibility (tooltips, plain-English descriptions, sensible defaults).

---

## GMWB Product Specification

### What is a GMWB?

A Guaranteed Minimum Withdrawal Benefit rider on a variable annuity guarantees the policyholder can withdraw a fixed annual amount (typically 4-6% of the benefit base) for life, regardless of account value performance. The insurer bears the risk when account value depletes before death.

### Contract Mechanics

1. **Account Value (AV)**: Invested in equity/bond subaccounts; fluctuates with market returns. Reduced by withdrawals and fees.
2. **Benefit Base (BB)**: Notional amount used to determine guaranteed withdrawal. Typically equals initial premium; may include roll-up (e.g., 5% simple/compound annually) and/or step-up (ratchet to AV on anniversary if AV > BB).
3. **Guaranteed Annual Withdrawal (GAW)**: `BB × withdrawal_rate` (e.g., 5% for age 65+).
4. **Rider Fee**: Charged as % of AV or BB (e.g., 1.00% of BB annually), deducted from AV.
5. **Base Contract Fee (M&E + admin)**: Typically 1.25-1.50% of AV annually, deducted from AV.

### Projection Logic (per time step t, monthly or annual)

```
For t = 1 to max_projection_years:

  1. Beginning AV_t = AV_{t-1}

  2. Investment return:
     AV_t *= (1 + return_t)    # return_t from stochastic model

  3. Fees deducted:
     rider_fee_t = rider_fee_rate × BB_t / periods_per_year
     base_fee_t  = me_rate × AV_t / periods_per_year
     AV_t -= (rider_fee_t + base_fee_t)

  4. Withdrawal:
     GAW_t = BB_t × withdrawal_rate / periods_per_year
     withdrawal_t = min(GAW_t, AV_t)   # can't withdraw more than AV
     AV_t -= withdrawal_t

  5. GMWB claim (insurer pays when AV exhausted):
     if AV_t <= 0:
       claim_t = GAW_t - max(0, AV_before_withdrawal)  # shortfall
       AV_t = 0
     else:
       claim_t = 0

  6. Benefit base updates (at anniversary):
     - Roll-up: BB_t = BB_{t-1} × (1 + rollup_rate)  [if applicable]
     - Step-up: BB_t = max(BB_t, AV_t)                [if applicable]

  7. Survival/persistency:
     prob_alive_t = tPx from mortality table
     prob_in_force_t = prob_alive_t × Π(1 - lapse_rate_s) for s < t

  8. PV of claim:
     PV_t = claim_t × prob_in_force_t × discount_factor_t

  9. PV of fee income:
     PV_fee_t = rider_fee_t × prob_in_force_t × discount_factor_t

Final outputs:
  PV_claims  = Σ PV_t           (cost to insurer)
  PV_fees    = Σ PV_fee_t       (revenue to insurer)
  Net_cost   = PV_claims - PV_fees
```

---

## Stochastic Modeling (Monte Carlo)

### Equity Return Model

Use **geometric Brownian motion** (Black-Scholes framework):

```
return_t = exp((mu - 0.5 × sigma²) × dt + sigma × sqrt(dt) × Z_t) - 1
where Z_t ~ N(0,1)
```

- `mu`: expected annual return (e.g., 7%)
- `sigma`: annual volatility (e.g., 18%)
- `dt`: time step (1/12 for monthly, 1 for annual)

### Number of Scenarios

Default: **1,000 scenarios** (configurable: 100 to 10,000). Use Web Workers if available to avoid UI blocking.

### Output Statistics

For each metric (PV claims, PV fees, net cost):
- Mean, median, standard deviation
- Percentiles: 5th, 25th, 75th, 95th (CTE metrics)
- Distribution histogram
- Scenario fan chart (AV paths over time)

---

## Input Parameters & Defaults

### Policyholder
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Current Age | 65 | 40-90 | Current age of annuitant |
| Gender | Male | M/F/Unisex | For mortality table lookup |
| Max Projection Age | 100 | 90-120 | Omega (end of projection) |

### Contract
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Account Value | $500,000 | $10K-$10M | Current AV |
| Benefit Base | $500,000 | $10K-$10M | Current BB (may differ from AV) |
| Withdrawal Rate | 5.0% | 1-10% | % of BB withdrawn annually |
| Rider Fee | 1.00% | 0-3% | Annual % of BB charged for GMWB |
| M&E + Admin Fee | 1.40% | 0-3% | Annual % of AV for base contract |
| Roll-up Rate | 0.0% | 0-8% | Annual BB roll-up (0 = none) |
| Step-up | Off | On/Off | Anniversary ratchet of BB to AV |

### Economic Assumptions
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Expected Return (mu) | 7.0% | -5% to 20% | Gross annual equity return |
| Volatility (sigma) | 18.0% | 5-50% | Annual standard deviation |
| Discount Rate | 4.0% | 0-10% | Risk-free rate for PV discounting |
| Projection Frequency | Annual | Annual/Monthly | Time step granularity |

### Behavioral Assumptions
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Mortality Table | 2012 IAM Basic | Selection list | Base mortality |
| Mortality Improvement | Scale G2 | On/Off + scale | Projection scale |
| Lapse Rate | 3.0% flat | 0-20% | Annual lapse/surrender rate |
| Dynamic Lapse | Off | On/Off | ITM-dependent lapse adjustment |
| Benefit Utilization | 100% | 50-100% | % of policyholders who actually withdraw |

### Simulation
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Number of Scenarios | 1,000 | 100-10,000 | Monte Carlo paths |
| Random Seed | (none) | integer | For reproducibility |

---

## Mortality Tables

Embed the following tables as JSON in `data/`:

1. **2012 IAM Basic** — industry standard for individual annuities
2. **Annuity 2000** — older but widely referenced
3. **(Optional) Custom** — allow user to paste qx values

Format:
```json
{
  "name": "2012 IAM Basic",
  "type": "select",
  "male": { "40": 0.00112, "41": 0.00121, ... , "120": 1.0 },
  "female": { "40": 0.00067, "41": 0.00073, ... , "120": 1.0 }
}
```

---

## UI/UX Requirements

### Layout

Three-panel layout:
1. **Left sidebar** — Input parameters grouped by category (collapsible sections)
2. **Main area** — Results: summary metrics at top, charts below
3. **Right panel or tabs** — Detailed projection table, scenario explorer

### Charts (use Recharts)

1. **AV Fan Chart**: X = projection year, Y = AV. Show mean path + 5th/25th/75th/95th percentile bands. Shade the "AV = 0" zone.
2. **Claim Distribution Histogram**: Distribution of PV(total claims) across scenarios.
3. **Fee vs. Claim Comparison**: Bar chart comparing PV(fees) vs PV(claims) with net cost callout.
4. **Sensitivity Tornado**: Show impact on PV(net cost) of ±1 unit change in each input parameter.

### Interactivity

- All inputs should update results **in real time** (debounce Monte Carlo runs by 500ms)
- Show a progress indicator during simulation
- Allow "pin" to compare two sets of assumptions side by side
- Provide an "Export" button to download projection table as CSV

### Educational Features

- **Tooltips** on every input explaining what it is and why it matters
- **"What does this mean?"** expandable section under results explaining the output in plain English
- **Methodology** page/tab explaining the math with rendered formulas

---

## Code Quality Standards

- Pure functional components, React hooks only
- All calculation logic in separate utility modules (not in components)
- JSDoc comments on all actuarial functions
- Unit-testable calculation functions (even if tests aren't in v1)
- No external API calls — everything runs in the browser
- Performant: use typed arrays for scenario storage, avoid unnecessary re-renders

---

## File Structure

```
va-gmwb-calculator/
├── CLAUDE.md                   # This file
├── README.md                   # Public-facing docs, screenshots, how to use
├── index.html                  # Entry point for GitHub Pages
├── package.json                # If using build step
├── src/
│   ├── App.jsx                 # Main app shell
│   ├── components/
│   │   ├── InputPanel.jsx      # All input controls
│   │   ├── ResultsSummary.jsx  # Top-level PV metrics
│   │   ├── AVFanChart.jsx      # Account value paths chart
│   │   ├── ClaimHistogram.jsx  # Distribution chart
│   │   ├── SensitivityChart.jsx# Tornado diagram
│   │   ├── ProjectionTable.jsx # Detailed period-by-period table
│   │   └── Methodology.jsx     # Educational content
│   ├── engine/
│   │   ├── projection.js       # Core GMWB projection loop
│   │   ├── stochastic.js       # Monte Carlo / GBM return generator
│   │   ├── mortality.js        # Mortality table lookup & survival probs
│   │   └── utils.js            # Discount factors, statistics, helpers
│   └── data/
│       ├── mortality_2012iam.json
│       └── mortality_annuity2000.json
└── docs/                       # GitHub Pages build output (if needed)
```

---

## Future Enhancements (v2+)

- GMDB rider (death benefit — simpler, good add-on)
- GMAB rider (accumulation guarantee at maturity)
- GMIB rider (income benefit — most complex)
- Dynamic lapse model (lapse = f(ITM ratio))
- Multi-asset class (equity + bond allocation with rebalancing)
- Risk-neutral valuation (for fair value / GAAP reserving)
- Real-world calibration (fit mu/sigma to historical index data)
- Stochastic interest rates (Hull-White or similar)
- Greek sensitivities (delta, rho, vega of the guarantee)
- PDF report export
