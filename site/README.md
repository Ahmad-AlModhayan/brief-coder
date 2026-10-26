# coder.kahflabs.com

The Brief Coder website: static HTML, English and Arabic, no cookies, no trackers. Built on
[@kahf/design](https://github.com/Ahmad-AlModhayan/kahf-design), the Kahf family design system; Brief Coder's own touches
live here.

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # dist/
npm run preview
```

| File | What |
|---|---|
| `src/product.ts` | Name, links, call to action, Play Store link, CSS scope |
| `src/Home.astro` | The home page, both languages (copy in the `T` object at the top) |
| `src/pages/` | Routes: home, privacy, 404, sitemap |
| `src/styles/site.css` | Brief Coder-only styling, loaded after the family CSS |
| `public/` | Icons, social images, screens (fonts and theme.js are copied in at build) |
| `kahf.assets.json` | Inputs for `npm run assets` (favicons, icons, manifest, og images) |

## Deploy

Any static host, with this folder as the base directory: Netlify (`netlify.toml`), Vercel (`vercel.json`, root
directory = this folder), or Cloudflare Pages (build `npm run build`, output `dist`). Point `coder.kahflabs.com` at it.
