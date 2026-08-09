// Turning a PDF into the array of text lines the parsers expect.
//
// pdf.js hands back positioned text fragments, not lines — a single visual row
// can arrive as one run or twenty, depending on how the ERP wrote it. We group
// fragments by their y-coordinate to rebuild rows, then order each row by x.
//
// The pdf.js library is passed in rather than imported, so the browser can use
// the vendored build in ./pdfjs/ while the Node test harness injects the legacy
// build. Same code path both places — the tests exercise what actually ships.

/** Fragments closer than this vertically are treated as the same row. */
const ROW_TOLERANCE = 2.5;

/** A horizontal gap wider than this means a column boundary, not kerning. */
const COLUMN_GAP = 0.8;

/**
 * @param {ArrayBuffer} data      the PDF
 * @param {object} pdfjsLib      the pdf.js module
 * @returns {Promise<string[]>}  one string per visual row, pages concatenated
 */
export async function extractLines(data, pdfjsLib) {
  const doc = await pdfjsLib.getDocument({
    data,
    // Nothing is rendered — we only want the text layer — so skip the machinery
    // that would otherwise fetch fonts and colour profiles over the network.
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const rows = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      // Snap to a row: reuse an existing band if this fragment sits within
      // tolerance of it, otherwise start a new one.
      let key = null;
      for (const k of rows.keys()) {
        if (Math.abs(k - y) <= ROW_TOLERANCE) { key = k; break; }
      }
      if (key === null) { key = y; rows.set(key, []); }
      rows.get(key).push({ x, str: item.str, width: item.width || 0 });
    }

    // Top of the page downwards, then left to right within each row.
    const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, frags] of ordered) {
      frags.sort((a, b) => a.x - b.x);
      // Restore the gaps between fragments. Joining them directly runs adjacent
      // values together — "8.50" "0.40" "1,020.00" becomes "8.500.401,020.00",
      // which no amount of clever regex can reliably split back apart. pdf.js
      // reports each fragment's width, so a real horizontal gap becomes a space.
      let out = "";
      let cursor = null;
      for (const f of frags) {
        if (cursor !== null && f.x - cursor > COLUMN_GAP && !/\s$/.test(out) && !/^\s/.test(f.str)) {
          out += " ";
        }
        out += f.str;
        cursor = f.x + f.width;
      }
      lines.push(out.replace(/\s+$/, ""));
    }
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}

/**
 * Browser entry point: read a File and return its text lines.
 * `pdfjsLib` must already have its worker source configured.
 */
export async function linesFromFile(file, pdfjsLib) {
  const buf = await file.arrayBuffer();
  return extractLines(buf, pdfjsLib);
}
