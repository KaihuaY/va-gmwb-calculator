# RATINGS_DATA_SOURCES.md — public data source hierarchy

Authoritative-source guide for keeping product specs current. **No paid feeds.**
All sources here are publicly accessible without login.

## Primary sources (rate-sensitive fields: cap, participation, spread, trigger)

| Rank | Source | Why | Cadence |
|---|---|---|---|
| 1 | **SEC EDGAR — 497 supplements** | Authoritative public record. Carriers file 497 supplements whenever rates change (typically monthly). Documents are immutable once filed and have a date stamp. URLs are stable forever. | monthly or as filed |
| 2 | **Carrier own-site rate sheet PDFs** | Most current — usually published a few days before the 497. URLs rotate; carriers do site redesigns. Useful as the leading indicator, but always cross-check against EDGAR for the audit trail. | monthly |
| 3 | **State insurance department filings (NAIC SERFF)** | Free state-by-state. Slower-moving (structural changes only). Used for AM Best and contract-term changes, not month-over-month caps. | quarterly |

## Secondary sources (structural fields: M&E, surrender schedule, rider terms, AM Best)

| Rank | Source | Why |
|---|---|---|
| 1 | **SEC EDGAR — N-4 / N-6 prospectuses, 485APOS amendments** | Definitive base contract terms. Filed at product launch and re-filed for material amendments. |
| 2 | **AM Best company pages** (ratings.ambest.com) | Free, public ratings + FSR action timestamps. Useful for the IC sub-score. |
| 3 | **NAIC company profile pages** (content.naic.org) | NAIC company codes + complaint indices. Useful for BF sub-score. |

## Historical / behavioral sources (cap-cut history, illustration deltas)

| Rank | Source | Why |
|---|---|---|
| 1 | **Wayback Machine (web.archive.org)** | Captures of carrier rate-center pages over time. Reconstructs cap-rate cut history for the BF sub-score. |
| 2 | **EDGAR 497 filing history for the same product** | Same purpose — every 497 has a date; the cap-rate trajectory can be built from the filing history. |
| 3 | **Insurance trade press archives** (InsuranceNewsNet, ThinkAdvisor, NAIC press releases) | For regulatory fines, carrier acquisitions (PE flips), Aquarian-style events. |

## What we deliberately do NOT use

- **Wink / AnnuitySpecs, AnnuityRateWatch, CANNEX, Morningstar Annuity Intelligence** — paid. Excluded by design so the rating publication stays free and reproducible without subscription.
- **Carrier advisor portals** (login required) — not publicly verifiable.
- **Third-party rate aggregators that scrape and republish** — provenance ambiguous; SEC + carrier-own is the cleaner path.

## Fetcher workflow (append-only, audit-trail-friendly)

```
# 1. Walk the registry, archive raw responses, write a TIMESTAMPED proposal
python tools/fetch_cap_rates.py

# Output:
#   backend/data/rate_pulls/20260513-160000/equitable_scs_income_0_carrier.pdf
#   backend/data/rate_pulls/20260513-160000/equitable_scs_income_0_edgar.html
#   backend/data/rate_pulls/20260513-160000/...meta.json (sidecar per body)
#   backend/data/rate_proposals/20260513-160000.json
#   backend/data/rate_proposals/latest.json  -> pointer to the most recent

# 2. Review the archived PDFs / HTML alongside the parsed candidates. K verifies
#    each cap against the parser_hint and accepts:
python tools/apply_rate_proposals.py latest \
    --accept equitable_scs_income:0:0.085 \
    --accept jackson_market_link_pro:0:0.095

# Output:
#   - Updates each spec's segment cap_rate + cap_rate_last_verified
#   - Appends an event to backend/data/rate_history/{slug}.json (audit log)

# 3. Re-rate and re-sign:
python tools/rate_product.py --all
python tools/publish_rating.py --all --sign --name "K Hu" --credentials "FSA, MAAA"
```

## Helper: finding the right EDGAR URL for a carrier

```
python tools/list_edgar_filings.py 0002039145              # Equitable
python tools/list_edgar_filings.py 0000812348 --form N-4   # Jackson's N-4 prospectus
python tools/list_edgar_filings.py 0000812348 --since 2025-01-01
```

Common insurer CIKs (verified):

| Carrier | CIK | Notes |
|---|---|---|
| Equitable Financial Life Insurance Co of America | 0002039145 | SCS Income issuer |
| Equitable Financial Life Insurance Company | 0000727920 | SCS / SCS Plus issuer |
| Allianz Life Insurance Company of North America | 0000356213 | Index Advantage family |
| Brighthouse Life Insurance Company | 0001294404 | Shield family |
| Lincoln National Life Insurance Company | 0000059558 | Level Advantage family |
| Jackson National Life Insurance Company | 0000812348 | Market Link Pro |
| Athene Annuity and Life Company | 0001515136 | Amplify family |
| Symetra Life Insurance Company | 0000031033 | Trek family |
| Nationwide Life Insurance Company | 0000205695 | Defender / DPA |
| Pacific Life Insurance Company | 0000750100 | Index Advisory / Index Foundation |
| Prudential Annuities Life Assurance Corp | 0000891587 | FlexGuard family |
| Corebridge Life Insurance Company (AIG Life) | 0001275319 | MarketLock |
| MassMutual Ascend Life Insurance Co | 0001047862 | Index Summit family |
| Principal Life Insurance Company | 0001379785 | Strategic Outcomes |
| Transamerica Life Insurance Company | 0001106932 | Structured Index Advantage |
| Global Atlantic Life Insurance Company | 0001596335 | ForeStructured Growth |
| Midland National Life Insurance Co | 0000311024 | Oak Elite |
| Aspida Life Insurance Company | 0001853379 | DreamPath |

Verify CIKs at https://www.sec.gov/cgi-bin/browse-edgar?company=<name>&CIK=&owner=include&action=getcompany
