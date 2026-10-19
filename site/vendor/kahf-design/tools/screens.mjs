#!/usr/bin/env node
// kahf-screens — re-renders app screens from a design canvas into the site's public/screens
// (<name>.webp at 824 wide, <name>-1x.webp at 412 wide). Run it from the site's folder after a canvas changes.
//   1. Download the canvas's project/ folder and its artifact-type/dc-runtime.js (the canvas runtime).
//   2. npm i --no-save sharp playwright
//   3. npx kahf-screens <project-dir> <dc-runtime.js> Board[:WxH] ...
//      e.g. npx kahf-screens ./canvas/project ./canvas/dc-runtime.js Main Focus TodayArabic
// Boards are cropped to the phone's first screen (412 x 915) unless a size is given.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const { chromium } = require('playwright');
const [dir, runtime, ...boards] = process.argv.slice(2);
if (!dir || !runtime || !boards.length) { console.error('Usage: npx kahf-screens <project-dir> <dc-runtime.js> Board ...'); process.exit(1); }
const out = path.join(process.cwd(), 'public', 'screens');
mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = p.endsWith('/support.js') ? runtime : path.join(dir, p);
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const spec of boards) {
  const [name, size] = spec.split(':');
  const [w, h] = (size ?? '412x915').split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${port}/${name}.dc.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  const file = name.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase();
  await sharp(png).webp({ quality: 82 }).toFile(path.join(out, `${file}.webp`));
  await sharp(png).resize(w).webp({ quality: 82 }).toFile(path.join(out, `${file}-1x.webp`));
  console.log(`${name} -> screens/${file}.webp`);
  await page.close();
}
await browser.close();
server.close();
