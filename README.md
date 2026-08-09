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

Each app lives in its own folder with its own manifest and service worker, so they
have **separate PWA scopes** and can all be installed to one phone independently —
the same pattern the delivery app uses for `/driver/` and `/admin/`.

Sales order entry is Phase 2 and will land at `/sales/`.

## Backend

All three apps point at the wholesale Supabase project:

```js
const API = "https://sihvyglufmftrpwogbeq.supabase.co/functions/v1/api";
```

Project `sihvyglufmftrpwogbeq` — FitFuel org, South Asia (Mumbai), chosen for latency from Dubai.

## Still to build (Phase 1)

- **Photo + signature upload.** The driver app captures both but stores
  `PENDING_UPLOAD/...` placeholders. Needs client-side downscaling to ~150 kB and
  an upload endpoint writing to the private `wholesale-docs` bucket — port the
  approach from the delivery app's proof upload.
- **Collection screen.** `/driver/collect` is implemented server-side, including
  the pro-rata split across a drop's invoices; the driver UI for it isn't built.
- **Custody handover screen** for end of day, both the driver and storekeeper halves.
- **Office invoice entry form** — currently a stub. Needs invoice number, amount,
  VAT and PDF upload, per invoice on the order.
- **Driver dropdown** in the warehouse app — populate from a staff endpoint.
- **Icons.** `icon-512.png` is referenced but not committed; drop one in at the repo
  root and both the manifests and Apple touch icons pick it up.

## Deploying

Push to `main`. GitHub Pages redeploys automatically.

DNS: `wholesale.fitfuel.ae` on Cloudflare, **grey-cloud / DNS-only** — proxying
breaks GitHub's certificate renewal. The repo must stay public for free Pages.
