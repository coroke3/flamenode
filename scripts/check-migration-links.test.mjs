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

test("fenced Markdown examples are not treated as filesystem links",()=>fixture(root=>{
 const md=[
  "```markdown",
  "[sample](does-not-exist-in-example.md)",
  "```",
  "~~~txt",
  "[sample](does-not-exist-in-tilde.md)",
  "~~~",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 assert.deepEqual(validateLinks({root,documents:listMarkdownFiles(root)}),[]);
}));

test("fence closing requires the same character and at least opening length",()=>fixture(root=>{
 const md=[
  "````markdown",
  "[sample](not-a-link-1.md)",
  "```", // too short to close a four-backtick block
  "[sample](not-a-link-2.md)",
  "~~~", // different marker does not close the block
  "[sample](not-a-link-3.md)",
  "````",
  "[real](broken-after-fence.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1);
 assert.match(errors[0],/broken relative link: broken-after-fence.md/);
}));

test("unterminated fences ignore examples until the end of the file",()=>fixture(root=>{
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),
   "\n~~~example\n[not-real](missing-at-eof.md)\n");
 assert.deepEqual(validateLinks({root,documents:listMarkdownFiles(root)}),[]);
}));
