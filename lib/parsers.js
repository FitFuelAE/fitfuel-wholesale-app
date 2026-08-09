// Reading a sales document out of the PDF the ERP already produced.
//
// Input is the page text as an array of lines (the office app builds these from
// pdf.js text items grouped by y-coordinate; the test harness reads them from
// fixtures). Output is one normalised shape regardless of which system wrote it.
//
// Every parser reconciles its extracted lines against the total printed on the
// document. If they disagree the document is REJECTED, not saved — an extraction
// error must never quietly become a figure in the cash position. That check has
// already caught two broken parsers during development.
//
// The four layouts have nothing in common:
//   Zoho   — OpenPDF, orderly reading order, qty on its own line
//   Facts  — Crystal Reports, whole row in one run, COLUMN ORDER VARIES per row
//   Tally  — everything concatenated without separators
//   Focus  — plain columns, but many lines are free-of-charge with no price
//            and the document carries no company at all (by design)

export const MONEY = String.raw`[\d,]+\.\d{2,4}`;

const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));
const squash = (s) => (s || "").replace(/\s+/g, " ").trim();
const money = (text, re) => { const m = text.match(re); return m ? num(m[1]) : null; };

// ---------------------------------------------------------------------------
// which system produced this?
// ---------------------------------------------------------------------------
export function detectErp(text) {
  if (/VAT TRN\s*:/.test(text) && /SI\d+\s*No/.test(text)) return "facts";
  if (/This is a Computer Generated Invoice/i.test(text)) return "tally";
  if (/S\.No\.\s*Units\s*Description/i.test(text)) return "focus";
  if (/Bill To/.test(text) && /(TAX INVOICE|SALES ORDER)/.test(text)) return "zoho";
  return null;
}

// ---------------------------------------------------------------------------
// Zoho — sequential layout, quantity on its own line above the unit
// ---------------------------------------------------------------------------
function parseZoho(lines) {
  const text = lines.join("\n");
  const out = { erp: "zoho" };

  out.docType = /^TAX INVOICE/m.test(text) ? "invoice"
              : /^SALES ORDER/m.test(text) ? "sales_order" : null;
  const dn = text.match(/Sales Order#\s*([A-Z]{2}\s*SO\/[\d/-]+)/)
          || text.match(/#\s*([A-Z]{2}\s*INV\/[\d/-]+)/);
  out.docNo = dn ? squash(dn[1]) : null;

  const trns = [...text.matchAll(/TRN\s*(\d{15})/g)].map((m) => m[1]);
  out.sellerTrn = trns[0] ?? null;
  const bill = text.match(/Bill To\s*\n(.+)/);
  out.customerName = bill ? squash(bill[1]) : null;
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;

  out.date = squash((text.match(/(?:Invoice|Order) Date\s*:\s*(.+)/) || [])[1]);
  out.lpo = squash((text.match(/P\.O\.#\s*:\s*(.+)/) || [])[1]) || null;

  out.total = money(text, new RegExp(String.raw`Balance Due\s*AED\s*(${MONEY})`))
           ?? money(text, new RegExp(String.raw`Total\s*AED\s*(${MONEY})`));
  out.taxableTotal = money(text, new RegExp(String.raw`Total Taxable Amount\s*(${MONEY})`))
                  ?? money(text, new RegExp(String.raw`Standard Rate \(\d+%\)\s+(${MONEY})\s+${MONEY}\s*$`, "m"));
  // Zoho prints each line VAT-inclusive, so the lines add up to the grand total.
  out.reconcileAgainst = "total";

  const items = [];
  const unitRe = /^\w+\s*\(\w+\)$/;
  const moneyRe = new RegExp(MONEY, "g");
  for (let i = 0; i + 2 < lines.length; i++) {
    if (!unitRe.test((lines[i + 1] || "").trim())) continue;   // unit anchors a row
    const cur = (lines[i] || "").trim();
    const nums = (lines[i + 2] || "").match(moneyRe) || [];
    if (nums.length < 2) continue;

    const alone = cur.match(/^([\d,]+\.\d+)$/);                // sales order shape
    if (alone) {
      // description wraps upward until the numbered line that starts it
      const parts = []; let j = i - 1;
      while (j >= 0 && !/^\s*\d+\s/.test(lines[j]) && parts.length < 6) {
        if (lines[j].trim()) parts.unshift(lines[j].trim());
        j--;
      }
      let full = squash((j >= 0 ? lines[j].replace(/^\s*\d+\s+/, "") : "") + " " + parts.join(" "));
      const half = full.slice(0, Math.floor(full.length / 2)).trim();   // Zoho repeats name+description
      if (half && full.startsWith(half) && full.endsWith(half)) full = half;
      items.push({ description: full, qty: num(alone[1]), unit: lines[i + 1].trim(),
                   rate: num(nums[0]), amount: num(nums[nums.length - 1]) });
      continue;
    }
    const inline = cur.match(/^\s*\d+\s+(.*?)\s+([\d,]+\.\d+)$/);        // invoice shape
    if (!inline) continue;
    const tail = lines.slice(i + 2, i + 5).join("\n").match(moneyRe) || nums;
    items.push({ description: squash(inline[1]), qty: num(inline[2]), unit: lines[i + 1].trim(),
                 rate: num(nums[0]), amount: num(tail[tail.length - 1]) });
  }
  out.lines = items;
  return out;
}

// ---------------------------------------------------------------------------
// Facts — Crystal Reports writes a whole row as one run and the column order
// is NOT stable between rows. Identify the numbers by arithmetic instead:
// exactly one triple satisfies qty x rate = amount.
// ---------------------------------------------------------------------------
function parseFacts(lines) {
  const text = lines.join("\n");
  const out = { erp: "facts", docType: /TAX INVOICE/.test(text) ? "invoice" : "sales_order" };

  out.sellerName = squash((text.match(/^(.*(?:L\.L\.C|LLC)\.?)\s*$/m) || [])[1]);
  out.sellerTrn = (text.match(/VAT TRN\s*:\s*(\d{15})/) || [])[1] ?? null;
  out.docNo = (text.match(/\*([A-Z]{2}\d+\.[\d\-/A-Z.]+)\*/) || [])[1] ?? null;
  out.customerName = squash((text.match(/Party\s+M\/S\s+(.+)/) || [])[1]);
  const trns = [...text.matchAll(/TRN\s*:?\s*(\d{15})/g)].map((m) => m[1]);
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;
  out.lpo = (text.match(/([\d]{3}-[A-Z]{3}-\d+)/) || [])[1] ?? null;
  out.paymentMode = (text.match(/Mode\s+(\w+)/) || [])[1] ?? null;
  out.date = (text.match(/(\d{2}-[A-Za-z]{3}-\d{4})/) || [])[1] ?? null;

  // Crystal prints the figure BEFORE its label on the totals block, and after it
  // in the layout-mode rendering — accept either.
  const facts_total = (label) =>
    money(text, new RegExp(String.raw`(${MONEY})\s*${label}`))
    ?? money(text, new RegExp(String.raw`${label}\s*(${MONEY})`));
  out.taxableTotal = facts_total("Gross Total");        // lines are pre-VAT
  out.vatTotal = facts_total("VAT Total");
  out.total = facts_total("Net Total");
  out.reconcileAgainst = "taxableTotal";

  const items = [];
  const moneyRe = new RegExp(MONEY, "g");
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!/\d/.test(l) || /Total/.test(l)) return;
    const nums = (l.match(moneyRe) || []).map(num);
    if (nums.length < 3) return;

    let trio = null;                                   // qty x rate = amount
    for (const a of nums) for (const b of nums) for (const c of nums) {
      if (a === b || Math.abs(a * b - c) > 0.01 || a < b) continue;
      trio = [a, b, c];
    }
    if (!trio) return;
    const [qty, rate, amount] = trio;
    const m = l.match(/(?:^|\s)(\d{1,3})\s+([A-Za-z*].*)$/);
    let description = m ? m[2].trim() : "";
    const next = (lines[i + 1] || "").trim();          // description wraps down one line
    if (next && !new RegExp(MONEY).test(next) && !/Total/.test(next)) description += " " + next;
    items.push({ sl: m ? Number(m[1]) : null, description: squash(description),
                 unit: (l.match(/\b([A-Z]{2,4})\b/) || [])[1] ?? null, qty, rate, amount });
  });
  out.lines = items;
  return out;
}

// ---------------------------------------------------------------------------
// Tally — no separators at all; fields run straight into one another
// ---------------------------------------------------------------------------
function parseTally(lines) {
  const text = lines.join("\n");
  const out = { erp: "tally", docType: /Tax Invoice/i.test(text) ? "invoice" : "sales_order" };

  out.sellerName = squash((text.match(/Tax Invoice\s*([A-Z][A-Z\s.]*?(?:LLC|L\.L\.C))/) || [])[1]);
  const trns = [...text.matchAll(/TRN\s*:\s*(\d{15})/g)].map((m) => m[1]);
  out.sellerTrn = trns[0] ?? null;
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;
  out.docNo = (text.match(/Invoice No\.\s*(\d+)/) || [])[1] ?? null;
  out.date = (text.match(/Dated\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/) || [])[1] ?? null;
  out.customerName = squash((text.match(/Buyer\s*([A-Z][A-Za-z\s&.]+?)(?:DUBAI|SHARJAH|Emirate)/) || [])[1]);

  out.taxableTotal = money(text, new RegExp(String.raw`(${MONEY})\s*OUTPUT VAT`));
  out.vatTotal = money(text, new RegExp(String.raw`OUTPUT VAT\s*[\d.]*\s*%?\s*(${MONEY})`));
  out.total = money(text, new RegExp(String.raw`Total\s*AED\s*(${MONEY})`));
  out.reconcileAgainst = "taxableTotal";

  const items = [];
  const rowRe = new RegExp(
    String.raw`(\d{1,2})(\*?[A-Za-z][^%]*?)(\d+)\s?%(${MONEY})(\w+?)(${MONEY})(${MONEY})\s*(\w+)\s*\((${MONEY})\s*(\w+)\)`, "g");
  for (const m of text.matchAll(rowRe)) {
    const [, sl, desc, vatPct, amount, , rateRaw, packQty, , ctnQty] = m;
    // "ctn138.00" — the unit and rate collide, so recover the rate arithmetically
    const amt = num(amount), qty = num(ctnQty);
    const rate = qty ? Math.round((amt / qty) * 100) / 100 : num(rateRaw);
    items.push({ sl: Number(sl), description: squash(desc), unit: "ctn",
                 qty, rate, amount: amt, vatPct: Number(vatPct), packQty: num(packQty) });
  }
  out.lines = items;
  return out;
}

// ---------------------------------------------------------------------------
// Focus — clean columns. Many lines are free of charge: quantity only, no price.
// The document carries no company; the office picks it.
// ---------------------------------------------------------------------------
function parseFocus(lines) {
  const text = lines.join("\n");
  const out = { erp: "focus", docType: /SALES INVOICE/i.test(text) ? "invoice" : "sales_order" };

  out.docNo = (text.match(/SI No\.\s*([A-Z]{2,4}-[\d\-/]+)/) || [])[1] ?? null;
  out.date = (text.match(/Date\s*(\d{2}-\d{2}-\d{4})/) || [])[1] ?? null;
  const to = text.match(/To,[\s\S]*?\n(.+?)\s*Date/);
  out.customerName = squash(to ? to[1] : null);
  // Focus documents name no company — this is deliberate for the cash account.
  out.sellerName = null; out.sellerTrn = null;
  out.total = money(text, new RegExp(String.raw`^Total\s+(${MONEY})\s*$`, "m"));
  out.reconcileAgainst = "total";

  const rowRe = new RegExp(
    String.raw`^\s*(\d{1,3})\s+([A-Z]+)\s+(.+?)\s+(${MONEY})(?:\s+(${MONEY})\s+(${MONEY}))?\s*$`);
  const items = [];
  for (const l of lines) {
    const m = l.match(rowRe);
    if (!m) continue;
    items.push({ sl: Number(m[1]), unit: m[2], description: squash(m[3]),
                 qty: num(m[4]), rate: m[5] ? num(m[5]) : null,
                 amount: m[6] ? num(m[6]) : null, freeOfCharge: !m[6] });
  }
  out.lines = items;
  return out;
}

// ---------------------------------------------------------------------------
const PARSERS = { zoho: parseZoho, facts: parseFacts, tally: parseTally, focus: parseFocus };

/**
 * Parse a document and reconcile it against its own printed total.
 *
 * Returns { ok, doc, reason }. `ok` false means DO NOT SAVE — either the layout
 * wasn't recognised, or the lines don't add up to the total on the page.
 */
export function parseDocument(lines) {
  const text = lines.join("\n");
  if (text.replace(/\s/g, "").length < 100) {
    return { ok: false, reason: "This PDF has no readable text. If it came from Zoho, use Download PDF rather than Print — printing turns the text into pictures of letters." };
  }
  const erp = detectErp(text);
  if (!erp) return { ok: false, reason: "Could not tell which system produced this document." };

  const doc = PARSERS[erp](lines);
  doc.lineCount = doc.lines.length;
  doc.linesSum = Math.round(doc.lines.reduce((t, l) => t + (l.amount || 0), 0) * 100) / 100;

  // The self-check. Each layout declares which of its printed totals the line
  // amounts should add up to — Zoho prints lines VAT-inclusive, Facts and Tally
  // pre-VAT — so guessing one rule for all of them silently mis-flags documents.
  const expected = doc[doc.reconcileAgainst] ?? doc.total ?? doc.taxableTotal;
  doc.reconciled = expected != null && Math.abs(doc.linesSum - expected) < 0.02;

  if (!doc.lineCount) return { ok: false, doc, reason: "No line items could be read from this document." };
  if (!doc.reconciled) {
    return { ok: false, doc,
      reason: `The lines add up to ${doc.linesSum.toFixed(2)} but the document says ${expected == null ? "nothing" : expected.toFixed(2)}. Not saved — please check the file.` };
  }
  return { ok: true, doc };
}
