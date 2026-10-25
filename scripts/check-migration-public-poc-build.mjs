#!/usr/bin/env node
// Run after: npm run build --workspace=@flamenode/site
// Synthetic build output is not evidence of production visibility/cutover.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dir=path.join(root,"apps/site/dist/migration-fixture-poc");
const htmlPath=path.join(dir,"public_demo/index.html");
function fail(message){console.error("[MIG-0401 build] FAIL: "+message);process.exitCode=1;}
if(!fs.existsSync(htmlPath))fail("expected Astro public fixture HTML absent");
else {
 const html=fs.readFileSync(htmlPath,"utf8");
 if(!html.includes("Synthetic public video"))fail("expected public fixture title missing");
 if(!html.includes('data-synthetic-only="true"'))fail("output does not identify as synthetic fixture");
 if(/Synthetic private video|private_demo/i.test(html))fail("private fixture leaked to public HTML");
}
if(fs.existsSync(path.join(dir,"private_demo")))fail("private fixture produced an HTML route");
const pages=fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>fs.statSync(path.join(dir,x)).isDirectory()):[];
// `islands` is the MIG-0402 Island PoC page (it was `/` until MIG-0506 moved it here); it carries no fixture data.
const allowed=["islands","public_demo"];
if(pages.length!==allowed.length||pages.slice().sort().some((x,i)=>x!==allowed[i]))fail("unexpected public fixtures: "+pages.join(","));
if(fs.existsSync(path.join(dir,"islands/index.html"))&&/Synthetic private video|private_demo/i.test(fs.readFileSync(path.join(dir,"islands/index.html"),"utf8")))fail("private fixture leaked to the islands PoC page");
if(!process.exitCode)console.log("[MIG-0401 build] PASS: exactly one synthetic public fixture HTML output (plus the Island PoC page); private fixture denied; no production routing");
