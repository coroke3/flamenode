import { detectDelimiter, parseDelimited, stripBom } from "#utils/delimited";

export function parseLegacyImportText(name: string | undefined, content: string): unknown {
  const filename = name ?? "";
  if (/\.(csv|tsv)$/i.test(filename)) return parseCsv(content);

  const text = content.replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch {
    const looseRows = parseLooseJsonObjectArray(text);
    if (looseRows.length > 0) return looseRows;
    throw new Error("not-json");
  }
}

export function parseCsv(text: string): Record<string, string>[] {
  const normalized = stripBom(text);
  const grid = parseDelimited(normalized, detectDelimiter(normalized));
  const rows = grid.filter((r) => r.some((c) => c.trim()));
  const [headerRow, ...bodyRows] = rows;
  if (!headerRow) return [];
  const headers = headerRow.map((h) => h.trim());
  return bodyRows.map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) obj[header] = (cells[index] ?? "").trim();
    });
    return obj;
  });
}

function parseLooseJsonObjectArray(text: string): Record<string, unknown>[] {
  const chunks = extractObjectChunksByLine(text);
  return chunks
    .map(parseLooseObject)
    .filter((row): row is Record<string, unknown> => row != null);
}

function extractObjectChunksByLine(text: string): string[] {
  const chunks: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let current: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!current && trimmed === "{") {
      current = [line];
      continue;
    }
    if (!current) continue;
    current.push(line);
    if (trimmed === "}" || trimmed === "},") {
      chunks.push(current.join("\n"));
      current = null;
    }
  }

  return chunks;
}

function parseLooseObject(chunk: string): Record<string, unknown> | null {
  const obj: Record<string, unknown> = {};
  let i = 0;
  let seen = 0;

  while (i < chunk.length) {
    const keyStart = chunk.indexOf('"', i);
    if (keyStart < 0) break;
    const key = readLooseQuotedString(chunk, keyStart, "key");
    if (!key) break;

    i = skipWhitespace(chunk, key.end);
    if (chunk[i] !== ":") {
      i = key.end;
      continue;
    }
    i = skipWhitespace(chunk, i + 1);

    const value = readLooseValue(chunk, i);
    obj[key.value] = value.value;
    seen += 1;
    i = value.end;
  }

  return seen > 0 ? obj : null;
}

function readLooseValue(
  text: string,
  start: number,
): { value: unknown; end: number } {
  if (text[start] === '"') {
    const str = readLooseQuotedString(text, start, "value");
    if (!str) return { value: "", end: text.length };
    return { value: str.value, end: skipToNextField(text, str.end) };
  }

  let end = start;
  while (end < text.length && text[end] !== "," && text[end] !== "\n" && text[end] !== "}") {
    end += 1;
  }
  const raw = text.slice(start, end).trim();
  return { value: parseLooseScalar(raw), end: skipToNextField(text, end) };
}

function readLooseQuotedString(
  text: string,
  start: number,
  mode: "key" | "value",
): { value: string; end: number } | null {
  if (text[start] !== '"') return null;
  let out = "";
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "\\" && next != null) {
      out += unescapeJsonChar(next);
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (mode === "key") return { value: out, end: i + 1 };
      const nextSig = nextSignificantChar(text, i + 1);
      if (nextSig == null || nextSig === "," || nextSig === "}") {
        return { value: out.trim(), end: i + 1 };
      }
      out += ch;
      continue;
    }

    out += ch;
  }
  return { value: out.trim(), end: text.length };
}

function unescapeJsonChar(ch: string): string {
  if (ch === "n") return "\n";
  if (ch === "r") return "\r";
  if (ch === "t") return "\t";
  return ch;
}

function nextSignificantChar(text: string, start: number): string | null {
  for (let i = start; i < text.length; i++) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return null;
}

function skipWhitespace(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function skipToNextField(text: string, start: number): number {
  let i = start;
  while (i < text.length && text[i] !== "," && text[i] !== "}") i += 1;
  if (text[i] === ",") i += 1;
  return i;
}

function parseLooseScalar(raw: string): unknown {
  if (!raw) return "";
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}
