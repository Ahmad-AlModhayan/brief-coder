// @ts-check
/* The Astro integration every Kahf site uses:
     import kahf from '@kahf/design/integration';
     integrations: [kahf({ styles: '/src/styles/site.css' })]
   - copies the family's public files (fonts, theme.js) into the site's public/ before dev and build,
     so every site serves them from its own origin (they are generated: keep them in .gitignore);
   - loads the site's own stylesheet on every page, after kahf.css and product.css — the child's touches;
   - writes dist/_headers (security + caching) for Netlify and Cloudflare Pages. */
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { netlifyHeaders } from './tools/headers.mjs';

/**
 * @param {{ styles?: string, headers?: false | { endpoint?: string, forms?: boolean } }} [options]
 * @returns {import('astro').AstroIntegration}
 */
export default function kahf(options = {}) {
  const { styles, headers = {} } = options;
  return {
    name: '@kahf/design',
    hooks: {
      'astro:config:setup': ({ config, updateConfig }) => {
        const to = fileURLToPath(config.publicDir);
        mkdirSync(to, { recursive: true });
        cpSync(fileURLToPath(new URL('./public/', import.meta.url)), to, { recursive: true });
        // layouts/Base.astro imports 'virtual:kahf/site.css' right after kahf.css and product.css, so the
        // site's touches always come last in the cascade. It resolves to the site's file, or to nothing.
        const siteCss = styles ? fileURLToPath(new URL(styles.replace(/^\//, ''), config.root)) : null;
        const ID = 'virtual:kahf/site.css';
        updateConfig({
          vite: {
            ssr: { noExternal: ['@kahf/design'] },
            plugins: [{
              name: 'kahf-site-css',
              resolveId: (id) => (id === ID ? siteCss ?? '\0kahf-site-empty.css' : null),
              load: (id) => (id === '\0kahf-site-empty.css' ? '' : null),
            }],
          },
        });
      },
      'astro:build:done': ({ dir }) => {
        if (headers !== false) writeFileSync(new URL('_headers', dir), netlifyHeaders(headers));
      },
    },
  };
}
