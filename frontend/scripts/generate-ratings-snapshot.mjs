/**
 * generate-ratings-snapshot.mjs
 *
 * Build-time helper that snapshots the ratings publication data into static
 * JSON under `frontend/public/ratings-data/` so:
 *   - `vite build` ships them in `dist/ratings-data/...`
 *   - the SSG pre-render crawler can fetch the same data without needing a
 *     uvicorn process up
 *   - `npm run dev` continues to serve them via Vite's public dir
 *
 * Mirrors the shape returned by the FastAPI endpoints in backend/main.py:
 *   GET /ratings           -> ratings-data/ratings.json
 *   GET /ratings/{slug}    -> ratings-data/ratings/{slug}.json
 *   GET /methodology       -> ratings-data/methodology.json
 *
 * Reads directly from backend/data/{ratings,products,methodology}.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BACKEND_DATA = join(ROOT, 'backend', 'data');
const RATINGS_DIR = join(BACKEND_DATA, 'ratings');
const PRODUCTS_DIR = join(BACKEND_DATA, 'products');
const METHOD_DIR = join(BACKEND_DATA, 'methodology');
const OUT_DIR = join(__dirname, '..', 'public', 'ratings-data');

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadMethodology(version = 'v1') {
  return readJSON(join(METHOD_DIR, `methodology_${version}.json`));
}

function specHasGlwb(slug) {
  const p = join(PRODUCTS_DIR, `${slug}.json`);
  if (!existsSync(p)) return false;
  const spec = readJSON(p);
  return spec?.rider?.type === 'glwb';
}

function summarizeRating(r) {
  const snapshot = r.feature_snapshot || {};
  const sub = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, v.score]));
  return {
    slug: r.product_slug,
    name: r.product_name,
    carrier: r.carrier,
    letter_grade: r.letter_grade,
    composite: r.composite,
    sub_scores: sub(r.sub_scores),
    male_scores: sub(r.male_scores),
    female_scores: sub(r.female_scores),
    male_composite: r.male_composite ?? null,
    female_composite: r.female_composite ?? null,
    male_letter_grade: r.male_letter_grade ?? null,
    female_letter_grade: r.female_letter_grade ?? null,
    feature_snapshot: snapshot,
    verdict: r.verdict ?? null,
    methodology_version: r.methodology_version,
    signed_by: r.signed_by ?? null,
    signed_at: r.signed_at ?? null,
    has_glwb: snapshot.has_glwb ?? specHasGlwb(r.product_slug),
  };
}

function main() {
  // Reset output dir
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, 'ratings'), { recursive: true });

  const methodology = loadMethodology('v1');
  writeFileSync(join(OUT_DIR, 'methodology.json'), JSON.stringify(methodology));

  const files = readdirSync(RATINGS_DIR).filter((f) => /_v\d+\.json$/.test(f));
  const items = [];
  const slugs = [];
  for (const f of files) {
    const r = readJSON(join(RATINGS_DIR, f));
    if (r.status !== 'published') continue;
    items.push(summarizeRating(r));
    slugs.push(r.product_slug);

    // Per-slug detail: { rating, product }
    const product = existsSync(join(PRODUCTS_DIR, `${r.product_slug}.json`))
      ? readJSON(join(PRODUCTS_DIR, `${r.product_slug}.json`))
      : null;
    writeFileSync(
      join(OUT_DIR, 'ratings', `${r.product_slug}.json`),
      JSON.stringify({ rating: r, product }),
    );
  }
  items.sort((a, b) => b.composite - a.composite);

  writeFileSync(
    join(OUT_DIR, 'ratings.json'),
    JSON.stringify({
      count: items.length,
      methodology_version: methodology.version,
      methodology_effective_date: methodology.effective_date,
      items,
    }),
  );

  // Manifest used by the pre-render crawler to expand /ratings/:slug
  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ slugs: slugs.sort(), generated_at: new Date().toISOString() }),
  );

  console.log(`[snapshot] wrote ${items.length} ratings, methodology ${methodology.version}, manifest with ${slugs.length} slugs`);
}

main();
