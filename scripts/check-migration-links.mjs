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
    const quote = /^(?: {0,3}>[ \t]?)+/.exec(line);
    const quoteDepth = (quote?.[0].match(/>/g) ?? []).length;
    let body = quote ? line.slice(quote[0].length) : line;

    // Exiting a nested blockquote ends its code fence, even if an outer
    // blockquote remains. Otherwise real links in that outer quote are hidden.
    if (fence?.quoteDepth > quoteDepth && body.trim()) fence = null;
    // A fenced block inside a list also ends when its containing list item
    // ends. Without this, an unclosed fence hides real links after dedenting.
    // Empty lines may still be part of the list item, so keep the fence then.
    if (fence?.listIndent && body.trim() &&
        !body.startsWith(" ".repeat(fence.listIndent))) {
      fence = null;
      listIndent = 0;
    }

    if (fence) {
      if (fence.listIndent && body.startsWith(" ".repeat(fence.listIndent))) {
        body = body.slice(fence.listIndent);
      }
    } else {
      const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(body);
      if (list) {
        listIndent = list[0].length;
        body = body.slice(listIndent);
      } else if (listIndent && body.startsWith(" ".repeat(listIndent))) {
        body = body.slice(listIndent);
      } else if (body.trim()) {
        listIndent = 0;
      }
    }

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
export function validateLinks({root,documents}) {
  const errors=[];
  for(const filename of documents) {
    const content=withoutInlineCode(withoutFencedCode(fs.readFileSync(path.join(root,filename),"utf8")));
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
