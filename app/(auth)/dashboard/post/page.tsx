import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { Icon } from "@/components/ui/Icon";
import { VideoForm } from "@/components/forms/VideoForm";

export const metadata: Metadata = { title: "作品を投稿" };
export const dynamic = "force-dynamic";

export default async function PostPage(): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;

  return (
    <div
      style={{
        width: "min(96%, 960px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          NEW POST
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          作品を投稿
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          自由投稿はイベントに紐づかない通常投稿として登録します。スロット予約済みの場合は
          <Link href="/dashboard"> ダッシュボード </Link>
          から「動画を提出」してください。
        </p>
      </header>
      <VideoForm mode="free" />
      <p
        style={{
          marginTop: 20,
          color: "var(--text-muted)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="info" size={12} aria-hidden />
        利用規約への再同意は提出時に確認します。
      </p>
    </div>
  );
}
