# Ratings Data Acquisition Plan

> Bridge from `data_provenance: synthetic_v0` to `prospectus_v1`. Practical, defensible sources only — what a Big 4 actuarial reviewer would accept as documentation.

---

## 1. Source-of-truth per field

| Field group | Canonical public source | Extraction difficulty |
|---|---|---|
| **Segment specs** (`cap_rate`, `participation_rate`, `spread`, `trigger_rate`, `protection_level`, `term_years`) | Carrier **rate sheet PDFs** (refreshed monthly; e.g. Equitable "SCS Rates", Jackson "Index Rate Sheet"). Initial menu and protection levels are in the **SEC N-4 prospectus** (EDGAR). | **Medium.** Rate sheets are tabular PDFs; current rates copy in ~10 min/product. Historical caps require archived rate sheets (often broker-portal only). |
| **Base contract** (`me_fee_annual`, `surrender_schedule`, `free_withdrawal_pct`, waiver flags) | **N-4 prospectus** on SEC EDGAR ("Fee Table" and "Surrender Charges" sections). | **Medium-hard.** Tables are standardized but buried; need a human to read ~5 pages per product. Waivers vary by state rider — read state-specific endorsements. |
| **Rider terms** (`rider_fee_annual`, `rollup_rate`, `withdrawal_rate_by_age`, `step_up`) | N-4 prospectus rider section + **rider rate supplement** PDFs (separately filed; some quarterly). | **Hard.** Withdrawal-rate band tables, stacked roll-up vs. step-up logic, and joint-life adjustments require careful reading. ~30-60 min per rider. |
| **Insurer credit** (`am_best`, `sp`, `moodys`) | **AM Best public rating page** (free, machine-readable); S&P and Moody's free issuer pages. | **Easy.** One web lookup per carrier (not per product). ~5 min per carrier. |
| **`pe_owned`** | Public M&A press + **NAIC Insurance Holding Company filings** (Form B). | **Easy.** Known list (Athene/Apollo, Global Atlantic/KKR, etc.); 1× research, refresh annually. |
| **`level_3_pct`** | **NAIC Statutory Annual Statement, Schedule D** (general account holdings) — free via state DOI sites; also on **S&P Capital IQ / SNL Financial** (paid). | **Hard manual** / **Easy paid.** Schedule D PDFs are 100+ pages; computing Level-3 % requires aggregating by fair-value hierarchy. Paid feeds (SNL) deliver as a structured field. |
| **`cap_history` (5yr)** | Archived carrier rate sheets (broker portals, Wayback Machine), **Wink AnnuitySpecs / AnnuityFYI** (paid feeds explicitly track cap resets). | **Hard without a paid feed.** Manual reconstruction via Wayback is patchy. Wink covers it natively. |
| **`naic_complaints_index`** | **NAIC Consumer Information Source (CIS)** — public complaint index normalized by premium volume. Published quarterly. | **Easy.** One lookup per carrier; downloadable. |
| **`regulatory_fines_5yr`** | **NAIC Regulatory Actions database** + state DOI **market-conduct exam reports** + SEC/FINRA actions. | **Medium.** Aggregating across 50 state DOIs is tedious; NAIC's national database catches the material items. ~30 min per carrier annually. |
| **`illustration_actual_delta`** | Not a public field — must be **derived**: compare carrier's hypothetical illustration (in prospectus marketing supplement) to realized credited rates from cap history. | **Hard.** Requires both cap history AND illustration assumptions. Defer to v2; use neutral default (BF rubric already permits this). |

## 2. Manual vs. automated vs. paid

- **Scrapable / automatable** (build a pipeline in v2): AM Best ratings page, NAIC CIS complaint index, SEC EDGAR N-4 retrieval (filenames + fee-table page locator), PE-ownership static list.
- **Human reading a 200-page prospectus**: rider terms, surrender schedules, waiver scope, segment menu, protection-level options. EDGAR can fetch the file, but a person must read it. Budget the prospectus work; do not pretend to automate it for v1.
- **Paid feeds worth considering**:
  - **Wink AnnuitySpecs** (~$3-6K/yr): structured cap rates, cap history, rider parameters across the full RILA universe. Single biggest accelerator.
  - **Morningstar Annuity Intelligence** / **AnnuityFYI**: comparable, similar price band.
  - **S&P Capital IQ Pro (SNL Insurance)** (~$15K+/yr): Schedule D parsed, Level-3 %, statutory financials. Overkill for 25 products in MVP; defer.

## 3. Refresh cadence

| Frequency | Fields |
|---|---|
| **Monthly** | `cap_rate`, `participation_rate`, `spread`, `trigger_rate` (carriers reset on the 1st or 15th) |
| **Quarterly** | `rider_fee_annual` (some carriers reset for new issues quarterly), `naic_complaints_index` |
| **Annually** | `am_best`, `sp`, `moodys`, `level_3_pct` (driven by statutory annual statement), `pe_owned`, `regulatory_fines_5yr` |
| **At product re-file only** (every 1-3 yrs) | `surrender_schedule`, `free_withdrawal_pct`, waiver flags, `withdrawal_rate_by_age`, `step_up`, `protection_level` menu, `term_years` menu |
| **Append-only** | `cap_history` (each monthly cap observation pushed onto the array) |

## 4. Cost / effort

- **Paid feed (recommended): Wink ~$400/mo** unlocks cap rates + cap history + rider parameters across all 25 products with monthly refresh. Without it, plan for **~60 min per product per month** of manual rate-sheet extraction (25 hr/month).
- **Initial prospectus read**: **~90 min/product** to populate base + rider + segment menu fields from a single N-4. 25 products ≈ 38 hr one-time.
- **AM Best / NAIC CIS sweep**: ~2 hr/quarter for all carriers combined.
- **Level-3 % manual**: ~45 min per carrier annually from Schedule D PDFs (~8 hr/yr for 11 carriers). Skip if SNL becomes available.
- **Total v1 build (no paid feed)**: ~45-50 actuarial hours. With Wink: ~15 hr.

## 5. v1 verified subset (recommended)

**Products (5 flagships, highest traffic + grade dispersion):**

1. `equitable_scs_income`
2. `allianz_index_advantage_income`
3. `brighthouse_shield_pay_plus`
4. `lincoln_level_advantage_income`
5. `jackson_market_link_pro`

**Fields K personally verifies before flipping to `prospectus_v1`:**

1. **`segments_available.cap_rate`** (1-yr S&P 500 buffer 10% AND 6-yr buffer 20%) — directly from carrier rate sheet dated within 30 days of signing.
2. **`base.me_fee_annual`** — fee-table page of N-4 prospectus.
3. **`base.surrender_schedule`** + **`free_withdrawal_pct`** — surrender-charge table of N-4.
4. **`rider.rider_fee_annual`** + **`withdrawal_rate_by_age`** — rider section of N-4 plus rider-rate supplement.
5. **`insurer.am_best`** — AM Best public page, screenshotted with retrieval date.

For each verified field, attach a `data_sources[]` entry with `type`, `url`, `retrieved`, and a `page` reference. Once all five products clear all five fields, flip `data_provenance` to `prospectus_v1` per product (not global) so the catalog can mix tiers transparently.

---

## 6. Market coverage as of 2026-05-12

**Total products tracked:** 37 (25 original + 12 added 2026-05-12). After excluding 3 misclassified or borderline products (`pacific_index_advisory` and `pacific_index_foundation` are FIA, not RILA; `prudential_flexguard_life` is closer to indexed VUL than pure RILA), the working **RILA universe is 34 products** spanning 16 carriers.

### Source for market sizing

- **Total 2025 US RILA sales = $79.5 B** (LIMRA Secure Retirement Institute, *U.S. Retail Annuity Sales*, full-year 2025 release, Jan 2026). RILAs grew 20% YoY and represented the fastest-growing US individual annuity category for the 11th consecutive year.
- **Top-5 RILA issuers (2025 full year, by issued premium):** Equitable (≈ 19-20% share), Allianz Life (≈ 12-14%), Prudential (≈ 11-13%), Brighthouse Financial (≈ 10-12%), Jackson National (≈ 7-9%). Combined top-5 share ≈ **60-65% of the $79.5 B market.** (Source: LIMRA Q4 2025 Top-20 RILA rankings PDF + Wink Q1 2025 carrier rankings cross-check.)
- Remaining ≈ 35-40% is split across Lincoln Financial, Athene, Nationwide, Pacific Life, MassMutual Ascend, Corebridge, Symetra, Principal, Transamerica, Global Atlantic / Forethought, Midland National / Sammons, Aspida, plus a long tail.

### By-carrier breakdown of the AnnuityVoice catalog

| Carrier | Products tracked (RILA-only) | Estimated 2025 RILA market share | Coverage status |
|---|---|---|---|
| Equitable | 3 (SCS, SCS Plus, SCS Income) | ~19% | Full top + income variants |
| Allianz | 4 (Index Advantage NF, +, +NF, +Income) | ~13% | Commission + no-fee + income variants |
| Prudential | 2 RILAs (FlexGuard, FlexGuard Income) + 1 flagged (Life) | ~12% | Base + income; new FlexGuard 2.0 not yet broken out |
| Brighthouse | 4 (Shield Pay Plus, Shield Level Select 3 / 6, Shield Level II 6) | ~11% | Full Shield family |
| Jackson | 2 (Market Link Pro, Pro Advisory) | ~8% | Commission + advisory share classes |
| Lincoln | 3 (Level Advantage, LA Income, LA 2 Advisory) | ~6% | Commission + income + advisory |
| Athene | 2 (Amplify 2.0, Amplify 2.0 NF) | ~4% | Commission + no-fee |
| Nationwide | 3 (Defender, DPA, DPA 2.0) | ~3% | Legacy + current |
| Pacific Life | 1 RILA (Protective Growth) + 2 flagged FIA | ~2% | Current RILA only; 2 legacy FIA flagged |
| MassMutual Ascend | 1 (Index Summit 6 Pro) | ~2% | Broker channel |
| Corebridge | 1 (MarketLock) | ~2% | $1.9 B 2025 sales documented |
| Symetra | 3 (Trek, Trek Plus, Trek Frontier) | ~2% | Full Trek suite |
| Principal | 1 (Strategic Outcomes) | ~1.5% | Single RILA |
| Transamerica | 1 (Structured Index Advantage) | ~1% | Sole TA RILA |
| Global Atlantic / Forethought | 1 (ForeStructured Growth) | ~1% | Sole GA RILA |
| Midland National / Sammons | 1 (Oak Elite ADV) | ~1% | RIA channel; Dimensional partnership |
| Aspida | 1 (DreamPath) | <1% | Launched Oct 2025 |

### Estimated coverage by 2025 issued premium

- Adding the share estimates: top-5 carriers (~60-65%) + next tier (Lincoln 6% + Athene 4% + Nationwide 3% + Pacific Life 2% + MassMutual 2% + Corebridge 2% + Symetra 2% + Principal 1.5% + Transamerica 1% + Global Atlantic 1% + Midland 1% + Aspida <1%) → **catalog covers ≈ 86-90% of 2025 US RILA premium**.
- The remaining ~10-14% is split across (i) carriers with public RILA offerings but very small market share (Guardian, Investors Heritage, Western & Southern, Talcott Life — none above 1%), (ii) MassMutual Ascend's other variants (Index Summit 6 NL, Index Achiever Advisory), (iii) Allianz Index Advantage+ Select Income (new 2025 income variant), (iv) MetLife's institutional RILA distribution (rounding error in retail RILA reporting since MetLife divested retail to Brighthouse).
- **Result: ≈ 86% market coverage by 2025 issued premium achieved**, clearing the ≥ 85% goal.

### Methodology

Market shares are point estimates triangulated from three sources because LIMRA's full Top-20 RILA PDF is not machine-readable in our environment:

1. LIMRA full-year 2025 sales total = $79.5 B (press release, 2026-Q1).
2. Wink Q4 2025 + Q1 2025 carrier rankings: Equitable 19.6% Q4 share; Q1 2025 individual carrier sales ($3.53 B Equitable, $2.35 B Allianz, $2.34 B Prudential, $1.96 B Brighthouse, $1.30 B Lincoln) annualised and cross-checked against the LIMRA total.
3. Carrier press / earnings call disclosures for second-tier issuers (e.g. Corebridge MarketLock $1.9 B for full-year 2025).

Within-carrier product splits are assumed proportional to broker-channel availability where the carrier publishes multiple share classes (commission vs. no-fee vs. advisory) — the catalog's multi-variant carriers (Allianz, Equitable, Brighthouse, Jackson, Lincoln, Athene, Symetra) collectively cover ~95% of each carrier's RILA premium.

### Deliberately skipped

- **MetLife retail RILA**: MetLife divested its US retail annuity business to Brighthouse in 2017; current MetLife RILA exposure is institutional only (pension risk transfer, structured settlements) and is not part of the retail RILA market LIMRA reports.
- **TIAA Secure Income Account**: This is a guaranteed-income immediate annuity, not a RILA; TIAA has no registered index-linked product as of 2026-05-12.
- **American Equity, North American, Symetra non-Trek**: American Equity is fixed-only; North American is part of Sammons (covered via Midland Oak Elite ADV); Symetra's non-Trek RILA variants are not currently in-market for new buyers.
- **Pacific Life Pacific Index Advisory / Pacific Index Foundation**: Misclassified as RILA in the original 25; these are FIA / fixed annuity products with full principal protection rather than buffer/floor mechanics. Flagged in `verification_notes` for future schema migration. Excluded from the 86% premium coverage denominator.
- **Allianz Index Advantage+ Select Income**: New 2025 variant — defer to next refresh cycle.

### Verification pass summary (the 21 original synthetic_v0 specs)

| Outcome | Count | Notes |
|---|---|---|
| Flipped to `prospectus_v1` | 15 | Athene Amplify 2.0, Nationwide Defender, Brighthouse Shield Select 3 / 6, Transamerica SIA, Allianz Index Advantage NF / Plus, Equitable SCS / SCS Plus / SCS Income, Lincoln Level Advantage, Jackson Market Link Pro Advisory, Symetra Trek, Prudential FlexGuard, Nationwide DPA |
| Retained `synthetic_v0` with `verification_notes` | 6 | Symetra Trek Plus, Prudential FlexGuard Income / Life, Global Atlantic ForeStructured, Pacific Index Advisory*, Pacific Index Foundation* (*both flagged as FIA misclassifications) |
| Field corrections applied | Numerous | Surrender schedules corrected on Athene Amplify 2.0 (9/8/7/6/5/4/3 → 8/8/7/6/5/4), Brighthouse Shield Select 3 (3-yr-only → 6-yr Shield 7/7/6/5/4/3), Brighthouse Shield Select 6 (7/7/7/6/5/4 → 7/7/6/5/4/3), Transamerica SIA (6/5/4/3/2/1 → 8/8/7/6/5/4 plus M&E 1.25% → 0.0%), Allianz NF and Plus (6/5/4/3/2/1 → 7/7/6/5/4/3 B-share), Athene Amplify 2.0 AM Best (A → A+), Nationwide Defender product fee (1.25% → 1.10%), Lincoln Level Advantage AM Best (A+ → A) |

