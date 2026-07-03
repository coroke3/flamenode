import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import {
  analyzeLegacyPayload,
  applyLegacyImport,
  splitLegacyPayload,
  type ConflictStrategy,
  type LegacyImportMode,
  type LegacyImportResult,
  type StaticRebuildStrategy,
} from "@/lib/legacy/import";
import {
  buildLegacyImportPreviewToken,
  type LegacyImportPreviewTokenStrategy,
} from "@/lib/legacy/importPreviewToken";
import { parseLegacyImportText } from "@/lib/legacy/parse";

const MAX_IMPORT_FILES = 12;
const MAX_IMPORT_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_IMPORT_TEXT_CHARS = 8 * 1024 * 1024;
const DEFAULT_PREVIEW_LIMIT = 80;

interface JsonRequest {
  action?: "analyze" | "apply";
  files?: { name?: string; content?: string }[];
  previewToken?: string;
  previewLimit?: number;
  strategy?: {
    events?: ConflictStrategy;
    videos?: ConflictStrategy;
    updateXUsers?: boolean;
    importMode?: "archive" | "preserve" | "active_event" | "draft";
    enqueueStaticRebuild?: boolean;
    staticRebuildStrategy?: "none" | "summary" | "event" | "full";
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
  return handleForm(req);
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
    previewTotal: 0,
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
    const previewLimit = normalizePreviewLimit(body.previewLimit);
    const strategy = normalizeJsonImportStrategy(body.strategy);
    const previewToken = await buildLegacyImportPreviewToken({
      payload: merged.payload,
      strategy,
    });
    if (action === "analyze") {
      const result = await analyzeLegacyPayload(merged.payload, {
        events: strategy.events,
        videos: strategy.videos,
        updateXUsers: strategy.updateXUsers,
        importMode: strategy.importMode,
        enqueueStaticRebuild: strategy.enqueueStaticRebuild,
        staticRebuildStrategy: strategy.staticRebuildStrategy,
        dryRun: true,
        previewLimit,
      });
      return NextResponse.json({ ...result, previewToken });
    }

    if (action === "apply") {
      if (!body.previewToken || body.previewToken !== previewToken) {
        return jsonErrorResult(
          "反映前に現在のファイルと設定でドライランを実行してください。",
          409,
          ["preview-required"],
        );
      }
      const blocked = await getImportWriteBlockReason();
      if (blocked) return jsonErrorResult(blocked, 423, ["cost-guard"]);

      const result = await applyLegacyImport(
        merged.payload,
        {
          events: strategy.events,
          videos: strategy.videos,
          updateXUsers: strategy.updateXUsers,
          importMode: strategy.importMode,
          enqueueStaticRebuild: strategy.enqueueStaticRebuild,
          staticRebuildStrategy: strategy.staticRebuildStrategy,
          previewLimit,
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

function parseFormImportMode(raw: FormDataEntryValue | null): LegacyImportMode {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (
    v === "archive" ||
    v === "preserve" ||
    v === "active_event" ||
    v === "draft"
  ) {
    return v;
  }
  return "archive";
}

function parseFormStaticRebuildStrategy(
  raw: FormDataEntryValue | null,
): StaticRebuildStrategy | undefined {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "none" || v === "summary" || v === "event" || v === "full") {
    return v;
  }
  return undefined;
}

function legacyOptionsFromForm(form: FormData) {
  return {
    importMode: parseFormImportMode(form.get("import_mode")),
    enqueueStaticRebuild: form.get("enqueue_static_rebuild") !== "0",
    staticRebuildStrategy: parseFormStaticRebuildStrategy(
      form.get("static_rebuild_strategy"),
    ),
  };
}

async function handleForm(req: Request): Promise<Response> {
  const form = await req.formData();
  const dryRun = form.get("dry_run") === "1";
  const legacyFormOptions = legacyOptionsFromForm(form);
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
      const r = await analyzeLegacyPayload(parsed, {
        ...legacyFormOptions,
        dryRun: true,
        previewLimit: 0,
      });
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

  base.searchParams.set(
    "notice",
    "シンプルフォームはドライラン専用です。保存はプレビューUIで内容を確認してから実行してください。",
  );
  return NextResponse.redirect(base, { status: 303 });
}

function normalizeJsonImportMode(raw: unknown): LegacyImportMode {
  if (
    raw === "archive" ||
    raw === "preserve" ||
    raw === "active_event" ||
    raw === "draft"
  ) {
    return raw;
  }
  return "archive";
}

function normalizeJsonConflictStrategy(raw: unknown): ConflictStrategy {
  if (raw === "update" || raw === "merge") return raw;
  return "skip";
}

function normalizeJsonStaticRebuildStrategy(
  raw: unknown,
  importMode: LegacyImportMode,
): StaticRebuildStrategy {
  if (raw === "none" || raw === "summary" || raw === "event" || raw === "full") {
    return raw;
  }
  return importMode === "draft" ? "none" : "event";
}

function normalizeJsonImportStrategy(
  raw: JsonRequest["strategy"],
): LegacyImportPreviewTokenStrategy {
  const importMode = normalizeJsonImportMode(raw?.importMode);
  return {
    events: normalizeJsonConflictStrategy(raw?.events),
    videos: normalizeJsonConflictStrategy(raw?.videos),
    updateXUsers: raw?.updateXUsers === true,
    importMode,
    enqueueStaticRebuild: raw?.enqueueStaticRebuild !== false,
    staticRebuildStrategy: normalizeJsonStaticRebuildStrategy(
      raw?.staticRebuildStrategy,
      importMode,
    ),
  };
}

async function getImportWriteBlockReason(): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  const rows = await db.select().from(systemSettings).limit(1);
  const mode = rows[0]?.operation_mode ?? "normal";
  const isMaintenance = rows[0]?.is_maintenance_mode === 1;
  if (isMaintenance || mode === "maintenance") {
    return "Import apply is disabled during maintenance. Dry run is still available.";
  }
  if (mode === "read_only" || mode === "static_only") {
    return `Import apply is disabled in ${mode} mode. Dry run is still available.`;
  }
  return null;
}

function normalizePreviewLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_PREVIEW_LIMIT;
  }
  return Math.min(500, Math.max(0, Math.floor(raw)));
}

function mergeFiles(files: { name?: string; content?: string }[]): MergeResult {
  const allEvents: unknown[] = [];
  const allVideos: unknown[] = [];

  for (const f of files) {
    if (!f?.content) continue;
    let parsed: unknown;
    try {
      parsed = parseLegacyImportText(f.name, f.content);
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
