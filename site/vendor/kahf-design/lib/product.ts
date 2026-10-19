/* What every product site tells the shared layout about itself. Each site keeps its settings in its own src/product.ts. */
export type Lang = 'en' | 'ar';
export type ProductId = 'qasd' | 'mizwala' | 'wasl' | 'coder' | (string & {});
export type Page = 'home' | 'privacy' | 'terms';

export interface Link { label: string; href: string; icon?: string }

export interface Product {
  id: ProductId;
  /** https://<id>.kahflabs.com */
  url: string;
  /** The language served at "/". The other one lives under /ar/ or /en/. */
  rootLang: Lang;
  /** The CSS scope that sets the product's accent (from the Kahf design system). */
  scope: string;
  name: Record<Lang, string>;
  /** One line under the brand in the footer. */
  line: Record<Lang, string>;
  /** Pages this site has, besides home. */
  pages: Page[];
  /** In-page links in the header. */
  nav: Record<Lang, Link[]>;
  /** The header's call to action. */
  cta: Record<Lang, Link>;
  /** Shown in the footer's "Elsewhere" column. */
  elsewhere: Record<Lang, Link[]>;
  email: string;
}

export const KAHF = 'https://kahflabs.com';

/** Path of a page in a language, e.g. path(P, 'ar', 'privacy') -> /ar/privacy/ */
export function path(p: Product, lang: Lang, page: Page = 'home'): string {
  const prefix = lang === p.rootLang ? '/' : `/${lang}/`;
  return page === 'home' ? prefix : `${prefix}${page}/`;
}

export const other = (lang: Lang): Lang => (lang === 'en' ? 'ar' : 'en');

/** Arabic-Indic digits for Arabic pages. */
export const digits = (s: string | number, lang: Lang) =>
  lang === 'ar' ? String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : String(s);

/** Kahf's own pages, in the visitor's language. */
export const kahf = (lang: Lang, p = '') => `${KAHF}${lang === 'ar' ? '/ar' : ''}/${p}`;
