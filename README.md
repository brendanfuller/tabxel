# Tabxel

[![CI](https://github.com/brendanfuller/tabxel/actions/workflows/ci.yml/badge.svg)](https://github.com/brendanfuller/tabxel/actions/workflows/ci.yml)

Convert an HTML `<table>` into a real Excel **`.xlsx`** file, entirely in the browser.
The heavy lifting (XLSX/OOXML generation) runs in **WebAssembly**
(Rust + [`rust_xlsxwriter`](https://docs.rs/rust_xlsxwriter)); a thin JavaScript layer
walks the table and reads its styling. Ships as a **single, self-contained ESM** with
the wasm base64-inlined — load it straight from a CDN, no extra fetch, no build step
for consumers.

```html
<script type="module">
  import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@v0.1.0/dist/tabxel.js';

  const tx = new Tabxel();
  tx.addTable(document.querySelector('#report'));   // -> Sheet1
  tx.addTable(document.querySelector('#q2'), { sheetName: 'Q2' }); // -> another sheet
  await tx.download('report.xlsx');
</script>
```

## Features

- **Styling, automatically.** Colors, bold/italic, alignment, borders and column widths
  are read from the table's live `getComputedStyle()` — the sheet mirrors the page.
- **`data-*` overrides.** Annotate cells/columns to override the computed styling or set
  number formats, formulas, and explicit values/types.
- **Multiple sheets.** The first registered table is Sheet 1; each additional table is
  another sheet.
- **Merged cells.** `colspan` / `rowspan` become merged ranges.
- **Auto-filters.** Dropdown filters are added to header rows automatically.
- **Nested tables.** A `<table>` inside a cell is extracted to its own sheet, and the
  host cell becomes a hyperlink to it.
- **Typed.** Ships hand-written TypeScript declarations (`dist/tabxel.d.ts`, referenced
  from `package.json`), so TS consumers get full types and editors get hover docs /
  autocomplete out of the box. Plain-JS users still get JSDoc hovers from the source.

## API

```js
const tx = new Tabxel();
tx.addTable(tableEl, { sheetName });  // register a table (chainable)
Tabxel.fromTable(tableEl, opts);      // shortcut for new Tabxel().addTable(...)

await tx.toUint8Array();              // raw .xlsx bytes
await tx.toBlob();                    // Blob (correct xlsx MIME)
await tx.download('name.xlsx');       // trigger a browser download
```

> The table must be attached to the rendered document for computed styles and widths to
> be read (a `display:none` table yields no styling/sizing).

## `data-*` attribute reference

Computed CSS supplies all styling by default; a `data-*` attribute wins when present.

| Element      | Attribute            | Effect                                               |
| ------------ | -------------------- | ---------------------------------------------------- |
| `<table>`    | `data-sheet-name`    | Sheet name (else `Sheet1`, `Sheet2`, …)              |
| `<table>`    | `data-autofilter`    | `"false"` disables; on by default when a header row exists |
| `<table>`    | `data-header-rows`   | Header row count (else the `<thead>` row count)      |
| `<col>`      | `data-width`         | Explicit Excel column width                          |
| `<col>`      | `data-number-format` | Column-level Excel number format (e.g. `"$#,##0.00"`)|
| `<th>`/`<td>`| `data-bg`            | Background fill (`#RRGGBB`)                          |
| `<th>`/`<td>`| `data-color`         | Font color (`#RRGGBB`)                              |
| `<th>`/`<td>`| `data-bold`          | `true`/`false`                                       |
| `<th>`/`<td>`| `data-italic`        | `true`/`false`                                       |
| `<th>`/`<td>`| `data-align`         | `left` / `center` / `right`                          |
| `<th>`/`<td>`| `data-number-format` | Cell-level Excel number format                       |
| `<th>`/`<td>`| `data-type`          | `number` / `bool` / `text` (else inferred)           |
| `<th>`/`<td>`| `data-value`         | Override the cell's value                            |
| `<th>`/`<td>`| `data-formula`       | Excel formula (leading `=` optional)                 |

## CDN

Served from [jsDelivr](https://www.jsdelivr.com/), which adds correct CORS + MIME and
caches immutably per git tag:

```js
// Pinned to a release (recommended — the inlined wasm can't change under you):
import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@v0.1.0/dist/tabxel.js';

// Always-latest tag:
import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@latest/dist/tabxel.js';
```

## Building from source

Consumers never need Rust — only building `dist/tabxel.js` does.

**Prerequisites (build machine only):**

```sh
# Rust via rustup (if `rustc` is missing or isn't rustup-managed):
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
brew install binaryen           # provides wasm-opt (optional but recommended)
```

**Build + test:**

```sh
npm run build        # cargo -> wasm-bindgen -> wasm-opt -> inline into dist/tabxel.js
npm test             # Rust unit tests (native)
npm run test:smoke   # headless end-to-end pipeline test (needs: npm i jsdom)
npm run serve        # then open http://localhost:8080/examples/
```

## How it works

```
HTMLTableElement
   │  js/extract.js  — walk rows/cells, resolve rowspan/colspan grid,
   │                   read computed styles + data-* overrides, hoist nested tables
   ▼
plain { sheets:[ { name, cols, cells, autofilter } ] } payload
   │  wasm (src/lib.rs) — serde-deserialize, build workbook with rust_xlsxwriter
   ▼
.xlsx bytes  →  Blob / Uint8Array / download
```

WebAssembly never touches the DOM — all parsing happens in JS, so the wasm module stays
portable and small(ish).

## Layout

| Path                    | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `src/lib.rs`            | Rust/wasm core: payload → `.xlsx` bytes             |
| `js/extract.js`         | `HTMLTableElement` → payload (DOM + styles)         |
| `js/tabxel.js`          | Public `Tabxel` class + sheet orchestration         |
| `build/inline-wasm.mjs` | Stitches glue + base64 wasm + JS into one ESM       |
| `dist/tabxel.js`        | **Published artifact** (single ESM, wasm inlined)   |
| `examples/index.html`   | Live demo                                           |

## License

MIT
