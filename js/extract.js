// Tabxel — DOM extraction layer.
//
// Walks an HTMLTableElement into the plain `Sheet` payload the wasm core expects.
// Styling baseline comes from getComputedStyle(); `data-*` attributes override it.
// Nested <table>s are hoisted into their own sheets via the `onNested` callback.

const DEFAULT_FONT_COLOR = '#000000';

/** Convert "rgb(r,g,b)" / "rgba(r,g,b,a)" to "#RRGGBB". Returns null if transparent. */
function rgbToHex(value) {
  if (!value) return null;
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (a === 0) return null; // fully transparent — treat as "no fill"
  const hex = (n) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`.toUpperCase();
}

/** Approximate Excel column width (character units) from a pixel width. */
function pxToExcelWidth(px) {
  if (!px || px <= 0) return undefined;
  // Calibri 11 ≈ 7px per character + ~5px cell padding.
  return Math.max(1, Math.round(((px - 5) / 7) * 100) / 100);
}

/** Does this computed style describe a visible border on any side? */
function hasBorder(cs) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  return sides.some((s) => {
    const style = cs.getPropertyValue(`border-${s.toLowerCase()}-style`);
    const width = parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0;
    return style && style !== 'none' && width > 0;
  });
}

function normalizeAlign(value) {
  switch ((value || '').toLowerCase()) {
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'left':
    case 'start':
      return 'left';
    default:
      return undefined;
  }
}

/** Build the Style object for a cell: computed CSS baseline, then data-* overrides. */
function styleFor(cell) {
  const cs = getComputedStyle(cell);
  const style = {};

  const bg = rgbToHex(cs.backgroundColor);
  if (bg) style.bg = bg;

  const color = rgbToHex(cs.color);
  if (color && color !== DEFAULT_FONT_COLOR) style.font_color = color;

  const weight = parseInt(cs.fontWeight, 10);
  if (cs.fontWeight === 'bold' || (weight && weight >= 600)) style.bold = true;
  if (cs.fontStyle && cs.fontStyle.includes('italic')) style.italic = true;

  const align = normalizeAlign(cs.textAlign);
  if (align) style.align = align;

  const valign = { top: 'top', middle: 'middle', bottom: 'bottom' }[cs.verticalAlign];
  if (valign) style.valign = valign;

  if (hasBorder(cs)) style.border = true;

  // --- data-* overrides -----------------------------------------------------
  const d = cell.dataset;
  if (d.bg) style.bg = d.bg;
  if (d.color) style.font_color = d.color;
  if (d.bold !== undefined) style.bold = d.bold !== 'false';
  if (d.italic !== undefined) style.italic = d.italic !== 'false';
  if (d.align) style.align = normalizeAlign(d.align) || style.align;
  if (d.numberFormat) style.num_format = d.numberFormat;

  return style;
}

const NUMERIC_RE = /^-?\$?\s*[\d,]*\.?\d+%?$/;

/** Decide the typed CellValue for a cell given its text and data-* hints. */
function valueFor(cell, text) {
  const d = cell.dataset;
  if (d.formula !== undefined) {
    const f = d.formula.startsWith('=') ? d.formula : `=${d.formula}`;
    return { kind: 'formula', v: f };
  }
  const raw = d.value !== undefined ? d.value : text;
  const type = d.type;

  if (type === 'number' || (type === undefined && raw !== '' && NUMERIC_RE.test(raw.trim()))) {
    const n = parseFloat(String(raw).replace(/[$,%\s]/g, ''));
    if (!Number.isNaN(n)) return { kind: 'number', v: n };
  }
  if (type === 'bool') {
    return { kind: 'bool', v: /^(true|yes|1)$/i.test(raw.trim()) };
  }
  if (raw === '' || raw == null) return { kind: 'blank' };
  return { kind: 'text', v: String(raw) };
}

/** Text content of a cell, ignoring any nested <table>. */
function cellText(cell) {
  const nested = cell.querySelector('table');
  if (!nested) return cell.textContent.trim();
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('table').forEach((t) => t.remove());
  return clone.textContent.trim();
}

/**
 * Extract one table into a sheet payload.
 * @param {HTMLTableElement} table
 * @param {string} sheetName  final (already-unique) sheet name
 * @param {(nestedEl: HTMLTableElement, suggestedName: string) => string} onNested
 *        called for each nested table; returns the internal link target to store.
 */
export function extractTable(table, sheetName, onNested) {
  const rows = Array.from(table.rows); // render order across thead/tbody/tfoot
  const occupied = new Set();
  const key = (r, c) => `${r}:${c}`;
  const cells = [];
  let maxCol = 0;
  let nestedCount = 0;

  rows.forEach((tr, r) => {
    let c = 0;
    for (const el of Array.from(tr.cells)) {
      while (occupied.has(key(r, c))) c++;
      const colSpan = el.colSpan || 1;
      const rowSpan = el.rowSpan || 1;

      // Reserve the covered grid region.
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          occupied.add(key(r + dr, c + dc));
        }
      }

      const text = cellText(el);
      const style = styleFor(el);
      let value = valueFor(el, text);
      let link = null;

      const nested = el.querySelector('table');
      if (nested && onNested) {
        const base =
          nested.dataset.sheetName ||
          nested.getAttribute('aria-label') ||
          `${sheetName}_nested${++nestedCount}`;
        link = onNested(nested, base);
        // Visible cell text: existing label text, else a hint pointing at the sheet.
        if (!text) value = { kind: 'text', v: '↗ open sheet' };
        else value = { kind: 'text', v: text };
      }

      cells.push({
        row: r,
        col: c,
        row_span: rowSpan,
        col_span: colSpan,
        value,
        style,
        link,
      });

      c += colSpan;
      if (c > maxCol) maxCol = c;
    }
  });

  const colCount = maxCol;
  const cols = buildCols(table, rows, colCount);
  const autofilter = buildAutofilter(table, rows, colCount);

  return { name: sheetName, cols, cells, autofilter };
}

/** Per-column width/format specs (computed first-row width as default; <col> overrides). */
function buildCols(table, rows, colCount) {
  const cols = new Array(colCount).fill(null).map(() => ({}));

  // Default widths from the first row's rendered cell widths.
  if (rows[0]) {
    let c = 0;
    for (const el of Array.from(rows[0].cells)) {
      const w = pxToExcelWidth(el.getBoundingClientRect().width / (el.colSpan || 1));
      for (let dc = 0; dc < (el.colSpan || 1) && c < colCount; dc++, c++) {
        if (w) cols[c].width = w;
      }
    }
  }

  // Explicit <col> overrides.
  const colEls = Array.from(table.querySelectorAll('col'));
  colEls.forEach((colEl, i) => {
    if (i >= colCount) return;
    if (colEl.dataset.width) cols[i].width = parseFloat(colEl.dataset.width);
    if (colEl.dataset.numberFormat) cols[i].num_format = colEl.dataset.numberFormat;
  });

  return cols;
}

/** Autofilter rectangle over [last header row .. last row], unless disabled. */
function buildAutofilter(table, rows, colCount) {
  if (colCount === 0 || rows.length === 0) return null;
  if (table.dataset.autofilter === 'false') return null;

  let headerRows;
  if (table.dataset.headerRows !== undefined) {
    headerRows = parseInt(table.dataset.headerRows, 10) || 0;
  } else if (table.tHead) {
    headerRows = table.tHead.rows.length;
  } else {
    // Treat a leading all-<th> row as a header.
    const first = rows[0];
    const allTh = first && Array.from(first.cells).every((c) => c.tagName === 'TH');
    headerRows = allTh ? 1 : 0;
  }

  // Enable by default only when there is a header AND at least one data row.
  if (table.dataset.autofilter === undefined && headerRows === 0) return null;
  if (rows.length <= headerRows) return null;

  const firstRow = Math.max(0, headerRows - 1);
  return [firstRow, 0, rows.length - 1, colCount - 1];
}
