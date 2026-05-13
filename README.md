# Ratings UI screenshots

Captured 2026-05-12 from `localhost:5173` on the `ratings-mvp` branch
([commit 01edcc3](https://github.com/KaihuaY/va-gmwb-calculator/tree/ratings-mvp)).

Methodology **v1.3.0**. 37 RILA products rated (~86% of 2025 US RILA premium
per LIMRA), 50/50 blended-gender mortality, FSA-signed by K Hu.

| Screenshot | Page |
|---|---|
| `ratings_index.png` | `/ratings` — sortable, filterable index with search + lens columns + compare checkboxes |
| `ratings_detail.png` | `/ratings/pacific_index_advisory` (top-rated A+) — hero, contract terms, **new historical-regime backtest panel**, narrative with glossary tooltips, scoring scenario, collapsed score breakdown |
| `ratings_compare.png` | `/ratings/compare?slugs=equitable_scs_income,jackson_market_link_pro` — side-by-side with all 5 sub-scores uncollapsed + all 4 lens panels |
| `methodology.png` | `/methodology` — sub-score definitions, scoring scenario, letter bands, reproducibility, glossary list (14 terms) |

## What's new in this round

- **Methodology v1.3.0** simplified to 50/50 blended-gender mortality (no
  M/F toggle). Cleaner doc, no version history clutter. Title VII / Norris
  justifies it; mortality differential at typical annuity ages is small and
  washes out under the GV ratio.
- **Historical regime backtest panel** on every detail page — pick any of
  the 5 regimes, see the deterministic AV trajectory starting at $100. NOT
  a composite input (explicitly supplementary).
- **Search + compare**: live text search on `/ratings`; check 2-3 products
  then click the sticky CTA to compare side-by-side.
- **Glossary tooltips**: 14 actuarial terms (GLWB, GMDB, M&E, buffer, floor,
  cap rate, etc.) get inline tooltips wherever they appear; full list at
  the bottom of `/methodology`.
- **Coverage 25 -> 37 products**, 29 of them now `prospectus_v1` with SEC /
  carrier-page citations. New carriers: Corebridge, Pacific Life
  (Protective Growth variant), MassMutual Ascend, Principal, Midland
  National, Aspida (plus several new variants of existing carriers).
- **`sitemap.xml`** generated automatically as part of `build:ssg` - 41
  URLs total.

## Known item to flag for K

- `pacific_index_advisory` and `pacific_index_foundation` are flagged in
  their product specs as **FIA misclassifications** (the rating engine
  catalogue is RILA-only). Verification-notes field surfaces this so the
  catalogue can be cleaned up in a future refresh.

## Test status

- 55 backend pytest assertions pass
- 33 Playwright UI assertions pass
- byte-reproducibility holds for all 37 ratings at fixed `scored_at`

This branch stays **orphan** - separate from `ratings-mvp` and `master` so
binary attachments don't pollute the code branches.
