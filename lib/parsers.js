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

/**
 * The customer, from the block under "Bill To".
 *
 * Zoho prints the customer under that label, but the invoice's right-hand column
 * — Invoice Date, Terms, Due Date — sits at almost the same height on the page,
 * and pdf.js emits rows in the order it finds them. On most layouts the name is
 * the very next row; on some, a date row lands between the label and the name.
 * Taking "the line after Bill To" read one invoice's customer as
 * "Due Date : 17 Aug 2026".
 *
 * So scan forward instead and skip what plainly isn't a company: labelled
 * fields, tax numbers, currency amounts, bare figures.
 *
 * Nothing else can catch this. A wrong name is arithmetically invisible — every
 * figure still reconciles — so it survives both save gates and lands in the
 * warehouse queue looking correct.
 */
const RIGHT_COLUMN_FIELD =
  String.raw`(?:(?:invoice|order|due)\s+date|terms|p\.?\s*o\.?\s*#|vat\s*no\.?)\s*:`;
const NOT_A_NAME = new RegExp(
  String.raw`^${RIGHT_COLUMN_FIELD}|^trn\b|^balance\s+due\b|^(?:bill|ship)\s+to\b|^aed\s*[\d,]|^[\d.,%\s-]*$`, "i");

// The right-hand column doesn't only land on its own row — sometimes it lands on
// the SAME row as the customer, giving "DELI AND MEAL LLC Due Date : 17 Aug 2026".
// Cut the row at the first labelled field.
const trimField = (s) =>
  squash(s.replace(new RegExp(String.raw`\s+${RIGHT_COLUMN_FIELD}.*$`, "i"), ""));

export function billToName(lines) {
  const at = lines.findIndex((l) => /\bBill\s+To\b/i.test(l));
  if (at < 0) return null;

  // "Bill To" sometimes shares its row with the P.O. column; the name may also
  // be on that same row. Check the remainder of the label row first.
  const sameRow = squash(lines[at].replace(/^.*?\bBill\s+To\b/i, ""));
  if (sameRow && !NOT_A_NAME.test(sameRow)) return trimField(sameRow) || null;

  for (const l of lines.slice(at + 1, at + 7)) {
    const s = squash(l);
    if (!s || NOT_A_NAME.test(s)) continue;
    return trimField(s) || null;
  }
  return null;
}


/**
 * Which emirate an address belongs to.
 *
 * The same list and the same matching the delivery app uses, so an address that
 * lands in Dubai there lands in Dubai here. Districts are included because a
 * wholesale invoice often names the area and never the emirate — "Al Quoz" and
 * "Mussafah" say where they are perfectly well to anyone who works here.
 */
export const EMIRATES = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman",
                         "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

export function emirateOf(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  // Tally prints a structured "Emirate : X" for the buyer. Where a document
  // states it outright, that beats reading the rest of the address — the two can
  // disagree, and one of these invoices has a buyer whose address line says
  // DUBAI above an Emirate field saying Sharjah.
  const stated = raw.match(/emirate\s*:\s*([A-Za-z' -]+)/i);
  if (stated) {
    const named = emirateFromWords(stated[1].toLowerCase());
    if (named) return named;
  }
  return emirateFromWords(raw.toLowerCase());
}

function emirateFromWords(t) {
  // Order matters: Al Ain and Mussafah are Abu Dhabi, and must be tested before
  // a bare "dubai" appearing elsewhere in the same string can claim them.
  if (/abu\s*dhabi|abudhabi|\bauh\b|reem island|yas island|khalifa city|mussafah|musaffah|al\s*ain/.test(t)) return "Abu Dhabi";
  if (/sharjah|\bshj\b|industrial area \d+\s*,?\s*sharjah/.test(t)) return "Sharjah";
  if (/ajman/.test(t)) return "Ajman";
  if (/umm[\s-]*al[\s-]*qu?[a-z]+|\buaq\b/.test(t)) return "Umm Al Quwain";
  if (/ras[\s-]*al[\s-]*khaimah|\brak\b|alrams|al\s*rams/.test(t)) return "Ras Al Khaimah";
  if (/fuja[ie]rah/.test(t)) return "Fujairah";
  // Dubai last of the named ones, then its districts — a Dubai district is only
  // reached when nothing else in the string claimed the address first.
  if (/dubai|\bdxb\b/.test(t)) return "Dubai";
  if (/deira|al\s*quoz|alquoz|jebel\s*ali|al\s*qusais|qusais|bur\s*dubai|karama|muraqabat|business\s*bay|jafza|ras\s*al\s*khor|international city|silicon oasis|barsha/.test(t)) return "Dubai";
  return null;
}


/**
 * The address under the Bill To name, and nothing else.
 *
 * Scoped to the buyer's own block on purpose. The seller's letterhead is at the
 * top of every one of these documents and always names an emirate, so scanning
 * the whole page would file every invoice under wherever the seller happens to
 * be rather than where the goods are going.
 */
export function billToAddress(lines, name) {
  const at = lines.findIndex((l) => /\bBill\s+To\b/i.test(l));
  if (at < 0) return null;
  const out = [];
  for (const l of lines.slice(at + 1, at + 9)) {
    const s = trimField(squash(l));
    if (!s) continue;
    // The tax numbers end the address block.
    if (/^(?:vat\s*no|trn)\b/i.test(s)) break;
    if (/^(?:taxable|#|sub\s*total|item\b)/i.test(s)) break;
    if (s === name) continue;                    // the name itself
    if (NOT_A_NAME.test(s)) continue;            // stray right-column fields
    out.push(s);
  }
  return out.join(", ") || null;
}

// ---------------------------------------------------------------------------
export function detectErp(text) {
  if (/VAT TRN\s*:/.test(text)) return "facts";
  if (/Computer Generated Invoice/i.test(text) || /Assesable Value/i.test(text)) return "tally";
  if (/S\.No\.\s+(?:Units\s+Description|Description\s+Units)/i.test(text)) return "focus";
  if (/(TAX INVOICE|SALES ORDER)/.test(text) && /TRN/.test(text)) return "zoho";
  return null;
}


/**
 * The grand total on a Zoho document — the figure the customer actually owes.
 *
 * `Total\s*AED` looks obvious and is wrong twice over, because that string turns
 * up in two other places on the same page and both of them are PRE-VAT:
 *
 *   Sub Total AED16,512.00                          ← matches inside "Sub Total"
 *   Total AED16,512.00 AED825.60 AED17,337.60       ← the Tax Details row, whose
 *                                                     first figure is the taxable
 *
 * Either one is exactly the grand total divided by 1.05, so every line on the
 * document adds up to 5% more than the total it is checked against and a
 * perfectly good invoice is refused. That is what was happening to the office:
 * four refusals in two days, every one of them out by exactly the VAT.
 *
 * So candidates are read with their context and judged, rather than trusted.
 */
function zohoGrandTotal(text) {
  const re = new RegExp(
    String.raw`([A-Za-z]*\s*)(Balance Due|Total)\s*AED\s*(${NUM})(\s*AED)?`, "gi");
  let balanceDue = null, plainTotal = null;
  for (const m of text.matchAll(re)) {
    if (/sub\s*$/i.test(m[1] || "")) continue;   // "Sub Total AED…" is pre-VAT
    if (m[4]) continue;                          // Tax Details row: more AED figures follow
    const value = num(m[3]);
    if (/balance/i.test(m[2])) balanceDue ??= value;
    else plainTotal ??= value;
  }
  // Balance Due is the customer's figure and wins where it is printed.
  return balanceDue ?? plainTotal;
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
  out.customerName = billToName(lines);
  out.customerAddress = billToAddress(lines, out.customerName);

  out.date = squash((text.match(/(?:Invoice|Order) Date\s*:\s*(.+)/) || [])[1]) || null;
  out.lpo = squash((text.match(/P\.O\.#\s*:\s*(.+)/) || [])[1]) || null;

  out.total = zohoGrandTotal(text);
  // An invoice prints "Total Taxable Amount"; a sales order prints neither, and
  // its figures live in the tax summary as "Standard Rate (5%) <taxable> <tax>".
  const taxSummary = text.match(new RegExp(String.raw`Standard Rate \(\d+%\)\s+(${NUM})\s+(${NUM})`));
  out.taxableTotal = money(text, new RegExp(String.raw`Total Taxable Amount\s*(${NUM})`))
                  ?? (taxSummary ? num(taxSummary[1]) : null);
  out.vatTotal = taxSummary ? num(taxSummary[2])
    : (out.total != null && out.taxableTotal != null
        ? Math.round((out.total - out.taxableTotal) * 100) / 100 : null);

  // Where the page states the taxable amount AND the tax independently, they add
  // up to the grand total. If the figure taken above disagrees, it was the wrong
  // one — this catches any layout not seen yet, without loosening either save
  // gate: the lines still have to add up to whatever total comes out of here.
  if (taxSummary && out.taxableTotal != null && out.vatTotal != null) {
    const stated = Math.round((out.taxableTotal + out.vatTotal) * 100) / 100;
    if (out.total == null || Math.abs(out.total - stated) > 0.02) out.total = stated;
  }

  out.lines = [];
  lines.forEach((l, i) => {
    const m = l.match(new RegExp(String.raw`^\s*(\d{1,3})\s+(.+?)\s+(${NUM}(?:\s+${NUM}){3,4})\s*$`));
    if (!m) return;
    const nums = m[3].trim().split(/\s+/).map(num);
    const [qty, rate] = nums;
    const amount = nums[nums.length - 1];
    // Descriptions wrap onto the following line, which also carries the unit and
    // the tax rate — "each (ea) 5.00%". Strip those before absorbing what is left,
    // or every description ends up with a stray percentage glued to it.
    let description = squash(m[2]);
    const cont = squash((lines[i + 1] || "")
      .replace(/\b\w+\s*\(\w+\)/g, "")     // the unit
      .replace(/[\d.]+\s*%/g, ""));           // the tax rate
    if (cont && /[A-Za-z]/.test(cont) && !/^\d/.test(cont)
        && !description.startsWith(cont.slice(0, 12))) {
      description = squash(description + " " + cont);
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
  out.customerName = squash((text.match(/Party\s+M\/S\s+(.+?)(?:\s+SI\d+\s+No|\s{2,}|$)/m) || [])[1]) || null;
  // Facts prints no customer address, but the Remarks field carries where the
  // goods are going — "Al Quoz Industrial Area 2". That IS the delivery area,
  // and it is the only thing on the page that describes the customer's location.
  out.customerAddress = squash((text.match(/^Remarks\s+(.+?)(?:\s+Mode\b.*)?$/mi) || [])[1]) || null;
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
  // Tally prints "Invoice No.  Dated" as a header and the two values a couple of
  // lines below, run together with whatever address line shares that row —
  // "Office 3807 1139 3-Aug-26". The number and the date always travel as a pair,
  // which is what makes them recoverable.
  const pair = text.match(/(\d+)\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/);
  out.docNo = pair ? pair[1] : null;
  out.date = pair ? pair[2] : ((text.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4})/) || [])[1] ?? null);
  out.customerName = squash((text.match(/Buyer\b.*\n(.+)/) || [])[1]) || null;
  // Everything between "Buyer" and the buyer's TRN. Tally prints "Emirate : X"
  // twice — once for itself in the letterhead above, once for the buyer here —
  // so the window matters more than the pattern.
  out.customerAddress = (() => {
    const at = lines.findIndex((l) => /^Buyer\b/i.test(l));
    if (at < 0) return null;
    const block = [];
    for (const l of lines.slice(at + 1, at + 10)) {
      const s = squash(l);
      if (/^TRN\s*:/i.test(s)) break;
      if (!s || s === out.customerName) continue;
      block.push(s.replace(/\s*(?:Despatch|Delivery Note|Destination|Despatched through|Buyer's Order).*$/i, "").trim());
    }
    return block.filter(Boolean).join(", ") || null;
  })();

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
// Focus — two layouts, distinguished by the column header:
//   A  "S.No. Units Description Qty Rate Gross"                (no VAT column)
//   B  "S.No. Description Units Qty Rate Gross AED VAT Amount" (VAT-bearing)
//
// Layout A carries no company at all — that is deliberate for the cash account,
// and the office is asked which one issued it. Layout B names the company and
// prints its TRN, so it identifies itself like the other systems.
// Free-of-charge lines appear in A: a quantity and no price whatsoever.
// ---------------------------------------------------------------------------
function parseFocus(lines) {
  const text = lines.join("\n");
  const vatLayout = /S\.No\.\s+Description\s+Units/i.test(text);
  // Layout B prints the line amount VAT-inclusive but the rate pre-VAT, so the
  // pre-VAT gross is the figure that satisfies qty x rate and adds up to the
  // taxable total — same convention as Facts and Tally.
  const out = { erp: "focus", reconcileAgainst: vatLayout ? "taxableTotal" : "total" };

  out.docType = /(SALES )?TAX INVOICE|SALES INVOICE/i.test(text) ? "invoice" : "sales_order";
  out.docNo = (text.match(/SI No\.\s*([A-Z]{2,4}-[\d\-/]+)/) || [])[1] ?? null;
  out.date = (text.match(/Date\s*(\d{2}-\d{2}-\d{4})/) || [])[1] ?? null;
  out.customerName = squash((text.match(/^(.+?)\s+Date\s+\d{2}-\d{2}-\d{4}/m) || [])[1]) || null;
  // Focus prints no customer address at all — not a district, not an emirate.
  // Left null rather than guessed; the office can still see it is unknown.
  out.customerAddress = null;

  // The seller's TRN may sit on the line after its label rather than beside it.
  out.sellerTrn = (text.match(/VAT TRN\s*:?\s*\n?\s*(\d{15})/) || [])[1] ?? null;
  out.sellerName = out.sellerTrn
    ? squash((text.match(/^([A-Z][A-Z\s.&]{4,})\s*$/m) || [])[1]) || null
    : null;                                  // layout A names nobody, by design
  const trns = [...text.matchAll(/TRN\s*:?\s*(\d{15})/g)].map((m) => m[1]);
  out.customerTrn = trns.find((t) => t !== out.sellerTrn) ?? null;
  out.lpo = (text.match(/PO#\s*(\S+)/) || [])[1] ?? null;

  out.total = money(text, new RegExp(String.raw`(?:^|\s)Total\s+(${NUM})\s*$`, "m"));
  if (vatLayout) {
    out.vatTotal = money(text, new RegExp(String.raw`TOTAL VAT\s*\n?\s*(${NUM})`));
    out.taxableTotal = money(text, new RegExp(String.raw`AEDTotal\s+${NUM}\s+(${NUM})`))
                    ?? money(text, new RegExp(String.raw`Total\s+${NUM}\s+(${NUM})`));
  }

  out.lines = [];
  for (const l of lines) {
    if (vatLayout) {
      // 1 <description> <UNITS> <qty> <rate> <gross> <vat> <amount>
      const m = l.match(new RegExp(
        String.raw`^\s*(\d{1,3})\s+(.+?)\s+([A-Z]{2,5})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`));
      if (!m) continue;
      out.lines.push({ sl: Number(m[1]), description: squash(m[2]), unit: m[3],
                       qty: num(m[4]), rate: num(m[5]),
                       amount: num(m[6]),            // gross, pre-VAT
                       vat: num(m[7]), amountInclVat: num(m[8]) });
    } else {
      // 1 <UNITS> <description> <qty> [<rate> <gross>]
      const m = l.match(new RegExp(
        String.raw`^\s*(\d{1,3})\s+([A-Z]+)\s+(.+?)\s+(${NUM})(?:\s+(${NUM})\s+(${NUM}))?\s*$`));
      if (!m) continue;
      out.lines.push({ sl: Number(m[1]), unit: m[2], description: squash(m[3]),
                       qty: num(m[4]), rate: m[5] ? num(m[5]) : null,
                       amount: m[6] ? num(m[6]) : null, freeOfCharge: !m[6] });
    }
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
