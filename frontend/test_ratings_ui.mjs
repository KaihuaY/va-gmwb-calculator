/**
 * Playwright smoke test for the Ratings publication.
 *
 * Pre-reqs:
 *   - uvicorn running on http://localhost:8000
 *   - Vite running on http://localhost:5173 (proxies /api -> :8000)
 *
 * Asserts:
 *   1. /ratings loads, shows 25 rows, every row has a letter grade
 *   2. Sorting by composite descending puts highest grade first
 *   3. Carrier filter narrows the table
 *   4. /ratings/equitable_scs_income loads, shows hero grade
 *   5. SignatureBlock present + signed_by populated
 *   6. All 5 sub-score bars rendered
 *   7. Anonymous (no auth) — never prompted for OTP
 *   8. /methodology loads + shows weights table
 *   9. JSON-LD Review schema embedded in detail page source
 */

import { chromium } from 'playwright';
import process from 'process';

const BASE = process.env.RATINGS_TEST_URL || 'http://localhost:5173';
let failed = 0;
function pass(msg) { console.log('  ✓', msg); }
function fail(msg) { console.error('  ✗', msg); failed++; }
async function assert(cond, msg) { if (cond) pass(msg); else fail(msg); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log('— /ratings index —');
await page.goto(`${BASE}/ratings`);
await page.waitForSelector('[data-testid="ratings-table"]', { timeout: 5000 });

const rows = await page.locator('[data-testid^="row-"]').count();
await assert(rows >= 25, `at least 25 product rows visible (got ${rows})`);

// Every row has a grade chip
const grades = await page.locator('[data-testid^="grade-"]').count();
await assert(grades === rows, `Every row has a grade chip (got ${grades} of ${rows})`);

// Composite is the default sort (desc) — first row should be Pacific Index Advisory (A-)
const firstGrade = await page.locator('[data-testid^="grade-"]').first().textContent();
await assert(firstGrade?.startsWith('A'), `Top row has A-tier grade (got "${firstGrade}")`);

console.log('— Carrier filter —');
await page.selectOption('[data-testid="filter-carrier"]', 'Equitable');
await page.waitForTimeout(150);
const equitableRows = await page.locator('[data-testid^="row-"]').count();
await assert(equitableRows === 3, `Equitable filter shows 3 products (got ${equitableRows})`);
await page.selectOption('[data-testid="filter-carrier"]', '');

console.log('— Min-grade filter —');
await page.selectOption('[data-testid="filter-min-grade"]', 'B');
await page.waitForTimeout(150);
const aOrB = await page.locator('[data-testid^="row-"]').count();
await assert(aOrB > 0 && aOrB < rows, `Min-grade=B filters something (got ${aOrB} of ${rows})`);
await page.selectOption('[data-testid="filter-min-grade"]', '');

console.log('— /ratings/equitable_scs_income detail —');
await page.goto(`${BASE}/ratings/equitable_scs_income`);
await page.waitForSelector('[data-testid="rating-detail"]', { timeout: 5000 });

// Hero grade visible
const heroGrade = await page.locator('[data-testid="hero-grade"]').textContent();
await assert(/^[A-F]/.test(heroGrade.trim()), `Hero shows a letter grade (got "${heroGrade.trim()}")`);

// SignatureBlock REQUIRED
const sigPresent = await page.locator('[data-testid="signature-block"]').count();
await assert(sigPresent === 1, 'SignatureBlock rendered exactly once');
const sigMissing = await page.locator('[data-testid="signature-block-missing"]').count();
await assert(sigMissing === 0, 'SignatureBlock error placeholder NOT rendered');

const signedBy = await page.locator('[data-testid="signed-by"]').textContent();
await assert(signedBy && signedBy.length > 0, `signed_by populated (got "${signedBy}")`);

// 5 sub-score bars
for (const k of ['tco', 'gv', 'sf', 'ic', 'bf']) {
  const visible = await page.locator(`[data-testid="subscore-${k}"]`).count();
  await assert(visible === 1, `Sub-score bar present: ${k}`);
}

// Regime backtest panel (interactive — uses live /api endpoint, not the snapshot)
console.log('— Regime backtest panel —');
const panelVisible = await page.locator('[data-testid="regime-backtest-panel"]').count();
await assert(panelVisible === 1, 'Regime backtest panel renders');

// Wait for the initial terminal-AV stat to populate (first regime auto-selected)
await page.waitForSelector('[data-testid="regime-backtest-terminal-av"]', { timeout: 8000 });
const initialTerminal = (await page.locator('[data-testid="regime-backtest-terminal-av"]').textContent()) || '';
const initialNum = parseFloat(initialTerminal.replace(/[^0-9.\-]/g, ''));
await assert(Number.isFinite(initialNum) && initialNum > 0,
             `Terminal AV is numeric and positive (got "${initialTerminal.trim()}")`);

// Switch to the post-GFC bull regime; terminal AV value should update
const pgfcPill = page.locator('[data-testid="regime-pill-post_gfc_bull_2010_2021"]');
if (await pgfcPill.count() === 1) {
  await pgfcPill.click();
  // Poll up to 8s for the value to differ from the initial reading
  let switchedTerminal = initialTerminal;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    switchedTerminal = (await page.locator('[data-testid="regime-backtest-terminal-av"]').textContent()) || '';
    if (switchedTerminal !== initialTerminal) break;
  }
  await assert(switchedTerminal !== initialTerminal,
               `Terminal AV updates when switching regimes (initial "${initialTerminal.trim()}" vs new "${switchedTerminal.trim()}")`);
} else {
  await assert(false, 'post_gfc_bull_2010_2021 regime pill present');
}

// JSON-LD Review schema in page source
const html = await page.content();
await assert(html.includes('"@type":"Review"') || html.includes('"@type": "Review"'),
             'JSON-LD Review schema embedded');
await assert(html.includes('FinancialProduct'), 'JSON-LD itemReviewed is a FinancialProduct');

console.log('— Anonymous access (no OTP gate) —');
// Look for the OTP modal that the calculator surfaces; should never appear on ratings
const otpModal = await page.locator('text=/Verify your email/i').count();
await assert(otpModal === 0, 'No OTP/auth gate triggered on ratings detail');

console.log('— /methodology —');
await page.goto(`${BASE}/methodology`);
await page.waitForSelector('[data-testid="methodology-page"]', { timeout: 5000 });
const mhtml = await page.content();
await assert(mhtml.includes('Total Cost of Ownership'), 'Methodology lists TCO');
await assert(mhtml.includes('Guarantee Value'),         'Methodology lists GV');
await assert(mhtml.includes('Surrender Flexibility'),   'Methodology lists SF');
await assert(mhtml.includes('Insurer Credit'),          'Methodology lists IC');
await assert(mhtml.includes('Behavioral Fairness'),     'Methodology lists BF');

console.log('— /ratings/nonexistent_slug 404 view —');
await page.goto(`${BASE}/ratings/nonexistent_slug_xyz`);
await page.waitForSelector('[data-testid="rating-not-found"]', { timeout: 5000 });
const notFound = await page.locator('[data-testid="rating-not-found"]').count();
await assert(notFound === 1, '404 path shows not-found view');

// ── New: Feature 1 — search filter ────────────────────────────────────────
console.log('— /ratings search filter —');
await page.goto(`${BASE}/ratings`);
await page.waitForSelector('[data-testid="ratings-table"]', { timeout: 5000 });
await page.fill('[data-testid="filter-search"]', 'Equitable');
await page.waitForTimeout(150);
const searchRows = await page.locator('[data-testid^="row-"]').count();
await assert(searchRows >= 3, `Typing "Equitable" in search shows ≥3 rows (got ${searchRows})`);
await page.fill('[data-testid="filter-search"]', '');

// ── New: Feature 2 — compare page ─────────────────────────────────────────
console.log('— /ratings/compare side-by-side —');
await page.goto(`${BASE}/ratings/compare?slugs=equitable_scs_income,jackson_market_link_pro`);
await page.waitForSelector('[data-testid="compare-page"]', { timeout: 5000 });
const colA = await page.locator('[data-testid="compare-col-equitable_scs_income"]').count();
const colB = await page.locator('[data-testid="compare-col-jackson_market_link_pro"]').count();
await assert(colA === 1, 'Compare column for equitable_scs_income rendered');
await assert(colB === 1, 'Compare column for jackson_market_link_pro rendered');
const compareSubBars = await page.locator('[data-testid^="subscore-"]').count();
await assert(compareSubBars === 10, `10 sub-score bars on compare page (5 per product) — got ${compareSubBars}`);

// ── New: Feature 3 — glossary list on /methodology ────────────────────────
console.log('— Glossary on /methodology —');
await page.goto(`${BASE}/methodology`);
await page.waitForSelector('[data-testid="methodology-page"]', { timeout: 5000 });
const glossary = await page.locator('[data-testid="glossary-list"]').count();
await assert(glossary === 1, 'Glossary list rendered on /methodology');
const glossaryHtml = await page.locator('[data-testid="glossary-list"]').innerHTML();
await assert(glossaryHtml.includes('GLWB'),    'Glossary lists GLWB');
await assert(glossaryHtml.includes('M&amp;E') || glossaryHtml.includes('M&E'),
             'Glossary lists M&E');
await assert(glossaryHtml.includes('AM Best'), 'Glossary lists AM Best');

// ── New: Feature 4 — sitemap.xml ──────────────────────────────────────────
console.log('— /sitemap.xml —');
const sitemapRes = await page.goto(`${BASE}/sitemap.xml`);
const sitemapTxt = await sitemapRes.text();
await assert(sitemapTxt.startsWith('<?xml'), 'sitemap.xml begins with XML declaration');
await assert(sitemapTxt.includes('<urlset'), 'sitemap.xml has <urlset> root element');
const urlCount = (sitemapTxt.match(/<url>/g) || []).length;
await assert(urlCount >= 25, `sitemap.xml has 25+ URL entries (got ${urlCount})`);

await browser.close();

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll Playwright smoke checks passed.');
