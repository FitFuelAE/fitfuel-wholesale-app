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

## Still to build (Phase 1)

- **Office invoice entry form** — currently a stub. Needs invoice number, amount,
  VAT and PDF upload, per invoice on the order.
- **Icons.** `icon-512.png` is referenced but not committed; drop one in at the repo
  root and both the manifests and Apple touch icons pick it up.

## Deploying

Push to `main`. GitHub Pages redeploys automatically.

DNS: `wholesale.fitfuel.ae` on Cloudflare, **grey-cloud / DNS-only** — proxying
breaks GitHub's certificate renewal. The repo must stay public for free Pages.
