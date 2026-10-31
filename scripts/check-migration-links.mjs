#!/usr/bin/env node
// Validate links between migration Markdown documents (not remote HTTP URLs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

// Link-like syntax in Markdown code fences is an example, not a dependency.
// Match CommonMark's 0–3 leading spaces, backtick/tilde fences, and close
// only with the same marker of at least the opening length.
function withoutFencedCode(markdown) {
  let fence = null;
  let listIndent = 0;

  return markdown.split(/\r?\n/).map((line) => {
    // A fenced block can be nested in a blockquote or a list item. Strip
    // container prefixes for detecting the marker, but preserve the original
    // line for checking actual links outside code blocks.
    // An existing list item can contain a quote after its continuation
    // indentation (e.g. "  > ```md"). Remove the list indent first so
    // both list > quote and quote > list containers are recognized.
    let body = line;
    let continuedList = false;
    if (listIndent && body.startsWith(" ".repeat(listIndent))) {
      body = body.slice(listIndent);
      continuedList = true;
    }
    const quote = /^(?: {0,3}>[ \t]?)+/.exec(body);
    let quoteDepth = (quote?.[0].match(/>/g) ?? []).length;
    if (quote) body = body.slice(quote[0].length);
    // A fenced block inside a list also ends when its containing list item
    // ends. Without this, an unclosed fence hides real links after dedenting.
    // Empty lines may still be part of the list item, so keep the fence then.
    if (fence?.listIndent && body.trim() && !continuedList &&
        !body.startsWith(" ".repeat(fence.listIndent))) {
      fence = null;
      listIndent = 0;
    }

    if (fence) {
      if (fence.listIndent && !continuedList && body.startsWith(" ".repeat(fence.listIndent))) {
        body = body.slice(fence.listIndent);
      }
    } else {
      const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(body);
      if (list) {
        listIndent = list[0].length;
        body = body.slice(listIndent);
      } else if (listIndent && !continuedList && body.startsWith(" ".repeat(listIndent))) {
        body = body.slice(listIndent);
      } else if (body.trim() && !continuedList) {
        listIndent = 0;
      }
    }

    // A block quote can also follow the newly recognized list marker
    // ("- > ```md"). Count both quote layers before checking fence scope.
    const nestedQuote = /^(?: {0,3}>[ \t]?)+/.exec(body);
    if (nestedQuote) {
      quoteDepth += (nestedQuote[0].match(/>/g) ?? []).length;
      body = body.slice(nestedQuote[0].length);
    }
    // Leaving an inner quote ends its unclosed code fence.
    if (fence?.quoteDepth > quoteDepth && body.trim()) fence = null;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
    if (fence) {
      if (marker && marker[1][0] === fence.char &&
          marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      return "";
    }

    // Backtick info strings cannot contain backticks; tilde info may.
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = {char: marker[1][0], length: marker[1].length,
        quoteDepth, listIndent};
      return "";
    }
    // Four-space / tab-indented code is not a filesystem dependency. Inside
    // list items, indentation is measured relative to that item's content.
    if (/^(?: {4}|\t)/.test(body)) return "";
    return line;
  }).join("\n");
}
// CommonMark inline code spans (one or more matching backticks) are literal.
// Mask their text while preserving newlines, so examples do not become links
// and genuine links outside the span are still checked. Unmatched delimiters
// stay literal instead of hiding the rest of the document.
function withoutInlineCode(markdown) {
  const runs = [];
  for (const match of markdown.matchAll(/`+/g)) {
    const backslashes = markdown.slice(0, match.index).match(/\\+$/)?.[0]?.length ?? 0;
    const escaped = backslashes % 2 === 1;
    const length = match[0].length - (escaped ? 1 : 0);
    if (length > 0) runs.push({ index: match.index + (escaped ? 1 : 0), length });
  }
  const next = new Array(runs.length);
  const last = new Map();
  for (let i = runs.length - 1; i >= 0; i--) {
    next[i] = last.get(runs[i].length);
    last.set(runs[i].length, i);
  }
  let result = "", cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const closing = next[i];
    if (closing === undefined) continue;
    const start = runs[i].index;
    const stop = runs[closing].index + runs[closing].length;
    result += markdown.slice(cursor, start) +
      markdown.slice(start, stop).replace(/[^\r\n]/g, " ");
    cursor = stop;
    i = closing;
  }
  return result + markdown.slice(cursor);
}

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
// Parse destination boundaries before validating a Markdown inline link.
// A regex ending at the first ")" incorrectly breaks `foo(bar).md` and
// escaped punctuation like `foo\\)bar.md`. Titles are not part of the path.
// This is deliberately scoped to inline links (the existing checker contract),
// not reference-style definitions or images.
function markdownLinkDestinations(markdown) {
  const punctuation = (ch) => {
    if (!ch) return false;
    const n=ch.charCodeAt(0);
    return (n>=33&&n<=47)||(n>=58&&n<=64)||(n>=91&&n<=96)||(n>=123&&n<=126);
  };
  const destinations=[];
  for (const match of markdown.matchAll(/\\[[^\\]\\n]*\\]\\(/g)) {
    // An escaped opening bracket is literal text, not a link.
    let backslashes=0;
    for (let j=match.index-1;j>=0&&markdown[j]==="\\\\";j--) backslashes++;
    if (backslashes%2) continue;
    let i=match.index+match[0].length, target="", valid=true;
    while (markdown[i]===" "||markdown[i]==="\\t") i++;
    if (markdown[i]==="<") {
      // Angle destinations allow parentheses without balancing.
      i++;
      let closed=false;
      while (i<markdown.length) {
        const c=markdown[i];
        if (c==="\\r"||c==="\\n"||c==="<") {valid=false;break;}
        if (c==="\\\\"&&punctuation(markdown[i+1])) {
          target+=markdown[i+1];i+=2;continue;
        }
        if (c===">") {closed=true;i++;break;}
        target+=c;i++;
      }
      if (!closed) valid=false;
    } else {
      // Unescaped parentheses inside unbracketed destinations must balance.
      // Escaped ASCII punctuation becomes the actual filename character.
      let depth=0;
      while (i<markdown.length) {
        const c=markdown[i];
        if (c==="\\r"||c==="\\n"||c==="<"||c===">") {valid=false;break;}
        if (c==="\\\\"&&punctuation(markdown[i+1])) {
          target+=markdown[i+1];i+=2;continue;
        }
        if (c==="(") depth++;
        else if (c===")") {if (depth===0) break;depth--;}
        else if (c===" "||c==="\\t") break;
        target+=c;i++;
      }
      if (depth!==0) valid=false;
    }
    if (!valid) continue;
    const beforeTitle=i;
    while (markdown[i]===" "||markdown[i]==="\\t") i++;
    if (markdown[i]!==")") {
      // Optional CommonMark title: "title", 'title' or (title).
      if (i===beforeTitle||!['"',"'","("].includes(markdown[i])) continue;
      const delimiter=markdown[i++], closing=delimiter==="("?")":delimiter;
      let closed=false;
      while (i<markdown.length) {
        if (markdown[i]==="\\r"||markdown[i]==="\\n") break;
        if (markdown[i]==="\\\\"&&punctuation(markdown[i+1])) {i+=2;continue;}
        if (markdown[i]===closing) {closed=true;i++;break;}
        i++;
      }
      if (!closed) continue;
      while (markdown[i]===" "||markdown[i]==="\\t") i++;
    }
    if (markdown[i]===")") destinations.push(target);
  }
  return destinations;
}

export function validateLinks({root,documents}) {
  const errors=[];
  // Lexical path checks are insufficient: a repository-local symlink can
  // resolve to a file outside the checkout. Resolve both ends before accepting.
  const realRoot=fs.realpathSync(root);
  for(const filename of documents) {
    const content=withoutInlineCode(withoutFencedCode(fs.readFileSync(path.join(root,filename),"utf8")));
    // Check Markdown inline relative paths. Code fences and HTTP links are not file targets.
    for(let target of markdownLinkDestinations(content)) {
      target=target.trim();
      if(!target||target.startsWith("#")||/^(?:https?:|mailto:|data:)/i.test(target))continue;
      target=target.split("#")[0].split("?")[0];
      const resolved=path.resolve(target.startsWith("/")?root:path.dirname(path.join(root,filename)),target.replace(/^\//,""));
      if(!resolved.startsWith(root+path.sep)) {
        errors.push(filename+": link outside repository: "+target);
        continue;
      }
      if(!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        errors.push(filename+": broken relative link: "+target);
        continue;
      }
      const realTarget=fs.realpathSync(resolved);
      const relative=path.relative(realRoot,realTarget);
      if(relative===".." || relative.startsWith(".."+path.sep) || path.isAbsolute(relative))
        errors.push(filename+": link outside repository: "+target);
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
