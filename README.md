# Ratings UI screenshots

Captured 2026-05-12 from `localhost:5173` on the `ratings-mvp` branch
(methodology v1.2.0, after the merge of agents D/E/F/G).

- `ratings_index.png` — `/ratings` index page (25 products, sorted by composite desc)
- `ratings_detail.png` — `/ratings/pacific_index_advisory` detail page (top-rated)

Both at 1440px wide, full-page.

## Quick observations

- Top of table: Pacific Index Advisory **A+** (97.0), Market Link Pro Advisory **A** (93.8)
- Bottom: SCS Income **C** (60.3), Index Advantage+ Income **C-** (56.9)
- All 25 signed by **K Hu, FSA, MAAA** at 2026-05-12T00:00:00Z
- Methodology v1.2.0 is correctly shown in the header and signature block
- Known bug: the "Why this grade" narrative paragraph hardcodes
  `Methodology v1.0.0` — needs a patch in `draft_narrative()`

This branch is an **orphan** kept separate from `ratings-mvp` so the dev
branch stays clean of binary attachments.
