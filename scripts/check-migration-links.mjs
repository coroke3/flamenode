#!/usr/bin/env node
// Validate links between migration Markdown documents (not remote HTTP URLs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export function listMarkdownFiles(root,rel="docs/migration") {
  const abs=path.join(root,rel);
  const out=[];
  for(const item of fs.readdirSync(abs,{withFileTypes:true})) {
    const next=path.posix.join(rel,item.name);
    if(item.isDirectory())out.push(...listMarkdownFiles(root,next));
    else if(item.isFile() && item.name.endsWith(".md"))out.push(next);
  }
  return out;
}
export function validateLinks({root,documents}) {
  const errors=[];
  for(const filename of documents) {
    const content=fs.readFileSync(path.join(root,filename),"utf8");
    // Check Markdown inline relative paths. Code fences and HTTP links are not file targets.
    for(const match of content.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      let target=match[1].trim().replace(/^<|>$/g,"");
      if(!target||target.startsWith("#")||/^(?:https?:|mailto:|data:)/i.test(target))continue;
      target=target.split("#")[0].split("?")[0];
      const resolved=path.resolve(target.startsWith("/")?root:path.dirname(path.join(root,filename)),target.replace(/^\//,""));
      if(!resolved.startsWith(root+path.sep)) {
        errors.push(filename+": link outside repository: "+target);
        continue;
      }
      if(!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
        errors.push(filename+": broken relative link: "+target);
    }
  }
  return errors;
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked) {
  const documents=listMarkdownFiles(ROOT);
  const errors=validateLinks({root:ROOT,documents});
  for(const e of errors)console.error("[migration-links] "+e);
  if(errors.length)process.exitCode=1;
  else console.log("[migration-links] PASS: "+documents.length+" migration documents have valid relative file links");
}
