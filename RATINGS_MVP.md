# AnnuityVoice Ratings — MVP Build Spec

> **What this document is.** Engineering brief for adding a public, FSA-signed annuity product rating service ("Ratings") on top of the existing AnnuityVoice calculator engine. Written for an autonomous agent (or a coordinated agent team) to execute end-to-end. Read [CLAUDE.md](./CLAUDE.md) first — that's the canonical project doc; this doc is additive.

---

## 1. Product thesis (read this — every implementation decision flows from it)

AnnuityVoice today is a **calculator** (user inputs → result, neutral, unsigned, free). The Ratings product is a **publication** (curated catalog → standardized score → FSA-signed letter grade, editorial, monetized two-sided). They share the Monte Carlo engine; everything else is different.

**Positioning line (do not deviate from):**

> *"You're delegating the work to AI. You're hiring an actuary for the judgment."*

The AI/engine handles ingestion, parsing, simulation, sub-score computation, draft narrative. **An FSA signs each rating.** The signature is the product. Hide the signature and we become commoditized; lead with it and we become an authority.

**Three rules that fall out of the thesis:**

1. **Ratings are public.** Methodology is open. The calculator may stay gated (Advanced mode OTP), but every letter grade is freely viewable, linkable, and indexable. Flip the current OTP model: gate inputs, not verdicts.
2. **Every rating page shows the signing actuary's name, FSA designation, and date.** Treated as a structural requirement, not a decorative element.
3. **No paid badges in MVP.** Carrier-paid badge revenue is in the business model but launches *after* editorial authority is established (post-MVP). Any pay-for-rating logic in v1 destroys credibility before it accrues.

---

## 2. MVP scope (60–90 days)

### In scope

- **Engine extension:** RILA mechanics added to the Monte Carlo (`backend/engine/projection.py`).
- **Product coverage:** **25 named RILA products** rated and published (see [§7](#7-initial-product-universe-25-rilas)). VAs, FIAs, SPIAs explicitly deferred to v2.
- **Methodology:** 5 sub-scores, equal-weighted, mapped to A+→F letter grade. Methodology paper published at `/methodology` with versioned hash.
- **Publication UI:** new `/ratings` route on annuityvoice.com — index page (sortable/filterable table) and per-product detail page.
- **Editorial workflow:** rating draft → FSA review → signature → publish → version pin.
- **Data store:** rated-product catalog (JSON-first, SQLite-second) with rating history.
- **OTP inversion:** ratings public; the *Advanced* calculator mode stays OTP-gated.

### Explicitly out of scope for MVP

- ❌ Carrier-paid badges / payment flows
- ❌ Advisor terminal subscription
- ❌ Premium consumer tier
- ❌ Cap-reset history (not yet structured; v2 once data pipeline exists)
- ❌ FIA, SPIA, DIA, traditional VA coverage (engine first does RILAs; rest follow)
- ❌ Multi-rater workflow (only K signs in MVP)
- ❌ Lead-gen referrals to RIAs
- ❌ API for B2A consumption
- ❌ Internationalization

### Success criteria

| # | Criterion | How measured |
|---|---|---|
| 1 | 25 RILAs rated, FSA-signed, published | Count published rating pages |
| 2 | Methodology fully documented, hash-versioned | `/methodology` accessible; methodology JSON committed |
| 3 | Each product page renders <2s, SEO-indexed | Lighthouse + Google Search Console |
| 4 | Ratings reproducible from product spec JSON | CI test re-runs rating; matches snapshot |
| 5 | Editorial workflow has a documented audit trail | Git log on rating files shows draft→review→sign |
| 6 | Calculator (existing) still works; no regressions | Existing Playwright suite passes |

---

## 3. Architecture overview

```
ActuarialModel/
├── backend/
│   ├── engine/
│   │   ├── projection.py           # EXTEND: add RILA path; add rating runner
│   │   ├── rila.py                 # NEW: RILA segment mechanics
│   │   ├── rating.py               # NEW: 5 sub-score functions + composite
│   │   └── (existing files)
│   ├── data/
│   │   ├── products/               # NEW: one JSON file per rated product
│   │   │   ├── equitable_scs_income.json
│   │   │   ├── allianz_index_advantage_income.json
│   │   │   └── ... (25 total)
│   │   ├── ratings/                # NEW: one JSON file per rating result
│   │   │   ├── equitable_scs_income_v1.json
│   │   │   └── ...
│   │   ├── methodology/
│   │   │   └── methodology_v1.json # NEW: weights, thresholds, sub-score defs
│   │   └── (existing mortality tables)
│   ├── main.py                     # EXTEND: add /ratings, /ratings/{slug}, /methodology routes
│   └── (existing)
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx     # EXISTING
│   │   │   ├── RatingsIndex.jsx    # NEW
│   │   │   ├── RatingDetail.jsx    # NEW
│   │   │   └── Methodology.jsx     # NEW (replaces existing Methodology tab role for ratings)
│   │   ├── components/
│   │   │   ├── RatingCard.jsx      # NEW
│   │   │   ├── SubscoreBar.jsx     # NEW
│   │   │   ├── SignatureBlock.jsx  # NEW — REQUIRED on every rating page
│   │   │   └── (existing)
│   │   ├── App.jsx                 # EXTEND: add /ratings router branch
│   │   └── api/client.js           # EXTEND: ratings endpoints
│   └── (existing)
├── tools/
│   ├── rate_product.py             # NEW: CLI — given product JSON, output rating JSON
│   ├── publish_rating.py           # NEW: CLI — moves draft → signed → published
│   └── (existing)
├── CLAUDE.md                       # EXISTING
└── RATINGS_MVP.md                  # THIS FILE
```

---

## 4. Rating methodology (the IP)

### 4.1 Five sub-scores, each 0–100

| Sub-score | What it measures | Inputs | Weight in composite (MVP) |
|---|---|---|---|
| **TCO** — Total Cost of Ownership | Expected fee drag over 10 years vs the best-in-class RILA in the cohort | M&E, rider fee, cap-spread, participation-rate-equivalent fees | 0.20 |
| **GV** — Guarantee Value | Monte Carlo PV of GLWB/GMDB benefits per dollar of rider cost | Rider terms, mortality, projection model | 0.20 |
| **SF** — Surrender Flexibility | Length and severity of surrender schedule; free-withdrawal corridor; hardship waiver scope | Surrender schedule, free-withdrawal %, waiver list | 0.20 |
| **IC** — Insurer Credit | Carrier credit quality, adjusted for PE-ownership and Level 3 asset concentration | AM Best / S&P / Moody's; PE-owned flag; Level 3 % | 0.20 |
| **BF** — Behavioral Fairness | Historical cap-reset behavior, illustration-vs-actual delta, complaint/fine history | Initial vs current cap; SEC filings; NAIC complaint data | 0.20 |

Equal weighting in MVP. Weights configurable in `methodology_v1.json`; future versions may rebalance with public changelog.

### 4.2 Sub-score scoring rubrics

**TCO sub-score:**
```
tco_drag = sum_of_all_explicit_fees + cap_spread_drag_estimate
# cap_spread_drag_estimate: simulated avg annual drag from cap vs uncapped index return
cohort_best = min(tco_drag across all products in same product type)
cohort_worst = max(tco_drag)
tco_score = 100 * (1 - (tco_drag - cohort_best) / (cohort_worst - cohort_best))
# Clamp to [0, 100]
```

**GV sub-score:**
```
gv_value = MonteCarloPV(rider benefits) using AnnuityVoice engine, standardized scenario
gv_cost = PV(all rider fees) over projection horizon
gv_ratio = gv_value / gv_cost
# Higher ratio = better
gv_score = 100 * min(1, gv_ratio / cohort_max_ratio)
# Products without riders get gv_score = 50 (neutral, neither rewarded nor penalized)
```

**SF sub-score (rule-based, 0–100):**
```
sf_score = 100
sf_score -= 5 * surrender_period_years           # -5 per year of surrender
sf_score -= max(0, max_surrender_pct - 5) * 5    # -5 per pct over 5%
sf_score += (free_withdrawal_pct - 10) * 1       # bonus over 10% free
sf_score += 5 if nursing_home_waiver else 0
sf_score += 5 if terminal_illness_waiver else 0
sf_score += 5 if disability_waiver else 0
sf_score = clamp(sf_score, 0, 100)
```

**IC sub-score:**
```
ic_score = rating_to_score(am_best_rating)  # A++ = 100, A+ = 95, A = 88, ..., B+ = 50
ic_score -= 10 if pe_owned else 0
ic_score -= 10 if level_3_pct > 0.25 else 0
ic_score -= 5  if level_3_pct > 0.15 else 0
ic_score = clamp(ic_score, 0, 100)
```

**BF sub-score:**
```
bf_score = 100
bf_score -= 10 * num_major_cap_cuts_5yr     # major = >25% cut to cap rate
bf_score -= 5 * num_minor_cap_cuts_5yr      # minor = 10-25%
bf_score -= 5 if illustration_actual_delta > 0.10  # >10% gap = manipulative illustrations
bf_score -= 2 * naic_complaint_index_normalized
bf_score -= 5 * num_regulatory_fines_5yr_capped_at_3
bf_score = clamp(bf_score, 0, 100)
# Where data is missing, BF defaults to 70 (slight penalty for opacity)
```

### 4.3 Composite → letter grade

```python
composite = 0.20*tco + 0.20*gv + 0.20*sf + 0.20*ic + 0.20*bf

LETTER_BANDS = [
  (95, "A+"), (90, "A"),  (85, "A-"),
  (80, "B+"), (75, "B"),  (70, "B-"),
  (65, "C+"), (60, "C"),  (55, "C-"),
  (50, "D+"), (45, "D"),  (40, "D-"),
  (0,  "F"),
]
```

### 4.4 Standardized scoring scenario (MUST be identical across products)

| Parameter | Value |
|---|---|
| Policyholder age | 60 |
| Gender | Male (publish female variant separately) |
| Initial premium | $250,000 |
| Projection horizon | 30 years |
| Income election age | 65 |
| Withdrawal rate | per product (use age-65 band as stated by carrier) |
| Equity drift μ | 7.0% |
| Volatility σ | 18.0% |
| Discount rate | 4.0% |
| Mortality table | 2012 IAM Basic (Scale G2) |
| Base lapse | 3.0% with dynamic lapse ON, sensitivity 0.5, floor 10% |
| Monte Carlo paths | 5,000 (higher than calculator default for rating stability) |
| Seed | 42 (fixed; reproducibility is required for ratings to be defensible) |

**Rule:** the scoring scenario is locked in `methodology_v1.json`. Changing any value bumps methodology version and re-rates all products (with public changelog).

---

## 5. Engine extensions — RILA mechanics

### 5.1 New file: `backend/engine/rila.py`

```python
from dataclasses import dataclass
from typing import Literal

@dataclass
class RILASegment:
    term_years: int                          # 1, 3, 5, 6 common
    index: Literal["sp500", "russell2000", "msci_eafe", "custom"]
    crediting_method: Literal["cap", "participation", "spread", "trigger"]
    cap_rate: float | None                   # max return per segment
    participation_rate: float | None         # multiplier on index
    spread: float | None                     # subtracted from index return
    trigger_rate: float | None               # paid if index ≥ 0
    protection_type: Literal["buffer", "floor"]
    protection_level: float                  # buffer = absorbs first X% loss; floor = max loss capped at -X%

@dataclass
class RILAProduct:
    name: str
    carrier: str
    base_av: float
    segments: list[RILASegment]              # holder allocates % to each
    allocation_pcts: list[float]             # sums to 1.0
    me_fee_annual: float                     # M&E + admin charge (on AV)
    has_glwb: bool
    glwb_terms: dict | None                  # if has_glwb: roll-up, withdrawal_rate, etc.
    has_gmdb: bool
    surrender_schedule: list[float]          # by year: [.08, .07, .06, .05, .04, .03, .02]
    free_withdrawal_pct: float               # e.g. 0.10
    nursing_home_waiver: bool
    terminal_illness_waiver: bool
    disability_waiver: bool

def project_rila_path(
    product: RILAProduct,
    index_returns: np.ndarray,   # path of returns
    dt: float,
) -> dict:
    """
    Project one Monte Carlo path for a RILA. Returns dict with AV trajectory,
    rider claims (if any), and fees paid.
    """
    # At each segment boundary:
    #   raw_return = compound index return over segment term
    #   credit = apply_crediting(segment, raw_return)
    #   AV *= (1 + credit)
    #   AV -= fees over segment
    # Outside segments: AV held flat or accrues at fixed rate (carrier-specific)
    ...

def apply_crediting(segment: RILASegment, raw_return: float) -> float:
    if segment.crediting_method == "cap":
        upside = min(raw_return * (segment.participation_rate or 1.0), segment.cap_rate)
    elif segment.crediting_method == "participation":
        upside = raw_return * segment.participation_rate
    elif segment.crediting_method == "spread":
        upside = max(0, raw_return - segment.spread)
    elif segment.crediting_method == "trigger":
        upside = segment.trigger_rate if raw_return >= 0 else 0
    else:
        raise ValueError("unknown crediting method")
    
    if raw_return < 0:
        if segment.protection_type == "buffer":
            downside = min(0, raw_return + segment.protection_level)
        elif segment.protection_type == "floor":
            downside = max(raw_return, -segment.protection_level)
        else:
            raise ValueError("unknown protection type")
        return downside
    return upside
```

### 5.2 Extension to `backend/engine/projection.py`

Add a `product_type: Literal["va", "rila"]` field to `SimulationParams`. When `"rila"`, route to `rila.project_rila_path()` instead of the existing GBM/GMWB path. The dataclass section order from CLAUDE.md still applies; RILA-specific parameters go into the **Contract** section.

### 5.3 New file: `backend/engine/rating.py`

```python
def compute_rating(product: RILAProduct, methodology: dict) -> dict:
    """
    Run the standardized scoring scenario for `product` and return:
    {
      "product_slug": "equitable_scs_income",
      "methodology_version": "v1.0.0",
      "scored_at": "2026-05-09T14:23:00Z",
      "sub_scores": {
        "tco": 78.4,
        "gv":  82.1,
        "sf":  65.0,
        "ic":  90.0,
        "bf":  70.0,
      },
      "composite": 77.1,
      "letter_grade": "B+",
      "narrative": "...",            # AI-drafted, FSA-edited
      "signed_by": null,              # filled by publish_rating.py
      "signed_at": null,
    }
    """
    ...
```

---

## 6. Data model

### 6.1 Product JSON shape — `backend/data/products/<slug>.json`

```json
{
  "slug": "equitable_scs_income",
  "name": "Structured Capital Strategies Income",
  "carrier": "Equitable",
  "product_type": "rila",
  "first_offered": "2022-03-01",
  "data_sources": [
    {"type": "prospectus", "url": "...", "retrieved": "2026-05-01"},
    {"type": "carrier_rate_sheet", "url": "...", "retrieved": "2026-05-01"}
  ],
  "base": {
    "base_av_default": 250000,
    "me_fee_annual": 0.0125,
    "surrender_schedule": [0.06, 0.05, 0.04, 0.03, 0.02, 0.01],
    "free_withdrawal_pct": 0.10,
    "nursing_home_waiver": true,
    "terminal_illness_waiver": true,
    "disability_waiver": false
  },
  "segments_available": [
    {
      "term_years": 1,
      "index": "sp500",
      "crediting_method": "cap",
      "cap_rate": 0.085,
      "participation_rate": 1.0,
      "protection_type": "buffer",
      "protection_level": 0.10
    },
    {
      "term_years": 6,
      "index": "sp500",
      "crediting_method": "cap",
      "cap_rate": 0.55,
      "participation_rate": 1.0,
      "protection_type": "buffer",
      "protection_level": 0.20
    }
  ],
  "rider": {
    "type": "glwb",
    "rider_fee_annual": 0.0125,
    "rollup_rate": 0.06,
    "withdrawal_rate_by_age": {"55-59": 0.04, "60-64": 0.05, "65+": 0.055},
    "step_up": true
  },
  "insurer": {
    "am_best": "A+",
    "sp": "A+",
    "moodys": "A1",
    "pe_owned": false,
    "level_3_pct_2024": 0.18
  },
  "behavioral_data": {
    "initial_cap": 0.09,
    "current_cap": 0.085,
    "cap_history": [
      {"date": "2022-03-01", "cap": 0.09},
      {"date": "2023-09-01", "cap": 0.085}
    ],
    "naic_complaints_index": 0.7,
    "regulatory_fines_5yr": 0
  }
}
```

### 6.2 Rating JSON shape — `backend/data/ratings/<slug>_v<n>.json`

(Output of `compute_rating()`; see [§5.3](#53-new-file-backendenginerratingpy).)

### 6.3 Methodology JSON — `backend/data/methodology/methodology_v1.json`

```json
{
  "version": "v1.0.0",
  "effective_date": "2026-05-09",
  "weights": {"tco": 0.20, "gv": 0.20, "sf": 0.20, "ic": 0.20, "bf": 0.20},
  "scoring_scenario": {
    "age": 60,
    "gender": "M",
    "premium": 250000,
    "horizon_years": 30,
    "election_age": 65,
    "mu": 0.07,
    "sigma": 0.18,
    "discount_rate": 0.04,
    "mortality_table": "2012iam",
    "base_lapse": 0.03,
    "dynamic_lapse": true,
    "lapse_sensitivity": 0.5,
    "lapse_min_multiplier": 0.10,
    "num_scenarios": 5000,
    "seed": 42
  },
  "letter_bands": [
    {"min": 95, "grade": "A+"}, {"min": 90, "grade": "A"}, {"min": 85, "grade": "A-"},
    {"min": 80, "grade": "B+"}, {"min": 75, "grade": "B"}, {"min": 70, "grade": "B-"},
    {"min": 65, "grade": "C+"}, {"min": 60, "grade": "C"}, {"min": 55, "grade": "C-"},
    {"min": 50, "grade": "D+"}, {"min": 45, "grade": "D"}, {"min": 40, "grade": "D-"},
    {"min": 0,  "grade": "F"}
  ],
  "sub_score_definitions": { "...": "verbatim text from §4.2 of RATINGS_MVP.md" }
}
```

---

## 7. Initial product universe (25 RILAs)

| # | Carrier | Product | Slug |
|---|---|---|---|
| 1 | Equitable | Structured Capital Strategies | `equitable_scs` |
| 2 | Equitable | SCS Plus | `equitable_scs_plus` |
| 3 | Equitable | SCS Income | `equitable_scs_income` |
| 4 | Allianz | Index Advantage+ | `allianz_index_advantage_plus` |
| 5 | Allianz | Index Advantage+ Income | `allianz_index_advantage_income` |
| 6 | Allianz | Index Advantage NF | `allianz_index_advantage_nf` |
| 7 | Brighthouse | Shield Level Select 6 | `brighthouse_shield_select_6` |
| 8 | Brighthouse | Shield Level Pay Plus | `brighthouse_shield_pay_plus` |
| 9 | Brighthouse | Shield Level Select 3 | `brighthouse_shield_select_3` |
| 10 | Lincoln | Level Advantage | `lincoln_level_advantage` |
| 11 | Lincoln | Level Advantage Income | `lincoln_level_advantage_income` |
| 12 | Prudential | FlexGuard | `prudential_flexguard` |
| 13 | Prudential | FlexGuard Income | `prudential_flexguard_income` |
| 14 | Prudential | FlexGuard Life | `prudential_flexguard_life` |
| 15 | Jackson | Market Link Pro | `jackson_market_link_pro` |
| 16 | Jackson | Market Link Pro Advisory | `jackson_market_link_pro_advisory` |
| 17 | Athene | Amplify 2.0 | `athene_amplify_2` |
| 18 | Symetra | Trek | `symetra_trek` |
| 19 | Symetra | Trek Plus | `symetra_trek_plus` |
| 20 | Nationwide | Defender | `nationwide_defender` |
| 21 | Nationwide | Defined Protection Annuity | `nationwide_dpa` |
| 22 | Pacific Life | Pacific Index Foundation | `pacific_index_foundation` |
| 23 | Pacific Life | Pacific Index Advisory | `pacific_index_advisory` |
| 24 | Transamerica | Structured Index Advantage | `transamerica_sia` |
| 25 | Global Atlantic | ForeStructured Growth | `globalatlantic_forestructured` |

**Verification step (do this first, agent):** confirm each product is still actively sold in May 2026. If not, replace with the closest currently-sold product from the same carrier.

---

## 8. UI / UX

### 8.1 Routes

| Route | Page | Public? |
|---|---|---|
| `/` | LandingPage (existing) | Yes |
| `/calculator` | Existing calculator | Yes (Standard mode) |
| `/calculator?advanced=1` | Advanced calculator | OTP-gated (existing) |
| `/ratings` | **NEW** RatingsIndex | Yes |
| `/ratings/:slug` | **NEW** RatingDetail | Yes |
| `/methodology` | **NEW** Methodology | Yes |

### 8.2 `/ratings` — Index page

Sortable, filterable table:

```
┌─────────────────────────────────────────────────────────────────────┐
│ AnnuityVoice Ratings — Registered Index-Linked Annuities            │
│ 25 products rated · Methodology v1.0.0 · Updated 2026-05-09         │
├─────────────────────────────────────────────────────────────────────┤
│ Filter: [ Carrier ▼ ] [ Grade ≥ ▼ ] [ Has Income Rider ▼ ]          │
├──┬────────────────────────────────┬───────────┬───────┬─────┬──────┤
│  │ Product                        │ Carrier   │ Grade │ TCO │ GV   │
├──┼────────────────────────────────┼───────────┼───────┼─────┼──────┤
│  │ Equitable SCS Income           │ Equitable │  B+   │ 78  │ 82   │
│  │ Allianz Index Advantage Income │ Allianz   │  B    │ 72  │ 79   │
│  │ Brighthouse Shield Pay Plus    │ Bright…   │  C+   │ 60  │ 64   │
│  │ ...                            │           │       │     │      │
└──┴────────────────────────────────┴───────────┴───────┴─────┴──────┘
```

Sortable by every column. Letter grade colored (A=green → F=red). Link each row to detail page.

### 8.3 `/ratings/:slug` — Detail page

Required sections, in order:

1. **Header.** Product name · carrier · letter grade (huge, colored) · methodology version pin.
2. **Signature block (REQUIRED — top of fold).**
   ```
   ┌─────────────────────────────────────────────────────────────┐
   │ Signed by [Name], FSA · NAIC # XXXXX · 2026-05-09          │
   │ Methodology v1.0.0 · Reproducible from product spec hash:  │
   │ a3f9...c2e1                                                │
   └─────────────────────────────────────────────────────────────┘
   ```
3. **Sub-scores.** Five horizontal bars (TCO / GV / SF / IC / BF) with score and one-sentence rationale each.
4. **Narrative.** 2–4 short paragraphs explaining the grade. AI-drafted, FSA-edited.
5. **Standardized scenario.** Plain-English: "Rated for a 60-year-old male, $250,000 premium, planning to draw income at 65, over 30 years."
6. **Product specs.** Compact table of the underlying contract terms.
7. **Methodology link.** "How we score" → `/methodology`.
8. **Last rated · Next review.** Date stamps.
9. **Disclaimer.** Standard rating-agency disclaimer; opinion not advice; no fiduciary relationship.

### 8.4 Signature block component spec

**File:** `frontend/src/components/SignatureBlock.jsx`

**Required props:** `signedBy`, `credentials`, `signedAt`, `methodologyVersion`, `productSpecHash`.

NAIC IDs are for producer/agent licensure, not for credentialed actuaries signing methodology. The credential string (FSA, MAAA) is the relevant authority signal.

**Rule:** this component must render on every rating detail page. Hide it and the page errors. Hard-coded requirement, not a stylistic preference. Add a CI test that asserts presence.

---

## 9. Editorial workflow

```
┌────────────┐    ┌───────────┐    ┌────────────┐    ┌──────────┐
│ Draft      │───▶│ AI narr-  │───▶│ FSA review │───▶│ Published│
│ (auto from │    │ ative gen │    │ + sign     │    │          │
│ product    │    │           │    │            │    │          │
│ spec)      │    │           │    │            │    │          │
└────────────┘    └───────────┘    └────────────┘    └──────────┘
   git commit       git commit       git commit         git tag
   "draft"          "narrative"      "signed"           "published"
```

### Commands

```bash
# 1. Generate draft rating from product spec
python tools/rate_product.py --product equitable_scs_income --methodology v1.0.0
# → writes backend/data/ratings/equitable_scs_income_v1_draft.json

# 2. Generate AI narrative (calls Claude API)
python tools/rate_product.py --product equitable_scs_income --add-narrative
# → updates draft with narrative

# 3. FSA reviews narrative, edits as needed, signs
python tools/publish_rating.py --product equitable_scs_income --sign --name "K Hu, FSA" --naic-id XXXXX
# → sets signed_by, signed_at; writes published rating; tags git commit

# 4. Bulk re-rate (e.g., methodology update or product data refresh)
python tools/rate_product.py --all --methodology v1.0.0
# → re-rates all products; outputs diff vs previously published
```

### Reproducibility rule

Given a (product spec JSON, methodology JSON, random seed), the rating must be byte-identical on re-run. CI test enforces this. Any non-determinism in the engine = bug, not a feature.

---

## 10. Build sequence (agent execution order)

Each step is a stop-and-test gate. Don't proceed if the prior step's tests fail.

| Step | Deliverable | Test gate |
|---|---|---|
| **S1. RILA engine** | `backend/engine/rila.py` with `RILASegment`, `RILAProduct`, `project_rila_path`, `apply_crediting`. | Unit tests on `apply_crediting` for cap/participation/spread/trigger × buffer/floor combinations. Snapshot test: deterministic AV trajectory for fixed seed and 6-year buffer-cap segment. |
| **S2. Rating engine** | `backend/engine/rating.py` with `compute_rating()`; 5 sub-score functions; composite + letter. | Hand-calculated sanity case (synthetic product) returns expected grade. |
| **S3. Methodology JSON + Product schema** | `methodology_v1.json`; product JSON schema; Pydantic validators. | Schema validation passes on a hand-crafted fixture. |
| **S4. First 5 product specs** | Hand-craft 5 product JSONs from prospectuses (Equitable SCS Income, Allianz Index Advantage Income, Brighthouse Shield Pay Plus, Lincoln Level Advantage Income, Prudential FlexGuard Income). | Each validates against schema; `rate_product.py` produces a rating without error. |
| **S5. `tools/rate_product.py`** | CLI: takes product slug + methodology version → produces rating JSON. | Round-trip test: rate, re-rate, check byte-identical. |
| **S6. `/ratings` + `/ratings/:slug` UI** | RatingsIndex + RatingDetail pages; SignatureBlock component. | Playwright: visit `/ratings`, sort by grade, click into one, signature block visible. |
| **S7. `/methodology` page** | Renders methodology JSON as human-readable doc. | Lighthouse SEO score ≥ 90. |
| **S8. `tools/publish_rating.py` + signing workflow** | CLI flow for sign+publish; git tag emitted. | Audit-trail test: signed rating has signed_by + signed_at; unsigned cannot be served by API. |
| **S9. Remaining 20 product specs** | All 25 products specified. | Schema validation across all 25. |
| **S10. Rate + FSA-sign all 25** | All 25 ratings published. | Page-render test on all 25 detail pages. |
| **S11. OTP inversion** | Calculator's Advanced mode stays gated; ratings paths fully public. No login/email required to see a rating. | Anonymous Playwright session can read every rating page. |
| **S12. Launch checklist** | Sitemap, robots.txt, Open Graph tags, JSON-LD schema on each rating page (`Review` schema). | Google Rich Results test passes on 3 sample rating pages. |

---

## 11. SEO + indexability (critical for the publication thesis)

- **Each rating page is its own indexable URL.** No client-side-only routing for content; pre-render or SSR `/ratings/*`.
- **Schema.org `Review` markup** on every rating detail page. `itemReviewed` = the product; `reviewRating` = letter grade; `author` = signing FSA's name and credentials.
- **Open Graph + Twitter Card** with grade prominently visible in card preview.
- **Sitemap auto-generated** from product catalog at build time.
- **Canonical URLs** stable across rating versions (use `/ratings/:slug`, methodology version queried as `?v=1.0.0` if needed for history).
- **No paywall on ratings, ever.** The calculator's Advanced mode stays gated; ratings do not.

---

## 12. Testing

### 12.1 Engine tests (`backend/tests/`)

- `test_rila.py` — RILA segment crediting; buffer/floor mechanics; multi-segment allocation
- `test_rating.py` — sub-score functions on synthetic products; composite arithmetic; letter mapping edge cases (boundary grades)
- `test_reproducibility.py` — same (product, methodology, seed) → byte-identical rating JSON

### 12.2 UI tests (`frontend/tests/`)

- Existing Playwright suite must still pass (`frontend/test_ui_agent.mjs`)
- New tests:
  - `/ratings` loads, table sorts, filters work
  - `/ratings/:slug` loads, signature block visible (CI fails if missing)
  - Anonymous visitor can read every rating (no OTP gate triggered)

### 12.3 Methodology audit test

Run the methodology JSON through a fixture set of 5 synthetic products with known expected grades. Output must match. If methodology changes, fixture grades update with a public changelog.

---

## 13. Disclaimers + legal scaffolding

Required text on every rating page (footer, small but legible):

> *"Annuity ratings are the opinion of the named signing actuary based on the published methodology (v[X.Y.Z]). They are not investment advice, do not constitute a recommendation, and do not create a fiduciary relationship. Ratings reflect data available as of the rating date and may change. Contract terms vary; consult the product prospectus and a qualified advisor before purchase."*

**E&O / media liability insurance** required pre-launch. Agent: flag this as a non-engineering blocker.

**Pre-publication carrier notice protocol** (post-MVP, but reserve hooks now): 30-day notice to rated carrier before publishing; accept factual corrections; ignore opinion challenges. Standard NRSRO playbook.

---

## 14. What "done" looks like at MVP launch

- ✅ Visit `https://annuityvoice.com/ratings` from a fresh browser, no login.
- ✅ See a table of 25 RILAs with letter grades.
- ✅ Sort by grade. Filter to "B+ and above."
- ✅ Click into "Equitable SCS Income." See the letter grade huge at the top. See the signature block immediately below: *"Signed by K Hu, FSA · 2026-XX-XX · Methodology v1.0.0."*
- ✅ Read the 5 sub-score bars. Read the 3-paragraph narrative. Click "How we score" → see the full methodology.
- ✅ View page source. Find `Review` JSON-LD schema with the FSA's name and the letter grade.
- ✅ Re-run the rating from the CLI. Get byte-identical output.
- ✅ Hit `/calculator?advanced=1`. Still prompted for OTP. Calculator unchanged.

If all 8 above are true, MVP is shipped.

---

## 15. Post-MVP roadmap (do not build in MVP, but reserve hooks)

| Track | Items |
|---|---|
| Coverage expansion | FIA, traditional VA, SPIA, DIA — each is its own engine extension |
| Monetization | Carrier-paid badges (with editorial firewall); advisor terminal subscription; consumer premium tier with "alternatives to this product" |
| Authority | NAIC engagement; state DOI market-conduct citation; FCRA/NRSRO designation path |
| Distribution | DPL Financial Partners co-marketing; RIA channel partnerships; Kitces guest post; SOA / CAS forum credibility build |
| Editorial | Multi-rater workflow; public rating-change changelog; carrier rebuttal page (linked-but-separate) |
| Data | Structured ingestion pipeline from SEC N-4 / state form filings; cap-reset history database; complaint-data ingestion from NAIC CIS |

---

## 16. Open questions for K (do not block agent on these; flag in PR)

1. **Signing actuary:** confirm "K Hu, FSA, MAAA" + NAIC producer number for the signature block.
2. **Domain:** stay at `annuityvoice.com/ratings`, or stand up `ratings.annuityvoice.com`? Recommend `/ratings` for SEO consolidation.
3. **Female variant:** publish parallel ratings for female 60-yr-old, or single-gender with disclosure? Recommend single-gender for MVP, female variant in v2.
4. **Methodology review board:** any external FSAs to co-sign methodology v1? Strengthens credibility but adds coordination cost. Defer to v2.
5. **Open-source methodology repo?** Strong move for authority — every rating reproducible by anyone with the engine. Recommend yes.
6. **E&O insurance carrier identified?** Non-engineering blocker for launch.

---

*End of spec. Agents: read [CLAUDE.md](./CLAUDE.md) first for codebase conventions, then start at [§10 Build sequence](#10-build-sequence-agent-execution-order). Ping the user on any decision in [§16 Open questions](#16-open-questions-for-k-do-not-block-agent-on-these-flag-in-pr) that blocks your current step.*
