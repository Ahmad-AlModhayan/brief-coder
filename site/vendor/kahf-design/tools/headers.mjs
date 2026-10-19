/* Security and caching headers for every Kahf site. The kahf() integration writes them to dist/_headers at build
   (Netlify, Cloudflare Pages); vercel.json mirrors them. Sites load nothing from other origins.
   forms: true allows posting to the same origin, mailto: and the contact endpoint (kahflabs.com's contact form). */
export function securityHeaders({ endpoint = '', forms = false } = {}) {
  let origin = '';
  try { origin = endpoint ? new URL(endpoint).origin : ''; } catch { origin = ''; }
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${origin ? ' ' + origin : ''}`,
    forms ? `form-action 'self' mailto:${origin ? ' ' + origin : ''}` : "form-action 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

export const CACHE = [
  ['/_astro/*', 'public, max-age=31536000, immutable'],
  ['/fonts/*', 'public, max-age=31536000, immutable'],
  ['/og/*', 'public, max-age=86400'],
  ['/screens/*', 'public, max-age=604800'],
];

export function netlifyHeaders(options = {}) {
  const lines = ['/*', ...Object.entries(securityHeaders(options)).map(([k, v]) => `  ${k}: ${v}`), ''];
  for (const [path, value] of CACHE) lines.push(path, `  Cache-Control: ${value}`, '');
  return lines.join('\n');
}
