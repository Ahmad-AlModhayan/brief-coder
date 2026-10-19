import { path, type Product, type Page } from './product';

/** sitemap.xml for a product site: every page in both languages, with hreflang alternates. */
export function sitemap(p: Product): Response {
  const abs = (x: string) => new URL(x, p.url).href;
  const pages: Page[] = ['home', ...p.pages];
  const entry = (loc: string, page: Page) => `  <url>
    <loc>${abs(loc)}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${abs(path(p, 'en', page))}"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${abs(path(p, 'ar', page))}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(path(p, p.rootLang, page))}"/>
  </url>`;
  const body = pages.flatMap((pg) => [entry(path(p, 'en', pg), pg), entry(path(p, 'ar', pg), pg)]).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
