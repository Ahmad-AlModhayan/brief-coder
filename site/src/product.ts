import type { Product } from '@kahf/design/lib/product';

/** Obsidian Coder's site settings. repo: point it at the plugin's own repository once it is public. */
export const repo = 'https://github.com/Ahmad-AlModhayan';

export const P: Product = {
  id: 'coder',
  url: 'https://coder.kahflabs.com',
  rootLang: 'en',
  scope: 'kf-scope-coder',
  name: { en: 'Obsidian Coder', ar: 'Obsidian Coder' },
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
