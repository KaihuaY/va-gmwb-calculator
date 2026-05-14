# Ratings UI screenshots

Latest captured **2026-05-14** from `localhost:5173` on the `ratings-mvp`
branch. This branch stays **orphan** — separate from `ratings-mvp` and
`master` so binary attachments don't pollute the code branches.

## 2026-05-14 update

| Screenshot | Page |
|---|---|
| `landing.png` | `/` — marketing landing page, now with a **RILA Ratings** section + nav/footer links alongside the calculator |
| `ratings_index.png` | `/ratings` — index with the new **verified-coverage banner** (15 of 66 segments verified), "Compare" column (was "Cmp"), no Stress column, lens-driven feature columns |
| `ratings_index_mobile.png` | `/ratings` at 390px width — phone layout |
| `ratings_detail.png` | `/ratings/jackson_market_link_pro` — hero, contract terms, **merged "Allocation choice & historical performance" section** (3 allocation cards now drive the regime chart), narrative, scoring scenario |
| `ratings_detail_allianz.png` | `/ratings/allianz_index_advantage_plus` — a product with PDF-verified caps applied (1-yr cap 22.5%, 6-yr participation 110%) |
| `ratings_compare.png` | `/ratings/compare?slugs=...` — **rebuilt** row-aligned comparison: each attribute is one row, best-in-class value tinted green, lens switcher, sub-score toggle |
| `methodology.png` | `/methodology` — sub-score definitions, scoring scenario, letter bands, glossary |

## What changed since the last screenshot round

- **Stress removed from the index** — every product scored F under stress, so
  the column carried no signal. Stress detail also dropped from the product
  page; the regime backtest chart (which defaults to each product's worst
  regime) is the real signal.
- **Allocation + regime merged** — one "Allocation choice & historical
  performance" section. The 3 allocation cards (conservative / balanced /
  growth) are the same control that drives the regime replay chart.
- **Non-RILA products excluded** — Pacific Index Advisory/Foundation and
  Prudential FlexGuard Life (FIA / indexed VUL) no longer appear in listings.
  34 RILA products remain.
- **Cap-rate backfill round 1** — server-side PDF fetcher unlocked 9 carrier
  rate sheets WebFetch couldn't reach; 15 of 66 segments now verified against
  carrier-official PDFs / SEC filings. Coverage banner makes the gap honest.
- **Comparison page rebuilt** — row-aligned with best-in-class highlighting.
- **Landing page** now reflects the ratings publication, not just the
  calculator.

Note: `ratings_detail_allocations.png` and `ratings_detail_freshness.png` from
the prior round are now stale (the allocation panel was merged into the regime
section) — retained only for historical reference.

## Coverage status (see `RATINGS_COVERAGE.md` on `ratings-mvp`)

- 34 RILA products rated, FSA-signed by K Hu, methodology v1.4.0
- Features verified: 29 / 34 at `prospectus_v1`
- Rates verified: 15 / 66 segments (22.7%) against carrier-official sources

## Test status

- 62 backend pytest assertions pass
- 53 Playwright QA-probe assertions pass
- `build:ssg` prerender: 36 / 36 routes
