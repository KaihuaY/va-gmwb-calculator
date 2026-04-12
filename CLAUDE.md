# VA Rider Calculator

## Project Overview

An interactive actuarial present value calculator for **variable annuity guarantee riders** (GMWB and GMDB implemented; GMAB, GMIB planned). Designed for practicing actuaries and students learning how VA guarantees work.

**App title**: VA Rider Calculator
**Tech stack**:
- **Backend**: Python (FastAPI, NumPy) — Monte Carlo engine, mortality tables, sensitivity analysis
- **Frontend**: React + Vite, Tailwind CSS, Recharts
- **GitHub Pages MVP**: standalone `index.html` with embedded JS engine (not yet synced with Python backend — sync when Lambda deployed)

**Deployment targets**:
- Production: FastAPI on AWS Lambda (Function URL) + React on S3/CloudFront
- MVP/demo: `index.html` on GitHub Pages (static, no backend required)

---

## Audience

- **Practicing actuaries** — precise, auditable calculations; projection details; sensitivity analysis
- **General/educational** — students, financial professionals learning how VA guarantees work; tooltips, plain-English explanations, sensible defaults

---

## Riders Implemented

### GMWB — Guaranteed Minimum Withdrawal Benefit

Policyholder can withdraw a fixed annual amount (GAW = BB × withdrawal_rate) for life, regardless of AV performance. Insurer pays the shortfall when AV is exhausted before death.

**Projection logic (per time step t):**
```
1. AV *= GBM return
2. Deduct fees: rider_fee × BB × dt  +  me_fee × AV × dt
3. Accumulation phase (t < election_age − current_age):
     GAW = 0; roll-up applies to BB each anniversary
   Withdrawal phase (t ≥ election_age − current_age):
     GAW = BB × withdrawal_rate × dt × benefit_utilization
     AV -= min(GAW, AV)
     GMWB claim = max(0, GAW − AV_before_withdrawal)
4. Anniversary: step-up BB = max(BB, AV) if step_up enabled
5. PV(GMWB claim) += claim × persistency × discount_factor
```

### GMDB — Guaranteed Minimum Death Benefit

Insurer pays `max(0, BB − AV)` to beneficiaries at death. Expected value computed each period:
```
prob_dying_in_period = q_annual × dt × running_lapse_factor
PV(GMDB) += max(0, BB − AV) × prob_dying_in_period × discount_factor
```
where `q_annual = survival_probs[t−1] − survival_probs[t]` (annual mortality decrement).

---

## Stochastic Model

**Geometric Brownian Motion** (Black-Scholes):
```
return_t = exp((μ − 0.5σ²)×dt + σ×√dt×Z) − 1,  Z ~ N(0,1)
```
- Default: 1,000 scenarios (configurable 100–10,000)
- NumPy SFC64 RNG with optional fixed seed for reproducibility
- Annual or monthly time step (monthly ≈12× slower, more accurate)

---

## Input Parameters & Defaults

### Policyholder
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Current Age | 65 | 40–90 | Age at valuation date |
| Gender | Male | M/F | Selects mortality table gender column |
| Max Projection Age | 100 | 90–120 | Omega — projection end |

### Contract
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Account Value | $500,000 | $10K–$10M | Current market value of subaccounts |
| Benefit Base | $500,000 | $10K–$10M | Notional amount for GAW calculation |
| Election Age | 65 | ≥ current_age | Age withdrawals begin; before = accumulation phase |
| Withdrawal Rate | 5.0% | 1–10% | % of BB per year (age-banded: 4% @55–59, 5% @60–64, 6% @65+) |
| Rider Fee | 1.00% | 0–3% | Annual % of BB deducted from AV |
| M&E + Admin Fee | 1.40% | 0–3% | Annual % of AV for base contract |
| Roll-up Rate | 0.0% | 0–8% | Annual BB growth during accumulation only |
| Step-up (Ratchet) | Off | On/Off | BB = max(BB, AV) at each anniversary |
| GMDB Rider | Off | On/Off | Enable Guaranteed Minimum Death Benefit |

### Economic
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Expected Return (μ) | 7.0% | −5% to 20% | Gross annual GBM drift |
| Volatility (σ) | 18.0% | 5–50% | Annual standard deviation |
| Discount Rate | 4.0% | 0–10% | Risk-free rate for PV discounting |
| Frequency | Annual | Annual/Monthly | Projection time step |

### Mortality
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Mortality Table | 2012 IAM Basic | 2012iam / annuity2000 | 2012 IAM includes Scale G2 improvement |
| Mortality Multiplier | 1.0× | 0.5–2.0× | Scale all qx values (< 1 = lighter mortality) |

### Lapse
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Base Lapse Rate | 3.0% | 0–20% | Annual surrender probability |
| Dynamic Lapse | Off | On/Off | ITM-adjusted: lapse ∝ 1 − sensitivity×(BB/AV−1) |
| ITM Sensitivity | 0.5 | 0–2.0 | Rate at which lapse falls as BB/AV rises |
| Min Lapse Floor | 10% | 0–100% | Floor as % of base rate (prevents lapse → 0) |

### Policyholder Behavior
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Benefit Utilization | 100% | 50–100% | % of in-force who actually take withdrawals |

### Simulation
| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Scenarios | 1,000 | 100–10,000 | Monte Carlo paths |
| Random Seed | 42 | 1–999,999 | Fixed seed for reproducibility |

---

## Mortality Tables

Stored as JSON in `backend/data/`:
1. **2012 IAM Basic** (`2012iam`) — industry standard; includes Scale G2 improvement projection
2. **Annuity 2000** (`annuity2000`) — static table, no improvement

---

## UI Layout

**Left sidebar** (resizable, 220–520px): 4-tab input panel
1. **Policyholder** — Policyholder + Contract sections
2. **Assumptions** — Mortality + Lapse + Policyholder Behavior
3. **Economic** — Economic assumptions
4. **Simulation** — Scenarios + seed

Run / Run Sensitivity buttons pinned at sidebar bottom.

**Main area**: Summary metric cards → tab bar → content
- **Charts**: AV fan chart, claim histogram, fee vs. claim bar chart, stat tables
- **Projection Table**: Year-by-year AV percentiles + survival/persistency + CSV export
- **Sensitivity**: Tornado chart (±10% shift on each parameter)
- **Methodology**: Mathematical documentation

---

## Actuarial Parameter Section Convention

All parameter groupings — Python dataclasses, Pydantic models, React UI — must follow this order. Never mix sections.

| # | Section | Current Parameters |
|---|---------|-------------------|
| 1 | **Policyholder** | `current_age`, `gender`, `max_age` |
| 2 | **Contract** | `account_value`, `benefit_base`, `election_age`, `withdrawal_rate`, `rider_fee`, `me_fee`, `rollup_rate`, `step_up`, `gmdb_enabled` |
| 3 | **Economic** | `mu`, `sigma`, `discount_rate`, `frequency` |
| 4 | **Mortality** | `mortality_table`, `mort_multiplier` *(future: custom qx upload)* |
| 5 | **Lapse** | `lapse_rate`, `dynamic_lapse`, `lapse_sensitivity`, `lapse_min_multiplier` |
| 6 | **Policyholder Behavior** | `benefit_utilization` *(future: partial withdrawal)* |
| 7 | **Simulation** | `num_scenarios`, `seed` |

Applies to: `backend/engine/projection.py` · `backend/main.py` · `frontend/src/components/InputPanel.jsx` · `frontend/src/App.jsx`

---

## Actual File Structure

```
ActuarialModel/
├── CLAUDE.md
├── backend/
│   ├── main.py                      # FastAPI app: /simulate, /sensitivity, /health
│   ├── requirements.txt
│   ├── data/
│   │   ├── mortality_2012iam.json
│   │   └── mortality_annuity2000.json
│   └── engine/
│       ├── projection.py            # SimulationParams dataclass + Monte Carlo runner
│       ├── mortality.py             # Survival probs, persistency, adjust_lapse_for_itm()
│       ├── stochastic.py            # GBM return generation (NumPy)
│       ├── utils.py                 # Discount factors, compute_stats(), compute_histogram()
│       ├── auth.py                  # OTP generation + SES/SMTP/console email dispatch
│       ├── otp_store.py             # SQLite OTP table (create/verify/rate-limit)
│       └── session_store.py         # SQLite session persistence for analytics
├── frontend/
│   ├── index.html                   # GitHub Pages MVP (standalone, CDN deps, JS engine)
│   ├── test_page.mjs                # Playwright headless test for index.html
│   ├── package.json                 # Vite + React + Recharts + Tailwind
│   ├── src/
│   │   ├── App.jsx                  # App shell: params state, run handlers, resizable sidebar
│   │   ├── api/client.js            # Axios wrappers for /simulate and /sensitivity
│   │   └── components/
│   │       ├── InputPanel.jsx       # 4-tab input panel (Policyholder/Assumptions/Economic/Simulation)
│   │       ├── ResultsSummary.jsx   # Metric cards (GMWB, GMDB, Fees, Net Cost, Scenarios)
│   │       ├── AVFanChart.jsx       # AV percentile fan chart
│   │       ├── ClaimHistogram.jsx   # PV(GMWB claims) distribution
│   │       ├── FeeVsClaimChart.jsx  # Fee vs GMWB vs GMDB vs Net bar chart
│   │       ├── ProjectionTable.jsx  # Year-by-year table + CSV export
│   │       ├── SensitivityChart.jsx # Tornado chart
│   │       ├── Methodology.jsx      # Educational content + math
│       ├── AdvancedGateModal.jsx # OTP email verification gate (Step 1: email, Step 2: code)
│       ├── SnapshotComparison.jsx # Side-by-side scenario comparison with delta badges
│       └── OptimalAgeChart.jsx  # Optimal election age sweep chart
│   ├── pages/
│   │   └── LandingPage.jsx      # AnnuityVoice marketing page (/, React Router)
│   └── vite.config.js
├── backend/.env.example             # SMTP/SES env var documentation (copy to .env)
└── infra/                           # AWS deployment scripts (not yet active)
```

---

## Implemented vs. Planned Features

### Done ✓
- GMWB rider (Monte Carlo, accumulation + withdrawal phases, roll-up, step-up)
- GMDB rider (death benefit shortfall, mortality-weighted PV)
- Election age / deferral period (accumulation phase with roll-up before election)
- Dynamic lapse (ITM-adjusted: lapse decreases as BB/AV rises)
- Sensitivity analysis / tornado chart (±10% shift, 11 parameters)
- 2012 IAM Basic (Scale G2) + Annuity 2000 mortality tables
- Annual and monthly projection frequency
- Resizable left sidebar (drag handle, 220–520px)
- 4-tab input panel (Policyholder / Assumptions / Economic / Simulation)
- Percentage display for all rate inputs (not raw decimals)
- Projection table with CSV export
- AV fan chart, claim histogram, fee vs. claim chart
- Pre-push Playwright test for `index.html` MVP
- AnnuityVoice landing page (React Router, `/` + `/calculator` routes)
- Share / permalink (base64 URL hash), session persistence (localStorage)
- Product presets (Jackson, Equitable, TIAA, Nationwide, Lincoln)
- Scenario snapshots + side-by-side comparison (up to 3 runs)
- Smart Insight Cards, SPIA comparison, print-ready CSS
- Mobile bottom-sheet input panel
- **Email OTP verification gate** — Advanced mode requires a verified email
  - `POST /auth/send-otp` — rate-limited (3/10 min), stores in SQLite, sends via SES or SMTP
  - `POST /auth/verify-otp` — timing-safe 6-digit check, single-use, 10-min expiry
  - Transport config: `SES_REGION` → AWS SES; `SMTP_HOST` → SMTP; neither → console (dev)
  - `va_calc_verified_email` localStorage key set only on OTP success
  - See `backend/engine/auth.py`, `backend/engine/otp_store.py`, `backend/.env.example`

### Pending / Future
- **AWS deployment**: Lambda + S3/CloudFront not yet provisioned (infra/ scripts exist but no env vars)
- **Email transport in prod**: configure `SES_REGION` + verify `FROM_EMAIL` in AWS SES before deploying
- **index.html JS sync**: dynamic lapse, election age, GMDB not in standalone MVP; sync when Lambda is live
- **GMAB rider**: accumulation guarantee (return of premium at maturity)
- **GMIB rider**: income benefit (most complex — annuitisation guarantee)
- **Risk-neutral valuation**: fair value / GAAP reserving (replace real-world GBM with risk-neutral measure)
- **Stochastic interest rates**: Hull-White or similar
- **Multi-asset class**: equity + bond allocation with rebalancing
- **Greek sensitivities**: delta, rho, vega of the guarantee
- **PDF report export**
- **Custom mortality table**: allow user to paste qx values
- **Real-world calibration**: fit μ/σ to historical index data

---

## Email OTP Authentication

Advanced mode is gated behind a verified email address. The flow is:

1. User clicks "Advanced" → `AdvancedGateModal` opens (Step 1: email + role form)
2. Frontend calls `POST /auth/send-otp { email }` → 6-digit code stored in SQLite + sent by email
3. Modal transitions to Step 2: code entry form with 60-second resend countdown
4. Frontend calls `POST /auth/verify-otp { email, code }` → backend validates, marks code used
5. On success: `va_calc_verified_email` + `va_calc_email` written to `localStorage`, Advanced mode unlocked

**localStorage keys:**
| Key | Meaning |
|-----|---------|
| `va_calc_verified_email` | OTP-verified email — gates Advanced mode |
| `va_calc_email` | Legacy key (also set on verify); used by `saveParams` / `recordSession` |
| `va_calc_role` | User role (optional, set on unlock) |
| `va_calc_saved_params` | Last-used params (only saved when `va_calc_email` is present) |

**Rate limiting:** 3 send requests per email per 10-minute window. OTP expires in 10 minutes, single-use.

**Dev workflow without a real email server:**
```bash
# No env vars needed — OTP prints to the uvicorn console:
# [AnnuityVoice OTP — DEV MODE] To: you@example.com | Code: 847291
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**Configuring email transport (copy backend/.env.example → backend/.env):**
```bash
# Option A — AWS SES (production)
SES_REGION=us-east-1
FROM_EMAIL=noreply@annuityvoice.com

# Option B — SMTP (works with Gmail App Passwords, Mailgun, etc.)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=you@gmail.com
```

---

## Development Workflow

### Rule: Always test `index.html` locally before pushing to GitHub

The GitHub Pages MVP must pass a Playwright headless test before every push. A git pre-push hook enforces this.

**Manual test** (from repo root):
```bash
node frontend/test_page.mjs
```

**Automated enforcement**: `.git/hooks/pre-push` runs the test on every `git push`.

### Running locally

```bash
# Backend (from backend/)
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend (from frontend/)
npm run dev        # → http://localhost:5173
```

### Claude Code Skills for This Project

| Skill | Invoke | Purpose |
|-------|--------|---------|
| `update-config` | `/update-config` | Configure Claude Code hooks (e.g. auto-run MVP test before git push) |
| `simplify` | `/simplify` | Post-implementation code review after engine or component changes |
| `batch` | `/batch <instruction>` | Parallelise large multi-file changes across isolated git worktrees — ideal for index.html JS sync or adding a new rider across all layers at once |
| `security-review` | `/security-review` | Scan pending changes for vulnerabilities — run before AWS deployment to check CORS config, Pydantic validation, and FastAPI input handling |
| `loop` | `/loop <interval> <prompt>` | Re-run a prompt on a schedule — useful for monitoring Lambda deploy status or watching CI test results |
| `install-github-app` | `/install-github-app` | Wire up Claude GitHub Actions bot for automated PR review and test runs on push |
| `diff` | `/diff` | Interactive diff viewer — review pending changes before committing (complements the pre-push test rule) |
