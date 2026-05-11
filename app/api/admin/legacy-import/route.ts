import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  analyzeLegacyPayload,
  applyLegacyImport,
  splitLegacyPayload,
  type ConflictStrategy,
  type LegacyImportResult,
} from "@/lib/legacy/import";

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

interface JsonRequest {
  action?: "analyze" | "apply";
  files?: { name?: string; content?: string }[];
  strategy?: {
    events?: ConflictStrategy;
    videos?: ConflictStrategy;
    updateXUsers?: boolean;
  };
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
      return jsonErrorResult("JSON ボディを解析できませんでした。", 400);
    }

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return jsonErrorResult("files が空です。", 400);
    }

    const merged = mergeFiles(files);
    if (!merged.ok) {
      return jsonErrorResult(merged.message ?? "ファイルの結合に失敗しました。", 400);
    }

    const action = body.action ?? "analyze";
    if (action === "analyze") {
      const result = await analyzeLegacyPayload(merged.payload);
      return NextResponse.json(result);
    }

    if (action === "apply") {
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

    return jsonErrorResult(`不明な action: ${action}`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonErrorResult(`サーバー処理エラー: ${msg}`, 500, [msg]);
  }
}

async function handleForm(req: Request, operatorId: string): Promise<Response> {
  const form = await req.formData();
  const dryRun = form.get("dry_run") === "1";
  const file = form.get("file");
  const base = new URL("/admin/import", req.url);

  if (!(file instanceof File) || file.size === 0) {
    base.searchParams.set("notice", "JSON ファイルを選択してください。");
    return NextResponse.redirect(base, { status: 303 });
  }

  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    base.searchParams.set("notice", "JSON の形式が正しくありません。");
    return NextResponse.redirect(base, { status: 303 });
  }

  if (dryRun) {
    try {
      const r = await analyzeLegacyPayload(parsed);
      base.searchParams.set(
        "notice",
        `ドライラン完了: events ${r.counts.events.create + r.counts.events.update} 件 / videos ${
          r.counts.videos.create + r.counts.videos.update
        } 件`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      base.searchParams.set("notice", `ドライラン失敗: ${msg}`);
    }
    return NextResponse.redirect(base, { status: 303 });
  }

  try {
    const r = await applyLegacyImport(parsed, { events: "skip", videos: "skip" }, operatorId);
    base.searchParams.set(
      "notice",
      `取り込み完了: events 新規 ${r.counts.events.create} / 更新 ${r.counts.events.update} / videos 新規 ${r.counts.videos.create} / 更新 ${r.counts.videos.update}${
        r.errors.length ? ` / エラー ${r.errors.length} 件` : ""
      }`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    base.searchParams.set("notice", `取り込み失敗: ${msg}`);
  }
  return NextResponse.redirect(base, { status: 303 });
}

interface MergeResult {
  ok: boolean;
  message?: string;
  payload: unknown;
}

function mergeFiles(files: { name?: string; content?: string }[]): MergeResult {
  const allEvents: unknown[] = [];
  const allVideos: unknown[] = [];

  for (const f of files) {
    if (!f?.content) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.content);
    } catch {
      return {
        ok: false,
        message: `${f.name ?? "(無名ファイル)"} の JSON 形式が不正です。`,
        payload: null,
      };
    }
    const { eventInputs, videoInputs } = splitLegacyPayload(parsed);
    allEvents.push(...eventInputs);
    allVideos.push(...videoInputs);
  }

  return { ok: true, payload: { events: allEvents, videos: allVideos } };
}
