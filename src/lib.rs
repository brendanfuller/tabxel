//! Tabxel core: turn a structured payload (extracted from an HTML table by the JS
//! layer) into real `.xlsx` bytes using `rust_xlsxwriter`.
//!
//! The DOM is never touched here — the JS binding walks the `HTMLTableElement`,
//! reads computed styles + `data-*` overrides, and serializes everything into the
//! [`Book`] shape below. This keeps the wasm module small and portable.

use std::collections::HashMap;

use rust_xlsxwriter::{
    Color, Format, FormatAlign, FormatBorder, Formula, Url, Workbook, XlsxError,
};
use serde::Deserialize;

/// Top-level payload: one workbook, many sheets. Sheet order == export order.
#[derive(Deserialize, Debug, Default)]
pub struct Book {
    pub sheets: Vec<Sheet>,
}

#[derive(Deserialize, Debug, Default)]
pub struct Sheet {
    pub name: String,
    #[serde(default)]
    pub cols: Vec<ColSpec>,
    #[serde(default)]
    pub cells: Vec<Cell>,
    /// `[first_row, first_col, last_row, last_col]` for the autofilter, if any.
    #[serde(default)]
    pub autofilter: Option<[u32; 4]>,
}

#[derive(Deserialize, Debug, Default)]
pub struct ColSpec {
    /// Excel column width (character units). `None` leaves the default width.
    #[serde(default)]
    pub width: Option<f64>,
    /// Column-level number format, e.g. `"#,##0.00"`.
    #[serde(default)]
    pub num_format: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
pub struct Cell {
    pub row: u32,
    pub col: u32,
    #[serde(default = "one")]
    pub row_span: u32,
    #[serde(default = "one")]
    pub col_span: u32,
    #[serde(default)]
    pub value: CellValue,
    #[serde(default)]
    pub style: Style,
    /// Internal hyperlink target for nested-table navigation,
    /// e.g. `"internal:'Sheet2'!A1"`.
    #[serde(default)]
    pub link: Option<String>,
}

fn one() -> u32 {
    1
}

/// Typed cell value. JS sends `{ "kind": "...", "v": ... }` (adjacently tagged).
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", content = "v", rename_all = "lowercase")]
pub enum CellValue {
    Text(String),
    Number(f64),
    Bool(bool),
    Formula(String),
    Blank,
}

impl Default for CellValue {
    fn default() -> Self {
        CellValue::Blank
    }
}

/// Cell styling. Computed-CSS baseline merged with `data-*` overrides by the JS layer.
/// Derives `Hash`/`Eq` so identical styles share one `Format` (see [`FormatCache`]).
#[derive(Deserialize, Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Style {
    /// Background fill as `#RRGGBB`.
    #[serde(default)]
    pub bg: Option<String>,
    /// Font color as `#RRGGBB`.
    #[serde(default)]
    pub font_color: Option<String>,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// `"left" | "center" | "right"`.
    #[serde(default)]
    pub align: Option<String>,
    /// `"top" | "middle" | "bottom"`.
    #[serde(default)]
    pub valign: Option<String>,
    #[serde(default)]
    pub border: bool,
    /// Cell-level Excel number format.
    #[serde(default)]
    pub num_format: Option<String>,
}

/// Caches built `Format`s keyed by `Style` so we don't rebuild identical ones.
#[derive(Default)]
struct FormatCache {
    map: HashMap<Style, Format>,
}

impl FormatCache {
    fn get(&mut self, style: &Style) -> &Format {
        self.map
            .entry(style.clone())
            .or_insert_with(|| build_format(style))
    }
}

/// Parse `#RGB` / `#RRGGBB` into a packed `0xRRGGBB` value.
fn parse_hex(s: &str) -> Option<u32> {
    let h = s.trim().trim_start_matches('#');
    match h.len() {
        6 => u32::from_str_radix(h, 16).ok(),
        3 => {
            // Expand shorthand: "abc" -> "aabbcc".
            let mut out = String::with_capacity(6);
            for ch in h.chars() {
                out.push(ch);
                out.push(ch);
            }
            u32::from_str_radix(&out, 16).ok()
        }
        _ => None,
    }
}

fn build_format(style: &Style) -> Format {
    let mut fmt = Format::new();
    if let Some(rgb) = style.bg.as_deref().and_then(parse_hex) {
        fmt = fmt.set_background_color(Color::RGB(rgb));
    }
    if let Some(rgb) = style.font_color.as_deref().and_then(parse_hex) {
        fmt = fmt.set_font_color(Color::RGB(rgb));
    }
    if style.bold {
        fmt = fmt.set_bold();
    }
    if style.italic {
        fmt = fmt.set_italic();
    }
    if let Some(a) = style.align.as_deref() {
        let align = match a {
            "center" => Some(FormatAlign::Center),
            "right" => Some(FormatAlign::Right),
            "left" => Some(FormatAlign::Left),
            _ => None,
        };
        if let Some(a) = align {
            fmt = fmt.set_align(a);
        }
    }
    if let Some(v) = style.valign.as_deref() {
        let valign = match v {
            "top" => Some(FormatAlign::Top),
            "middle" => Some(FormatAlign::VerticalCenter),
            "bottom" => Some(FormatAlign::Bottom),
            _ => None,
        };
        if let Some(v) = valign {
            fmt = fmt.set_align(v);
        }
    }
    if style.border {
        fmt = fmt.set_border(FormatBorder::Thin);
    }
    if let Some(nf) = style.num_format.as_deref() {
        fmt = fmt.set_num_format(nf);
    }
    fmt
}

/// Build the whole workbook from a [`Book`] payload and return the `.xlsx` bytes.
///
/// This is deliberately free of any wasm/JS types so it can be unit-tested natively
/// with `cargo test`.
pub fn build_workbook(book: Book) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();

    for sheet in &book.sheets {
        let mut cache = FormatCache::default();
        let worksheet = workbook.add_worksheet();
        if !sheet.name.is_empty() {
            worksheet.set_name(&sheet.name)?;
        }

        // Column widths + optional column-level number formats.
        for (i, col) in sheet.cols.iter().enumerate() {
            let c = i as u16;
            if let Some(w) = col.width {
                worksheet.set_column_width(c, w)?;
            }
            if let Some(nf) = col.num_format.as_deref() {
                let fmt = Format::new().set_num_format(nf);
                worksheet.set_column_format(c, &fmt)?;
            }
        }

        for cell in &sheet.cells {
            let row = cell.row;
            let col = cell.col as u16;
            let fmt = cache.get(&cell.style).clone();

            let merged = cell.row_span > 1 || cell.col_span > 1;
            if merged {
                let last_row = cell.row + cell.row_span.saturating_sub(1);
                let last_col = (cell.col + cell.col_span.saturating_sub(1)) as u16;
                // merge_range only takes a string; blank it, then write the typed
                // value (with the same format) into the top-left cell.
                worksheet.merge_range(row, col, last_row, last_col, "", &fmt)?;
            }

            if let Some(target) = &cell.link {
                let text = match &cell.value {
                    CellValue::Text(s) => s.clone(),
                    _ => target.clone(),
                };
                let url = Url::new(target).set_text(text);
                worksheet.write_url_with_format(row, col, url, &fmt)?;
                continue;
            }

            match &cell.value {
                CellValue::Text(s) => {
                    worksheet.write_string_with_format(row, col, s, &fmt)?;
                }
                CellValue::Number(n) => {
                    worksheet.write_number_with_format(row, col, *n, &fmt)?;
                }
                CellValue::Bool(b) => {
                    worksheet.write_boolean_with_format(row, col, *b, &fmt)?;
                }
                CellValue::Formula(f) => {
                    worksheet.write_formula_with_format(row, col, Formula::new(f), &fmt)?;
                }
                CellValue::Blank => {
                    // A merged range already carries the fill; a lone blank with a
                    // non-default style still needs the format applied.
                    if !merged && cell.style != Style::default() {
                        worksheet.write_blank(row, col, &fmt)?;
                    }
                }
            }
        }

        if let Some([r1, c1, r2, c2]) = sheet.autofilter {
            worksheet.autofilter(r1, c1 as u16, r2, c2 as u16)?;
        }
    }

    workbook.save_to_buffer()
}

/// wasm/JS entry point. Deserializes the JS payload and returns a `Uint8Array`.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn generate(payload: JsValue) -> Result<Vec<u8>, JsValue> {
        let book: super::Book = serde_wasm_bindgen::from_value(payload)
            .map_err(|e| JsValue::from_str(&format!("tabxel: invalid payload: {e}")))?;
        super::build_workbook(book).map_err(JsValue::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zip_ok(bytes: &[u8]) -> bool {
        // XLSX is a zip; it starts with the local-file-header magic "PK\x03\x04".
        bytes.len() > 4 && &bytes[0..2] == b"PK"
    }

    #[test]
    fn empty_book_still_produces_a_buffer() {
        // rust_xlsxwriter tolerates zero worksheets and emits a (minimal) file.
        // The JS layer guarantees >= 1 sheet, so this just documents the behavior.
        let bytes = build_workbook(Book::default()).expect("build ok");
        assert!(zip_ok(&bytes));
    }

    #[test]
    fn single_sheet_with_values() {
        let book = Book {
            sheets: vec![Sheet {
                name: "Sheet1".into(),
                cols: vec![ColSpec {
                    width: Some(20.0),
                    num_format: None,
                }],
                cells: vec![
                    Cell {
                        row: 0,
                        col: 0,
                        row_span: 1,
                        col_span: 1,
                        value: CellValue::Text("Hello".into()),
                        style: Style {
                            bold: true,
                            bg: Some("#FFDD00".into()),
                            ..Default::default()
                        },
                        link: None,
                    },
                    Cell {
                        row: 1,
                        col: 0,
                        row_span: 1,
                        col_span: 1,
                        value: CellValue::Number(42.5),
                        style: Style::default(),
                        link: None,
                    },
                ],
                autofilter: Some([0, 0, 1, 0]),
            }],
        };
        let bytes = build_workbook(book).expect("build ok");
        assert!(zip_ok(&bytes), "output should be a valid xlsx/zip");
    }

    #[test]
    fn merged_cells_and_hex_parsing() {
        assert_eq!(parse_hex("#FF0000"), Some(0xFF0000));
        assert_eq!(parse_hex("f0a"), Some(0xFF00AA));
        assert_eq!(parse_hex("nope"), None);

        let book = Book {
            sheets: vec![Sheet {
                name: "Merged".into(),
                cols: vec![],
                cells: vec![Cell {
                    row: 0,
                    col: 0,
                    row_span: 1,
                    col_span: 3,
                    value: CellValue::Text("Spanned header".into()),
                    style: Style {
                        align: Some("center".into()),
                        border: true,
                        ..Default::default()
                    },
                    link: None,
                }],
                autofilter: None,
            }],
        };
        let bytes = build_workbook(book).expect("build ok");
        assert!(zip_ok(&bytes));
    }
}
