import type { Product } from '@kahf/design/lib/product';

/** Brief Coder's site settings. */
export const repo = 'https://github.com/Ahmad-AlModhayan/brief-coder';

export const P: Product = {
  id: 'coder',
  // The site's own address. PUBLIC_SITE_URL overrides it while the site is served from a temporary domain (coder.getrihla.com).
  url: import.meta.env.PUBLIC_SITE_URL || 'https://coder.kahflabs.com',
  rootLang: 'en',
  scope: 'kf-scope-coder',
  name: { en: 'Brief Coder', ar: 'Brief Coder' },
  line: {
    en: 'Run and Copy on every code block in your Obsidian notes, with the output right beneath.',
    ar: 'زرّا «تشغيل» و«نسخ» على كل كتلة كود في ملاحظات Obsidian، والنتيجة تحتها مباشرة.',
  },
  pages: [],
  nav: {
    en: [{ label: 'Try it', href: '#try' }, { label: 'How it works', href: '#how' }, { label: 'Install', href: '#install' }],
    ar: [{ label: 'جرّبه', href: '#try' }, { label: 'كيف يعمل', href: '#how' }, { label: 'التثبيت', href: '#install' }],
  },
  cta: {
    en: { label: 'Get it on GitHub', href: repo },
    ar: { label: 'حمّله من GitHub', href: repo },
  },
  elsewhere: {
    en: [{ label: 'GitHub', href: repo }],
    ar: [{ label: 'GitHub', href: repo }],
  },
  email: 'hello@kahflabs.com',
};
