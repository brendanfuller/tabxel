// Type declarations for Tabxel's public API (dist/tabxel.js).
// Hand-written: the surface is small and stable.

/** Options for registering a table as a sheet. */
export interface AddTableOptions {
  /**
   * Explicit worksheet name. Overrides the table's `data-sheet-name`.
   * Excel rules apply (<=31 chars; `[ ] : * ? / \` are stripped; made unique).
   */
  sheetName?: string;
}

/**
 * Builds an `.xlsx` workbook from one or more HTML `<table>` elements.
 *
 * The first registered table becomes Sheet 1; each additional table becomes a
 * further sheet. Cell styling is read from `getComputedStyle()` and can be
 * overridden with `data-*` attributes (see the README for the full reference).
 *
 * @example
 * ```ts
 * const tx = new Tabxel();
 * tx.addTable(document.querySelector('#report')!);
 * tx.addTable(q2Table, { sheetName: 'Q2' });
 * await tx.download('report.xlsx');
 * ```
 */
export declare class Tabxel {
  constructor();

  /**
   * Register a table. Chainable. The table should be attached to the rendered
   * document so computed styles and column widths can be read.
   * @throws {TypeError} if `el` is not an `HTMLTableElement`.
   */
  addTable(el: HTMLTableElement, options?: AddTableOptions): this;

  /** Shortcut for `new Tabxel().addTable(el, options)`. */
  static fromTable(el: HTMLTableElement, options?: AddTableOptions): Tabxel;

  /** Generate the raw `.xlsx` bytes. */
  toUint8Array(): Promise<Uint8Array>;

  /** Generate the `.xlsx` as a `Blob` with the correct spreadsheet MIME type. */
  toBlob(): Promise<Blob>;

  /**
   * Generate the `.xlsx` and trigger a browser download.
   * @param filename defaults to `"tabxel.xlsx"`; a `.xlsx` extension is ensured.
   * @throws if called outside a browser DOM.
   */
  download(filename?: string): Promise<void>;
}

/**
 * Bind the wasm backend (the `generate` function and a readiness promise).
 * The single-file build calls this automatically after booting the inlined
 * wasm; you only need it for custom (e.g. separate-`.wasm`) bootstraps.
 */
export declare function bindWasm(
  generateFn: (payload: unknown) => Uint8Array,
  readyPromise?: Promise<unknown>,
): void;
