/**
 * Remove fenced code blocks from link-validation input. Example Markdown
 * links inside code fences are not references to files in this repository.
 * Prose and inline code remain inspectable.
 *
 * Fences inside blockquotes (`> ```), nested blockquotes and list items
 * (indented beyond 3 spaces) are recognised as well.
 */
const QUOTE_PREFIX = /^ {0,3}>[ \t]?/;
const LIST_MARKER = /^ *(?:[-*+]|\d{1,9}[.)])[ \t]+/;

function stripQuotes(line) {
  let rest = line;
  let depth = 0;
  while (QUOTE_PREFIX.test(rest)) {
    rest = rest.replace(QUOTE_PREFIX, "");
    depth += 1;
  }
  return { rest, depth };
}

function leadingSpaces(text) {
  return text.length - text.trimStart().length;
}

export function proseOutsideFencedCode(markdown) {
  let fenceCharacter = null;
  let fenceLength = 0;
  let fenceDepth = 0;
  let inList = false;
  return markdown.split(/\r?\n/).map((line) => {
    const { rest, depth } = stripQuotes(line);
    if (fenceCharacter !== null) {
      // A non-blank line outside the blockquote that opened the fence ends it.
      if (depth < fenceDepth && rest.trim() !== "") {
        fenceCharacter = null;
        fenceLength = 0;
        fenceDepth = 0;
      } else {
        const closing = rest.match(/^ *(`+|~+)[ \t]*$/);
        if (
          closing &&
          closing[1][0] === fenceCharacter &&
          closing[1].length >= fenceLength &&
          (inList || leadingSpaces(rest) <= 3)
        ) {
          fenceCharacter = null;
          fenceLength = 0;
          fenceDepth = 0;
        }
        return "";
      }
    }
    if (depth === 0) {
      if (LIST_MARKER.test(rest)) inList = true;
      else if (rest.trim() !== "" && leadingSpaces(rest) === 0) inList = false;
    }
    const listItem = rest.match(LIST_MARKER);
    const content = listItem ? rest.slice(listItem[0].length) : rest;
    const allowedIndent = listItem || inList ? Infinity : 3;
    const opening = content.match(/^ *(`{3,}|~{3,})(.*)$/);
    if (opening && leadingSpaces(content) <= (listItem ? 3 : allowedIndent)) {
      // Backtick fence info strings cannot contain backticks.
      if (opening[1][0] === "`" && opening[2].includes("`")) return line;
      fenceCharacter = opening[1][0];
      fenceLength = opening[1].length;
      fenceDepth = depth;
      return "";
    }
    return line;
  }).join("\n");
}
