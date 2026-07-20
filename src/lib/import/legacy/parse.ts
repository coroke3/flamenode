export type LegacyParsedFile = {
  name: string;
  rows: Record<string, unknown>[];
};

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function detectDelimiter(text: string): "," | "\t" {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
    ? "\t"
    : ",";
}

function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const source = stripBom(text);
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  if (quoted) throw new Error("引用符が閉じられていません。");
  return rows;
}

function parseCsv(text: string): Record<string, unknown>[] {
  const grid = parseDelimited(text, detectDelimiter(text)).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  const [headerRow, ...bodyRows] = grid;
  if (!headerRow) return [];
  const headers = headerRow.map((header) => header.trim());
  return bodyRows.map((cells) => {
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unwrapJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["events", "videos", "data", "items", "rows"]) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
  return [value];
}

function parseLooseJsonObjects(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, index + 1).replace(/,\s*$/, "");
        try {
          const parsed = JSON.parse(chunk);
          if (isRecord(parsed)) rows.push(parsed);
        } catch {
          // 壊れた断片は行単位で無視し、最終的に0件なら明示エラーにする。
        }
        start = -1;
      }
    }
  }
  return rows;
}

export function parseLegacyImportText(name: string, content: string): LegacyParsedFile {
  const normalizedName = name || "legacy-data.json";
  const text = stripBom(content);
  let rows: Record<string, unknown>[];
  if (/\.(csv|tsv)$/i.test(normalizedName)) {
    rows = parseCsv(text);
  } else {
    try {
      rows = unwrapJson(JSON.parse(text));
    } catch {
      rows = parseLooseJsonObjects(text);
    }
  }
  if (rows.length === 0) {
    throw new Error(`${normalizedName}: 取り込める行を検出できませんでした。`);
  }
  return { name: normalizedName, rows };
}
