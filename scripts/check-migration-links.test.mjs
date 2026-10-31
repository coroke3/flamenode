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
test("quoted Markdown link titles do not become filenames",()=>fixture(root=>{
 const md=[
  '[first](deep/CHILD.md "Child file")',
  "[second](deep/CHILD.md 'Child file')",
  '[third](<deep/CHILD.md> "Angle destination")',
  '[external](https://example.com/path "Remote")',
  '[missing](not-present.md "Missing file")',
  '[escape](../../../../../outside.md "Unsafe")',
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,2,errors.join("\n"));
 assert.match(errors.join("\n"),/broken relative link: not-present\.md/);
 assert.match(errors.join("\n"),/link outside repository: \.\.\/\.\.\/\.\.\/\.\.\/\.\.\/outside\.md/);
 assert.doesNotMatch(errors.join("\n"),/Child file|Angle destination|Remote|Missing file|Unsafe/);
}));

test("balanced parentheses, escaped punctuation and titles resolve to their real files",()=>fixture(root=>{
  const base=path.join(root,"docs/migration");
  for(const filename of ["foo(bar).md","foo)bar.md","two(nest(level)).md"]){
    fs.writeFileSync(path.join(base,filename),"# Fixture\n");
  }
  const md=[
    "[literal](foo(bar).md)",
    "[escaped](foo\\(bar\\).md)",
    "[escaped close](foo\\)bar.md)",
    "[nested](two(nest(level)).md)",
    '[quoted title](foo(bar).md "Parenthesis title")',
    "[angle](<foo(bar).md> 'Angle title')",
    "[paren title](foo(bar).md (Optional title))",
    "[remote](https://example.com/path(foo))",
    "\\[escaped label](not-a-real-link.md)",
    "[missing](missing(with-parens).md)",
    "[escaped missing](missing\\(escaped\\).md)",
    "[outside](../../../../../outside(evil).md)",
  ].join("\n");
  fs.appendFileSync(path.join(base,"README.md"),"\n"+md+"\n");
  const errors=validateLinks({root,documents:listMarkdownFiles(root)});
  assert.equal(errors.length,3,errors.join("\n"));
  assert.match(errors.join("\n"),/broken relative link: missing\(with-parens\)\.md/);
  assert.match(errors.join("\n"),/broken relative link: missing\(escaped\)\.md/);
  assert.match(errors.join("\n"),/link outside repository: \.\.\/\.\.\/\.\.\/\.\.\/\.\.\/outside\(evil\)\.md/);
  assert.doesNotMatch(errors.join("\n"),/foo\(|foo\)|two\(|not-a-real-link|Parenthesis title|Angle title/);
}));

test("malformed unbalanced link cannot swallow a following valid missing-file link",()=>fixture(root=>{
  fs.appendFileSync(path.join(root,"docs/migration/README.md"),
    "\n[invalid](broken(unbalanced.md) [real](missing-after-unbalanced.md)\n");
  const errors=validateLinks({root,documents:listMarkdownFiles(root)});
  assert.equal(errors.length,1,errors.join("\n"));
  assert.match(errors[0],/broken relative link: missing-after-unbalanced\.md/);
}));

test("does not treat a fragment-only URL as a local file",()=>fixture(root=>{
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n[heading](#entry)\n");
 assert.deepEqual(validateLinks({root,documents:listMarkdownFiles(root)}),[]);
}));
test("repository symlinks may not escape the checkout and local symlinks remain valid",()=>fixture(root=>{
 const outsideDir=fs.mkdtempSync(path.join(os.tmpdir(),"flamenode-outside-link-"));
 try{
  const outside=path.join(outsideDir,"secret.md");
  fs.writeFileSync(outside,"# external fixture\n");
  fs.symlinkSync(outside,path.join(root,"docs/migration/external-alias.md"));
  fs.symlinkSync(path.join(root,"docs/migration/deep/CHILD.md"),
    path.join(root,"docs/migration/inside-alias.md"));
  fs.appendFileSync(path.join(root,"docs/migration/README.md"),
    "\n[outside](external-alias.md)\n[inside](inside-alias.md)\n");
  const errors=validateLinks({root,documents:listMarkdownFiles(root)});
  assert.equal(errors.length,1,errors.join("\n"));
  assert.match(errors[0],/link outside repository: external-alias\.md/);
  assert.doesNotMatch(errors.join("\n"),/inside-alias/);
 }finally{fs.rmSync(outsideDir,{recursive:true,force:true});}
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


test("invalid backtick fence info cannot hide broken links; tilde info may contain backticks",()=>fixture(root=>{
 const md=[
  "```lang`invalid",
  "[real](broken-after-invalid-fence.md)",
  "~~~lang`valid",
  "[example](not-a-dependency.md)",
  "~~~",
  "[real](broken-after-valid-tilde.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,2);
 assert.match(errors.join("\n"),/broken-after-invalid-fence\.md/);
 assert.match(errors.join("\n"),/broken-after-valid-tilde\.md/);
}));


test("nested list fences exclude examples but still check actual list links",()=>fixture(root=>{
 const md=[
  "- examples:",
  "    ```md",
  "    [sample](not-a-file-in-list.md)",
  "    ```",
  "    [real](missing-list-target.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1);
 assert.match(errors[0],/broken relative link: missing-list-target\.md/);
}));

test("blockquote fences exclude examples but not following blockquote links",()=>fixture(root=>{
 const md=[
  "> ```markdown",
  "> [sample](not-a-file-in-quote.md)",
  "> ```",
  "> [real](missing-quote-target.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1);
 assert.match(errors[0],/broken relative link: missing-quote-target\.md/);
}));

test("exiting a nested blockquote code fence restores link validation in the outer quote",()=>fixture(root=>{
 const md=[
  "> > ```markdown",
  "> > [example](not-a-file-in-nested-quote.md)",
  "> [real](missing-after-nested-quote.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1,errors.join("\n"));
 assert.match(errors[0],/broken relative link: missing-after-nested-quote\.md/);
}));

test("inline code spans are ignored while adjacent file links are checked",()=>fixture(root=>{
 const md=[
  "`[example](fake-inline.md)` and [real](missing-after-inline.md)",
  "``[example](fake-double-inline.md)`` and [real](missing-after-double.md)",
  "Before `multiline",
  "[example](fake-multiline.md)",
  "` [real](missing-after-multiline.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,3,errors.join("\n"));
 for(const target of ["missing-after-inline.md","missing-after-double.md","missing-after-multiline.md"])
  assert.match(errors.join("\n"),new RegExp(target.replace(".", "\\.")));
 assert.doesNotMatch(errors.join("\n"),/fake-/);
}));

test("escaped and unmatched backticks cannot hide real file links",()=>fixture(root=>{
 const md=[
  "Escaped \\`[real](missing-escaped.md)\\`",
  "Unmatched `[real](missing-unmatched.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,2,errors.join("\n"));
 assert.match(errors.join("\n"),/missing-escaped\.md/);
 assert.match(errors.join("\n"),/missing-unmatched\.md/);
}));

test("indented code examples are excluded, ordinary links remain validated",()=>fixture(root=>{
 const md=[
  "    [sample](not-a-file-in-indented-code.md)",
  "",
  "[real](missing-after-code.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1);
 assert.match(errors[0],/broken relative link: missing-after-code\.md/);
}));

test("dedenting out of a list ends an unclosed fenced block and checks following links",()=>fixture(root=>{
 const md=[
  "- examples:",
  "    ```md",
  "    [sample](not-a-file-in-list.md)",
  "",
  "[real](missing-after-list-dedent.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1);
 assert.match(errors[0],/broken relative link: missing-after-list-dedent\.md/);
}));

test("list then blockquote fences ignore example links but validate the following real link",()=>fixture(root=>{
 const md=[
  "- > ```md",
  "  > [example](not-a-list-quote-dependency.md)",
  "  > ```",
  "[real](missing-after-list-quote.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1,errors.join("\n"));
 assert.match(errors[0],/missing-after-list-quote\.md/);
 assert.doesNotMatch(errors.join("\n"),/not-a-list-quote-dependency/);
}));

test("blockquote then list fences recognize their nesting without hiding later links",()=>fixture(root=>{
 const md=[
  "> - ```md",
  ">   [example](not-a-quote-list-dependency.md)",
  ">   ```",
  "> [real](missing-after-quote-list.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1,errors.join("\n"));
 assert.match(errors[0],/missing-after-quote-list\.md/);
 assert.doesNotMatch(errors.join("\n"),/not-a-quote-list-dependency/);
}));

test("unclosed combined list-quote fence stops at list dedent rather than hiding a real link",()=>fixture(root=>{
 const md=[
  "- > ```md",
  "  > [example](not-a-file-in-unclosed-fence.md)",
  "[real](missing-after-composite-dedent.md)",
 ].join("\n");
 fs.appendFileSync(path.join(root,"docs/migration/README.md"),"\n"+md+"\n");
 const errors=validateLinks({root,documents:listMarkdownFiles(root)});
 assert.equal(errors.length,1,errors.join("\n"));
 assert.match(errors[0],/missing-after-composite-dedent\.md/);
 assert.doesNotMatch(errors.join("\n"),/not-a-file-in-unclosed-fence/);
}));
