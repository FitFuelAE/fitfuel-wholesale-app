#!/usr/bin/env node
// Stamps a build version across the apps.
//
//   node scripts/stamp-version.mjs            # stamps today's date + a counter
//   node scripts/stamp-version.mjs 2026-08-13.2
//
// Run this before every push that touches lib/. Two things depend on it:
//
//   1. The module imports carry `?v=<version>`, so a changed library is a
//      different URL and the browser cannot serve a stale copy. Without it an
//      unversioned lib/parsers.js sat in cache for ten minutes and a fixed
//      parser appeared not to work — twice.
//   2. The header shows the version, so "which build is this browser running?"
//      is answerable, and a refused document records it.
//
// A version that is not bumped is worse than none, because it looks current.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["driver", "office", "warehouse", "admin"];

function nextVersion(existing) {
  const today = new Date().toISOString().slice(0, 10);
  const used = existing
    .map((v) => (v?.startsWith(today) ? Number(v.split(".").pop()) : 0))
    .filter(Number.isFinite);
  return `${today}.${Math.max(0, ...used) + 1}`;
}

const current = APPS.map((a) => {
  const html = readFileSync(join(ROOT, a, "index.html"), "utf8");
  return html.match(/const APP_VERSION = "([^"]+)"/)?.[1];
});
const version = process.argv[2] || nextVersion(current);

let touched = 0;
for (const app of APPS) {
  const file = join(ROOT, app, "index.html");
  let html = readFileSync(file, "utf8");
  const before = html;

  // Version every local module import so a changed library is a new URL.
  html = html.replace(/from "(\.\.\/lib\/[^"?]+)(\?v=[^"]*)?"/g, `from "$1?v=${version}"`);
  html = html.replace(/workerSrc = "(\.\.\/lib\/[^"?]+)(\?v=[^"]*)?"/g, `workerSrc = "$1?v=${version}"`);

  if (/const APP_VERSION = "[^"]*"/.test(html)) {
    html = html.replace(/const APP_VERSION = "[^"]*"/, `const APP_VERSION = "${version}"`);
  } else {
    html = html.replace(/(const API = "[^"]*";)/, `$1\nconst APP_VERSION = "${version}";`);
  }

  // The service-worker cache name carries it too, so an old shell is discarded.
  const swFile = join(ROOT, app, "sw.js");
  let sw = readFileSync(swFile, "utf8");
  sw = sw.replace(/const CACHE = "[^"]*"/, `const CACHE = "ffws-${app}-${version}"`);
  writeFileSync(swFile, sw);

  if (html !== before) touched++;
  writeFileSync(file, html);
}

console.log(`stamped ${version} across ${touched} app(s) and ${APPS.length} service worker(s)`);
