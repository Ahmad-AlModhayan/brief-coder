#!/usr/bin/env node
// kahf-assets — draws a site's favicons, app icons, web manifest, robots.txt and social images (og/en.png,
// og/ar.png) from the product marks in @kahf/design and the family fonts. Run it from the site's folder:
//   npm i --no-save sharp playwright && npx kahf-assets
// It reads kahf.assets.json next to package.json: { id, name, bg, ink, accent, headline, sub, short, description, rootLang? }
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const { chromium } = require('playwright');

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandSrc = readFileSync(path.join(pkg, 'lib/brand.ts'), 'utf8');
const BRAND = JSON.parse(brandSrc.slice(brandSrc.indexOf('{'), brandSrc.lastIndexOf('}') + 1));
const conf = JSON.parse(readFileSync(path.join(process.cwd(), 'kahf.assets.json'), 'utf8'));
const SITES = { [conf.id]: conf };
const glyph = (id, small) => {
  if (id === 'qasd') {
    const m = small ? BRAND.qasd.small : BRAND.qasd.mark;
    return `<svg x="18.56" y="14.08" width="26.88" height="35.84" viewBox="${m.viewBox}">${m.body}</svg>`;
  }
  if (id === 'mizwala') return `<svg x="0" y="0" width="64" height="64" viewBox="18 18 72 72">${BRAND.mizwala.icon.body}</svg>`;
  return `<svg x="9.6" y="9.6" width="44.8" height="44.8" viewBox="0 0 24 24">${BRAND[id].body}</svg>`;
};
const tile = (id, { rx = 15, pad = 0, small = false } = {}) => {
  const s = SITES[id];
  const inner = pad ? `<g transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})">` : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rx}" fill="${s.bg}"/>${inner}<g fill="${s.ink}" color="${s.ink}">${glyph(id, small)}</g></g></svg>`;
};
const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * size / 64 * 4 }).resize(size, size).png().toBuffer();
const ico = (images) => {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(([size, img]) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0); e.writeUInt8(size, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12);
    offset += img.length; return e;
  });
  return Buffer.concat([header, ...dir, ...images.map(([, img]) => img)]);
};

const font = (f) => pathToFileURL(path.join(pkg, `public/fonts/${f}.woff2`)).href;
const og = (id, lang) => {
  const s = SITES[id]; const ar = lang === 'ar';
  const url = `${id}.kahflabs.com`;
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
@font-face{font-family:"Plex";src:url("${font('IBMPlexSans-SemiBold')}");font-weight:600}
@font-face{font-family:"Plex";src:url("${font('IBMPlexSans-Regular')}");font-weight:400}
@font-face{font-family:"PlexAr";src:url("${font('IBMPlexSansArabic-Bold')}");font-weight:700}
@font-face{font-family:"PlexAr";src:url("${font('IBMPlexSansArabic-Regular')}");font-weight:400}
@font-face{font-family:"Mono";src:url("${font('IBMPlexMono-Medium')}");font-weight:500}
html,body{margin:0}body{width:1200px;height:630px;background:#f5f4f0;color:#1b1a17;font-family:${ar ? 'PlexAr,Plex' : 'Plex,PlexAr'},sans-serif;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;padding:80px 96px 68px;position:relative;overflow:hidden}
body::before{content:'';position:absolute;inset:0;background:radial-gradient(55% 75% at ${ar ? '8%' : '92%'} 0%, ${s.accent}22 0%, transparent 70%)}
.top{position:relative;display:flex;align-items:center;gap:22px}.top>svg{width:84px;height:84px;border-radius:19px}
.name{font-weight:${ar ? 700 : 600};font-size:40px}
h1{position:relative;margin:0;font-weight:${ar ? 700 : 600};font-size:${ar ? 76 : 80}px;line-height:${ar ? 1.45 : 1.04};letter-spacing:${ar ? 0 : '-0.035em'};max-width:1000px}
.foot{position:relative;display:flex;justify-content:space-between;align-items:baseline;gap:24px;border-top:2px solid #e5e2db;padding-top:26px;font-size:26px;color:#6b675f}
.mono{font-family:Mono,monospace;font-weight:500;direction:ltr;color:${s.accent};white-space:nowrap}
</style></head><body>
<div class="top">${tile(id)}<span class="name">${s.name[lang]}</span></div>
<h1>${s.headline[lang]}</h1>
<div class="foot"><span>${s.sub[lang]}</span><span class="mono">${url}</span></div>
</body></html>`;
};

const id = conf.id;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
{
  const s = SITES[id];
  const pub = (p) => path.join(process.cwd(), 'public', p);
  mkdirSync(pub('og'), { recursive: true });
  writeFileSync(pub('favicon.svg'), tile(id, { small: true }) + '\n');
  writeFileSync(pub('favicon.ico'), ico([[16, await png(tile(id, { small: true }), 16)], [32, await png(tile(id, { small: true }), 32)]]));
  writeFileSync(pub('apple-touch-icon.png'), await png(tile(id, { rx: 0 }), 180));
  writeFileSync(pub('icon-192.png'), await png(tile(id), 192));
  writeFileSync(pub('icon-512.png'), await png(tile(id), 512));
  writeFileSync(pub('icon-maskable-512.png'), await png(tile(id, { rx: 0, pad: 10 }), 512));
  const rootLang = s.rootLang ?? 'en';
  writeFileSync(pub('site.webmanifest'), JSON.stringify({
    name: s.name[rootLang], short_name: s.short, description: s.description, lang: rootLang, dir: rootLang === 'ar' ? 'rtl' : 'ltr',
    start_url: '/', display: 'browser', background_color: '#f5f4f0', theme_color: '#f5f4f0',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n');
  writeFileSync(pub('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: https://${id}.kahflabs.com/sitemap.xml\n`);
  for (const lang of ['en', 'ar']) {
    const file = path.join(os.tmpdir(), `kahf-og-${id}-${lang}.html`);
    writeFileSync(file, og(id, lang));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: pub(`og/${lang}.png`) });
  }
  console.log('assets written for', id);
}
await browser.close();
