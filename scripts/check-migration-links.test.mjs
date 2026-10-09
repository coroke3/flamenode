import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {validateLinks,listMarkdownFiles} from "./check-migration-links.mjs";

function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"flamenode-md-links-"));
 try{
  fs.mkdirSync(path.join(root,"docs/migration/deep"),{recursive:true});
  fs.writeFileSync(path.join(root,"docs/migration/README.md"),"# Entry\n[child](deep/CHILD.md)\n[external](https://github.com)\n");
  fs.writeFileSync(path.join(root,"docs/migration/deep/CHILD.md"),"# Child\n[parent](../README.md)\n");
  return run(root);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
}
test("enumerates nested migration Markdown files and resolves reciprocal links",()=>fixture(root=>{
 const docs=listMarkdownFiles(root);
 assert.equal(docs.length,2);
 assert.deepEqual(validateLinks({root,documents:docs}),[]);
}));
test("detects broken relative links without requiring remote HTTP access",()=>fixture(root=>{
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n[missing](nothing.md)\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.match(errors.join("\n"),/broken relative link: nothing.md/);
}));
test("does not treat a fragment-only URL as a local file",()=>fixture(root=>{
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n[heading](#entry)\n");
 assert.deepEqual(validateLinks({root,documents:listMarkdownFiles(root)}),[]);
}));
test("does not permit relative links escaping the repository",()=>fixture(root=>{
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n[escape](../../../../../outside.md)\n");
 assert.match(validateLinks({root,documents:listMarkdownFiles(root)}).join("\n"),/outside repository/);
}));
