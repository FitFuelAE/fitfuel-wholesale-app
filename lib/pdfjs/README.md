# pdf.js (vendored)

Mozilla pdf.js `pdfjs-dist@4.10.38`, Apache-2.0, committed here rather than loaded
from a CDN because the app must work from GitHub Pages with no external requests.

Only two files are needed:
- `pdf.min.mjs`        — the library
- `pdf.worker.min.mjs` — the worker it spawns

Used solely to pull the **text layer** out of an ERP's PDF. Nothing is rendered:
no canvas, no images, no fonts. See `../parsers.js` for what happens to the text.

To update: `npm pack pdfjs-dist@<version>` and copy the same two files from
`package/build/`.
