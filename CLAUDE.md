# AnnuityVoice

> **Live at [annuityvoice.com](https://annuityvoice.com)**

An interactive actuarial present value calculator for **variable annuity guarantee riders** (GMWB and GMDB live; GMAB, GMIB planned). Two modes: a clean **Standard** view for advisors and clients, and a full **Advanced** view for actuaries and analysts.

**Tech stack**:
- **Backend**: Python (FastAPI, NumPy) — Monte Carlo engine, mortality tables, sensitivity analysis — deployed on AWS Lambda (arm64)
- **Frontend**: React + Vite, Tailwind CSS, Recharts — deployed on S3 + CloudFront, custom domain via Route 53
- **GitHub Pages MVP**: standalone `index.html` with embedded JS engine (not yet synced with Python backend features)

**Deployment**:
- Production: `https://annuityvoice.com` (Lambda Function URL + CloudFront + ACM)
- Dev: `start.bat` → uvicorn :8000 + Vite :5173 (Vite proxies `/api` → localhost)
- Monthly cost: ~$0.50 (Route 53 hosted zone only; Lambda + CloudFront within free tier at current traffic)

---

## Audience

- **RIAs / financial advisors** — run "Product A vs. Product B" comparisons for client meetings; share permalink; print one-pager; use presets for Jackson, Equitable, TIAA, Nationwide, Lincoln
- **Practicing actuaries** — full Monte Carlo with sensitivity tornado, projection table, dynamic lapse, mortality tables, CSV export
- **Students / educators** — plain-English insight cards, methodology tab with math, sensible defaults, health selector abstraction over mortality multiplier

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

## What's Shipped ✓

**Engine**
- GMWB rider — Monte Carlo, accumulation + withdrawal phases, roll-up, step-up, age-banded rates
- GMDB rider — death benefit shortfall, mortality-weighted PV
- Dynamic lapse (ITM-adjusted), benefit utilization, fixed account allocation
- 2012 IAM Basic (Scale G2) + Annuity 2000 mortality tables; annual + monthly frequency
- Sensitivity analysis / tornado chart (±10% shift, 13 parameters)
- Optimal election age sweep (`/optimal_election_age`)

**UI / UX**
- Standard mode — compact StatStrip metrics, health selector, insight cards, SPIA comparison
- Advanced mode — full MetricCards, all parameters exposed, OTP-gated
- Sidebar collapsed by default on desktop; mobile bottom-sheet drawer
- Resizable sidebar (drag handle, 220–520px); sidebar open/closed persists in localStorage
- 5 product presets (Jackson, Equitable, TIAA, Nationwide, Lincoln)
- Scenario snapshots + side-by-side comparison (up to 3 runs) with delta badges
- Share / permalink (base64 URL hash); session persistence (localStorage)
- Print-ready CSS (`window.print()` one-pager with logo, params, charts, disclaimer)
- AV fan chart, claim histogram, fee vs. claim chart, projection table (CSV export)
- AnnuityVoice landing page (`/`) + calculator (`/calculator`), React Router

**Infrastructure**
- Deployed: Lambda arm64 + S3 + CloudFront + Route 53 + ACM
- Email OTP gate for Advanced mode (SES / SMTP / console fallback in dev)
- Session analytics — every run recorded to SQLite (`backend/query_sessions.py` for queries)
- Playwright UI test suite (`frontend/test_ui_agent.mjs`) with 10 scenarios

---

## Roadmap

Grouped by impact area. Items within each group are loosely priority-ordered.

### Advisor workflow (highest RIA stickiness)
- **Branded PDF report** — "Download Summary" button generates a client-ready PDF with logo, inputs, charts, and the print disclaimer. More polished than browser print; advisors can email it directly.
- **Client email delivery** — after print/export, offer "Email this to my client" (pre-fills advisor's email from localStorage; client gets a read-only link + PDF attachment)
- **More product presets** — add Brighthouse, Prudential, Allianz, North American, Protective. Each preset is one JSON object; low effort, high search value.
- **Comparison notes field** — free-text note per snapshot ("Client preferred B because lower fee") saved to sessionStorage alongside the comparison panel
- **"What does this mean?" plain-English mode** — toggle in Standard mode that rewrites metric labels and chart axis titles into client-friendly language ("Guaranteed income value" vs "PV(GMWB)")

### Growth / discoverability
- **SEO landing pages** — static pages for "Jackson National GMWB calculator", "Equitable SCS analyzer", etc. Each pre-loads the relevant preset via URL hash. Google indexes the content; advisor Googles the product name and finds the tool.
- **Embed widget** — `<iframe>` snippet that insurance-focused blogs and RIA sites can drop in. Read-only Standard mode, branded "Powered by AnnuityVoice".
- **Case study blog posts** — "How to evaluate a variable annuity before recommending it" with screenshots of the tool walkthrough. Publish on the AnnuityVoice site; share on advisor forums.
- **Live example CTA on landing page** — hero tertiary link "→ See Jackson National modeled" pre-loads Jackson preset so visitors land in the calculator with results already shown (share hash already works, just needs the constant + link wired up)

### Actuary / power user
- **Review mortality assumptions** — audit the 2012 IAM Basic (Scale G2) and Annuity 2000 tables for appropriateness: confirm improvement factors are applied correctly, consider adding a more recent table (e.g. 2019 CSO or SOA PRI-2012), and verify the mortality multiplier interacts correctly with both tables
- **Review lapse assumptions** — audit base lapse rate, dynamic lapse ITM-adjustment, and lapse floor against industry data (LIMRA, SOA experience studies); consider policy-year grading (surrender charges typically cause lapse rates to spike at free-partial-withdrawal anniversary) and validate the dynamic lapse formula behaves sensibly at extreme ITM ratios
- **GMAB rider** — accumulation guarantee (return of premium at maturity); straightforward addition alongside GMDB
- **Risk-neutral valuation mode** — replace real-world GBM drift with risk-neutral measure (μ = r); useful for GAAP reserving and fair-value pricing alongside the existing real-world view
- **Custom mortality table** — paste qx values into a text box; useful for pricing substandard lives or validating proprietary tables
- **Greek sensitivities** — delta, rho, vega of the guarantee value; natural extension of the existing tornado chart
- **Real-world calibration** — fit μ/σ to a ticker's historical returns (SPY, AGG, etc.); replaces manual economic assumption entry

### Technical maintenance
- **index.html JS sync** — the GitHub Pages standalone MVP is missing dynamic lapse, GMDB, election age deferral, and age-banded rates; sync when there's a forcing function (e.g. before a conference demo that needs offline mode)
- **GMIB rider** — income benefit / annuitisation guarantee; most complex rider, deferred until GMAB is done
- **Stochastic interest rates** — Hull-White or Vasicek; prerequisite for risk-neutral mode
- **Multi-asset class** — equity + bond allocation with rebalancing; prerequisite for fixed-indexed annuity modeling

---

## Reaching RIAs

RIAs are the highest-value early adopters: they already understand annuity mechanics, they have clients to show the tool to, and they share tools within tight professional networks. Getting 10 enthusiastic RIAs is worth more than 1,000 passive page views.

### Where RIAs congregate

| Channel | Notes |
|---------|-------|
| **Kitces.com** | Most-read RIA blog; Michael Kitces has a "tools" section and an active community forum. A guest post or tool submission is the highest-leverage single action. |
| **XYPN Network** | Community of fee-only, younger RIAs (mostly CFPs). Very active Slack and annual conference. Members actively share practice-management tools. |
| **NAPFA community** | National Association of Personal Financial Advisors — fee-only RIAs. Forums, regional groups, and an annual conference. |
| **r/financialplanning** | Active subreddit; advisors and consumers. A "I built a free VA analyzer" post with a GIF demo tends to do well. |
| **Twitter / X — #RIA, #CFP, #annuity** | Fintech-adjacent advisors are active here. Short thread showing a Jackson vs. Equitable comparison screenshot + link. |
| **LinkedIn** | Target: CFP, ChFC, RIA, insurance-licensed advisors. Direct connection + personalized note works better than a broadcast post. |
| **FPA (Financial Planning Association)** | Local chapters hold monthly meetings; a 10-minute tool demo at a chapter meeting is very effective. |

### Outreach approach that works

1. **Lead with a specific scenario, not features** — "I modeled a 65-year-old comparing Jackson Elite vs. Equitable SCS with a 5% roll-up. Here's what the numbers say." Link to the pre-loaded share URL. Advisors click because it's *their* problem, not because it's a cool tool.

2. **Share a real comparison** — Run Jackson vs. Equitable with default assumptions, take a screenshot of the Snapshot Comparison panel, post it with "first tool I've found that does side-by-side VA rider PV in 30 seconds." Advisors share peer-validated content.

3. **Write a methodology note** — A 500-word blog post titled "How we calculate the present value of a GMWB guarantee" with the math. Actuaries and sophisticated advisors will share it because it's rare to see this explained clearly outside of a textbook.

4. **NAPFA/FPA chapter demo** — Contact a local chapter program director. Offer a 15-minute "Evaluating VA guarantees with Monte Carlo" presentation. Bring printed one-pagers using the print feature. This creates word-of-mouth in a high-trust setting.

5. **Kitces "Weekend Reading" submission** — Michael Kitces has a standing call for tool submissions in his weekly roundup. Email a one-paragraph description + screenshot + URL to the editorial team. Getting listed there reaches ~100K advisors in one shot.

6. **SOA / CAS forums and LinkedIn groups** — Actuaries will validate the math and share with colleagues. A post in the SOA LinkedIn group or a comment in the EA/FSA exam study communities ("here's a tool that runs the GMWB projection interactively") reaches a technical audience that amplifies credibility.

### What to say

> *"AnnuityVoice is a free Monte Carlo calculator for VA guarantee riders — GMWB and GMDB. You enter the contract terms (benefit base, roll-up, rider fee, election age) and it runs 1,000 scenarios with real mortality tables to show the actuarial present value of the guarantee and the fees, side by side. Presets for Jackson, Equitable, TIAA, Nationwide, and Lincoln. Standard mode is clean enough to use in a client meeting; Advanced mode has the full actuarial machinery."*

Keep it under 60 words, lead with the output (PV comparison), not the technology (Monte Carlo).

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

### Running locally

```bash
# Quickest: double-click start.bat (repo root)
# Starts uvicorn first, waits 4 s, then starts Vite — avoids the "not responding" banner

# Or manually:
# Backend (from backend/)
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (from frontend/)
npm run dev        # → http://localhost:5173
# Vite proxies /api → localhost:8000 (see vite.config.js)
# .env.production is NOT loaded in dev; that file only applies to npm run build
```

### Rule: Always test `index.html` locally before pushing to GitHub

The GitHub Pages MVP must pass a Playwright headless test before every push. A git pre-push hook enforces this.

**Manual test** (from repo root):
```bash
node frontend/test_page.mjs
```

**Automated enforcement**: `.git/hooks/pre-push` runs the test on every `git push`.

### Full UI test suite (Vite + uvicorn must be running)

```bash
node frontend/test_ui_agent.mjs
# 10 scenarios — app load, default sim, health selector, DB-only, advanced mode,
# banded rates, section order, standard mode clarity, tooltip, input clear/retype
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
