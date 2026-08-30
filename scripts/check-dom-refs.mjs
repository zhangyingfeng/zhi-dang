#!/usr/bin/env node
// Cheap, static guard against the exact class of bug that shipped in 1.1.0:
// public/app.js's $(id) helper (a thin wrapper over
// document.getElementById) referencing an id that doesn't actually exist in
// public/index.html — e.g. because the element was removed in a refactor but
// a reference to it was left behind. $("reveal") after the export/reveal
// button merge is exactly this. Complements, but doesn't replace, the jsdom
// tests in test/app.test.ts: this check only needs the static text of both
// files, so it also catches dead references in code paths those tests don't
// happen to exercise.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const appJs = readFileSync(path.join(root, "public/app.js"), "utf8");
const html = readFileSync(path.join(root, "public/index.html"), "utf8");

const htmlIds = new Set([...html.matchAll(/\bid="([a-zA-Z0-9-]+)"/g)].map((m) => m[1]));
const referenced = new Set([...appJs.matchAll(/\$\("([a-zA-Z0-9-]+)"\)/g)].map((m) => m[1]));

const missing = [...referenced].filter((id) => !htmlIds.has(id));
if (missing.length) {
  console.error(`public/app.js references element id(s) that don't exist in public/index.html: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`OK: all ${referenced.size} $("...") references in app.js exist in index.html.`);
