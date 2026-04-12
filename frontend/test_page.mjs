import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));

await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

const rootLen = await page.evaluate(() => document.getElementById('root').innerHTML.length);
const metricCards = await page.evaluate(() => document.querySelectorAll('.metric-card').length);
const hasButton = await page.evaluate(() => !!document.querySelector('button'));

console.log('Root HTML length:', rootLen);
console.log('Metric cards:', metricCards);
console.log('Has button:', hasButton);
console.log('JS errors:', errors.length === 0 ? 'NONE' : errors.join('\n'));

await browser.close();
process.exit(errors.length > 0 || rootLen < 100 ? 1 : 0);
