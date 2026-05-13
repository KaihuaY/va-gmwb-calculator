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
