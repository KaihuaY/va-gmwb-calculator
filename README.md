# Ratings UI screenshots

Latest captured **2026-05-17** from `localhost:5173` on the `ratings-mvp`
branch. This branch stays **orphan** — separate from `ratings-mvp` and
`master` so binary attachments don't pollute the code branches.

## 2026-05-17 update — business-model pivot to consumer/agent-funnel

Major reframe between the last screenshot round and this one:

- **Dropped the personal FSA signature** on consumer-facing pages.
  AnnuityVoice is now positioned as an **impersonal independent publisher**
  funded by a vetted-advisor referral funnel — not a credibility play for
  K's actuarial services. The `signed_by` audit trail stays in the data;
  the public site never names a person.
- **Two new consumer-funnel pages.** `/find-an-advisor` captures consumer
  intent and forwards to a closed-beta network of fee-only fiduciary
  advisors. `/how-we-make-money` is a transparency page describing the
  full economics, including a "disclosed engagements" slot for paid
  carrier work.
- **Landing page rewritten end-to-end** for simplicity. The legacy
  white-label-report-for-RIAs framing is gone (false SOC-2 claims,
  fictional "Non-Solicitation Agreement," 5-scenario hidden-money copy,
  duplicate calculator / ratings CTAs). What's left: hero + what we
  cover + how it works + why this is different + FAQ + footer.

| Screenshot | Page |
|---|---|
| `landing.png` | `/` — **fully rewritten.** Hero presents the two annuity categories side by side; "What we cover," "How it works" (3 honest steps ending at the optional advisor intro), and "Why this is different" (independent / reproducible / honest about gaps). FAQs rewritten for the new model. |
| `ratings_index.png` | `/ratings` — verified-coverage banner, "Compare" column, data-confidence chips next to every grade, lens-driven feature columns. |
| `ratings_index_mobile.png` | `/ratings` at 390px width. |
| `ratings_detail.png` | `/ratings/jackson_market_link_pro` — methodology stamp (no personal signature), data-confidence panel in the hero, merged allocation + regime section, and **two CTAs**: consumer ("Talk to a vetted advisor") + carrier ("Is this your product? Request a private review"). |
| `ratings_detail_allianz.png` | `/ratings/allianz_index_advantage_plus` — a product with PDF-verified caps applied (1-yr cap 22.5%, 6-yr participation 110%). |
| `ratings_compare.png` | `/ratings/compare?slugs=...` — row-aligned side-by-side, best-in-class highlighted, lens switcher. |
| `methodology.png` | `/methodology` — sub-score definitions, scoring scenario, letter bands, glossary. |
| `find_an_advisor.png` | **NEW.** `/find-an-advisor?product=...&type=RILA` — consumer funnel endpoint. Form (name, email, state, question), explicit "pilot status" copy, deep-link product context banner. |
| `how_we_make_money.png` | **NEW.** `/how-we-make-money` — transparency page. Side-by-side "we do / we don't" callouts, money-flow diagram, what protects the rating from the funnel, disclosed-engagements section (empty for now). |
| `work_with_k.png` | `/work-with-k` — institutional services funnel (kept; this page is where K's credential IS the value prop, so it's the one place the personal name stays). |
| `calculator.png` | `/calculator` — VA Monte Carlo calculator + new consumer CTA above the disclaimer ("Want a second opinion on this contract? → vetted advisor intro"). |

## What's no longer accurate (kept for historical reference only)

- `ratings_detail_allocations.png`, `ratings_detail_freshness.png` — pre-merge layout
- Earlier rounds' README content describing K's signature as the value prop —
  superseded by the impersonal-publisher pivot

## Status

- 88 Playwright QA-probe checks passing
- 63 backend pytest passing
- Local-only deployment; nothing public yet (E&O binding is the launch gate)
