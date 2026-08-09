// Reading a sales document out of the PDF the ERP already produced.
//
// Input is the page text as lines, built by ../lib/pdf-text.js from pdf.js
// fragments. Output is one normalised shape whichever system wrote it.
//
// TWO checks decide whether a document may be saved, and both had to exist:
//
//   1. Per row — quantity x rate must equal the row's amount. Without this a
//      totals line gets mistaken for an item, and if its value happens to equal
//      the document total the second check passes on garbage. That is not
//      hypothetical; it happened during development.
//   2. Per document — the rows must add up to the total printed on the page.
//
// Fail either and the document is REJECTED, not saved. An extraction error must
// never quietly become a figure in the cash position.
//
// Line amounts mean different things per system: Zoho prints them VAT-inclusive,
// Facts and Tally pre-VAT. Each parser declares its own `reconcileAgainst`, since
// one shared rule silently mis-flags half the documents as broken.

const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?`;

const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));
const squash = (s) => (s || "").replace(/\s+/g, " ").trim();
const money = (text, re) => { const m = text.match(re); return m ? num(m[1]) : null; };
const trailingNums = (line) => {
  const m = line.match(new RegExp(String.raw`((?:${NUM}\s+)*${NUM})\s*%?\s*$`));
  return m ? m[1].trim().split(/\s+/).map(num) : [];
};

// ---------------------------------------------------------------------------
export function detectErp(text) {
  if (/VAT TRN\s*:/.test(text)) return "facts";
  if (/Computer Generated Invoice/i.test(text) || /Assesable Value/i.test(text)) return "tally";
  if (/S\.No\.\s+Units\s+Description/i.test(text)) return "focus";
  if (/(TAX INVOICE|SALES ORDER)/.test(text) && /TRN/.test(text)) return "zoho";
  return null;
}

// ---------------------------------------------------------------------------
// Zoho — "1 <description> <qty> <rate> <taxable|tax%> <vat> <total>"
// ---------------------------------------------------------------------------
function parseZoho(lines) {
  const text = lines.join("\n");
  const out = { erp: "zoho", reconcileAgainst: "total" };   // rows are VAT-inclusive

  out.docType = /TAX INVOICE/.test(text) ? "invoice"
              : /SALES ORDER/.test(text) ? "sales_order" : null;
  out.docNo = squash((text.match(/(?:Sales Order#|#)\s*([A-Z]{2}\s*(?:SO|INV)\/[\d/-]+)/) || [])[1]) || null;

  const trns = [...text.matchAll(/TRN\s*(\d{15})/g)].map((m) => m[1]);
  out.sellerTrn = trns[0] ?? null;
  out.sellerName = squash((text.match(/^(.*(?:LLC|L\.L\.C).*)$/m) || [])[1]) || null;
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;
  out.customerName = squash((text.match(/Bill To\s*\n(.+)/) || [])[1]) || null;

  out.date = squash((text.match(/(?:Invoice|Order) Date\s*:\s*(.+)/) || [])[1]) || null;
  out.lpo = squash((text.match(/P\.O\.#\s*:\s*(.+)/) || [])[1]) || null;

  out.total = money(text, new RegExp(String.raw`Balance Due\s*AED\s*(${NUM})`))
           ?? money(text, new RegExp(String.raw`Total\s*AED\s*(${NUM})`));
  out.taxableTotal = money(text, new RegExp(String.raw`Total Taxable Amount\s*(${NUM})`));
  out.vatTotal = out.total != null && out.taxableTotal != null
    ? Math.round((out.total - out.taxableTotal) * 100) / 100 : null;

  out.lines = [];
  lines.forEach((l, i) => {
    const m = l.match(new RegExp(String.raw`^\s*(\d{1,3})\s+(.+?)\s+(${NUM}(?:\s+${NUM}){3,4})\s*$`));
    if (!m) return;
    const nums = m[3].trim().split(/\s+/).map(num);
    const [qty, rate] = nums;
    const amount = nums[nums.length - 1];
    // Descriptions wrap onto the following line, which Zoho then repeats.
    let description = squash(m[2]);
    const next = squash(lines[i + 1] || "");
    if (next && !/^\d/.test(next) && !description.startsWith(next.slice(0, 12))) {
      description = squash(description + " " + next.replace(/each\s*\(ea\)/i, ""));
    }
    out.lines.push({ sl: Number(m[1]), description, qty, rate, amount });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Facts — "1 <description> <UOM> <qty> <rate> <vat> <amount>"
// ---------------------------------------------------------------------------
function parseFacts(lines) {
  const text = lines.join("\n");
  const out = { erp: "facts", reconcileAgainst: "taxableTotal" };  // rows are pre-VAT

  out.docType = /TAX INVOICE/.test(text) ? "invoice" : "sales_order";
  out.sellerName = squash((text.match(/^(.*(?:L\.L\.C|LLC)\.?)\s*$/m) || [])[1]) || null;
  out.sellerTrn = (text.match(/VAT TRN\s*:\s*(\d{15})/) || [])[1] ?? null;
  out.docNo = (text.match(/\*([A-Z]{2}\d+\.[\d\-/A-Z.]+)\*/) || [])[1] ?? null;
  out.customerName = squash((text.match(/Party\s+M\/S\s+(.+?)(?:\s{2,}|$)/m) || [])[1]) || null;
  const trns = [...text.matchAll(/TRN\s*:?\s*(\d{15})/g)].map((m) => m[1]);
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;
  out.lpo = (text.match(/(\d{3}-[A-Z]{3}-\d+)/) || [])[1] ?? null;
  out.paymentMode = (text.match(/Mode\s+(\w+)/) || [])[1] ?? null;
  out.date = (text.match(/(\d{2}-[A-Za-z]{3}-\d{4})/) || [])[1] ?? null;

  out.taxableTotal = money(text, new RegExp(String.raw`Gross Total\s*(${NUM})`));
  out.vatTotal = money(text, new RegExp(String.raw`VAT Total\s*(${NUM})`));
  out.total = money(text, new RegExp(String.raw`Net Total\s*(${NUM})`));

  out.lines = [];
  lines.forEach((l, i) => {
    const m = l.match(new RegExp(
      String.raw`^\s*(\d{1,3})\s+(.+?)\s+([A-Z]{2,4})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`));
    if (!m) return;
    let description = squash(m[2]);
    const next = squash(lines[i + 1] || "");
    if (next && !/^\d/.test(next) && !/Total/i.test(next)) description += " " + next;
    out.lines.push({ sl: Number(m[1]), description: squash(description), unit: m[3],
                     qty: num(m[4]), rate: num(m[5]), vat: num(m[6]), amount: num(m[7]) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Tally — "1 <description> <packQty> <packUnit> <rate> <unit> <amount> <vat> %"
// with the carton quantity on the following line as "(50.00 ctn)"
// ---------------------------------------------------------------------------
function parseTally(lines) {
  const text = lines.join("\n");
  const out = { erp: "tally", reconcileAgainst: "taxableTotal" };  // rows are pre-VAT

  out.docType = /Tax Invoice/i.test(text) ? "invoice" : "sales_order";
  out.sellerName = squash((text.match(/^([A-Z][A-Z\s.]*(?:LLC|L\.L\.C))\s*$/m) || [])[1]) || null;
  const trns = [...text.matchAll(/TRN\s*:\s*(\d{15})/g)].map((m) => m[1]);
  out.sellerTrn = trns[0] ?? null;
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;
  out.docNo = (text.match(/Invoice No\.?\s*\n?\s*(\d+)/) || [])[1] ?? null;
  out.date = (text.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4})/) || [])[1] ?? null;
  out.customerName = squash((text.match(/Buyer\s*\n(.+)/) || [])[1]) || null;

  const sum = text.match(new RegExp(String.raw`Total\s+(${NUM})\s+(${NUM})`));
  out.taxableTotal = sum ? num(sum[1]) : null;
  out.vatTotal = sum ? num(sum[2]) : null;
  out.total = money(text, new RegExp(String.raw`AED\s*(${NUM})\s*$`, "m"));

  out.lines = [];
  lines.forEach((l, i) => {
    const m = l.match(new RegExp(
      String.raw`^\s*(\d{1,3})\s+(.+?)\s+(${NUM})\s+(\w+)\s+(${NUM})\s+(\w+)\s+(${NUM})\s+(\d+)\s*%\s*$`));
    if (!m) return;
    // The carton quantity follows in brackets — but a long description wraps
    // first, so it can be one or two lines further down. Anything between the
    // row and the bracket is the rest of the description.
    let ctn = [], description = squash(m[2]);
    for (let k = 1; k <= 3 && i + k < lines.length; k++) {
      const cand = squash(lines[i + k]);
      const hit = cand.match(new RegExp(String.raw`^\((${NUM})\s*(\w+)\)$`));
      if (hit) { ctn = hit; break; }
      // Only a genuine next row stops the scan. A description continuation can
      // legitimately begin with a digit — "330ml" is part of a product name.
      if (/^\d{1,3}\s+\S/.test(cand) || /Total/i.test(cand)) break;
      if (cand && cand !== "continued ...") description += " " + cand;
    }
    const qty = ctn[1] ? num(ctn[1]) : num(m[3]);
    out.lines.push({ sl: Number(m[1]), description: squash(description),
                     packQty: num(m[3]), packUnit: m[4],
                     rate: num(m[5]), unit: ctn[2] || m[6],
                     amount: num(m[7]), vatPct: Number(m[8]), qty });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Focus — "1 <UNITS> <description> <qty> [<rate> <gross>]"
// Free-of-charge lines carry a quantity and no price at all.
// The document names no company; the office picks it.
// ---------------------------------------------------------------------------
function parseFocus(lines) {
  const text = lines.join("\n");
  const out = { erp: "focus", reconcileAgainst: "total", sellerName: null, sellerTrn: null };

  out.docType = /SALES INVOICE/i.test(text) ? "invoice" : "sales_order";
  out.docNo = (text.match(/SI No\.\s*([A-Z]{2,4}-[\d\-/]+)/) || [])[1] ?? null;
  out.date = (text.match(/Date\s*(\d{2}-\d{2}-\d{4})/) || [])[1] ?? null;
  out.customerName = squash((text.match(/^(.+?)\s+Date\s+\d{2}-\d{2}-\d{4}/m) || [])[1]) || null;
  out.total = money(text, new RegExp(String.raw`^Total\s+(${NUM})\s*$`, "m"));

  out.lines = [];
  for (const l of lines) {
    const m = l.match(new RegExp(
      String.raw`^\s*(\d{1,3})\s+([A-Z]+)\s+(.+?)\s+(${NUM})(?:\s+(${NUM})\s+(${NUM}))?\s*$`));
    if (!m) continue;
    out.lines.push({ sl: Number(m[1]), unit: m[2], description: squash(m[3]),
                     qty: num(m[4]), rate: m[5] ? num(m[5]) : null,
                     amount: m[6] ? num(m[6]) : null, freeOfCharge: !m[6] });
  }
  return out;
}

// ---------------------------------------------------------------------------
const PARSERS = { zoho: parseZoho, facts: parseFacts, tally: parseTally, focus: parseFocus };

/**
 * Parse and validate. Returns { ok, doc, reason }.
 * `ok: false` means DO NOT SAVE.
 */
export function parseDocument(lines) {
  const text = lines.join("\n");
  if (text.replace(/\s/g, "").length < 100) {
    return { ok: false, reason: "This PDF has no readable text. If it came from Zoho, use Download PDF rather than Print — printing turns the characters into pictures of letters." };
  }
  const erp = detectErp(text);
  if (!erp) return { ok: false, reason: "Could not tell which system produced this document." };

  const doc = PARSERS[erp](lines);

  // Row check: a priced row must satisfy quantity x rate = amount. This is what
  // stops a totals line being counted as an item.
  doc.lines = doc.lines.filter((l) => {
    if (l.amount == null || l.rate == null || l.qty == null) return true;   // free-of-charge
    return Math.abs(l.qty * l.rate - l.amount) < 0.02;
  });

  doc.lineCount = doc.lines.length;
  doc.linesSum = Math.round(doc.lines.reduce((t, l) => t + (l.amount || 0), 0) * 100) / 100;

  if (!doc.lineCount) return { ok: false, doc, reason: "No line items could be read from this document." };

  const expected = doc[doc.reconcileAgainst] ?? doc.total ?? doc.taxableTotal;
  doc.reconciled = expected != null && Math.abs(doc.linesSum - expected) < 0.02;
  if (!doc.reconciled) {
    return { ok: false, doc, reason:
      `The ${doc.lineCount} line${doc.lineCount === 1 ? "" : "s"} add up to ${doc.linesSum.toFixed(2)} but the document says ${expected == null ? "nothing" : expected.toFixed(2)}. Not saved — please check the file.` };
  }
  return { ok: true, doc };
}
