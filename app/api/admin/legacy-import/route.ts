import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import {
  analyzeLegacyPayload,
  applyLegacyImport,
  splitLegacyPayload,
  type ConflictStrategy,
  type LegacyImportResult,
} from "@/lib/legacy/import";

const MAX_IMPORT_FILES = 12;
const MAX_IMPORT_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_IMPORT_TEXT_CHARS = 8 * 1024 * 1024;

interface JsonRequest {
  action?: "analyze" | "apply";
  files?: { name?: string; content?: string }[];
  strategy?: {
    events?: ConflictStrategy;
    videos?: ConflictStrategy;
    updateXUsers?: boolean;
  };
}

interface MergeResult {
  ok: boolean;
  message?: string;
  payload: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return handleJson(req, u.id);
  }
  return handleForm(req, u.id);
}

function jsonErrorResult(
  message: string,
  status: number,
  errors: string[] = [],
): NextResponse {
  const body: LegacyImportResult = {
    ok: false,
    message,
    counts: {
      events: { create: 0, update: 0, skip: 0, failed: 0 },
      videos: { create: 0, update: 0, skip: 0, failed: 0 },
      xUsers: { create: 0, update: 0 },
      members: 0,
      editors: 0,
    },
    preview: [],
    errors,
  };
  return NextResponse.json(body, { status });
}

async function handleJson(req: Request, operatorId: string): Promise<Response> {
  try {
    let body: JsonRequest;
    try {
      body = (await req.json()) as JsonRequest;
    } catch {
      return jsonErrorResult("Invalid JSON body.", 400);
    }

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return jsonErrorResult("files is empty.", 400);
    }

    const fileLimitError = validateImportFiles(files);
    if (fileLimitError) {
      return jsonErrorResult(fileLimitError, 413, ["size-limit"]);
    }

    const merged = mergeFiles(files);
    if (!merged.ok) {
      return jsonErrorResult(merged.message ?? "Failed to merge import files.", 400);
    }

    const action = body.action ?? "analyze";
    if (action === "analyze") {
      const result = await analyzeLegacyPayload(merged.payload);
      return NextResponse.json(result);
    }

    if (action === "apply") {
      const blocked = await getImportWriteBlockReason();
      if (blocked) return jsonErrorResult(blocked, 423, ["cost-guard"]);

      const result = await applyLegacyImport(
        merged.payload,
        {
          events: body.strategy?.events,
          videos: body.strategy?.videos,
          updateXUsers: body.strategy?.updateXUsers,
        },
        operatorId,
      );
      return NextResponse.json(result);
    }

    return jsonErrorResult(`Unknown action: ${action}`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorResult(`Server error: ${msg}`, 500, [msg]);
  }
}

async function handleForm(req: Request, operatorId: string): Promise<Response> {
  const form = await req.formData();
  const dryRun = form.get("dry_run") === "1";
  const files = form
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const base = new URL("/admin/import", req.url);

  if (files.length === 0) {
    base.searchParams.set("notice", "Select JSON, CSV, or TSV files.");
    return NextResponse.redirect(base, { status: 303 });
  }

  const fileLimitError = validateFormFiles(files);
  if (fileLimitError) {
    base.searchParams.set("notice", fileLimitError);
    return NextResponse.redirect(base, { status: 303 });
  }

  let parsed: unknown;
  try {
    const merged = mergeFiles(
      await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          content: await file.text(),
        })),
      ),
    );
    if (!merged.ok) throw new Error(merged.message ?? "parse failed");
    parsed = merged.payload;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid import file format.";
    base.searchParams.set("notice", msg);
    return NextResponse.redirect(base, { status: 303 });
  }

  if (dryRun) {
    try {
      const r = await analyzeLegacyPayload(parsed);
      base.searchParams.set(
        "notice",
        `Dry run complete: events ${r.counts.events.create + r.counts.events.update}, videos ${
          r.counts.videos.create + r.counts.videos.update
        }.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      base.searchParams.set("notice", `Dry run failed: ${msg}`);
    }
    return NextResponse.redirect(base, { status: 303 });
  }

  const blocked = await getImportWriteBlockReason();
  if (blocked) {
    base.searchParams.set("notice", blocked);
    return NextResponse.redirect(base, { status: 303 });
  }

  try {
    const r = await applyLegacyImport(parsed, { events: "skip", videos: "skip" }, operatorId);
    base.searchParams.set(
      "notice",
      `Import complete: events create ${r.counts.events.create} / update ${r.counts.events.update}, videos create ${r.counts.videos.create} / update ${r.counts.videos.update}${
        r.errors.length ? `, errors ${r.errors.length}` : ""
      }.`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    base.searchParams.set("notice", `Import failed: ${msg}`);
  }
  return NextResponse.redirect(base, { status: 303 });
}

async function getImportWriteBlockReason(): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  const rows = await db.select().from(systemSettings).limit(1);
  const mode = rows[0]?.cost_guard_mode ?? "normal";
  const isMaintenance = rows[0]?.is_maintenance_mode === 1;
  if (isMaintenance || mode === "maintenance") {
    return "Import apply is disabled during maintenance. Dry run is still available.";
  }
  if (mode === "read_only" || mode === "static_only") {
    return `Import apply is disabled in ${mode} mode. Dry run is still available.`;
  }
  return null;
}

function mergeFiles(files: { name?: string; content?: string }[]): MergeResult {
  const allEvents: unknown[] = [];
  const allVideos: unknown[] = [];

  for (const f of files) {
    if (!f?.content) continue;
    let parsed: unknown;
    try {
      parsed = /\.(csv|tsv)$/i.test(f.name ?? "")
        ? parseCsv(f.content)
        : JSON.parse(f.content);
    } catch {
      return {
        ok: false,
        message: `${f.name ?? "(unnamed file)"} could not be parsed as JSON, CSV, or TSV.`,
        payload: null,
      };
    }
    const { eventInputs, videoInputs } = splitLegacyPayload(parsed);
    allEvents.push(...eventInputs);
    allVideos.push(...videoInputs);
  }

  return { ok: true, payload: { events: allEvents, videos: allVideos } };
}

function validateImportFiles(files: { name?: string; content?: string }[]): string | null {
  if (files.length > MAX_IMPORT_FILES) {
    return `Too many import files. Maximum is ${MAX_IMPORT_FILES}.`;
  }
  let totalChars = 0;
  for (const file of files) {
    const content = file.content ?? "";
    totalChars += content.length;
    if (content.length > MAX_IMPORT_TEXT_CHARS) {
      return `${file.name ?? "file"} is too large.`;
    }
  }
  if (totalChars > MAX_IMPORT_TEXT_CHARS) {
    return "Import files are too large in total.";
  }
  return null;
}

function validateFormFiles(files: File[]): string | null {
  if (files.length > MAX_IMPORT_FILES) {
    return `Too many import files. Maximum is ${MAX_IMPORT_FILES}.`;
  }
  const totalSize = files.reduce((acc, file) => acc + file.size, 0);
  if (totalSize > MAX_IMPORT_TOTAL_BYTES) {
    return "Import files are too large in total.";
  }
  return null;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const delimiter = detectDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  const [headerRow, ...bodyRows] = rows.filter((r) => r.some((c) => c.trim()));
  if (!headerRow) return [];
  const headers = headerRow.map((h, index) =>
    (index === 0 ? h.replace(/^\uFEFF/, "") : h).trim(),
  );
  return bodyRows.map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) obj[header] = (cells[index] ?? "").trim();
    });
    return obj;
  });
}

function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}
