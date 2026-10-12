#!/usr/bin/env node
// Run after: npm run build --workspace=@flamenode/site
// Synthetic build output is not evidence of production visibility/cutover.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dir=path.join(root,"apps/site/dist/__migration_poc");
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
if(pages.length!==1||pages[0]!=="public_demo")fail("unexpected public fixtures: "+pages.join(","));
if(!process.exitCode)console.log("[MIG-0401 build] PASS: exactly one synthetic public HTML output; private fixture denied; no production routing");
