/**
 * generate-sitemap.mjs
 *
 * Build-time SEO helper. Reads backend/data/ratings/*.json for the list of
 * published slugs and writes frontend/public/sitemap.xml with one <url> entry
 * for each crawl target:
 *
 *   /                  (landing)
 *   /calculator        (calculator)
 *   /methodology       (methodology page)
 *   /ratings           (ratings index)
 *   /ratings/:slug     (every published rating — <lastmod> = signed_at)
 *
 * Domain is configurable via SITEMAP_BASE_URL (defaults to
 * https://annuityvoice.com). The file lands in /public so Vite ships it at
 * dist/sitemap.xml.
 *
 * Wired into `npm run build:ssg` before snapshot+vite build so the static
 * server (and the Playwright pre-render) serve a current sitemap.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const RATINGS_DIR = join(ROOT, 'backend', 'data', 'ratings');
const PUBLIC_DIR = join(__dirname, '..', 'public');
const OUT_PATH = join(PUBLIC_DIR, 'sitemap.xml');

const BASE = (process.env.SITEMAP_BASE_URL || 'https://annuityvoice.com').replace(/\/$/, '');

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function isoDate(value, fallback) {
  if (!value) return fallback;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return fallback;
  }
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlBlock(loc, lastmod, changefreq, priority) {
  const parts = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  parts.push(`  </url>`);
  return parts.join('\n');
}

function main() {
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const entries = [];

  // Static high-value routes.
  entries.push(urlBlock(`${BASE}/`,            today, 'weekly',  '1.0'));
  entries.push(urlBlock(`${BASE}/calculator`,  today, 'weekly',  '0.9'));
  entries.push(urlBlock(`${BASE}/methodology`, today, 'monthly', '0.7'));
  entries.push(urlBlock(`${BASE}/ratings`,     today, 'weekly',  '0.9'));

  // Every published rating.
  const files = readdirSync(RATINGS_DIR).filter((f) => /_v\d+\.json$/.test(f));
  let ratingCount = 0;
  for (const f of files) {
    const r = readJSON(join(RATINGS_DIR, f));
    if (r.status !== 'published') continue;
    const lastmod = isoDate(r.signed_at, today);
    entries.push(urlBlock(`${BASE}/ratings/${r.product_slug}`, lastmod, 'monthly', '0.8'));
    ratingCount++;
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join('\n') + '\n' +
    `</urlset>\n`;

  writeFileSync(OUT_PATH, xml, 'utf-8');
  console.log(`[sitemap] wrote ${OUT_PATH} — ${entries.length} URLs (${ratingCount} ratings)`);
}

main();
