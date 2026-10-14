// Stitch the wasm-bindgen glue, the base64-inlined wasm, and the Tabxel JS into a
// single self-contained ESM at dist/tabxel.js — no runtime deps, no extra fetch.
//
// Run after: cargo build (wasm) -> wasm-bindgen --target web -> (optional) wasm-opt.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...p) => join(root, ...p);

// --- inputs ----------------------------------------------------------------
let glue = readFileSync(P('pkg', 'tabxel.js'), 'utf8');
const wasm = readFileSync(P('pkg', 'tabxel_bg.wasm'));
let extract = readFileSync(P('js', 'extract.js'), 'utf8');
let api = readFileSync(P('js', 'tabxel.js'), 'utf8');

// --- find the wasm-bindgen init (default export) name ----------------------
let initName = null;
let m =
  glue.match(/export\s+default\s+function\s+([A-Za-z0-9_$]+)/) || // export default function init
  glue.match(/export\s+default\s+([A-Za-z0-9_$]+)\s*;/) || // export default __wbg_init;
  glue.match(/([A-Za-z0-9_$]+)\s+as\s+default/); // export { __wbg_init as default }
if (m) initName = m[1];
if (!initName) {
  throw new Error('inline-wasm: could not locate the wasm-bindgen init default export');
}

// --- neutralize all top-level exports in the glue (keep declarations local) -
glue = glue
  .replace(/export\s+default\s+async\s+function/g, 'async function')
  .replace(/export\s+default\s+function/g, 'function')
  .replace(/^\s*export\s+default\s+[^;]+;?\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')
  .replace(/^export\s+(async\s+)?function/gm, '$1function')
  .replace(/^export\s+(const|let|var|class)/gm, '$1');

// --- strip module imports/exports we inline ourselves ----------------------
extract = extract.replace(/^export\s+function/gm, 'function');
api = api
  .replace(/^import[^\n]*\n/gm, '') // drop `import { extractTable } from './extract.js'`
  .replace(/^export\s+(function|class|const)/gm, '$1'); // bindWasm/Tabxel become local...
// ...then we re-export only the public surface explicitly at the end.

const wasmB64 = wasm.toString('base64');

const out = `// Tabxel — single-file build (HTML table -> XLSX, wasm inlined). AUTO-GENERATED.
// Source: src/lib.rs + js/*.js. Do not edit directly.
/* eslint-disable */

${glue}

// --- inlined wasm payload ---------------------------------------------------
const __TABXEL_WASM_B64 = "${wasmB64}";
function __tabxelWasmBytes() {
  const bin = atob(__TABXEL_WASM_B64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const __tabxelReady = ${initName}({ module_or_path: __tabxelWasmBytes() });

// --- DOM extraction ---------------------------------------------------------
${extract}

// --- public API -------------------------------------------------------------
${api}

bindWasm(generate, __tabxelReady);

export { Tabxel, bindWasm };
`;

mkdirSync(P('dist'), { recursive: true });
writeFileSync(P('dist', 'tabxel.js'), out, 'utf8');
// Ship the hand-written type declarations alongside the ESM.
copyFileSync(P('js', 'tabxel.d.ts'), P('dist', 'tabxel.d.ts'));

const kb = (n) => (n / 1024).toFixed(1);
console.log(
  `inline-wasm: wrote dist/tabxel.js  (wasm ${kb(wasm.length)} KB -> esm ${kb(
    Buffer.byteLength(out),
  )} KB, init="${initName}")`,
);
