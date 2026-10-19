// Copies a kahf-design checkout into vendor/kahf-design (the site's copy of the parent design system).
//   node scripts/sync-kahf.mjs <path-to-kahf-design>
// Copies the files kahf-design publishes (its package.json "files"), then records the version and commit.
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const src = process.argv[2];
if (!src || !existsSync(path.join(src, 'package.json'))) {
  console.error('Usage: node scripts/sync-kahf.mjs <path-to-kahf-design>');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(path.join(src, 'package.json'), 'utf8'));
const dest = path.resolve('vendor/kahf-design');
const notes = existsSync(path.join(dest, 'VENDORED.md')) ? readFileSync(path.join(dest, 'VENDORED.md'), 'utf8') : '';
rmSync(dest, { recursive: true, force: true });
for (const f of ['package.json', ...pkg.files]) {
  if (existsSync(path.join(src, f))) cpSync(path.join(src, f), path.join(dest, f), { recursive: true });
}
rmSync(path.join(dest, 'tools/build_css.py'), { force: true });
let commit = 'unknown';
try { commit = execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch {}
writeFileSync(path.join(dest, 'VENDORED.md'), notes.replace(/\*\*v[^*]+\*\* \(commit [^)]+\)/, `**v${pkg.version}** (commit ${commit})`));
console.log(`vendored @kahf/design ${pkg.version} (${commit}) into vendor/kahf-design — run npm install, then commit.`);
