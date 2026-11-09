/**
 * Remove fenced code blocks from link-validation input. Example Markdown
 * links inside code fences are not references to files in this repository.
 * Prose and inline code remain inspectable.
 *
 * Follows the CommonMark container model: blockquotes and list items are
 * tracked as a stack, a fence belongs to the innermost container it was
 * opened in, and it ends when that container ends. Fence markers must be
 * indented at most 3 spaces relative to the container content.
 */
const QUOTE_PREFIX = /^ {0,3}>[ ]?/;
const LIST_MARKER = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^ {0,3}(`+|~+)[ ]*$/;

function leadingSpaces(text) {
  return text.length - text.trimStart().length;
}

export function proseOutsideFencedCode(markdown) {
  const containers = []; // { quote: true } | { indent: number }
  let fence = null; // { depth, character, length }
  return markdown.split(/\r?\n/).map((line) => {
    let rest = line.replace(/\t/g, "    ");
    // Continue the open containers.
    let matched = 0;
    for (const container of containers) {
      if (container.quote) {
        const prefix = rest.match(QUOTE_PREFIX);
        if (!prefix) break;
        rest = rest.slice(prefix[0].length);
      } else if (rest.trim() === "") {
        // A blank line keeps a list item open.
      } else if (leadingSpaces(rest) >= container.indent) {
        rest = rest.slice(container.indent);
      } else {
        break;
      }
      matched += 1;
    }
    if (fence !== null) {
      if (matched >= fence.depth) {
        const closing = rest.match(CLOSE_FENCE);
        if (
          closing &&
          closing[1][0] === fence.character &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }
        return "";
      }
      // The container holding the fence ended, which ends the fence too.
      fence = null;
    }
    containers.length = matched;
    // Open new containers on this line.
    for (;;) {
      const prefix = rest.match(QUOTE_PREFIX);
      if (prefix) {
        containers.push({ quote: true });
        rest = rest.slice(prefix[0].length);
        continue;
      }
      const item = THEMATIC_BREAK.test(rest) ? null : rest.match(LIST_MARKER);
      if (item) {
        const markerWidth = item[1].length + item[2].length;
        const gap = item[3].length;
        // Five or more spaces after the marker start indented code instead.
        const indent = gap === 0 || gap > 4 ? markerWidth + 1 : markerWidth + gap;
        containers.push({ indent });
        rest = rest.slice(Math.min(indent, rest.length));
        continue;
      }
      break;
    }
    const opening = rest.match(OPEN_FENCE);
    // Backtick fence info strings cannot contain backticks.
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = {
        depth: containers.length,
        character: opening[1][0],
        length: opening[1].length,
      };
      return "";
    }
    return line;
  }).join("\n");
}
