import * as React from "react";
import { validateChapterTime } from "../../../../packages/domain/src/video/chapterTime.ts";
import {
  ACTIVE_X_BEFORE_SWITCH_EVENT,
  ACTIVE_X_CHANGED_EVENT,
} from "../../../../src/lib/client/activeXSwitchEvents.ts";
import {
  createChapter,
  createChaptersBulk,
  updateChapter,
  deleteChapter,
} from "../lib/chapterWrite.ts";

/**
 * MIG-0518 U02: isolated ChapterComposer/ChapterCommentPanel write controls.
 * The owner of VideoPageIsland.ts (#452) mounts this after viewerOverlay arrives.
 * Do not render authenticated controls in Astro static HTML (JS-disabled parity).
 */
export interface EditableChapter {
  id: string;
  chapter_time: string;
  chapter_label: string;
  note?: string | null;
  visibility: "public" | "private";
  /** Caller derives this from the authenticated viewer overlay; server checks again. */
  canManage: boolean;
}

export interface VideoChapterIslandProps {
  videoId: string;
  activeXId: string | null;
  canPost: boolean;
  canBulk?: boolean;
  settingsHref?: string;
  chapters?: readonly EditableChapter[];
  onChanged?: () => void;
}

const h = React.createElement;
const NETWORK_ERROR = "通信エラーが発生しました。状態を再取得してもう一度お試しください。";

export function videoChapterDraftIsDirty(
  time: string,
  label: string,
  note: string,
  csv: string,
): boolean {
  return Boolean(time.trim() || label.trim() || note.trim() || csv.trim());
}

export function VideoChapterIsland({
  videoId,
  activeXId,
  canPost,
  canBulk = false,
  settingsHref = "/dashboard/settings",
  chapters = [],
  onChanged,
}: VideoChapterIslandProps): React.ReactElement | null {
  const [mounted, setMounted] = React.useState(false);
  const [time, setTime] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [visibility, setVisibility] = React.useState<"public" | "private">("public");
  const [bulkCsv, setBulkCsv] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [bulkErrors, setBulkErrors] = React.useState<readonly string[]>([]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const pending = React.useRef(false);
  const epoch = React.useRef(0);
  const draftRef = React.useRef({ time, label, note, bulkCsv });
  draftRef.current = { time, label, note, bulkCsv };

  React.useEffect(() => { setMounted(true); }, []);
  React.useEffect(() => {
    const before = (event: Event) => {
      const d = draftRef.current;
      if (!videoChapterDraftIsDirty(d.time, d.label, d.note, d.bulkCsv)) return;
      if (!window.confirm("入力中のチャプター情報があります。Active X ID を切り替えると内容が失われます。切り替えますか？")) {
        event.preventDefault();
      }
    };
    const changed = () => {
      // In-flight successful writes are never displayed as the new viewer's result.
      epoch.current += 1;
      setTime(""); setLabel(""); setNote(""); setBulkCsv("");
      setEditingId(null); setMessage(""); setError(""); setBulkErrors([]);
    };
    window.addEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, before);
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, changed);
    return () => {
      window.removeEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, before);
      window.removeEventListener(ACTIVE_X_CHANGED_EVENT, changed);
    };
  }, []);

  const ready = mounted && Boolean(activeXId?.trim()) && canPost;
  const start = (): number | null => {
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    return epoch.current;
  };
  const end = (generation: number) => {
    pending.current = false;
    setBusy(false);
    return generation === epoch.current;
  };
  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    if (!label.trim()) { setError("タイトルを入力してください。"); return; }
    const parsedTime = validateChapterTime(time);
    if (!parsedTime.ok) { setError(parsedTime.message); return; }
    const generation = start();
    if (generation === null) return;
    try {
      const body = {
        chapter_time: time.trim(),
        chapter_label: label.trim(),
        note: note.trim(),
        visibility,
      };
      const result = editingId
        ? await updateChapter(editingId, body)
        : await createChapter(videoId, { ...body, active_x_snapshot: activeXId!.trim() });
      if (!end(generation)) return;
      if (!result.ok) { setError(result.message ?? "投稿に失敗しました。"); return; }
      setTime(""); setLabel(""); setNote(""); setEditingId(null);
      setMessage(result.pendingPublicReflection
        ? "保存しました。公開ページへの反映には時間がかかる場合があります。"
        : "保存しました。");
      onChanged?.();
    } catch {
      if (end(generation)) setError(NETWORK_ERROR);
    }
  };
  const onBulk = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || !canBulk) return;
    const csv = bulkCsv.trim();
    if (!csv) { setError("CSV を貼り付けてください。"); return; }
    const generation = start();
    if (generation === null) return;
    try {
      const result = await createChaptersBulk(videoId, { csv, active_x_snapshot: activeXId!.trim() });
      if (!end(generation)) return;
      setBulkErrors(result.errors ?? []);
      if (!result.ok) { setError(result.message ?? "一括登録に失敗しました。"); return; }
      setBulkCsv("");
      setMessage(result.pendingPublicReflection
        ? `${result.message ?? "一括登録しました。"} 公開ページへの反映には時間がかかる場合があります。`
        : (result.message ?? "一括登録しました。"));
      onChanged?.();
    } catch {
      if (end(generation)) setError(NETWORK_ERROR);
    }
  };
  const onDelete = async (id: string) => {
    if (!ready || pending.current || !window.confirm("このチャプターを削除しますか？")) return;
    const generation = start();
    if (generation === null) return;
    try {
      const result = await deleteChapter(id);
      if (!end(generation)) return;
      if (!result.ok) { setError(result.message ?? "削除に失敗しました。"); return; }
      setMessage(result.message ?? "チャプターを削除しました。");
      onChanged?.();
    } catch {
      if (end(generation)) setError(NETWORK_ERROR);
    }
  };

  // Neither pre-rendered HTML nor a signed-out visitor can submit a chapter.
  if (!mounted) return null;
  if (!ready) {
    return h("section", { "aria-label": "チャプター投稿" },
      h("p", null, "承認済み X ID を選択するとチャプターを投稿できます。"),
      h("a", { href: settingsHref }, "X ID設定へ"));
  }
  return h("section", { "aria-label": "チャプター投稿" },
    h("h3", null, "チャプターコメント投稿"),
    error ? h("p", { role: "alert" }, error) : null,
    message ? h("p", { role: "status" }, message) : null,
    h("form", { onSubmit },
      h("label", null, "時刻", h("input", {
        type: "text", value: time, maxLength: 32, required: true,
        placeholder: "mm:ss", disabled: busy, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTime(e.target.value),
      })),
      h("label", null, "タイトル", h("input", {
        type: "text", value: label, maxLength: 120, required: true,
        disabled: busy, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value),
      })),
      h("label", null, "コメント", h("textarea", {
        value: note, maxLength: 1000, disabled: busy,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value),
      })),
      h("label", null, h("input", {
        type: "checkbox", checked: visibility === "public", disabled: busy,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setVisibility(e.target.checked ? "public" : "private"),
      }), "公開"),
      h("button", { type: "submit", disabled: busy }, busy ? "送信中…" : editingId ? "更新" : "投稿"),
      editingId ? h("button", {
        type: "button", disabled: busy,
        onClick: () => { setEditingId(null); setTime(""); setLabel(""); setNote(""); },
      }, "キャンセル") : null,
    ),
    chapters.filter((chapter) => chapter.canManage).map((chapter) =>
      h("div", { key: chapter.id },
        h("span", null, chapter.chapter_label),
        h("button", {
          type: "button", disabled: busy,
          onClick: () => {
            setEditingId(chapter.id);
            setTime(chapter.chapter_time);
            setLabel(chapter.chapter_label);
            setNote(chapter.note ?? "");
            setVisibility(chapter.visibility);
            setError(""); setMessage("");
          },
        }, "編集"),
        h("button", {
          type: "button", disabled: busy,
          onClick: () => { void onDelete(chapter.id); },
        }, "削除"),
      ),
    ),
    canBulk ? h("details", null,
      h("summary", null, "CSV で一括登録 (動画オーナーのみ)"),
      h("form", { onSubmit: onBulk },
        h("label", null, "CSV", h("textarea", {
          value: bulkCsv, maxLength: 64 * 1024, disabled: busy,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setBulkCsv(e.target.value),
        })),
        h("button", { type: "submit", disabled: busy || !bulkCsv.trim() }, "一括登録"),
        bulkErrors.length ? h("ul", null,
          ...bulkErrors.slice(0, 8).map((value, i) => h("li", { key: i }, value)),
        ) : null,
      ),
    ) : null,
  );
}
export default VideoChapterIsland;
