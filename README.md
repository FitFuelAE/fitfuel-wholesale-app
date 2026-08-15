# FitFuel Wholesale — PWA frontend

The four working surfaces for the wholesale operation. Static HTML, no build step,
served from GitHub Pages on **wholesale.fitfuel.ae**.

> Backend + schema: `FitFuelAE/fitfuel-wholesale-management`.
> **Nothing is shared with FitFuel Delivery** — different repo, database, domain
> and logins.

## Why static files on GitHub Pages

Same reason as the delivery app: Supabase forces `text/plain` + a `sandbox` CSP on
any HTML served from edge functions or storage on `*.supabase.co`, so the rendered
page cannot live there. JSON APIs on Supabase are fine — the pages call the `api`
edge function cross-origin.

## Layout

| Path | Who | Installs as |
|---|---|---|
| `/` | — | landing page, links to the three apps |
| `/driver/` | drivers | **WS Driver** |
| `/warehouse/` | storekeeper, pickers | **WS Store** |
| `/office/` | office staff | **WS Office** |
| `/admin/` | master, admins | **WS Admin** |

Each app lives in its own folder with its own manifest and service worker, so they
have **separate PWA scopes** and can all be installed to one phone independently —
the same pattern the delivery app uses for `/driver/` and `/admin/`.

Sales order entry is Phase 2 and will land at `/sales/`.

## The driver app is complete

Photos are downscaled on the phone (long edge 1600px, JPEG quality stepped down
until under ~150 kB) and uploaded to the private `wholesale-docs` bucket via
`POST /upload`. The signature pad exports the same way. Payment capture proposes
the pro-rata split across the drop's invoices — matching the server's own
calculation — and blocks submission if an edited split doesn't add up.

## Backend

All three apps point at the wholesale Supabase project:

```js
const API = "https://sihvyglufmftrpwogbeq.supabase.co/functions/v1/api";
```

Project `sihvyglufmftrpwogbeq` — FitFuel org, South Asia (Mumbai), chosen for latency from Dubai.

## Reading the ERP's PDFs

The office uploads the PDF it already produces; the app reads the company,
customer, line items and totals off it. No customer or product master to keep.

- `lib/pdfjs/` — Mozilla pdf.js, vendored (no CDN reachable from Pages)
- `lib/pdf-text.js` — groups pdf.js fragments into rows, restoring column gaps
- `lib/parsers.js` — one parser per ERP, each reconciling against the document

A document is only saved when every priced row satisfies quantity x rate =
amount **and** the rows add up to the total printed on the page. Otherwise the
office is told why, and nothing is written.

**From Zoho use Download PDF, never Print.** Printing converts the characters to
vector outlines and there is no text left to read; the app says so plainly rather
than failing obscurely.

## Still to build

- **Sales order entry** (Phase 2) — salesmen still send orders by WhatsApp. Lands
  at `/sales/`; the API route (`POST /orders`) is already there and tested.
- **Icons.** `icon-512.png` is referenced but not committed; drop one in at the repo
  root and both the manifests and Apple touch icons pick it up.

## Before every push that touches `lib/`

```bash
node scripts/stamp-version.mjs
```

It stamps a new build version into the module imports (`?v=…`), the version shown
in each app's header, and the service-worker cache names.

This is not housekeeping. `lib/parsers.js` was served under an unversioned URL
with a ten-minute cache, so a **fixed parser looked broken twice** — the file was
deployed, the browser kept using the old one, and the failure log recorded a
version number I had forgotten to bump, which made it look current. A version
that is not bumped is worse than no version, because it lies.

## Deploying

Push to `main`. GitHub Pages redeploys automatically.

DNS: `wholesale.fitfuel.ae` on Cloudflare, **grey-cloud / DNS-only** — proxying
breaks GitHub's certificate renewal. The repo must stay public for free Pages.
