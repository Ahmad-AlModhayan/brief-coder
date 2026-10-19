# Vendored copy of @kahf/design

This folder is a copy of github.com/Ahmad-AlModhayan/kahf-design at **v1.0.0** (commit 4c35e94).

It is copied in, not installed from GitHub, because kahf-design is private: a host (Cloudflare Pages,
Netlify, Vercel) can clone this repository but cannot read another private one without a token.
Vendoring keeps the design system private and lets the site build anywhere with no secrets.

Do not edit files here. Change kahf-design, tag a release, then update this copy:

    node scripts/sync-kahf.mjs ../../kahf-design      # from site/, path to your kahf-design checkout
