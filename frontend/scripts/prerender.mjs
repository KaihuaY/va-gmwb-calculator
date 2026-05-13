/**
 * prerender.mjs
 *
 * Static-site-generation pre-render for the ratings publication routes.
 *
 * Approach + choice rationale:
 *   We attempted vite-ssg (https://github.com/antfu-collective/vite-ssg) per the
 *   task hint, but as of the latest 0.x release (0.24.3) the package is a
 *   Vue-3-only renderer — peerDependencies are `vue ^3.2.10` and `vue-router
 *   ^4`, with no React entry point. Wiring it into a React 18 / react-router-
 *   dom v7 app would require either swapping the framework or pulling in the
 *   Vue runtime alongside React, both of which are "major restructuring" the
 *   task explicitly told us to fall back from.
 *
 *   The MVP-runbook escape hatch ("vite-plugin-prerender or a custom
 *   puppeteer-based pre-render script") is what we ship here. Playwright is
 *   already a devDependency (used by frontend/test_ratings_ui.mjs), so we
 *   crawl the app with a headless Chromium against a local static server
 *   over `dist/` and snapshot the rendered HTML back into `dist/<route>/
 *   index.html`.
 *
 * Pipeline:
 *   1. `vite build`            (npm run build)
 *   2. node generate-ratings-snapshot.mjs  (already run earlier — bakes the
 *      data into dist/ratings-data so the crawler doesn't need uvicorn)
 *   3. spin up a static-file http server over dist/ on 127.0.0.1:<port>
 *   4. Playwright visits /ratings, /methodology, and /ratings/:slug for every
 *      slug listed in ratings-data/manifest.json
 *   5. For each route, wait until the page's loading state clears + content
 *      indicator is present, then write `document.documentElement.outerHTML`
 *      to `dist/<route>/index.html`
 *
 * Other routes (/, /calculator, /calculator/:presetId, the SEO product pages)
 * are explicitly NOT crawled. They keep being client-rendered via dist/
 * index.html — exactly the existing SPA fallback behaviour.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PRERENDER_PORT || 4319);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json',
};

function makeServer(root) {
  return createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      // SPA fallback — serve index.html for any unknown path. We deliberately
      // do NOT short-circuit /ratings/* here because at crawl time those files
      // don't exist yet; we want to render the SPA shell and let React do its
      // thing. The snapshot HTML is written AFTER the crawl finishes.
      let fsPath = join(root, urlPath);
      try {
        const s = await stat(fsPath);
        if (s.isDirectory()) fsPath = join(fsPath, 'index.html');
      } catch {
        fsPath = join(root, 'index.html');
      }
      const buf = await readFile(fsPath);
      res.writeHead(200, { 'Content-Type': MIME[extname(fsPath)] || 'application/octet-stream' });
      res.end(buf);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
}

async function loadManifest() {
  const p = join(DIST, 'ratings-data', 'manifest.json');
  const txt = await readFile(p, 'utf-8');
  return JSON.parse(txt);
}

async function captureRoute(page, baseUrl, route, contentSelector) {
  const url = baseUrl + route;
  await page.goto(url, { waitUntil: 'networkidle' });
  // Wait for the page-level content marker (proves React has rendered the
  // real component, not the "Loading…" placeholder)
  await page.waitForSelector(contentSelector, { timeout: 10_000 });
  return page.content();
}

async function writeRouteHtml(route, html) {
  const cleanRoute = route.replace(/^\/+/, '').replace(/\/+$/, '');
  const outDir = join(DIST, cleanRoute);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'index.html'), html, 'utf-8');
}

async function main() {
  const manifest = await loadManifest();
  const slugs = manifest.slugs || [];
  console.log(`[prerender] crawling ${slugs.length + 2} routes`);

  const server = makeServer(DIST);
  await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
  const baseUrl = `http://127.0.0.1:${PORT}`;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const routes = [
    { route: '/ratings',     selector: '[data-testid="ratings-table"]' },
    { route: '/methodology', selector: '[data-testid="methodology-page"]' },
    ...slugs.map((slug) => ({
      route: `/ratings/${slug}`,
      selector: '[data-testid="rating-detail"]',
    })),
  ];

  let ok = 0, fail = 0;
  for (const { route, selector } of routes) {
    try {
      const html = await captureRoute(page, baseUrl, route, selector);
      await writeRouteHtml(route, html);
      console.log(`  [ok]  ${route}`);
      ok++;
    } catch (e) {
      console.error(`  [fail] ${route} — ${e.message}`);
      fail++;
    }
  }

  await browser.close();
  await new Promise((res) => server.close(res));
  console.log(`[prerender] done — ${ok} ok, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
