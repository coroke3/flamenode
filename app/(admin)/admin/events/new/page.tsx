import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { events } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export const metadata: Metadata = { title: "イベント作成" };
export const dynamic = "force-dynamic";

async function createEvent(formData: FormData) {
  "use server";

  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    redirect("/admin/events?error=forbidden");
  }

  const db = getDatabase();
  if (!db) redirect("/admin/events?error=db");

  const title = String(formData.get("title") ?? "").trim();
  const idInput = String(formData.get("id") ?? "").trim();
  const explanation = String(formData.get("explanation") ?? "").trim();
  const id = idInput || generateId("event");
  const now = Math.floor(Date.now() / 1000);

  if (!title) redirect("/admin/events/new?error=title");

  await db.insert(events).values({
    id,
    title,
    explanation: explanation || null,
    event_type: "event",
    is_active: 0,
    is_entry_open: 0,
    is_archived: 0,
    created_at: now,
    updated_at: now,
  });

  redirect(`/admin/events/${id}`);
}

export default function AdminNewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): React.ReactElement {
  return (
    <div style={{ maxWidth: 720 }}>
      <p className="fn-muted fn-text-xs fn-bold">EVENT</p>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>イベント作成</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        最小情報でイベントを作成します。詳細な枠や運営メンバーは作成後の詳細画面で管理します。
      </p>

      <React.Suspense fallback={null}>
        <ErrorNotice searchParams={searchParams} />
      </React.Suspense>

      <form action={createEvent} className="fn-card" style={{ marginTop: 20 }}>
        <label className="fn-label" htmlFor="event-title">イベント名</label>
        <input id="event-title" name="title" className="fn-input" required maxLength={120} />

        <label className="fn-label fn-mt-md" htmlFor="event-id">イベントID</label>
        <input
          id="event-id"
          name="id"
          className="fn-input"
          placeholder="未入力なら自動生成"
          pattern="[A-Za-z0-9_-]+"
          maxLength={80}
        />

        <label className="fn-label fn-mt-md" htmlFor="event-explanation">説明</label>
        <textarea id="event-explanation" name="explanation" className="fn-textarea" rows={5} />

        <button type="submit" className="fn-btn fn-btn-primary fn-mt-md">
          作成
        </button>
      </form>
    </div>
  );
}

async function ErrorNotice({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<React.ReactElement | null> {
  const { error } = await searchParams;
  if (!error) return null;
  const message =
    error === "title"
      ? "イベント名を入力してください。"
      : error === "forbidden"
        ? "管理者のみ作成できます。"
        : "イベント作成に失敗しました。";
  return (
    <p className="fn-error" style={{ marginTop: 12 }}>
      {message}
    </p>
  );
}
