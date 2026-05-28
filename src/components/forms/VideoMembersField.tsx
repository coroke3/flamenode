"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { normalizeXId } from "@/lib/utils/xid";
import { parseCsv } from "@/lib/utils/csv";

export interface VideoMemberChapterInput {
  time: string;
  label: string;
  note: string;
}

export interface VideoMemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
  /**
   * メンバーチャプター。time / label / note の組を 0 件以上持つ。
   * サーバー側 (replaceVideoMembers) で video_members.chapters_json に保存される。
   */
  chapters?: VideoMemberChapterInput[];
}

export interface VideoMemberSuggestion {
  name: string;
  x_user_id: string;
}

interface VideoMembersFieldProps {
  initialMembers?: VideoMemberInput[];
  suggestions?: VideoMemberSuggestion[];
  hiddenName?: string;
  disabled?: boolean;
}

const EMPTY_ROW: VideoMemberInput = {
  name: "",
  x_user_id: "",
  role: "",
  comment: "",
  chapters: [],
};

/** メンバーキー (CSV 差分追加用)。X ID 優先、なければ名前 (lowercase trim)。 */
function memberKey(m: VideoMemberInput): string {
  const xid = normalizeXId(m.x_user_id);
  if (xid) return `x:${xid}`;
  return `n:${m.name.trim().toLowerCase()}`;
}

/** チャプター重複キー: `${memberKey}:${mm:ss}` */
function chapterKey(mk: string, ch: VideoMemberChapterInput): string {
  return `${mk}:${normalizeMemberChapterTime(ch.time) ?? ch.time.trim()}`;
}

function normalizeMemberChapterTime(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,4}):([0-5]?\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    return null;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function splitChapterTimes(raw: string): string[] {
  return raw
    .split(/[;\s,、]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeChapterCell(raw: string | undefined): boolean {
  if (!raw) return false;
  if (raw.includes("|")) return true;
  return splitChapterTimes(raw).some((part) => normalizeMemberChapterTime(part));
}

/** CSV chapters セル。新形式は "0:12;1:05"、旧形式 "time|label|note" も読む。 */
function parseChaptersCell(cell: string): VideoMemberChapterInput[] {
  const out: VideoMemberChapterInput[] = [];
  for (const raw of cell.split(/[;\n]/)) {
    const t = raw.trim();
    if (!t) continue;
    if (!t.includes("|")) {
      for (const timeRaw of splitChapterTimes(t)) {
        const time = normalizeMemberChapterTime(timeRaw) ?? timeRaw;
        out.push({ time, label: "", note: "" });
      }
      continue;
    }
    const cols = t.split("|");
    const time = normalizeMemberChapterTime(cols[0] ?? "") ?? (cols[0] ?? "").trim();
    const label = (cols[1] ?? "").trim();
    const note = (cols[2] ?? "").trim();
    if (!time) continue;
    out.push({ time, label, note });
  }
  return out;
}

/** chapters の配列を CSV セル形式 "0:12;1:05" に直列化する。 */
function serializeChaptersCell(chapters: VideoMemberChapterInput[]): string {
  return chapters
    .map((c) => normalizeMemberChapterTime(c.time) ?? c.time.trim())
    .filter(Boolean)
    .join(";");
}

function headerIndex(headers: string[], aliases: string[]): number | null {
  const normalizedAliases = aliases.map((a) => a.trim().toLowerCase());
  const index = headers.findIndex((header) =>
    normalizedAliases.includes(header.trim().toLowerCase()),
  );
  return index >= 0 ? index : null;
}

function chapterLabelForMember(member: VideoMemberInput): string {
  const xid = normalizeXId(member.x_user_id);
  return member.role.trim() || member.name.trim() || (xid ? `@${xid}` : "担当");
}

export function VideoMembersField({
  initialMembers = [],
  suggestions = [],
  hiddenName = "members_json",
  disabled = false,
}: VideoMembersFieldProps): React.ReactElement {
  const [rows, setRows] = React.useState<VideoMemberInput[]>(() =>
    initialMembers.length > 0 ? initialMembers : [{ ...EMPTY_ROW }],
  );
  const [copied, setCopied] = React.useState(false);

  // /api/internal/x-users/search からの追加候補 (debounce 検索)
  const [fetched, setFetched] = React.useState<VideoMemberSuggestion[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchStatus, setSearchStatus] = React.useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [searchHint, setSearchHint] = React.useState<string | null>(null);
  const [searchHasMore, setSearchHasMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);

  const fetchSuggestions = React.useCallback(
    async (q: string, offset: number, signal?: AbortSignal) => {
      if (disabled) return;
      setSearchStatus("loading");
      setSearchHint(null);
      try {
        const res = await fetch(
          `/api/internal/x-users/search?q=${encodeURIComponent(q)}&limit=20&offset=${offset}`,
          { signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error("search_failed");
        const json = (await res.json()) as {
          items?: { id: string; x_name: string | null }[];
          hasMore?: boolean;
          nextOffset?: number | null;
          hint?: string | null;
        };
        const items = (json.items ?? []).map((r) => ({
          name: r.x_name ?? r.id,
          x_user_id: r.id,
        }));
        setFetched((prev) => {
          const map = new Map<string, VideoMemberSuggestion>();
          if (offset > 0) {
            for (const s of prev) map.set(normalizeXId(s.x_user_id), s);
          }
          for (const s of items) map.set(normalizeXId(s.x_user_id), s);
          return Array.from(map.values());
        });
        setSearchHasMore(Boolean(json.hasMore));
        setNextOffset(
          typeof json.nextOffset === "number" ? json.nextOffset : null,
        );
        setSearchHint(
          items.length === 0 && offset === 0
            ? "候補が見つかりません。X ID の表記や文字数を確認してください。"
            : (json.hint ?? null),
        );
        setSearchStatus("done");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSearchStatus("error");
        setSearchHint("候補の取得に失敗しました。少し待って再入力してください。");
      }
    },
    [disabled],
  );

  React.useEffect(() => {
    const q = searchQuery.trim();
    if (disabled || q.length < 2) {
      setFetched([]);
      setSearchStatus("idle");
      setSearchHint(q.length === 1 ? "2文字以上で候補を検索します。" : null);
      setSearchHasMore(false);
      setNextOffset(null);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      void fetchSuggestions(q, 0, controller.signal);
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [disabled, fetchSuggestions, searchQuery]);

  // props + fetched を id ベースで重複排除して 1 つの suggestion 配列にまとめる
  const mergedSuggestions = React.useMemo(() => {
    const map = new Map<string, VideoMemberSuggestion>();
    for (const s of suggestions) map.set(normalizeXId(s.x_user_id), s);
    for (const s of fetched) {
      const key = normalizeXId(s.x_user_id);
      if (!map.has(key)) map.set(key, s);
    }
    return Array.from(map.values());
  }, [suggestions, fetched]);

  const suggestionsById = React.useMemo(() => {
    const map = new Map<string, VideoMemberSuggestion>();
    for (const s of mergedSuggestions) map.set(normalizeXId(s.x_user_id), s);
    return map;
  }, [mergedSuggestions]);

  const suggestionsByName = React.useMemo(() => {
    const map = new Map<string, VideoMemberSuggestion>();
    for (const s of mergedSuggestions) {
      const key = s.name.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, s);
    }
    return map;
  }, [mergedSuggestions]);

  const update = (i: number, patch: Partial<VideoMemberInput>) => {
    if (disabled) return;
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const fillFromName = (i: number, name: string) => {
    if (disabled) return;
    const hit = suggestionsByName.get(name.trim().toLowerCase());
    if (!hit) return;
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === i && !row.x_user_id
          ? { ...row, x_user_id: hit.x_user_id, name: row.name || hit.name }
          : row,
      ),
    );
  };

  const fillFromXId = (i: number, xid: string) => {
    if (disabled) return;
    const hit = suggestionsById.get(normalizeXId(xid));
    if (!hit) return;
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === i && !row.name
          ? { ...row, name: hit.name, x_user_id: normalizeXId(row.x_user_id) }
          : idx === i
            ? { ...row, x_user_id: normalizeXId(row.x_user_id) }
            : row,
      ),
    );
  };

  const add = () => {
    if (disabled) return;
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  };
  const remove = (i: number) =>
    !disabled && setRows((prev) => prev.filter((_, idx) => idx !== i));

  const copyCsvPrompt = async () => {
    // 既存メンバーを 5 列 CSV に直列化 (空メンバーは除外)
    const existing = rows
      .filter((r) => r.name.trim() || r.x_user_id.trim())
      .map((r) => {
        const chapters = serializeChaptersCell(r.chapters ?? []);
        const cells = [
          r.name.trim(),
          normalizeXId(r.x_user_id),
          chapters,
          r.role.trim(),
          r.comment.trim(),
        ].map((c) => {
          // CSV 内に , か " か改行があれば quote
          if (/[",\n]/.test(c)) return `"${c.replace(/"/g, '""')}"`;
          return c;
        });
        return cells.join(",");
      })
      .join("\n");

    const hasExisting = existing.length > 0;
    const lines = [
      "次の情報を FlameNode の合作メンバー CSV に整形してください。",
      "",
      "出力は CSV 本文のみ。",
      "列は 活動名,ID,チャプター,役割,コメント の5列です。",
      "x_user_id は @ を外してください。不明なら空欄にしてください。",
      "チャプターは mm:ss だけを入力してください。複数ある場合は ; 区切りで指定できます (例: 0:12;1:05)。",
      "既存データと重複する項目は出力せず、追加・修正が必要な差分だけを出力してください。",
      "",
      hasExisting ? "既存データ:" : "既存データ (空):",
      "活動名,ID,チャプター,役割,コメント",
    ];
    if (hasExisting) lines.push(existing);
    lines.push("");
    lines.push("追加したい情報:");
    lines.push("(ここに貼り付けてください)");

    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const text = e.clipboardData.getData("text");
    if (!text || !/[\n,]/.test(text)) return;
    e.preventDefault();
    let rowsRaw = parseCsv(text);
    if (rowsRaw.length === 0) return;
    // 1行目がヘッダー (name/x_user_id/chapters のいずれかを含む) ならスキップ
    const firstLower = rowsRaw[0]!.map((c) => c.trim().toLowerCase());
    const header = {
      name: headerIndex(firstLower, ["活動名", "name", "display_name"]),
      xid: headerIndex(firstLower, ["id", "x id", "x_id", "x_user_id", "xid"]),
      chapters: headerIndex(firstLower, ["チャプター", "chapter", "chapters"]),
      role: headerIndex(firstLower, ["役割", "role"]),
      comment: headerIndex(firstLower, ["コメント", "comment"]),
    };
    const hasHeader = Object.values(header).some((index) => index !== null);
    if (hasHeader) {
      rowsRaw = rowsRaw.slice(1);
    }

    // CSV 1 行 → VideoMemberInput (5 列目があれば chapters を読む)
    const parsed = rowsRaw
      .map((cols): VideoMemberInput => {
        const oldOrder =
          !hasHeader &&
          looksLikeChapterCell(cols[4]) &&
          !looksLikeChapterCell(cols[2]);
        const nameRaw = cols[header.name ?? 0] ?? "";
        const xidRaw = cols[header.xid ?? 1] ?? "";
        const chaptersRaw = hasHeader
          ? (cols[header.chapters ?? 2] ?? "")
          : oldOrder
            ? (cols[4] ?? "")
            : (cols[2] ?? "");
        const roleRaw = hasHeader
          ? (cols[header.role ?? 3] ?? "")
          : oldOrder
            ? (cols[2] ?? "")
            : (cols[3] ?? "");
        const commentRaw = hasHeader
          ? (cols[header.comment ?? 4] ?? "")
          : oldOrder
            ? (cols[3] ?? "")
            : (cols[4] ?? "");
        const xid = normalizeXId(xidRaw);
        const hit = xid ? suggestionsById.get(xid) : null;
        const chapters = parseChaptersCell(chaptersRaw);
        return {
          name: nameRaw.trim() || hit?.name || "",
          x_user_id: xid,
          role: roleRaw.trim(),
          comment: commentRaw.trim(),
          chapters,
        };
      })
      .filter((r) => r.name || r.x_user_id);
    if (parsed.length === 0) return;

    // 差分追加: 既存メンバーと同じキーなら、空欄でない role / comment / chapters を補完。
    // チャプターは重複キー (memberKey:sec:labelLower) を避けて追加する。
    setRows((prev) => {
      const next = prev.map((p) => ({ ...p, chapters: [...(p.chapters ?? [])] }));
      const idx = new Map<string, number>();
      next.forEach((r, i) => idx.set(memberKey(r), i));
      for (const p of parsed) {
        const k = memberKey(p);
        const existIdx = idx.get(k);
        if (existIdx === undefined) {
          // 新規メンバー追加 (chapters は必ず配列に正規化)
          next.push({ ...p, chapters: p.chapters ?? [] });
          idx.set(k, next.length - 1);
        } else {
          // 既存メンバー: 空欄でないフィールドだけ補完
          const target = next[existIdx]!;
          if (!target.role && p.role) target.role = p.role;
          if (!target.comment && p.comment) target.comment = p.comment;
          if (!target.name && p.name) target.name = p.name;
          // チャプターは重複キーを除いてマージ
          const targetChapters = target.chapters ?? [];
          const knownKeys = new Set<string>(
            targetChapters.map((c) => chapterKey(k, c)),
          );
          for (const ch of p.chapters ?? []) {
            const key = chapterKey(k, ch);
            if (knownKeys.has(key)) continue;
            knownKeys.add(key);
            targetChapters.push(ch);
          }
          target.chapters = targetChapters;
        }
      }
      // 空行 (name/x_user_id どちらも空) は除去
      return next.filter((r) => r.name || r.x_user_id);
    });
  };

  const payload = React.useMemo(() => {
    const cleaned = rows
      .map((r) => ({
        name: r.name.trim(),
        x_user_id: normalizeXId(r.x_user_id),
        role: r.role.trim(),
        comment: r.comment.trim(),
        chapters: (r.chapters ?? [])
          .map((c) => {
            const time = normalizeMemberChapterTime(c.time);
            if (!time) return null;
            return {
              time,
              label: c.label.trim() || chapterLabelForMember(r),
              note: c.note.trim(),
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null),
      }))
      .filter((r) => r.name || r.x_user_id);
    return JSON.stringify(cleaned);
  }, [rows]);

  // メンバー行ごとのチャプター行を編集するヘルパー
  const updateChapterTimes = (i: number, raw: string) => {
    if (disabled) return;
    const chapters = splitChapterTimes(raw).map((time) => ({
      time,
      label: "",
      note: "",
    }));
    setRows((prev) =>
      prev.map((r, idx) =>
        idx === i
          ? { ...r, chapters }
          : r,
      ),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name={hiddenName} value={payload} />
      <datalist id="member-name-suggestions">
        {mergedSuggestions.map((s) => (
          <option key={`${s.x_user_id}-name`} value={s.name}>
            @{s.x_user_id}
          </option>
        ))}
      </datalist>
      <datalist id="member-xid-suggestions">
        {mergedSuggestions.map((s) => (
          <option key={`${s.x_user_id}-xid`} value={s.x_user_id}>
            {s.name}
          </option>
        ))}
      </datalist>

      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        名前または XID を入力すると、既存のクリエイター情報からもう片方を提案します。作品ごとに表示名は変更できます。
      </p>
      {searchQuery.trim().length > 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          {searchStatus === "loading"
            ? "候補を検索中..."
            : (searchHint ?? `${mergedSuggestions.length}件の候補を表示しています。`)}
        </p>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(150px, 1.2fr) minmax(120px, 0.9fr) minmax(118px, 0.8fr) minmax(120px, 0.85fr) minmax(160px, 1.2fr) auto",
          gap: 6,
          alignItems: "center",
          fontSize: 11,
          color: "var(--text-muted)",
          minWidth: 820,
        }}
      >
        <span>活動名</span>
        <span>X ID</span>
        <span>チャプター</span>
        <span>役割</span>
        <span>コメント</span>
        <span></span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(150px, 1.2fr) minmax(120px, 0.9fr) minmax(118px, 0.8fr) minmax(120px, 0.85fr) minmax(160px, 1.2fr) auto",
            gap: 6,
            alignItems: "center",
            minWidth: 820,
          }}
        >
          <input
            type="text"
            value={r.name}
            onChange={(e) => {
              update(i, { name: e.target.value });
              setSearchQuery(e.target.value);
            }}
            onBlur={(e) => fillFromName(i, e.target.value)}
            placeholder="表示名"
            className="fn-input"
            maxLength={80}
            list="member-name-suggestions"
            disabled={disabled}
          />
          <input
            type="text"
            value={r.x_user_id}
            onChange={(e) => {
              update(i, { x_user_id: e.target.value });
              setSearchQuery(e.target.value);
            }}
            onBlur={(e) => fillFromXId(i, e.target.value)}
            placeholder="@なし"
            className="fn-input"
            maxLength={32}
            pattern="[A-Za-z0-9_]*"
            list="member-xid-suggestions"
            disabled={disabled}
          />
          <input
            type="text"
            value={serializeChaptersCell(r.chapters ?? [])}
            onChange={(e) => updateChapterTimes(i, e.target.value)}
            placeholder="0:12;1:05"
            title="mm:ss 形式。複数ある場合は ; 区切り"
            className="fn-input"
            maxLength={80}
            disabled={disabled}
          />
          <input
            type="text"
            value={r.role}
            onChange={(e) => update(i, { role: e.target.value })}
            placeholder="作画 / 編集 / 音響など"
            className="fn-input"
            maxLength={40}
            disabled={disabled}
          />
          <input
            type="text"
            value={r.comment}
            onChange={(e) => update(i, { comment: e.target.value })}
            placeholder="任意コメント"
            className="fn-input"
            maxLength={200}
            disabled={disabled}
          />
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => remove(i)}
            aria-label="この行を削除"
            disabled={disabled}
          >
            <Icon name="trash" size={11} aria-hidden />
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={add}
          disabled={disabled}
        >
          <Icon name="plus" size={11} aria-hidden /> 行を追加
        </button>
        {searchHasMore && nextOffset !== null ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => void fetchSuggestions(searchQuery.trim(), nextOffset)}
            disabled={disabled || searchStatus === "loading"}
          >
            候補をさらに読み込む
          </button>
        ) : null}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          CSV形式でまとめて貼り付け
        </summary>
        <textarea
          className="fn-input"
          rows={4}
          style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}
          placeholder={"例:\n田中,tanaka,0:12,作画,よろしく\n佐藤,sato_design,1:05;1:42,音響,"}
          onPaste={onPaste}
          disabled={disabled}
        />
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={copyCsvPrompt}
          style={{ marginTop: 8 }}
          disabled={disabled}
        >
          <Icon name="copy" size={11} aria-hidden />
          {copied ? "コピーしました" : "CSV作成プロンプトをコピー"}
        </button>
      </details>
    </div>
  );
}
