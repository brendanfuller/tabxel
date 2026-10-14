// Tabxel — public API.
//
// Usage (from the single-file CDN build):
//   import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@v0.1.0/dist/tabxel.js';
//   const tx = new Tabxel();
//   tx.addTable(document.querySelector('#report'));     // -> Sheet1
//   tx.addTable(other, { sheetName: 'Q2' });            // -> next sheet
//   await tx.download('report.xlsx');
//
// The wasm `generate` fn and a readiness promise are supplied via bindWasm() — the
// single-file build calls it after booting the inlined wasm; a dev bootstrap can too.

import { extractTable } from './extract.js';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let _generate = null;
let _ready = Promise.resolve();

/** Bind the wasm backend. Called by the build (single-file) or a dev bootstrap. */
export function bindWasm(generateFn, readyPromise) {
  _generate = generateFn;
  _ready = readyPromise || Promise.resolve();
}

/** Excel sheet-name rules: <=31 chars, none of []:*?/\, unique within the book. */
function uniqueSheetName(base, used) {
  let name = String(base || 'Sheet')
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .slice(0, 31);
  if (!name) name = 'Sheet';
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  for (let i = 2; ; i++) {
    const suffix = `~${i}`;
    const candidate = name.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** Walk all registered tables (and their nested tables) into a Book payload. */
function buildBook(entries) {
  const used = new Set();
  const sheets = [];
  const queue = [];

  entries.forEach((entry, i) => {
    const base = entry.options.sheetName || entry.el.dataset.sheetName || `Sheet${i + 1}`;
    queue.push({ el: entry.el, name: uniqueSheetName(base, used) });
  });

  while (queue.length) {
    const item = queue.shift();
    const sheet = extractTable(item.el, item.name, (nestedEl, suggestedBase) => {
      const nestedName = uniqueSheetName(suggestedBase, used);
      queue.push({ el: nestedEl, name: nestedName });
      // Internal hyperlink target understood by rust_xlsxwriter.
      return `internal:'${nestedName.replace(/'/g, "''")}'!A1`;
    });
    sheets.push(sheet);
  }

  return { sheets };
}

export class Tabxel {
  constructor() {
    this._tables = [];
  }

  /**
   * Register a table. The first registered table becomes Sheet 1; each subsequent
   * one becomes an additional sheet.
   * @param {HTMLTableElement} el
   * @param {{ sheetName?: string }} [options]
   */
  addTable(el, options = {}) {
    if (!el || el.tagName !== 'TABLE') {
      throw new TypeError('Tabxel.addTable expects an HTMLTableElement');
    }
    this._tables.push({ el, options });
    return this;
  }

  /** Convenience: `Tabxel.fromTable(el).download(...)`. */
  static fromTable(el, options = {}) {
    return new Tabxel().addTable(el, options);
  }

  async _generateBytes() {
    if (!_generate) {
      throw new Error('Tabxel: wasm backend not initialized (bindWasm was never called)');
    }
    if (this._tables.length === 0) {
      throw new Error('Tabxel: no tables registered — call addTable() first');
    }
    await _ready;
    const book = buildBook(this._tables);
    return _generate(book); // Uint8Array
  }

  /** Raw `.xlsx` bytes. */
  async toUint8Array() {
    return this._generateBytes();
  }

  /** `.xlsx` as a Blob with the correct MIME type. */
  async toBlob() {
    const bytes = await this._generateBytes();
    return new Blob([bytes], { type: XLSX_MIME });
  }

  /** Trigger a browser download of the `.xlsx`. */
  async download(filename = 'tabxel.xlsx') {
    if (typeof document === 'undefined') {
      throw new Error('Tabxel.download requires a browser DOM');
    }
    const blob = await this.toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
