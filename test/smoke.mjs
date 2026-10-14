// Headless end-to-end smoke test: boot the inlined wasm, run the full
// DOM -> payload -> xlsx pipeline via jsdom, and validate the output zip.
//
// Run: node test/smoke.mjs   (requires `npm install jsdom`)

import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const html = `<!doctype html><html><head><style>
  .good { background: rgb(217,234,211); }
  thead th { background: rgb(43,87,151); color: rgb(255,255,255); }
</style></head><body>
<table id="sales" data-sheet-name="Sales">
  <colgroup><col data-width="22"><col data-width="14" data-number-format="#,##0"></colgroup>
  <thead>
    <tr><th>Region</th><th colspan="2">Performance</th></tr>
    <tr><th>Name</th><th>Units</th><th>Revenue</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>North</td><td class="num">1200</td><td class="good">48250.5</td>
    </tr>
    <tr>
      <td>South</td><td>860</td>
      <td>
        <table id="inner" data-sheet-name="South detail">
          <thead><tr><th>Rep</th><th>Deals</th></tr></thead>
          <tbody><tr><td>Ana</td><td>7</td></tr></tbody>
        </table>
      </td>
    </tr>
    <tr><td>Total</td><td>2060</td><td data-formula="SUM(C3:C4)"></td></tr>
  </tbody>
</table>
<table id="people" data-sheet-name="People">
  <thead><tr><th>Name</th><th>Active</th></tr></thead>
  <tbody><tr><td>Alice</td><td data-type="bool">true</td></tr></tbody>
</table>
</body></html>`;

const dom = new JSDOM(html, { pretendToBeVisual: true });
// Expose the browser globals extract.js/tabxel.js expect.
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.Blob = dom.window.Blob;
globalThis.Node = dom.window.Node;
if (!globalThis.atob) globalThis.atob = (b) => Buffer.from(b, 'base64').toString('binary');

const { Tabxel } = await import('../dist/tabxel.js');

const tx = new Tabxel();
tx.addTable(document.getElementById('sales'));
tx.addTable(document.getElementById('people'));

const bytes = await tx.toUint8Array();

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  -', msg);
}

assert(bytes instanceof Uint8Array, 'generate returns a Uint8Array');
assert(bytes.length > 1000, `output is non-trivial (${bytes.length} bytes)`);
assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'output has the zip (PK) magic');

const out = '/tmp/tabxel-smoke.xlsx';
writeFileSync(out, bytes);

const list = execSync(`unzip -l ${out}`).toString();
for (const entry of [
  'xl/workbook.xml',
  'xl/worksheets/sheet1.xml',
  'xl/worksheets/sheet2.xml',
  'xl/worksheets/sheet3.xml', // Sales, South detail (nested), People
]) {
  assert(list.includes(entry), `archive contains ${entry}`);
}

// Spot-check sheet contents.
const wb = execSync(`unzip -p ${out} xl/workbook.xml`).toString();
for (const name of ['Sales', 'South detail', 'People']) {
  assert(wb.includes(name), `workbook declares sheet "${name}"`);
}

const sheet1 = execSync(`unzip -p ${out} xl/worksheets/sheet1.xml`).toString();
assert(/mergeCell[^>]*ref="B1:C1"/.test(sheet1), 'colspan header merged as B1:C1');
assert(sheet1.includes('autoFilter'), 'autofilter present on Sales');
assert(sheet1.includes('hyperlink') || /r:id/.test(sheet1), 'nested-table hyperlink present');

console.log('\nALL SMOKE CHECKS PASSED ->', out);
