// Produce dist/tabxel.min.js from dist/tabxel.js: minified, all inline comments
// stripped, with a single short banner line on top. Uses esbuild.

import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...p) => join(root, ...p);

const pkg = JSON.parse(readFileSync(P('package.json'), 'utf8'));
const repoUrl = (pkg.repository?.url || pkg.homepage || '')
  .replace(/^git\+/, '')
  .replace(/\.git(#.*)?$/, '');

const banner = `/*! Tabxel v${pkg.version} | ${pkg.license || 'MIT'} | ${repoUrl} */`;

await build({
  entryPoints: [P('dist', 'tabxel.js')],
  outfile: P('dist', 'tabxel.min.js'),
  format: 'esm',
  minify: true,
  legalComments: 'none', // drop the verbose /*! banner from the source
  banner: { js: banner }, // ...and prepend our short one
  logLevel: 'warning',
});

const kb = (statSync(P('dist', 'tabxel.min.js')).size / 1024).toFixed(1);
console.log(`minify: wrote dist/tabxel.min.js (${kb} KB)`);
