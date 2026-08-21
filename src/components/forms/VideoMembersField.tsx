"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { normalizeXId } from "@/lib/utils/xid";
import {
  chapterKey,
  memberKey,
  normalizeMemberChapterTime,
  parseVideoMemberText,
  serializeChaptersCell,
  serializeVideoMemberTsv,
  splitChapterTimes,
  type VideoMemberInput,
  type VideoMemberSuggestion,
} from "@/lib/video/memberInput";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import { scoreSimpleMemberSuggestion } from "@/lib/video/memberSuggestionRank";
import { writeTextToClipboard } from "@/lib/utils/clipboard";
import {
  applyVideoCollaboratorPermissionsBatch,
} from "@/lib/actions/video-collab-perms";
import { MAX_COLLABORATOR_PERMISSION_BATCH } from "@/lib/video/atomicLimits";
import styles from "./VideoForm.module.css";

export type {
  VideoMemberChapterInput,
  VideoMemberInput,
  VideoMemberSuggestion,
} from "@/lib/video/memberInput";

interface VideoMembersFieldProps {
  initialMembers?: VideoMemberInput[];
  suggestions?: VideoMemberSuggestion[];
  hiddenName?: string;
  disabled?: boolean;
  chaptersDisabled?: boolean;
  /** 正規化後の有効メンバー一覧。入力・追加・削除・並び替え・CSV反映のすべてで通知する。 */
  onChange?: (members: VideoMemberInput[]) => void;
  /** 設定時は「編集できる人」セクションへ誘導するリンクを表示 */
  collabPermsHref?: string;
  /**
   * 既存作品の編集画面など、TSV権限列をServer Actionで反映できる対象作品ID。
   * 未指定（新規投稿など）のときは権限列を反映せず、その旨を明示する。
   */
  permissionTargetVideoId?: string | null;
}

const EMPTY_ROW: VideoMemberInput = {
  name: "",
  x_user_id: "",
  role: "",
  comment: "",
  chapters: [],
};

function chapterLabelForMember(member: VideoMemberInput): string {
  const xid = normalizeXId(member.x_user_id);
  return member.role.trim() || member.name.trim() || (xid ? `@${xid}` : "担当");
}

function stripCsvEditFlags(members: VideoMemberInput[]): VideoMemberInput[] {
  return members.map((m) => {
    const { can_edit: _ce, ...rest } = m;
    return { ...rest, chapters: rest.chapters ?? [] };
  });
}

function normalizeMemberRows(rows: VideoMemberInput[]): VideoMemberInput[] {
  return rows
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
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError"),
  );
}

export function VideoMembersField({
  initialMembers = [],
  suggestions = [],
  hiddenName = "members_json",
  disabled = false,
  chaptersDisabled = false,
  onChange,
  collabPermsHref,
  permissionTargetVideoId,
}: VideoMembersFieldProps): React.ReactElement {
  const [rows, setRows] = React.useState<VideoMemberInput[]>(() =>
    initialMembers.length > 0 ? initialMembers : [{ ...EMPTY_ROW }],
  );
  const [viewMode, setViewMode] = React.useState<"card" | "table">(() =>
    initialMembers.length >= 8 ? "table" : "card",
  );
  const [copied, setCopied] = React.useState(false);
  const [copiedLabel, setCopiedLabel] = React.useState<string | null>(null);
  const [bulkWarning, setBulkWarning] = React.useState<string | null>(null);
  // 連続コピー時に前のタイマーが新しい「コピーしました」表示を即座に消さないよう管理する。
  const copiedTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // /api/internal/x-users/search からの追加候補 (debounce 検索)
  const [fetched, setFetched] = React.useState<VideoMemberSuggestion[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchStatus, setSearchStatus] = React.useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [searchHint, setSearchHint] = React.useState<string | null>(null);
  const [searchHasMore, setSearchHasMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const suggestionRequestIdRef = React.useRef(0);
  const loadMoreControllerRef = React.useRef<AbortController | null>(null);

  const fetchSuggestions = React.useCallback(
    async (q: string, offset: number, signal?: AbortSignal) => {
      if (disabled) return;
      const requestId = ++suggestionRequestIdRef.current;
      setSearchStatus("loading");
      setSearchHint(null);
      try {
        const res = await fetch(
          `/api/internal/x-users/search?q=${encodeURIComponent(q)}&limit=20&offset=${offset}`,
          { signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error("search_failed");
        const json = (await res.json()) as {
          items?: {
            id: string;
            x_name: string | null;
            score?: number;
            matchedBy?: string;
          }[];
          hasMore?: boolean;
          nextOffset?: number | null;
          hint?: string | null;
        };
        const items = (json.items ?? []).map(
          (row) => ({
            name: row.x_name ?? row.id,
            x_user_id: row.id,
            score: row.score,
            matchedBy: row.matchedBy,
          }),
        );
        if (signal?.aborted || requestId !== suggestionRequestIdRef.current) return;
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
        if (
          isAbortError(e) ||
          signal?.aborted ||
          requestId !== suggestionRequestIdRef.current
        ) {
          return;
        }
        setSearchStatus("error");
        setSearchHint("候補の取得に失敗しました。少し待って再入力してください。");
      }
    },
    [disabled],
  );

  React.useEffect(() => {
    const q = searchQuery.trim();
    if (disabled || q.length < 1) {
      suggestionRequestIdRef.current += 1;
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
      setFetched([]);
      setSearchStatus("idle");
      setSearchHint(null);
      setSearchHasMore(false);
      setNextOffset(null);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      void fetchSuggestions(q, 0, controller.signal);
    }, 150);
    return () => {
      controller.abort();
      suggestionRequestIdRef.current += 1;
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
      window.clearTimeout(t);
    };
  }, [disabled, fetchSuggestions, searchQuery]);

  const loadMoreSuggestions = React.useCallback(() => {
    if (disabled || nextOffset === null) return;
    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    void fetchSuggestions(searchQuery.trim(), nextOffset, controller.signal).finally(() => {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
      }
    });
  }, [disabled, fetchSuggestions, nextOffset, searchQuery]);

  // props + fetched を id ベースで重複排除して 1 つの suggestion 配列にまとめる
  const mergedSuggestions =
    React.useMemo(() => {
      const map = new Map<
        string,
        VideoMemberSuggestion
      >();

      for (const suggestion of suggestions) {
        const key = normalizeXId(
          suggestion.x_user_id,
        );
        if (key) map.set(key, suggestion);
      }

      // API検索結果を優先し、サーバー側scoreを保持
      for (const suggestion of fetched) {
        const key = normalizeXId(
          suggestion.x_user_id,
        );
        if (key) map.set(key, suggestion);
      }

      const query = searchQuery.trim();

      return Array.from(map.values())
        .map((suggestion) => ({
          ...suggestion,
          score:
            suggestion.score ??
            scoreSimpleMemberSuggestion(
              query,
              suggestion,
            ),
        }))
        .sort(
          (left, right) =>
            (right.score ?? 0) -
              (left.score ?? 0) ||
            left.name.localeCompare(
              right.name,
              "ja",
            ) ||
            left.x_user_id.localeCompare(
              right.x_user_id,
            ),
        );
    }, [
      suggestions,
      fetched,
      searchQuery,
    ]);

  // 空入力時は候補0件。preloadされたsuggestionsも空queryでは出さない。
  const visibleSuggestions = searchQuery.trim()
    ? mergedSuggestions.slice(0, 20)
    : [];

  const suggestionsById = React.useMemo(() => {
    const map = new Map<string, VideoMemberSuggestion>();
    for (const s of mergedSuggestions) map.set(normalizeXId(s.x_user_id), s);
    return map;
  }, [mergedSuggestions]);

  const suggestionsByName =
    React.useMemo(() => {
      const map = new Map<
        string,
        VideoMemberSuggestion[]
      >();

      for (const suggestion of mergedSuggestions) {
        const key = suggestion.name
          .trim()
          .normalize("NFKC")
          .toLowerCase();

        if (!key) continue;

        const current = map.get(key) ?? [];
        current.push(suggestion);
        map.set(key, current);
      }

      return map;
    }, [mergedSuggestions]);

  const update = (i: number, patch: Partial<VideoMemberInput>) => {
    if (disabled) return;
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const fillFromName = (
    index: number,
    name: string,
  ) => {
    if (disabled) return;

    const key = name
      .trim()
      .normalize("NFKC")
      .toLowerCase();

    const hits =
      suggestionsByName.get(key) ?? [];

    // 同名が複数存在する場合は自動決定しない
    if (hits.length !== 1) return;

    const hit = hits[0];

    setRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index &&
        !row.x_user_id
          ? {
              ...row,
              x_user_id:
                hit.x_user_id,
              name:
                row.name || hit.name,
            }
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
    setRows((prev) => {
      if (normalizeMemberRows(prev).length >= MAX_VIDEO_MEMBERS) return prev;
      return [...prev, { ...EMPTY_ROW }];
    });
  };
  const remove = (i: number) =>
    !disabled && setRows((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, direction: -1 | 1) => {
    if (disabled) return;
    setRows((prev) => {
      const nextIndex = i + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const current = next[i]!;
      next[i] = next[nextIndex]!;
      next[nextIndex] = current;
      return next;
    });
  };

  const copyWithLabel = async (text: string, label: string, failure: string) => {
    const ok = await writeTextToClipboard(text);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    if (!ok) {
      setBulkWarning(failure);
      setCopied(false);
      setCopiedLabel(null);
      return false;
    }
    setBulkWarning(null);
    setCopied(true);
    setCopiedLabel(label);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
      setCopiedLabel(null);
    }, 1800);
    return true;
  };

  /** 現在のメンバー表をTSV（常に6セル）としてクリップボードへコピーする。 */
  const copyTsv = async () => {
    const existing = rows.filter((r) => r.name.trim() || r.x_user_id.trim());
    if (existing.length === 0) return;
    await copyWithLabel(
      serializeVideoMemberTsv(existing),
      "TSVコピー",
      "TSVのコピーに失敗しました。",
    );
  };

  const buildAiPrompt = () => {
    // 既存メンバーがあればTSVとしてプロンプト末尾に添付する。
    const existing = rows
      .filter((r) => r.name.trim() || r.x_user_id.trim())
      .map((r) => ({
        name: r.name,
        x_user_id: r.x_user_id,
        role: r.role,
        comment: r.comment,
        chapters: r.chapters ?? [],
        can_edit: undefined,
      }));
    const existingTsv =
      existing.length > 0 ? serializeVideoMemberTsv(existing) : "";
    const lines = [
      "以下のメンバー情報を FlameNode 用TSVに変換してください。",
      "",
      "列順:",
      "1. ユーザー名",
      "2. X ID",
      "3. チャプター",
      "4. 役職",
      "5. コメント",
      "6. 権限",
      "",
      "1人につき1行、タブ区切りで出力してください。",
      "Markdownのコードブロックや説明文やヘッダーは付けないでください。",
      "",
      "X IDの先頭の@は外してください。",
      "",
      "チャプターは m:ss または mm:ss 形式にしてください。",
      "複数ある場合は ; で区切ってください。",
      "",
      "末尾の情報が不明なら、その列以降は省略できます。",
      "途中の列だけ不明で後の列に値がある場合は、空欄のままタブ位置を維持してください。",
      "",
      "権限は ON / OFF / 空欄 のいずれかにしてください。",
      "",
      "セル内にタブを含めないでください。",
    ];
    if (existing.length > 0) {
      lines.push("", "現在のメンバー（TSV・参考）:", existingTsv);
    }
    lines.push("", "追加・修正したい情報:");
    lines.push("(ここに貼り付けてください)");
    return lines.join("\n");
  };

  const copyAiPrompt = async () => {
    await copyWithLabel(buildAiPrompt(), "AIプロンプト", "プロンプトのコピーに失敗しました。");
  };

  const mergeCsvMembers = React.useCallback((parsed: VideoMemberInput[]) => {
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
      const normalized = next.filter((r) => r.name || r.x_user_id);
      return normalized.slice(0, MAX_VIDEO_MEMBERS);
    });
  }, []);

  // ---- TSV一括入力（スプレッドシート / AI）----
  const [bulkSource, setBulkSource] = React.useState<{ label: string; text: string }>({
    label: "spreadsheet",
    text: "",
  });
  const [aiText, setAiText] = React.useState("");
  const [bulkPreview, setBulkPreview] = React.useState<{
    members: VideoMemberInput[];
    warnings: string[];
    permissionIntents: { label: string; xid: string; intent: boolean }[];
    duplicateXids: Set<string>;
  } | null>(null);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = React.useState(false);
  const [permConfirmOpen, setPermConfirmOpen] = React.useState(false);
  const [permPending, setPermPending] = React.useState(false);
  const [permResult, setPermResult] = React.useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const pendingApplyRef = React.useRef<(() => void) | null>(null);

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const text = e.clipboardData.getData("text");
    if (!text || !/[\n\t,]/.test(text)) return;
    e.preventDefault();
    setBulkSource((prev) => ({ ...prev, text }));
    confirmBulk(text);
  };

  /** TSV/CSVテキストを解析してpreview table用の状態を作る。既存rowsは書き換えない。 */
  const confirmBulk = (text: string) => {
    if (!text.trim()) {
      setBulkWarning("TSVを入力してください。");
      setBulkPreview(null);
      return;
    }
    const parsed = parseVideoMemberText(text, {
      suggestions: mergedSuggestions,
      existingMembers: rows,
    });
    // 権限列はpermission intentとして分離して保持する（members_jsonへは流さない）。
    const intents = parsed.members
      .map((m) => ({
        label: m.name.trim() || (m.x_user_id ? `@${normalizeXId(m.x_user_id)}` : "名前未設定"),
        xid: normalizeXId(m.x_user_id),
        intent: m.can_edit === 1 || m.can_edit === true,
        hasIntent:
          m.can_edit === 1 ||
          m.can_edit === true ||
          m.can_edit === 0 ||
          m.can_edit === false,
      }))
      .filter((m) => m.hasIntent && m.xid)
      .map(({ label, xid, intent }) => ({ label, xid, intent }));

    const seen = new Set<string>();
    const duplicatedXids = new Set<string>();
    for (const member of parsed.members) {
      const xid = normalizeXId(member.x_user_id);
      if (!xid) continue;
      if (seen.has(xid)) duplicatedXids.add(xid);
      seen.add(xid);
    }
    const warnings = [...parsed.warnings];
    if (parsed.members.length > MAX_VIDEO_MEMBERS) {
      warnings.push(`合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。`);
    }
    if (intents.length > MAX_COLLABORATOR_PERMISSION_BATCH) {
      warnings.push(`権限列の反映は1回あたり${MAX_COLLABORATOR_PERMISSION_BATCH}人までです。`);
    }
    setBulkWarning(warnings.length > 0 ? warnings.join(" / ") : null);
    setBulkPreview({
      members: parsed.members,
      warnings,
      permissionIntents: intents,
      duplicateXids: duplicatedXids,
    });
  };

  const confirmSpreadsheet = () => confirmBulk(bulkSource.text);
  const confirmAi = () => confirmBulk(aiText);

  const finishApply = (mode: "merge" | "replace", members: VideoMemberInput[]) => {
    // 権限intentはmembers_jsonへ混ぜない。表示属性のみ保存する。
    const stripped = stripCsvEditFlags(members);
    if (mode === "merge") {
      mergeCsvMembers(stripped);
    } else {
      replaceRowsWith(stripped);
    }
    setBulkPreview(null);
    setBulkSource({ label: "spreadsheet", text: "" });
    setAiText("");
  };

  const applyBulk = (mode: "merge" | "replace") => {
    if (!bulkPreview || disabled || bulkPreview.members.length === 0) return;
    if (mode === "replace") {
      // 置き換えは必ず明示確認を挟む。
      pendingApplyRef.current = () => finishApply("replace", bulkPreview.members);
      setReplaceConfirmOpen(true);
      return;
    }
    finishApply("merge", bulkPreview.members);
  };

  /** 置き換え確認後、権限intentがあれば編集権限の確認dialogへ進む。 */
  const onReplaceConfirmed = () => {
    setReplaceConfirmOpen(false);
    if (
      bulkPreview &&
      bulkPreview.permissionIntents.length > 0 &&
      permissionTargetVideoId
    ) {
      setPermConfirmOpen(true);
      return;
    }
    pendingApplyRef.current?.();
    pendingApplyRef.current = null;
  };

  const replaceRowsWith = (members: VideoMemberInput[]) => {
    setRows(() => {
      if (members.length === 0) return [{ ...EMPTY_ROW }];
      return members
        .map((r) => ({ ...r, chapters: r.chapters ?? [] }))
        .slice(0, MAX_VIDEO_MEMBERS);
    });
  };

  /** 編集権限だけを専用batch Server Actionで一括反映する。 */
  const applyPermissionsBatch = async () => {
    if (!bulkPreview || !permissionTargetVideoId || permPending) return;
    const intents = bulkPreview.permissionIntents.slice(0, MAX_COLLABORATOR_PERMISSION_BATCH);
    setPermPending(true);
    setPermResult(null);
    try {
      const result = await applyVideoCollaboratorPermissionsBatch({
        video_id: permissionTargetVideoId,
        notify: true,
        intents: intents.map((intent) => ({
          x_user_id: intent.xid,
          display_name: intent.label.replace(/ @[^ ]+$/, "") || `@${intent.xid}`,
          intent: intent.intent ? "on" : "off",
        })),
      });
      setPermResult({
        ok: result.ok,
        message: result.message ?? (result.ok ? "反映しました。" : "反映に失敗しました。"),
      });
      if (result.ok) {
        setPermConfirmOpen(false);
        pendingApplyRef.current?.();
        pendingApplyRef.current = null;
        setBulkPreview(null);
        setBulkSource({ label: "spreadsheet", text: "" });
        setAiText("");
      }
    } catch {
      setPermResult({ ok: false, message: "編集権限の反映中にエラーが発生しました。" });
    } finally {
      setPermPending(false);
    }
  };

  const normalizedRows = React.useMemo(() => normalizeMemberRows(rows), [rows]);
  const payload = React.useMemo(() => JSON.stringify(normalizedRows), [normalizedRows]);

  React.useEffect(() => {
    onChange?.(normalizedRows);
  }, [normalizedRows, onChange]);

  // メンバー行ごとのチャプター行を編集するヘルパー
  const updateChapterTimes = (i: number, raw: string) => {
    if (chaptersDisabled) return;
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
        {visibleSuggestions.map((s) => (
          <option key={`${s.x_user_id}-name`} value={s.name}>
            @{s.x_user_id}
          </option>
        ))}
      </datalist>
      <datalist id="member-xid-suggestions">
        {visibleSuggestions.map((s) => (
          <option key={`${s.x_user_id}-xid`} value={s.x_user_id}>
            {s.name}
          </option>
        ))}
      </datalist>

      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        名前または XID を入力すると、既存のクリエイター情報からもう片方を提案します。作品ごとに表示名は変更できます。
        作品の編集に参加させる人は、下の「編集できる人」欄で設定してください（この欄では公開表示用の情報のみ）。
      </p>
      {collabPermsHref && !disabled ? (
        <a href={collabPermsHref} className="fn-btn fn-btn-ghost fn-btn-sm" style={{ alignSelf: "flex-start" }}>
          <Icon name="settings" size={11} aria-hidden /> 編集できる人を設定
        </a>
      ) : null}
      {searchQuery.trim().length > 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          {searchStatus === "loading"
            ? "候補を検索中..."
            : (searchHint ?? `${mergedSuggestions.length}件の候補を表示しています。`)}
        </p>
      ) : null}
      <div
        role="group"
        aria-label="メンバー編集の表示モード"
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 2,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-pill)",
          alignSelf: "flex-start",
        }}
      >
        <button
          type="button"
          className={`fn-btn fn-btn-sm ${viewMode === "card" ? "fn-btn-primary" : "fn-btn-ghost"}`}
          aria-pressed={viewMode === "card"}
          onClick={() => setViewMode("card")}
        >
          カード
        </button>
        <button
          type="button"
          className={`fn-btn fn-btn-sm ${viewMode === "table" ? "fn-btn-primary" : "fn-btn-ghost"}`}
          aria-pressed={viewMode === "table"}
          onClick={() => setViewMode("table")}
        >
          表
        </button>
      </div>
      {viewMode === "table" ? (
        <div
          style={{
            overflowX: "auto",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "48px minmax(150px, 1.05fr) minmax(120px, 0.8fr) minmax(110px, 0.7fr) minmax(120px, 0.8fr) minmax(160px, 1fr) 82px 82px 132px",
              gap: 6,
              alignItems: "center",
              fontSize: 11,
              color: "var(--text-muted)",
              minWidth: 1080,
              paddingBottom: 4,
            }}
          >
            <span>順</span>
            <span>活動名</span>
            <span>ID</span>
            <span>チャプター</span>
            <span>役割</span>
            <span>コメント</span>
            <span>編集権限</span>
            <span>公開</span>
            <span>操作</span>
          </div>
          {rows.map((r, i) => {
            const canEdit = r.can_edit === true || r.can_edit === 1;
            const isPublic = r.is_public_member !== false && r.is_public_member !== 0;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "48px minmax(150px, 1.05fr) minmax(120px, 0.8fr) minmax(110px, 0.7fr) minmax(120px, 0.8fr) minmax(160px, 1fr) 82px 82px 132px",
                  gap: 6,
                  alignItems: "center",
                  minWidth: 1080,
                  marginTop: 6,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {i + 1}
                </span>
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
                  disabled={chaptersDisabled}
                />
                <input
                  type="text"
                  value={r.role}
                  onChange={(e) => update(i, { role: e.target.value })}
                  placeholder="作画 / 編集"
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
                <span className={`fn-badge ${canEdit ? "fn-badge-warning" : "fn-badge-soft"}`}>
                  {canEdit ? "あり" : "なし"}
                </span>
                <span className={`fn-badge ${isPublic ? "fn-badge-accent" : "fn-badge-soft"}`}>
                  {isPublic ? "公開" : "非公開"}
                </span>
                <span style={{ display: "inline-flex", gap: 4 }}>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    onClick={() => move(i, -1)}
                    aria-label={`${i + 1}行目を上へ移動`}
                    disabled={disabled || i === 0}
                  >
                    <Icon name="chevron-up" size={11} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    onClick={() => move(i, 1)}
                    aria-label={`${i + 1}行目を下へ移動`}
                    disabled={disabled || i === rows.length - 1}
                  >
                    <Icon name="chevron-down" size={11} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    onClick={() => remove(i)}
                    aria-label={`${i + 1}行目を削除`}
                    disabled={disabled}
                  >
                    <Icon name="trash" size={11} aria-hidden />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((r, i) => (
            <section
              key={i}
              className="fn-card"
              style={{ padding: 12, display: "grid", gap: 10 }}
            >
              <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="fn-badge fn-badge-soft">{i + 1}</span>
                <strong style={{ fontSize: 13, flex: 1 }}>
                  {r.name || r.x_user_id || "新しいメンバー"}
                </strong>
                <button
                  type="button"
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  onClick={() => move(i, -1)}
                  aria-label={`${i + 1}人目を上へ移動`}
                  disabled={disabled || i === 0}
                >
                  <Icon name="chevron-up" size={11} aria-hidden />
                </button>
                <button
                  type="button"
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  onClick={() => move(i, 1)}
                  aria-label={`${i + 1}人目を下へ移動`}
                  disabled={disabled || i === rows.length - 1}
                >
                  <Icon name="chevron-down" size={11} aria-hidden />
                </button>
                <button
                  type="button"
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  onClick={() => remove(i)}
                  aria-label={`${i + 1}人目を削除`}
                  disabled={disabled}
                >
                  <Icon name="trash" size={11} aria-hidden />
                </button>
              </header>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 8,
                }}
              >
                <label>
                  <span className="fn-label">活動名</span>
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
                </label>
                <label>
                  <span className="fn-label">ID</span>
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
                </label>
                <label>
                  <span className="fn-label">チャプター</span>
                  <input
                    type="text"
                    value={serializeChaptersCell(r.chapters ?? [])}
                    onChange={(e) => updateChapterTimes(i, e.target.value)}
                    placeholder="0:12;1:05"
                    title="mm:ss 形式。複数ある場合は ; 区切り"
                    className="fn-input"
                    maxLength={80}
                    disabled={chaptersDisabled}
                  />
                </label>
                <label>
                  <span className="fn-label">役割</span>
                  <input
                    type="text"
                    value={r.role}
                    onChange={(e) => update(i, { role: e.target.value })}
                    placeholder="作画 / 編集 / 音響など"
                    className="fn-input"
                    maxLength={40}
                    disabled={disabled}
                  />
                </label>
              </div>
              <label>
                <span className="fn-label">コメント</span>
                <input
                  type="text"
                  value={r.comment}
                  onChange={(e) => update(i, { comment: e.target.value })}
                  placeholder="任意コメント"
                  className="fn-input"
                  maxLength={200}
                  disabled={disabled}
                />
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span
                  className={`fn-badge ${
                    r.can_edit === true || r.can_edit === 1
                      ? "fn-badge-warning"
                      : "fn-badge-soft"
                  }`}
                >
                  {r.can_edit === true || r.can_edit === 1
                    ? "作品編集に参加"
                    : "編集不可"}
                </span>
                <span className="fn-badge fn-badge-soft">
                  チャプター {r.chapters?.length ?? 0} 件
                </span>
                {collabPermsHref && !disabled ? (
                  <a
                    href={collabPermsHref}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    style={{ padding: "2px 8px", minHeight: 28 }}
                  >
                    編集権を管理
                  </a>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={add}
          disabled={disabled || normalizedRows.length >= MAX_VIDEO_MEMBERS}
        >
          <Icon name="plus" size={11} aria-hidden /> 行を追加
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, opacity: 0.75 }}>
          最大{MAX_VIDEO_MEMBERS}人
        </span>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => void copyTsv()}
          disabled={disabled || normalizedRows.length === 0}
          title="Google Sheets / Excel にそのまま貼り付けできます（常に6列）"
        >
          <Icon name="copy" size={11} aria-hidden />
          {copied && copiedLabel === "TSVコピー" ? "コピーしました" : "TSVをコピー"}
        </button>
        {searchHasMore && nextOffset !== null ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={loadMoreSuggestions}
            disabled={disabled || searchStatus === "loading"}
          >
            候補をさらに読み込む
          </button>
        ) : null}
      </div>
      {bulkWarning ? (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--accent-warning)" }}>
          {bulkWarning}
        </p>
      ) : null}

      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
          スプレッドシート / AIから一括入力
        </summary>
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          <section style={{ display: "grid", gap: 4 }}>
            <strong style={{ fontSize: 12 }}>列の説明</strong>
            <ol className="fn-text-muted-sm" style={{ margin: 0, paddingLeft: 18 }}>
              <li>ユーザー名</li>
              <li>X ID（@なし・大文字小文字はどちらでも可）</li>
              <li>チャプター（m:ss / mm:ss。複数は ; 区切り、例: 0:12;1:05）</li>
              <li>役職</li>
              <li>コメント</li>
              <li>権限（ON / OFF / 空欄）</li>
            </ol>
            {!permissionTargetVideoId ? (
              <p className="fn-text-muted-sm" style={{ margin: 0 }}>
                権限列は作品作成後、作品編集画面から反映できます。この画面ではメンバー情報だけ取り込みます。
              </p>
            ) : null}
          </section>

          <section style={{ display: "grid", gap: 6 }}>
            <label className="fn-label" htmlFor="members-tsv-input">
              TSV貼り付け（スプレッドシートからそのまま貼り付けできます）
            </label>
            <textarea
              id="members-tsv-input"
              className="fn-input"
              rows={5}
              style={{ fontFamily: "monospace", fontSize: 12 }}
              placeholder={"例:\nAlice\talice_x\t1:23\t映像\tモーション担当\tON\nBob\tbob123\t12:05\tイラスト\t背景担当\tOFF"}
              value={bulkSource.text}
              onChange={(e) => setBulkSource((prev) => ({ ...prev, text: e.target.value }))}
              onPaste={onPaste}
              disabled={disabled}
            />
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={confirmSpreadsheet}
              disabled={disabled || !bulkSource.text.trim()}
            >
              内容を確認
            </button>
          </section>

          <section style={{ display: "grid", gap: 6 }}>
            <strong style={{ fontSize: 12 }}>AIでTSVを作る</strong>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={() => void copyAiPrompt()}
              disabled={disabled}
            >
              <Icon name="copy" size={11} aria-hidden />
              {copied && copiedLabel === "AIプロンプト" ? "コピーしました" : "プロンプトをコピー"}
            </button>
            <p className="fn-text-muted-sm" style={{ margin: 0 }}>
              コピーしたプロンプトをAIエージェントに渡し、出力されたTSVを下に貼り付けてください。
            </p>
            <textarea
              aria-label="AIが出力したTSV"
              className="fn-input"
              rows={4}
              style={{ fontFamily: "monospace", fontSize: 12 }}
              placeholder={"AI出力のTSVをここへ貼り付け"}
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              disabled={disabled}
            />
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={confirmAi}
              disabled={disabled || !aiText.trim()}
            >
              内容を確認
            </button>
          </section>

          {bulkPreview ? (
            <section style={{ display: "grid", gap: 8 }}>
              <strong style={{ fontSize: 12 }}>確認（{bulkPreview.members.length}行）</strong>
              {bulkPreview.members.length === 0 ? (
                <p className="fn-text-muted-sm" style={{ margin: 0 }}>
                  有効な行がありません。
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                        <th style={{ padding: 4 }}>#</th>
                        <th style={{ padding: 4 }}>ユーザー名</th>
                        <th style={{ padding: 4 }}>X ID</th>
                        <th style={{ padding: 4 }}>チャプター</th>
                        <th style={{ padding: 4 }}>役職</th>
                        <th style={{ padding: 4 }}>コメント</th>
                        <th style={{ padding: 4 }}>権限</th>
                        <th style={{ padding: 4 }}>検証結果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.members.map((member, index) => {
                        const xid = normalizeXId(member.x_user_id);
                        const duplicate = xid ? bulkPreview.duplicateXids.has(xid) : false;
                        const invalid = !member.name.trim() && !xid;
                        const permissionText =
                          member.can_edit === 1 || member.can_edit === true
                            ? "ON"
                            : member.can_edit === 0 || member.can_edit === false
                              ? "OFF"
                              : "変更なし";
                        return (
                          <tr key={index} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 4 }}>{index + 1}</td>
                            <td style={{ padding: 4 }}>{member.name}</td>
                            <td style={{ padding: 4 }}>{xid ? `@${xid}` : ""}</td>
                            <td style={{ padding: 4 }}>
                              {serializeChaptersCell(member.chapters ?? [])}
                            </td>
                            <td style={{ padding: 4 }}>{member.role}</td>
                            <td style={{ padding: 4 }}>{member.comment}</td>
                            <td style={{ padding: 4 }}>{permissionText}</td>
                            <td style={{ padding: 4, color: invalid ? "var(--accent-warning)" : undefined }}>
                              {invalid
                                ? "エラー: 名前とX IDが空"
                                : duplicate
                                  ? `警告: X ID重複 (@${xid})`
                                  : "OK"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="fn-btn fn-btn-primary fn-btn-sm"
                  onClick={() => applyBulk("merge")}
                  disabled={
                    disabled ||
                    bulkPreview.members.length === 0 ||
                    normalizedRows.length + bulkPreview.members.length > MAX_VIDEO_MEMBERS
                  }
                >
                  追加
                </button>
                <button
                  type="button"
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                  onClick={() => applyBulk("replace")}
                  disabled={disabled || bulkPreview.members.length === 0}
                >
                  現在のメンバーを置き換え
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </details>

      {replaceConfirmOpen ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="members-replace-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(0,0,0,0.45)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setReplaceConfirmOpen(false);
          }}
        >
          <div className="fn-card" style={{ width: "min(100%, 420px)", padding: 16 }}>
            <p id="members-replace-dialog-title" style={{ margin: "0 0 8px", fontWeight: 700 }}>
              現在のメンバーを置き換えますか？
            </p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: "var(--text-secondary)" }}>
              現在入力済みの {normalizedRows.length} 人分のメンバーを、確認済み
              {" "}
              {bulkPreview?.members.length ?? 0} 行で置き換えます。この操作は取り消せません。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => setReplaceConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-primary fn-btn-sm"
                onClick={onReplaceConfirmed}
              >
                置き換える
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {permConfirmOpen && bulkPreview ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="members-perm-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(0,0,0,0.45)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !permPending) setPermConfirmOpen(false);
          }}
        >
          <div className="fn-card" style={{ width: "min(100%, 480px)", padding: 16 }}>
            <p id="members-perm-dialog-title" style={{ margin: "0 0 8px", fontWeight: 700 }}>
              以下の編集権限を変更します。
            </p>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              {(() => {
                const grants = bulkPreview.permissionIntents.filter((i) => i.intent);
                const revokes = bulkPreview.permissionIntents.filter((i) => !i.intent);
                return (
                  <>
                    <div>
                      <strong>付与:</strong>
                      {grants.length === 0 ? (
                        <span style={{ color: "var(--text-muted)" }}> なし</span>
                      ) : (
                        <ul style={{ margin: "2px 0 6px", paddingLeft: 18 }}>
                          {grants.map((i) => (
                            <li key={`grant-${i.xid}`}>{i.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <strong>解除:</strong>
                      {revokes.length === 0 ? (
                        <span style={{ color: "var(--text-muted)" }}> なし</span>
                      ) : (
                        <ul style={{ margin: "2px 0 6px", paddingLeft: 18 }}>
                          {revokes.map((i) => (
                            <li key={`revoke-${i.xid}`}>{i.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--accent-warning)" }}>
              この変更により作品を編集できる人が変わります。
            </p>
            {permResult ? (
              <p
                role="status"
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: permResult.ok ? "var(--accent)" : "var(--accent-warning)",
                }}
              >
                {permResult.message}
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => setPermConfirmOpen(false)}
                disabled={permPending}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-primary fn-btn-sm"
                onClick={() => void applyPermissionsBatch()}
                disabled={permPending || bulkPreview.permissionIntents.length === 0}
              >
                {permPending ? "反映中..." : "変更を反映"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
