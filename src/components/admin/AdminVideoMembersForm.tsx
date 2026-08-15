"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";
import { updateVideoMembersAdmin } from "@/lib/actions/video";
import type { VideoActionResult } from "@/lib/video/types";
import { redirectForGuardReason } from "@/lib/client/guardRedirect";
import {
  VideoMembersField,
  type VideoMemberInput,
  type VideoMemberSuggestion,
} from "@/components/forms/VideoMembersField";

interface AdminVideoMembersFormProps {
  video: {
    id: string;
    title: string;
    youtube_video_id: string | null;
    collaboration_type: string | null;
  };
  initialMembers: VideoMemberInput[];
  memberSuggestions: VideoMemberSuggestion[];
}

export function AdminVideoMembersForm({
  video,
  initialMembers,
  memberSuggestions,
}: AdminVideoMembersFormProps): React.ReactElement {
  const router = useRouter();
  const [isCollab, setIsCollab] = React.useState(
    video.collaboration_type === "collab" || initialMembers.length > 0,
  );
  const [pending, startTransition] = React.useTransition();
  const submitInFlightRef = React.useRef(false);
  const [result, setResult] = React.useState<VideoActionResult | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || submitInFlightRef.current) return;
    const formData = new FormData(event.currentTarget);
    setResult(null);
    submitInFlightRef.current = true;
    startTransition(async () => {
      try {
        const next = await updateVideoMembersAdmin(formData);
        const currentPath =
          typeof window === "undefined"
            ? "/"
            : `${window.location.pathname}${window.location.search}`;
        if (!next.ok && redirectForGuardReason(router, next.reason, currentPath)) {
          return;
        }
        setResult(next);
        if (next.ok) router.refresh();
      } catch (error) {
        console.error("[AdminVideoMembersForm] submit failed", error);
        setResult({
          ok: false,
          message: "保存中に予期しないエラーが発生しました。もう一度お試しください。",
        });
      } finally {
        submitInFlightRef.current = false;
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="fn-card" style={{ display: "grid", gap: 18 }}>
      <input type="hidden" name="video_id" value={video.id} />
      <input type="hidden" name="is_collab" value="false" />

      <header style={{ display: "grid", gap: 8 }}>
        <span className="fn-badge fn-badge-soft">Participants</span>
        <h2 style={{ margin: 0, fontSize: 20 }}>参加者設定</h2>
        <p className="fn-muted" style={{ margin: 0, lineHeight: 1.8 }}>
          複数人参加作品の公開メンバーとメンバーチャプターを管理します。
          既存メンバーがある作品は合作作品として扱います。
        </p>
      </header>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-surface)",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        <input
          type="checkbox"
          name="is_collab"
          value="true"
          checked={isCollab}
          onChange={(e) => setIsCollab(e.target.checked)}
          disabled={pending}
        />
        この作品を合作作品として登録する
      </label>

      {isCollab ? (
        <VideoMembersField
          initialMembers={initialMembers}
          suggestions={memberSuggestions}
          disabled={pending}
        />
      ) : (
        <section
          style={{
            padding: 16,
            border: "1px dashed var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-muted)",
          }}
        >
          合作をOFFにすると、保存時に公開参加者とメンバーチャプターを空にします。
        </section>
      )}

      {result ? (
        <div role={result.ok ? "status" : "alert"} style={{ justifySelf: "start" }}>
          <p
            className={result.ok ? "fn-badge fn-badge-accent" : "fn-badge fn-badge-danger"}
            style={{ justifySelf: "start" }}
          >
            {result.message ?? (result.ok ? "保存しました。" : "保存に失敗しました。")}
          </p>
          {result.ok && result.pendingPublicReflection ? (
            <div style={{ marginTop: 8 }}>
              <PublicReflectionDelayNotice />
            </div>
          ) : null}
        </div>
      ) : null}

      <footer style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="submit" className="fn-btn fn-btn-primary" disabled={pending}>
          <Icon name="check" size={14} aria-hidden />
          {pending ? "保存中..." : "参加者設定を保存"}
        </button>
        <Link href={`/admin/videos/${video.id}`} className="fn-btn fn-btn-ghost">
          詳細へ戻る
        </Link>
        <Link
          href={`/${video.youtube_video_id ?? video.id}`}
          className="fn-btn fn-btn-ghost"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="external" size={12} aria-hidden />
          公開ページ
        </Link>
      </footer>
    </form>
  );
}
