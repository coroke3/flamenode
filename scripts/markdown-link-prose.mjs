/**
 * Remove fenced code blocks from link-validation input. Example Markdown
 * links inside code fences are not references to files in this repository.
 * Prose and inline code remain inspectable.
 */
export function proseOutsideFencedCode(markdown) {
  let fenceCharacter = null;
  let fenceLength = 0;
  return markdown.split(/\r?\n/).map((line) => {
    if (fenceCharacter !== null) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        closing &&
        closing[1][0] === fenceCharacter &&
        closing[1].length >= fenceLength
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      return "";
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening) {
      // Backtick fence info strings cannot contain backticks.
      if (opening[1][0] === "`" && opening[2].includes("`")) return line;
      fenceCharacter = opening[1][0];
      fenceLength = opening[1].length;
      return "";
    }
    return line;
  }).join("\n");
}
