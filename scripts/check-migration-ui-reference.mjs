#!/usr/bin/env node
// Validate the visual-source join without creating a second UX/FN ledger.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const classes = new Set(["VISUAL_SCREEN", "COMPAT_REDIRECT", "DEV_ONLY", "SYSTEM_SURFACE"]);
const clean = value => value.trim().replaceAll("`", "");
const cells = line => line.split("|").slice(1, -1).map(clean);

export function validateUiReference({ uiText, currentRoutesText, mappingText, pages, artifactExists }) {
  const errors = [];
  const state = uiText.match(/^> Status:\s*`?([A-Z_]+)/m)?.[1];
  if (!["REGISTERED_HTML", "PENDING_HTML"].includes(state)) errors.push("UI reference has an unknown registration state");
  if (state === "PENDING_HTML") return errors;
  if (!uiText.includes("CURRENT_SCREEN_MAPPING") || !uiText.includes("(screen-mapping/README.md)")) {
    errors.push("UI reference must delegate UX/FN contracts to CURRENT_SCREEN_MAPPING");
  }
  if (/\b(?:UX|FN)-[A-Z]+-\d{3}\b/.test(uiText)) {
    errors.push("UI reference must not duplicate UX/FN IDs; use the canonical screen mapping");
  }
  const current = new Map();
  for (const line of currentRoutesText.split("\n")) {
    const c = cells(line);
    if (classes.has(c[2])) current.set(c[0], { source: c[1], kind: c[2] });
  }
  for (const kind of classes) {
    const reported = currentRoutesText.match(new RegExp("^(?:CURRENT )?" + kind + "\\s+(\\d+)", "m"))?.[1];
    const actual = [...current.values()].filter(row => row.kind === kind).length;
    if (reported !== undefined && Number(reported) !== actual) errors.push("CURRENT route classification count mismatch: " + kind);
  }
  const reportedTotal = currentRoutesText.match(/^app\/\*\*\/page\.tsx\s+(\d+)/m)?.[1];
  if (reportedTotal !== undefined && Number(reportedTotal) !== current.size) errors.push("CURRENT route total count mismatch");
  const mocks = new Map();
  for (const page of pages) {
    if (mocks.has(page.name)) errors.push("duplicate mock name: " + page.name);
    mocks.set(page.name, page);
    for (const field of ["source", "html_live", "html_static", "screenshot_desktop", "screenshot_mobile"]) {
      const value = page[field];
      if (!value) continue;
      if (typeof value !== "string" || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
        errors.push(page.name + ": invalid artifact path " + field);
      } else if (artifactExists && !artifactExists(value)) errors.push(page.name + ": missing artifact " + value);
    }
  }
  const seen = new Set(), disposed = new Set();
  let table = "";
  for (const line of uiText.split("\n")) {
    const c = cells(line);
    if (c[0] === "CURRENT route" && c[1] === "Class") { table = "routes"; continue; }
    if (c[0] === "Mock" && c[1] === "Disposition") { table = "reference"; continue; }
    if (c[0] === "Mock" && c[1] === "Visual policy") { table = "parts"; continue; }
    if (!line.startsWith("|")) { table = ""; continue; }
    if (!c.length || /^-+$/.test(c[0])) continue;
    if (table === "routes") {
      const [route, kind, policy, refs] = c;
      if (seen.has(route)) errors.push("duplicate UI route: " + route);
      seen.add(route);
      const source = current.get(route);
      if (!source) { errors.push("unknown CURRENT route in UI reference: " + route); continue; }
      if (kind !== source.kind) errors.push(route + ": CURRENT class mismatch");
      const expected = kind === "COMPAT_REDIRECT" ? "PRESERVE_REDIRECT"
        : kind === "DEV_ONLY" ? "DEV_ONLY"
        : route === "/maintenance" ? "PUBLIC_MOCK"
        : kind === "SYSTEM_SURFACE" ? "PRESERVE_SYSTEM"
        : source.source.startsWith("app/(public)/") ? "PUBLIC_MOCK" : "CURRENT_UI_REUSE";
      if (policy !== expected) errors.push(route + ": expected visual policy " + expected);
      if (kind === "VISUAL_SCREEN" && !mappingText.includes("`" + route + "`")) {
        errors.push(route + ": missing canonical screen mapping");
      }
      const names = refs === "—" ? [] : (refs || "").split(",").map(clean);
      if (expected === "PUBLIC_MOCK" && !names.length) errors.push(route + ": public mock required");
      for (const name of names) {
        if (!mocks.has(name)) errors.push(route + ": unknown mock " + name);
        else {
          disposed.add(name);
          if (expected === "PUBLIC_MOCK" && mocks.get(name).route !== route) errors.push(route + ": wrong public mock " + name);
        }
      }
    } else if (table === "reference" || table === "parts") {
      const [name, policy] = c;
      const mock = mocks.get(name);
      if (!mock) { errors.push("unknown mock disposition: " + name); continue; }
      disposed.add(name);
      if (table === "reference") {
        if (policy !== "REFERENCE_ONLY" || current.has(mock.route)) errors.push(name + ": invalid reference-only disposition");
      } else {
        const expected = ["PublicHeader", "PublicFooter"].includes(name) ? "PUBLIC_MOCK" : "CURRENT_UI_REUSE";
        if (mock.group !== "共通パーツ" || policy !== expected) errors.push(name + ": invalid shared-part visual policy");
      }
    }
  }
  for (const route of current.keys()) if (!seen.has(route)) errors.push("UI reference missing CURRENT route: " + route);
  for (const name of mocks.keys()) if (!disposed.has(name)) errors.push("UI reference missing mock disposition: " + name);
  return errors;
}

export function readUiReferenceInputs(root) {
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  return {
    uiText: read("docs/migration/UI_REFERENCE.md"),
    currentRoutesText: read("docs/migration/CURRENT_ROUTES.md"),
    mappingText: read("docs/migration/screen-mapping/README.md"),
    pages: JSON.parse(read("docs/migration/mock/pages.json")).pages,
    artifactExists: file => fs.existsSync(path.join(root, "docs/migration/mock", file)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = validateUiReference(readUiReferenceInputs(root));
  if (errors.length) { errors.forEach(e => console.error("[migration:ui-reference] " + e)); process.exitCode = 1; }
  else console.log("[migration:ui-reference] OK: CURRENT route, mock and visual-policy joins");
}
