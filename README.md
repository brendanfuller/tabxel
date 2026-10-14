# Tabxel

[![CI](https://github.com/brendanfuller/tabxel/actions/workflows/ci.yml/badge.svg)](https://github.com/brendanfuller/tabxel/actions/workflows/ci.yml)

Convert an HTML `<table>` into an Excel file, entirely in the browser.

```html
<script type="module">
  import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@v0.1.0/dist/tabxel.js';

  const tx = new Tabxel();
  tx.addTable(document.querySelector('#report'));
  tx.addTable(document.querySelector('#q2'), { sheetName: 'Q2' });
  await tx.download('report.xlsx');
</script>
```

## Features

- **Automatic styling.** Colors, bold/italic, alignment, borders and column widths are read from the table's live `getComputedStyle()`.
- **`data-*` overrides.** Set number formats, formulas, explicit values/types, or override any computed style.
- **Multiple sheets.** The first table is Sheet 1; each additional table adds a sheet.
- **Merged cells.** `colspan`/`rowspan` become merged ranges.
- **Auto-filters.** Dropdown filters are added to header rows.
- **Nested tables.** Each is extracted to its own sheet, linked from the host cell.
- **Typed.** Ships TypeScript declarations with full types and editor hovers.

## Built on

Rust + [`rust_xlsxwriter`](https://docs.rs/rust_xlsxwriter) compiled to WebAssembly, with a thin JavaScript layer that reads the table. The wasm never touches the DOM. Ships as one self-contained ESM with the wasm inlined, so there's no extra fetch and no build step for consumers.

## API

```js
const tx = new Tabxel();
tx.addTable(tableEl, { sheetName });  // register a table (chainable)
Tabxel.fromTable(tableEl, opts);      // shortcut for new Tabxel().addTable(...)

await tx.toUint8Array();              // raw .xlsx bytes
await tx.toBlob();                    // Blob (correct xlsx MIME)
await tx.download('name.xlsx');       // trigger a browser download
```

The table must be attached to the rendered document; a `display:none` table has no computed styles or sizes to read.

## `data-*` attribute reference

Computed CSS supplies styling by default; a `data-*` attribute wins when present.

| Element      | Attribute            | Effect                                                     |
| ------------ | -------------------- | ---------------------------------------------------------- |
| `<table>`    | `data-sheet-name`    | Sheet name (else `Sheet1`, `Sheet2`, ...)                  |
| `<table>`    | `data-autofilter`    | `"false"` disables; on by default when a header row exists |
| `<table>`    | `data-header-rows`   | Header row count (else the `<thead>` row count)            |
| `<col>`      | `data-width`         | Explicit Excel column width                                |
| `<col>`      | `data-number-format` | Column-level number format (e.g. `"$#,##0.00"`)            |
| `<th>`/`<td>`| `data-bg`            | Background fill (`#RRGGBB`)                                 |
| `<th>`/`<td>`| `data-color`         | Font color (`#RRGGBB`)                                     |
| `<th>`/`<td>`| `data-bold`          | `true`/`false`                                             |
| `<th>`/`<td>`| `data-italic`        | `true`/`false`                                             |
| `<th>`/`<td>`| `data-align`         | `left` / `center` / `right`                                |
| `<th>`/`<td>`| `data-number-format` | Cell-level number format                                   |
| `<th>`/`<td>`| `data-type`          | `number` / `bool` / `text` (else inferred)                 |
| `<th>`/`<td>`| `data-value`         | Override the cell's value                                  |
| `<th>`/`<td>`| `data-formula`       | Excel formula (leading `=` optional)                       |

## CDN

Served from [jsDelivr](https://www.jsdelivr.com/) with correct CORS and MIME, cached immutably per git tag.

```js
// Pinned to a release (recommended):
import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@v0.1.0/dist/tabxel.js';

// Latest tag:
import { Tabxel } from 'https://cdn.jsdelivr.net/gh/brendanfuller/tabxel@latest/dist/tabxel.js';
```

## Building from source

Consumers never need Rust. Only building `dist/tabxel.js` does.

```sh
# Prerequisites (build machine only):
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
brew install binaryen           # wasm-opt (optional)

npm run build        # cargo, wasm-bindgen, wasm-opt, then inline into dist/tabxel.js
npm test             # Rust unit tests
npm run test:smoke   # headless end-to-end test (needs: npm i jsdom)
npm run serve        # open http://localhost:8080/examples/
```

## Layout

| Path                    | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `src/lib.rs`            | Rust/wasm core: payload to `.xlsx` bytes     |
| `js/extract.js`         | `HTMLTableElement` to payload (DOM + styles) |
| `js/tabxel.js`          | Public `Tabxel` class + orchestration        |
| `build/inline-wasm.mjs` | Stitches glue + wasm + JS into one ESM       |
| `dist/tabxel.js`        | Published artifact (single ESM)              |
| `examples/index.html`   | Live demo                                     |

## License

MIT
