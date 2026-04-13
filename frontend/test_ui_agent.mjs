/**
 * VA Rider Calculator — User-Perspective UI Test
 *
 * Acts as a real user navigating the app. Tests that:
 *   - Inputs make sense (labels, ranges, defaults)
 *   - Results are numerically reasonable
 *   - UI flows work (Standard/Advanced toggle, tab navigation, rider toggles)
 *   - Banded rate editor, health selector, optimizer work
 *
 * Usage:
 *   node frontend/test_ui_agent.mjs [--url=http://localhost:5173] [--screenshots]
 *
 * Exit code 0 = all scenarios passed; 1 = one or more failures
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] ?? 'http://localhost:5173/calculator';
// API base for direct (Node.js-level) endpoint tests — bypasses the browser.
// Auto-derived: localhost frontend → localhost:8000 backend.
// Override with --api=https://your-lambda-url for production runs.
const _apiArg = process.argv.find(a => a.startsWith('--api='))?.split('=')[1];
const API_BASE = _apiArg ?? (BASE_URL.startsWith('http://localhost') ? 'http://localhost:8000' : null);
const SCREENSHOTS = process.argv.includes('--screenshots');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-screenshots');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let browser, page;
const results = [];
const jsErrors = [];

function pass(name, detail = '') {
  results.push({ status: 'PASS', name, detail });
  console.log(`  ✅ PASS  ${name}${detail ? ' — ' + detail : ''}`);
}

function fail(name, detail = '') {
  results.push({ status: 'FAIL', name, detail });
  console.log(`  ❌ FAIL  ${name}${detail ? ' — ' + detail : ''}`);
}

function warn(name, detail = '') {
  results.push({ status: 'WARN', name, detail });
  console.log(`  ⚠️  WARN  ${name}${detail ? ' — ' + detail : ''}`);
}

async function screenshot(label) {
  if (!SCREENSHOTS) return;
  const fs = await import('fs');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${label}.png`), fullPage: true });
}

/** Wait for any in-flight simulation to finish (Run button becomes active again) */
async function waitForIdle(timeout = 45000) {
  await page.waitForFunction(() => {
    return !Array.from(document.querySelectorAll('button'))
      .some(b => b.textContent.includes('Running…'));
  }, { timeout });
  await page.waitForTimeout(400); // React state-flush settle
}

/** Wait for the spinner/progress bar to disappear after clicking Run */
async function waitForResults(timeout = 45000) {
  await waitForIdle(timeout);
}

/** Read the displayed text of the first metric card matching a title keyword.
 *  Works for both old MetricCards (text-3xl) and the compact StatStrip (tabular-nums). */
async function getMetricValue(titleKeyword) {
  return page.evaluate((kw) => {
    // Search every uppercase label element for the keyword, then return its sibling value
    const labels = document.querySelectorAll('[class*="uppercase"]');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes(kw.toLowerCase())) {
        const parent = label.parentElement;
        if (!parent) continue;
        // StatStrip value uses tabular-nums; advanced MetricCards use text-3xl
        const valueEl = parent.querySelector('[class*="tabular-nums"]')
                     || parent.querySelector('[class*="text-3xl"]');
        if (valueEl) return valueEl.textContent.trim();
      }
    }
    return null;
  }, titleKeyword);
}

/** Parse a formatted dollar string like "$45.2K" or "$1.23M" into a number */
function parseFmtDollar(s) {
  if (!s || s === '—') return null;
  const clean = s.replace(/[$,]/g, '');
  if (clean.endsWith('M')) return parseFloat(clean) * 1e6;
  if (clean.endsWith('K')) return parseFloat(clean) * 1e3;
  return parseFloat(clean);
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

async function clickRunSimulation() {
  const btn = page.locator('button', { hasText: /^Run Simulation$/ });
  // Wait until the button is enabled (not disabled by an in-flight run)
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(el => /^Run Simulation$/.test(el.textContent.trim()));
    return b && !b.disabled;
  }, { timeout: 30000 });
  await btn.click();
  // Confirm the click was accepted: button text changes to "Running…"
  // Allow 3s; very fast machines may complete before this check
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Running…')),
    { timeout: 3000 }
  ).catch(() => {}); // acceptable if run completed instantly
  await waitForIdle();
}

async function switchToAdvanced() {
  // localStorage is pre-seeded by addInitScript so the gate modal never appears
  const advBtn = page.locator('button', { hasText: 'Advanced' }).first();
  await advBtn.click();
  await page.waitForTimeout(300);
}

async function switchToStandard() {
  const stdBtn = page.locator('button', { hasText: 'Standard' }).first();
  await stdBtn.click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

async function scenario_appLoads() {
  console.log('\n[Scenario 1] App loads and renders correctly');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await screenshot('01-initial-load');

  const title = await page.textContent('h1').catch(() => null);
  if (title && title.includes('VA Rider Calculator')) {
    pass('App title visible', title.trim());
  } else {
    fail('App title missing', `Got: ${title}`);
  }

  const runBtn = await page.locator('button', { hasText: /Run Simulation/ }).count();
  runBtn > 0 ? pass('Run Simulation button present') : fail('Run Simulation button missing');

  // Check default inputs are visible
  const hasInputs = await page.evaluate(() => document.querySelectorAll('input').length);
  hasInputs > 3 ? pass('Input fields rendered', `${hasInputs} inputs`) : fail('Too few inputs rendered');

  // No JS errors on load
  jsErrors.length === 0 ? pass('No JS console errors on load') : fail('JS errors on load', jsErrors.join('; '));
}

async function scenario_defaultSimulation() {
  console.log('\n[Scenario 2] Default simulation — $500K AV, 5% WD, age 65, male');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await clickRunSimulation();
  await screenshot('02-default-results');

  // Check metric cards appeared
  const guaranteeVal = await getMetricValue('guarantee value');
  const feesVal = await getMetricValue('total fees');
  const netVal = await getMetricValue('net benefit');

  if (guaranteeVal) {
    const gv = parseFmtDollar(guaranteeVal);
    if (gv !== null && gv > 0 && gv < 1_000_000) {
      pass('Guarantee Value in sensible range', `${guaranteeVal} (${gv.toLocaleString()})`);
    } else {
      fail('Guarantee Value out of expected range', `Got ${guaranteeVal}`);
    }
  } else {
    fail('Guarantee Value card not found');
  }

  if (feesVal) {
    const fv = parseFmtDollar(feesVal);
    if (fv !== null && fv > 0 && fv < 500_000) {
      pass('Total Fees in sensible range', `${feesVal}`);
    } else {
      fail('Total Fees out of expected range', `Got ${feesVal}`);
    }
  } else {
    fail('Total Fees card not found');
  }

  if (netVal) {
    pass('Net Benefit card present', `${netVal}`);
  } else {
    fail('Net Benefit card not found');
  }

  // Check shortfall callout is present (GMWB default)
  const shortfallText = await page.evaluate(() => {
    const divs = document.querySelectorAll('[class*="rounded-xl"]');
    for (const d of divs) {
      if (d.textContent.includes('simulated scenarios') || d.textContent.includes('depletion')) return d.textContent.trim();
    }
    return null;
  });
  shortfallText
    ? pass('Shortfall callout rendered', shortfallText.slice(0, 80))
    : warn('Shortfall callout not found');
}

async function scenario_healthSelector() {
  console.log('\n[Scenario 3] Health selector — Standard mode, My Contract tab');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(300);

  // Find health buttons — should be Excellent / Good / Fair / Poor
  const healthButtons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.filter(b => ['Excellent', 'Good', 'Fair', 'Poor'].includes(b.textContent.trim()))
               .map(b => b.textContent.trim());
  });

  if (healthButtons.length === 4) {
    pass('Health selector has 4 options', healthButtons.join(', '));
  } else {
    fail('Health selector options missing', `Found: ${healthButtons.join(', ')}`);
    return;
  }

  // Click "Poor" and verify the hint text updates
  await page.locator('button', { hasText: 'Poor' }).click();
  await page.waitForTimeout(200);
  const hint = await page.evaluate(() => {
    const all = document.querySelectorAll('[class*="text-xs"][class*="text-slate-5"]');
    for (const el of all) {
      if (el.textContent.includes('mortality')) return el.textContent.trim();
    }
    return null;
  });
  hint && hint.includes('1.6')
    ? pass('Poor health updates multiplier hint', hint)
    : warn('Poor health hint not found or unexpected', hint);

  // Click "Good" to restore default
  await page.locator('button', { hasText: 'Good' }).click();
  await screenshot('03-health-selector');
}

async function scenario_dbOnly() {
  console.log('\n[Scenario 4] DB-only policy — uncheck GMWB, check GMDB');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  // Wait for the auto-run (triggered on page mount) to finish before touching inputs
  await waitForIdle();

  // Find GMWB checkbox (first checkbox in rider list)
  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();

  if (count < 2) {
    fail('Not enough checkboxes for rider selection', `Found ${count}`);
    return;
  }

  // Uncheck GMWB (first checkbox)
  const gmwbChecked = await checkboxes.nth(0).isChecked();
  if (gmwbChecked) await checkboxes.nth(0).click();

  // Check GMDB (second checkbox)
  const gmdbChecked = await checkboxes.nth(1).isChecked();
  if (!gmdbChecked) await checkboxes.nth(1).click();

  await page.waitForTimeout(200);
  await clickRunSimulation();
  await screenshot('04-db-only');

  const dbCard = await getMetricValue('death benefit');
  if (dbCard) {
    const dv = parseFmtDollar(dbCard);
    if (dv !== null && dv >= 0 && dv < 1_000_000) {
      pass('DB-only: Death Benefit Value card shows meaningful value', dbCard);
    } else {
      fail('DB-only: Death Benefit Value out of range', `Got ${dbCard}`);
    }
  } else {
    fail('DB-only: "Death Benefit Value" card not visible after run');
  }

  // GMWB card should NOT show $0 guarantee
  const gmwbCard = await getMetricValue('guarantee value');
  if (!gmwbCard) {
    pass('DB-only: No misleading "Guarantee Value" card shown');
  } else {
    warn('DB-only: Guarantee Value card still visible — may confuse users', gmwbCard);
  }
}

async function scenario_advancedMode() {
  console.log('\n[Scenario 5] Advanced mode — tab structure and Riders tab');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await waitForIdle();
  await switchToAdvanced();
  await screenshot('05-advanced-mode');

  // Check all 5 advanced tabs present
  const expectedTabs = ['Profile', 'Riders', 'Market', 'Actuarial', 'Simulation'];
  for (const tabLabel of expectedTabs) {
    const tab = await page.locator('button', { hasText: tabLabel }).count();
    tab > 0 ? pass(`Advanced tab "${tabLabel}" present`) : fail(`Advanced tab "${tabLabel}" missing`);
  }

  // Navigate to Riders tab
  await page.locator('button', { hasText: 'Riders' }).first().click();
  await page.waitForTimeout(200);

  // Check WD rate Simple/Banded toggle
  const simpleBtn = await page.locator('button', { hasText: 'Simple' }).count();
  const bandedBtn = await page.locator('button', { hasText: 'Banded' }).count();
  simpleBtn > 0 && bandedBtn > 0
    ? pass('Withdrawal Rate Simple/Banded toggle present')
    : fail('Simple/Banded toggle missing');

  // Election Strategy section header
  const electionHeader = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all.some(el => el.textContent.trim() === 'Election Strategy');
  });
  electionHeader ? pass('Election Strategy section visible') : fail('Election Strategy section missing');

  // Optimizer button
  const optimizerBtn = await page.locator('button', { hasText: /Find optimal start age/ }).count();
  optimizerBtn > 0 ? pass('Optimizer button present in Advanced Riders tab') : fail('Optimizer button missing');
}

async function scenario_bandedRates() {
  console.log('\n[Scenario 6] Banded withdrawal rates — toggle, add/remove bands, simulate');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await waitForIdle();
  await switchToAdvanced();

  // Go to Riders tab
  await page.locator('button', { hasText: 'Riders' }).first().click();
  await page.waitForTimeout(200);

  // Click Banded
  await page.locator('button', { hasText: 'Banded' }).click();
  await page.waitForTimeout(300);
  await screenshot('06-banded-toggle');

  // Verify banded editor appeared (look for "From age" header text)
  const fromAgeHeader = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .some(el => el.textContent.trim() === 'From age');
  });
  fromAgeHeader ? pass('Banded editor shows "From age" column') : fail('Banded editor not rendered after toggle');

  // Check band rows
  const bandRows = await page.evaluate(() => {
    // Count rows that have age inputs in the banded editor
    return document.querySelectorAll('[class*="space-y"] > div').length;
  });
  bandRows >= 3 ? pass(`Default 3 bands rendered`, `${bandRows} rows`) : warn('Expected 3 default bands', `Got ${bandRows}`);

  // Click "+ Add band"
  const addBandBtn = page.locator('button', { hasText: '+ Add band' });
  const addBandCount = await addBandBtn.count();
  if (addBandCount > 0) {
    await addBandBtn.click();
    await page.waitForTimeout(200);
    const newRows = await page.evaluate(() => document.querySelectorAll('[class*="space-y"] > div').length);
    newRows > bandRows ? pass('Add band increases band count') : fail('Add band did not add a row');
  } else {
    fail('"+ Add band" button not found');
  }

  // Switch back to Simple — verify editor disappears
  await page.locator('button', { hasText: 'Simple' }).click();
  await page.waitForTimeout(200);
  const editorGone = await page.evaluate(() => {
    return !Array.from(document.querySelectorAll('*')).some(el => el.textContent.trim() === 'From age');
  });
  editorGone ? pass('Switching to Simple hides banded editor') : fail('Banded editor still visible in Simple mode');

  // Switch back to Banded — bands should be preserved (not reset to defaults)
  await page.locator('button', { hasText: 'Banded' }).click();
  await page.waitForTimeout(200);
  const preservedRows = await page.evaluate(() => document.querySelectorAll('[class*="space-y"] > div').length);
  preservedRows > bandRows  // we added 1 band before switching, should be preserved
    ? pass('Bands preserved after Simple→Banded toggle')
    : warn('Bands may have reset after toggle', `Expected >${bandRows} rows, got ${preservedRows}`);

  // Run simulation in banded mode (advanced mode shows "PV(GMWB)")
  await clickRunSimulation();
  const gmwbVal = await getMetricValue('gmwb') ?? await getMetricValue('guarantee');
  gmwbVal
    ? pass('Simulation runs in banded mode', `PV = ${gmwbVal}`)
    : fail('Banded mode simulation produced no result');

  await screenshot('06b-banded-results');
}

async function scenario_sectionOrder() {
  console.log('\n[Scenario 7] Input section order — contract terms before strategy');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await waitForIdle();
  await switchToAdvanced();
  await page.locator('button', { hasText: 'Riders' }).first().click();
  await page.waitForTimeout(200);

  // Get vertical positions of key elements to verify ordering
  const positions = await page.evaluate(() => {
    const labels = ['GMWB Rider Fee', 'Annual Guaranteed Growth', 'Withdrawal Rate', 'Election Strategy', 'Election Age'];
    return labels.map(label => {
      const all = Array.from(document.querySelectorAll('label, div'));
      const el = all.find(e => e.textContent.trim().startsWith(label));
      return { label, top: el ? el.getBoundingClientRect().top : null };
    });
  });

  const visible = positions.filter(p => p.top !== null);
  console.log('    Section order (top positions):');
  visible.forEach(p => console.log(`      ${p.top?.toFixed(0).padStart(4)}px  ${p.label}`));

  if (visible.length >= 4) {
    const sorted = [...visible].sort((a, b) => a.top - b.top);
    const actualOrder = sorted.map(p => p.label);

    // Verify: Rider Fee and Guaranteed Growth come BEFORE Withdrawal Rate
    const riderFeeIdx = actualOrder.indexOf('GMWB Rider Fee');
    const wdRateIdx = actualOrder.indexOf('Withdrawal Rate');
    const electionStratIdx = actualOrder.indexOf('Election Strategy');
    const electionAgeIdx = actualOrder.indexOf('Election Age');

    riderFeeIdx < wdRateIdx
      ? pass('GMWB Rider Fee appears before Withdrawal Rate toggle')
      : fail('GMWB Rider Fee should come before Withdrawal Rate');

    wdRateIdx < electionStratIdx
      ? pass('Withdrawal Rate appears before Election Strategy header')
      : fail('Withdrawal Rate should appear before Election Strategy header');

    electionStratIdx < electionAgeIdx
      ? pass('Election Strategy header before Election Age input')
      : fail('Election Strategy header should precede Election Age input');
  } else {
    warn('Could not verify section order — not enough elements found');
  }
}

async function scenario_standardModeClarity() {
  console.log('\n[Scenario 8] Standard mode — user-friendly language check');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(300);

  // Check that standard mode main labels use plain English (not heavy jargon)
  // Note: GMWB/GMDB appear in rider badge chips as reference labels — that's intentional.
  // We only flag deeper actuarial terms that would confuse a general user.
  const deepJargon = ['BB', 'GAW', 'ITM', 'persistency', 'benefit base', 'annuitant'];
  const pageText = await page.evaluate(() => document.body.innerText);
  const foundDeepJargon = deepJargon.filter(t => pageText.toLowerCase().includes(t.toLowerCase()));
  foundDeepJargon.length === 0
    ? pass('Standard mode: no deep actuarial jargon in main UI')
    : warn('Standard mode contains some technical terms in main labels', foundDeepJargon.join(', '));

  // Verify friendly labels present
  const friendlyLabels = ['Your Age', 'Health Status', 'Account Value', 'Annual Withdrawal %'];
  for (const label of friendlyLabels) {
    pageText.includes(label)
      ? pass(`Friendly label present: "${label}"`)
      : fail(`Friendly label missing: "${label}"`);
  }
}

async function scenario_tooltipRendering() {
  console.log('\n[Scenario 9] Tooltip — hover renders without clipping');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(300);

  const infoIcons = page.locator('span', { hasText: 'ⓘ' });
  const iconCount = await infoIcons.count();

  if (iconCount === 0) {
    fail('No tooltip icons found');
    return;
  }
  pass(`Found ${iconCount} tooltip icons`);

  // Hover first icon, check tooltip appears and isn't cut off
  await infoIcons.first().hover();
  await page.waitForTimeout(300);

  const tooltipVisible = await page.evaluate(() => {
    // Portal tooltips are direct children of body with position:fixed
    const fixed = Array.from(document.body.children).filter(el =>
      el.style.position === 'fixed' && el.style.zIndex === '9999'
    );
    if (fixed.length === 0) return { visible: false };
    const rect = fixed[0].getBoundingClientRect();
    return {
      visible: true,
      width: rect.width,
      left: rect.left,
      right: rect.right,
      withinViewport: rect.right <= window.innerWidth && rect.left >= 0,
    };
  });

  if (tooltipVisible.visible) {
    tooltipVisible.withinViewport
      ? pass('Tooltip visible and within viewport', `${tooltipVisible.left.toFixed(0)}–${tooltipVisible.right.toFixed(0)}px`)
      : fail('Tooltip clips outside viewport', `right=${tooltipVisible.right.toFixed(0)}, viewport=${page.viewportSize()?.width}`);
  } else {
    fail('Tooltip not visible after hover');
  }

  await screenshot('09-tooltip');
}

async function scenario_inputClear() {
  console.log('\n[Scenario 10] Number input — full deletion and re-entry');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);

  // Ensure sidebar is open (desktop: click "Edit Inputs" pill if sidebar is collapsed)
  const editBtn = page.locator('button').filter({ hasText: /Edit Inputs/ });
  if (await editBtn.count() > 0 && await editBtn.isVisible()) {
    await editBtn.click();
    await page.waitForTimeout(300);
  }

  const numInputs = page.locator('input[type="number"]');

  // ── Test 1: integer input (age field, default 65) ─────────────────────────
  const ageInput = numInputs.first();
  await ageInput.click({ clickCount: 3 });
  await ageInput.press('Control+A');
  for (let i = 0; i < 3; i++) await ageInput.press('Backspace');
  await page.waitForTimeout(100);
  await ageInput.type('72');
  await ageInput.press('Tab');
  await page.waitForTimeout(200);

  const ageVal = await ageInput.inputValue();
  ageVal === '72'
    ? pass('Integer input: delete all digits then retype commits new value', `"${ageVal}"`)
    : fail('Integer input: field snapped back instead of accepting new value', `Got "${ageVal}" expected "72"`);

  // ── Test 2: percent input (withdrawal rate, default 5%) ───────────────────
  // The second type=number input in standard mode is the withdrawal rate PercentInput
  const pctInput = numInputs.nth(1);
  const origPct = await pctInput.inputValue();

  await pctInput.click({ clickCount: 3 });
  await pctInput.press('Control+A');
  for (let i = 0; i < 5; i++) await pctInput.press('Backspace');
  await page.waitForTimeout(100);
  await pctInput.type('6');
  await pctInput.press('Tab');
  await page.waitForTimeout(200);

  const newPct = await pctInput.inputValue();
  newPct === '6'
    ? pass('Percent input: delete all digits then retype commits new value', `"${newPct}"`)
    : fail('Percent input: field snapped back instead of accepting new value', `Got "${newPct}" (was "${origPct}")`);

  await screenshot('10-input-clear');
}

async function scenario_otpSendFlow() {
  console.log('\n[Scenario 11] OTP — /auth/send-otp API returns 200 and modal UI flow');

  // ── Test 1: Direct API call (Node.js fetch, not browser context) ──────────
  // Critical regression test: otp_store.py must write to /tmp on Lambda, not
  // the read-only /var/task.  Any sqlite3.OperationalError → 500 here.
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'otp-test@playwright.local' }),
      });
      if (res.status === 200) {
        pass('OTP API: /auth/send-otp returns 200', 'DB write succeeded (writable path confirmed)');
      } else if (res.status === 429) {
        // Rate limit means the endpoint is healthy — DB write succeeded on a prior call
        pass('OTP API: /auth/send-otp returns 429 (rate limited — endpoint is healthy)', `status ${res.status}`);
      } else {
        const body = await res.text().catch(() => '');
        fail('OTP API: unexpected status — endpoint broken', `HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (err) {
      fail('OTP API: network error — backend may not be running', err.message);
    }
  } else {
    warn('OTP API: skipping direct test — pass --api=<url> for production runs');
  }

  // ── Test 2: UI flow — modal appears, email entry, send triggers step 2 ────
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(300);

  // The init script seeds va_calc_email which also bypasses the gate.
  // Remove both keys so isAdvancedUnlocked() → false when Advanced is clicked.
  await page.evaluate(() => {
    localStorage.removeItem('va_calc_verified_email');
    localStorage.removeItem('va_calc_email');
  });

  await page.locator('button', { hasText: 'Advanced' }).first().click();
  await page.waitForTimeout(600);

  const modalText = await page.evaluate(() => document.body.innerText);
  const modalOpen =
    modalText.includes('Verify') ||
    modalText.includes('verification') ||
    (modalText.includes('email') && modalText.includes('Send'));

  if (!modalOpen) {
    warn('OTP gate modal did not appear — check isAdvancedUnlocked() logic');
  } else {
    pass('OTP gate modal opens when Advanced clicked without verified email');

    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.count() === 0) {
      fail('OTP modal: email input not found');
    } else {
      await emailInput.fill('ui-test@playwright.local');

      const sendBtn = page.locator('button').filter({ hasText: /send.*code|get.*code/i }).first();
      if (await sendBtn.count() === 0) {
        fail('OTP modal: send code button not found');
      } else {
        await sendBtn.click();
        await page.waitForTimeout(2000); // wait for round-trip to backend

        const afterText = await page.evaluate(() => document.body.innerText);
        const step2 =
          afterText.includes('Enter') &&
          (afterText.includes('6-digit') || afterText.includes('code') || afterText.includes('digit'));
        const hasError = /something went wrong|failed|error occurred|500/i.test(afterText);

        if (step2 && !hasError) {
          pass('OTP send succeeded — code entry step 2 shown');
        } else if (hasError) {
          fail('OTP send failed — error shown in modal', afterText.slice(0, 150));
        } else {
          warn('OTP send state unclear after click', afterText.slice(0, 150));
        }
      }
    }
  }

  await screenshot('11-otp-send');

  // Dismiss and restore session so subsequent tests (if any) still work
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    localStorage.setItem('va_calc_email', 'test@playwright.com');
    localStorage.setItem('va_calc_verified_email', 'test@playwright.com');
    localStorage.setItem('va_sidebar_open', '1');
  });
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  VA Rider Calculator — User-Perspective UI Test`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`${'='.repeat(60)}`);

  // Pre-flight: check server is reachable before launching browser
  try {
    const { default: http } = await import(BASE_URL.startsWith('https') ? 'https' : 'http');
    await new Promise((resolve, reject) => {
      const req = http.get(BASE_URL, res => { res.resume(); resolve(); });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  } catch {
    console.error(`\n  ❌ Cannot reach ${BASE_URL}`);
    console.error('  Start the dev server first:');
    console.error('    cd frontend && npm run dev');
    console.error('  Also ensure the backend is running:');
    console.error('    cd backend && python -m uvicorn main:app --port 8000\n');
    process.exit(2);
  }

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setViewportSize({ width: 1440, height: 900 });

  // Bypass both gate modals in every page load:
  //   - AdvancedGateModal: checks localStorage 'va_calc_email'
  //   - EmailCaptureModal: shown after first standard run if 'va_calc_email' absent
  await page.addInitScript(() => {
    localStorage.setItem('va_calc_email', 'test@playwright.com');
    // Keep sidebar open so input fields are always accessible in tests
    localStorage.setItem('va_sidebar_open', '1');
    // Clear saved params before every navigation so session persistence
    // doesn't bleed state between test scenarios (e.g. scenario 4 sets
    // gmwb_enabled=false and scenario 5 would then restore that state).
    localStorage.removeItem('va_calc_saved_params');
  });

  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });
  page.on('pageerror', err => jsErrors.push(`PAGE ERROR: ${err.message}`));

  const scenarios = [
    scenario_appLoads,
    scenario_defaultSimulation,
    scenario_healthSelector,
    scenario_dbOnly,
    scenario_advancedMode,
    scenario_bandedRates,
    scenario_sectionOrder,
    scenario_standardModeClarity,
    scenario_tooltipRendering,
    scenario_inputClear,
    scenario_otpSendFlow,
  ];

  for (const scenario of scenarios) {
    try {
      await scenario();
    } catch (err) {
      const name = scenario.name.replace('scenario_', '').replace(/_/g, ' ');
      fail(`${name} — uncaught error`, err.message);
    }
  }

  await browser.close();

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`  ✅ PASS: ${passed}   ⚠️  WARN: ${warned}   ❌ FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\n  Failed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`    - ${r.name}: ${r.detail}`));
  }
  if (warned > 0) {
    console.log('\n  Warnings:');
    results.filter(r => r.status === 'WARN').forEach(r => console.log(`    - ${r.name}: ${r.detail}`));
  }
  console.log('='.repeat(60) + '\n');

  // Machine-readable summary for skill consumption
  console.log('RESULT_JSON:' + JSON.stringify({ passed, warned, failed, checks: results }));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
