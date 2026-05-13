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
await assert(rows === 25, `25 product rows visible (got ${rows})`);

// Every row has a grade chip
const grades = await page.locator('[data-testid^="grade-"]').count();
await assert(grades === 25, `Every row has a grade chip (got ${grades})`);

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
await assert(aOrB > 0 && aOrB < 25, `Min-grade=B filters something (got ${aOrB})`);
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

await browser.close();

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll Playwright smoke checks passed.');
