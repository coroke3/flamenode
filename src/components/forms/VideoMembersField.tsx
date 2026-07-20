"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { normalizeXId } from "@/lib/utils/xid";
import {
  memberKey,
  parseVideoMemberCsv,
  type VideoMemberInput,
  type VideoMemberSuggestion,
} from "@/lib/video/memberInput";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import { scoreSimpleMemberSuggestion } from "@/lib/video/memberSuggestionRank";

export type {
  VideoMemberInput,
  VideoMemberSuggestion,
} from "@/lib/video/memberInput";

interface VideoMembersFieldProps {
  initialMembers?: VideoMemberInput[];
  suggestions?: VideoMemberSuggestion[];
  hiddenName?: string;
  disabled?: boolean;
  onChange?: (members: VideoMemberInput[]) => void;
  collabPermsHref?: string;
}

const EMPTY_ROW: VideoMemberInput = {
  name: "",
  x_user_id: "",
  role: "",
  comment: "",
};

function normalizeMemberRows(rows: VideoMemberInput[]): VideoMemberInput[] {
  const normalized = rows
    .map((row) => ({
      name: row.name.trim(),
      x_user_id: normalizeXId(row.x_user_id),
      role: row.role.trim(),
      comment: row.comment.trim(),
      can_edit: row.can_edit,
      is_public_member: row.is_public_member,
      order_index: row.order_index,
    }))
    .filter((row) => row.name || row.x_user_id);

  const seen = new Set<string>();
  return normalized.filter((row) => {
    const key = memberKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withoutCsvPermissions(members: VideoMemberInput[]): VideoMemberInput[] {
  return members.map(({ can_edit: _canEdit, ...member }) => member);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function VideoMembersField({
  initialMembers = [],
  suggestions = [],
  hiddenName = "members_json",
  disabled = false,
  onChange,
  collabPermsHref,
}: VideoMembersFieldProps): React.ReactElement {
  const componentId = React.useId().replace(/:/g, "");
  const nameListId = `member-name-${componentId}`;
  const xIdListId = `member-xid-${componentId}`;
  const [rows, setRows] = React.useState<VideoMemberInput[]>(() =>
    initialMembers.length > 0 ? initialMembers : [{ ...EMPTY_ROW }],
  );
  const [viewMode, setViewMode] = React.useState<"card" | "table">(() =>
    initialMembers.length >= 8 ? "table" : "card",
  );
  const [copied, setCopied] = React.useState(false);
  const [csvWarning, setCsvWarning] = React.useState<string | null>(null);
  const [csvEditDialog, setCsvEditDialog] = React.useState<{
    members: VideoMemberInput[];
    editOnNames: string[];
  } | null>(null);
  const [fetched, setFetched] = React.useState<VideoMemberSuggestion[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchStatus, setSearchStatus] = React.useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [searchHint, setSearchHint] = React.useState<string | null>(null);
  const [searchHasMore, setSearchHasMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);

  const fetchSuggestions = React.useCallback(
    async (query: string, offset: number, signal?: AbortSignal) => {
      if (disabled) return;
      setSearchStatus("loading");
      setSearchHint(null);
      try {
        const response = await fetch(
          `/api/internal/x-users/search?q=${encodeURIComponent(query)}&limit=20&offset=${offset}`,
          { signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("search_failed");
        const json = (await response.json()) as {
          items?: Array<{
            id: string;
            x_name: string | null;
            score?: number;
            matchedBy?: string;
          }>;
          hasMore?: boolean;
          nextOffset?: number | null;
          hint?: string | null;
        };
        const items = (json.items ?? []).map((row) => ({
          name: row.x_name ?? row.id,
          x_user_id: row.id,
          score: row.score,
          matchedBy: row.matchedBy,
        }));
        setFetched((previous) => {
          const map = new Map<string, VideoMemberSuggestion>();
          if (offset > 0) {
            for (const suggestion of previous) {
              map.set(normalizeXId(suggestion.x_user_id), suggestion);
            }
          }
          for (const suggestion of items) {
            map.set(normalizeXId(suggestion.x_user_id), suggestion);
          }
          return Array.from(map.values());
        });
        setSearchHasMore(Boolean(json.hasMore));
        setNextOffset(
          typeof json.nextOffset === "number" ? json.nextOffset : null,
        );
        setSearchHint(
          items.length === 0 && offset === 0
            ? "候補が見つかりません。X IDの表記を確認してください。"
            : (json.hint ?? null),
        );
        setSearchStatus("done");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchStatus("error");
        setSearchHint("候補の取得に失敗しました。再入力してください。");
      }
    },
    [disabled],
  );

  React.useEffect(() => {
    const query = searchQuery.trim();
    if (disabled || query.length < 2) {
      setFetched([]);
      setSearchStatus("idle");
      setSearchHint(query.length === 1 ? "2文字以上で検索します。" : null);
      setSearchHasMore(false);
      setNextOffset(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchSuggestions(query, 0, controller.signal);
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [disabled, fetchSuggestions, searchQuery]);

  const mergedSuggestions = React.useMemo(() => {
    const map = new Map<string, VideoMemberSuggestion>();
    for (const suggestion of [...suggestions, ...fetched]) {
      const key = normalizeXId(suggestion.x_user_id);
      if (key) map.set(key, suggestion);
    }
    const query = searchQuery.trim();
    return Array.from(map.values())
      .map((suggestion) => ({
        ...suggestion,
        score:
          suggestion.score ?? scoreSimpleMemberSuggestion(query, suggestion),
      }))
      .sort(
        (left, right) =>
          (right.score ?? 0) - (left.score ?? 0) ||
          left.name.localeCompare(right.name, "ja") ||
          left.x_user_id.localeCompare(right.x_user_id),
      );
  }, [fetched, searchQuery, suggestions]);

  const suggestionsById = React.useMemo(
    () =>
      new Map(
        mergedSuggestions.map((suggestion) => [
          normalizeXId(suggestion.x_user_id),
          suggestion,
        ]),
      ),
    [mergedSuggestions],
  );
  const suggestionsByName = React.useMemo(() => {
    const map = new Map<string, VideoMemberSuggestion[]>();
    for (const suggestion of mergedSuggestions) {
      const key = suggestion.name.trim().normalize("NFKC").toLowerCase();
      if (!key) continue;
      const current = map.get(key) ?? [];
      current.push(suggestion);
      map.set(key, current);
    }
    return map;
  }, [mergedSuggestions]);
  const visibleSuggestions = searchQuery.trim()
    ? mergedSuggestions.slice(0, 12)
    : mergedSuggestions.slice(0, 100);

  const update = React.useCallback(
    (index: number, patch: Partial<VideoMemberInput>) => {
      if (disabled) return;
      setRows((previous) =>
        previous.map((row, rowIndex) =>
          rowIndex === index ? { ...row, ...patch } : row,
        ),
      );
    },
    [disabled],
  );

  const fillFromName = (index: number, name: string) => {
    const key = name.trim().normalize("NFKC").toLowerCase();
    const hits = suggestionsByName.get(key) ?? [];
    if (disabled || hits.length !== 1) return;
    const hit = hits[0];
    setRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index && !row.x_user_id
          ? { ...row, x_user_id: hit.x_user_id, name: row.name || hit.name }
          : row,
      ),
    );
  };

  const fillFromXId = (index: number, rawXId: string) => {
    if (disabled) return;
    const xId = normalizeXId(rawXId);
    const hit = suggestionsById.get(xId);
    setRows((previous) =>
      previous.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, x_user_id: xId, name: row.name || hit?.name || "" }
          : row,
      ),
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    if (disabled) return;
    setRows((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const mergeCsvMembers = React.useCallback((parsed: VideoMemberInput[]) => {
    setRows((previous) => {
      const next = previous.map((row) => ({ ...row }));
      const indexByKey = new Map<string, number>();
      next.forEach((row, index) => indexByKey.set(memberKey(row), index));
      for (const candidate of parsed) {
        const key = memberKey(candidate);
        const index = indexByKey.get(key);
        if (index === undefined) {
          next.push({ ...candidate });
          indexByKey.set(key, next.length - 1);
          continue;
        }
        const target = next[index]!;
        if (!target.name && candidate.name) target.name = candidate.name;
        if (!target.role && candidate.role) target.role = candidate.role;
        if (!target.comment && candidate.comment) target.comment = candidate.comment;
      }
      return next
        .filter((row) => row.name || row.x_user_id)
        .slice(0, MAX_VIDEO_MEMBERS);
    });
  }, []);

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const text = event.clipboardData.getData("text");
    if (!text || !/[\n,]/.test(text)) return;
    event.preventDefault();
    const parsed = parseVideoMemberCsv(text, {
      suggestions: mergedSuggestions,
      existingMembers: rows,
    });
    const members = withoutCsvPermissions(parsed.members);
    setCsvWarning(parsed.warnings.length > 0 ? parsed.warnings.join(" / ") : null);
    if (members.length === 0) return;

    const editOn = parsed.members.filter(
      (member) => member.can_edit === 1 || member.can_edit === true,
    );
    if (editOn.length > 0) {
      setCsvEditDialog({
        members,
        editOnNames: editOn.map(
          (member) =>
            member.name.trim() ||
            (member.x_user_id ? `@${normalizeXId(member.x_user_id)}` : "名前未設定"),
        ),
      });
      return;
    }
    mergeCsvMembers(members);
  };

  const normalizedRows = React.useMemo(
    () => normalizeMemberRows(rows),
    [rows],
  );
  const payload = React.useMemo(
    () =>
      JSON.stringify(
        normalizedRows.map(({ name, x_user_id, role, comment }) => ({
          name,
          x_user_id,
          role,
          comment,
        })),
      ),
    [normalizedRows],
  );

  React.useEffect(() => {
    onChange?.(normalizedRows);
  }, [normalizedRows, onChange]);

  const copyCsvPrompt = async () => {
    const existing = normalizedRows
      .map((row) =>
        [row.name, row.x_user_id, row.role, row.comment, "OFF"]
          .map(csvCell)
          .join(","),
      )
      .join("\n");
    const lines = [
      "次の情報をFlameNodeの合作メンバーCSVに整形してください。",
      "",
      "出力はCSV本文のみ。",
      "列は 活動名,ID,役割,コメント,編集権 の5列です。",
      "IDは@を外してください。不明なら空欄にしてください。",
      "既存データと重複する行は出力しないでください。",
      "",
      "既存データ:",
      "活動名,ID,役割,コメント,編集権",
      existing,
      "",
      "追加したい情報:",
      "(ここに貼り付けてください)",
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const renderNameInput = (row: VideoMemberInput, index: number) => (
    <input
      type="text"
      value={row.name}
      onChange={(event) => {
        update(index, { name: event.target.value });
        setSearchQuery(event.target.value);
      }}
      onBlur={(event) => fillFromName(index, event.target.value)}
      placeholder="表示名"
      className="fn-input"
      maxLength={80}
      list={nameListId}
      disabled={disabled}
    />
  );

  const renderXIdInput = (row: VideoMemberInput, index: number) => (
    <input
      type="text"
      value={row.x_user_id}
      onChange={(event) => {
        update(index, { x_user_id: event.target.value });
        setSearchQuery(event.target.value);
      }}
      onBlur={(event) => fillFromXId(index, event.target.value)}
      placeholder="@なし"
      className="fn-input"
      maxLength={32}
      pattern="[A-Za-z0-9_]*"
      list={xIdListId}
      disabled={disabled}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name={hiddenName} value={payload} />
      <datalist id={nameListId}>
        {visibleSuggestions.map((suggestion) => (
          <option key={`${suggestion.x_user_id}-name`} value={suggestion.name}>
            @{suggestion.x_user_id}
          </option>
        ))}
      </datalist>
      <datalist id={xIdListId}>
        {visibleSuggestions.map((suggestion) => (
          <option key={`${suggestion.x_user_id}-xid`} value={suggestion.x_user_id}>
            {suggestion.name}
          </option>
        ))}
      </datalist>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
        ここでは公開参加者だけを設定します。チャプターは作品詳細のチャプター管理から設定してください。
      </p>
      {collabPermsHref && !disabled ? (
        <a
          href={collabPermsHref}
          className="fn-btn fn-btn-ghost fn-btn-sm"
          style={{ alignSelf: "flex-start" }}
        >
          <Icon name="settings" size={11} aria-hidden /> 編集できる人を設定
        </a>
      ) : null}
      {searchQuery.trim() ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
          {searchStatus === "loading"
            ? "候補を検索中..."
            : (searchHint ?? `${mergedSuggestions.length}件の候補を表示しています。`)}
        </p>
      ) : null}

      <div
        role="group"
        aria-label="メンバー編集の表示モード"
        style={{ display: "inline-flex", gap: 4, alignSelf: "flex-start" }}
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
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "44px minmax(150px,1fr) minmax(120px,.8fr) minmax(120px,.8fr) minmax(180px,1.2fr) 74px 74px 132px",
              gap: 6,
              minWidth: 900,
              color: "var(--text-muted)",
              fontSize: 11,
            }}
          >
            <span>順</span><span>活動名</span><span>ID</span><span>役割</span>
            <span>コメント</span><span>編集権</span><span>公開</span><span>操作</span>
          </div>
          {rows.map((row, index) => {
            const canEdit = row.can_edit === true || row.can_edit === 1;
            const isPublic = row.is_public_member !== false && row.is_public_member !== 0;
            return (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "44px minmax(150px,1fr) minmax(120px,.8fr) minmax(120px,.8fr) minmax(180px,1.2fr) 74px 74px 132px",
                  gap: 6,
                  alignItems: "center",
                  minWidth: 900,
                  marginTop: 6,
                }}
              >
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{index + 1}</span>
                {renderNameInput(row, index)}
                {renderXIdInput(row, index)}
                <input
                  type="text"
                  value={row.role}
                  onChange={(event) => update(index, { role: event.target.value })}
                  placeholder="作画 / 編集"
                  className="fn-input"
                  maxLength={80}
                  disabled={disabled}
                />
                <input
                  type="text"
                  value={row.comment}
                  onChange={(event) => update(index, { comment: event.target.value })}
                  placeholder="任意コメント"
                  className="fn-input"
                  maxLength={500}
                  disabled={disabled}
                />
                <span className={`fn-badge ${canEdit ? "fn-badge-warning" : "fn-badge-soft"}`}>
                  {canEdit ? "あり" : "なし"}
                </span>
                <span className={`fn-badge ${isPublic ? "fn-badge-accent" : "fn-badge-soft"}`}>
                  {isPublic ? "公開" : "非公開"}
                </span>
                <span style={{ display: "inline-flex", gap: 4 }}>
                  <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`${index + 1}行目を上へ`}>
                    <Icon name="chevron-up" size={11} aria-hidden />
                  </button>
                  <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => move(index, 1)} disabled={disabled || index === rows.length - 1} aria-label={`${index + 1}行目を下へ`}>
                    <Icon name="chevron-down" size={11} aria-hidden />
                  </button>
                  <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => !disabled && setRows((previous) => previous.filter((_, rowIndex) => rowIndex !== index))} disabled={disabled} aria-label={`${index + 1}行目を削除`}>
                    <Icon name="trash" size={11} aria-hidden />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, index) => (
            <section key={index} className="fn-card" style={{ padding: 12, display: "grid", gap: 10 }}>
              <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="fn-badge fn-badge-soft">{index + 1}</span>
                <strong style={{ flex: 1, fontSize: 13 }}>{row.name || row.x_user_id || "新しいメンバー"}</strong>
                <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`${index + 1}人目を上へ`}><Icon name="chevron-up" size={11} aria-hidden /></button>
                <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => move(index, 1)} disabled={disabled || index === rows.length - 1} aria-label={`${index + 1}人目を下へ`}><Icon name="chevron-down" size={11} aria-hidden /></button>
                <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => !disabled && setRows((previous) => previous.filter((_, rowIndex) => rowIndex !== index))} disabled={disabled} aria-label={`${index + 1}人目を削除`}><Icon name="trash" size={11} aria-hidden /></button>
              </header>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
                <label><span className="fn-label">活動名</span>{renderNameInput(row, index)}</label>
                <label><span className="fn-label">ID</span>{renderXIdInput(row, index)}</label>
                <label><span className="fn-label">役割</span><input type="text" value={row.role} onChange={(event) => update(index, { role: event.target.value })} placeholder="作画 / 編集 / 音響など" className="fn-input" maxLength={80} disabled={disabled} /></label>
              </div>
              <label><span className="fn-label">コメント</span><input type="text" value={row.comment} onChange={(event) => update(index, { comment: event.target.value })} placeholder="任意コメント" className="fn-input" maxLength={500} disabled={disabled} /></label>
            </section>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setRows((previous) => [...previous, { ...EMPTY_ROW }])}
          disabled={disabled || normalizedRows.length >= MAX_VIDEO_MEMBERS}
        >
          <Icon name="plus" size={11} aria-hidden /> 行を追加
        </button>
        <span style={{ alignSelf: "center", fontSize: 12, opacity: 0.75 }}>
          最大{MAX_VIDEO_MEMBERS}人
        </span>
        {searchHasMore && nextOffset !== null ? (
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => void fetchSuggestions(searchQuery.trim(), nextOffset)} disabled={disabled || searchStatus === "loading"}>
            候補をさらに読み込む
          </button>
        ) : null}
      </div>

      {csvWarning ? <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--accent-warning)" }}>{csvWarning}</p> : null}
      <details>
        <summary style={{ fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
          CSV形式でまとめて貼り付け
        </summary>
        <textarea
          className="fn-input"
          rows={4}
          style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}
          placeholder={'活動名,ID,役割,コメント,編集権\n田中,tanaka,作画,よろしく,OFF\n佐藤,sato_design,音響,"コメント",ON'}
          onPaste={onPaste}
          disabled={disabled}
        />
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={copyCsvPrompt} style={{ marginTop: 8 }} disabled={disabled}>
          <Icon name="copy" size={11} aria-hidden />
          {copied ? "コピーしました" : "CSV作成プロンプトをコピー"}
        </button>
      </details>

      {csvEditDialog ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby={`csv-edit-${componentId}`} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 16, background: "rgba(0,0,0,.45)" }} onClick={(event) => event.target === event.currentTarget && setCsvEditDialog(null)}>
          <div className="fn-card" style={{ width: "min(100%,420px)", padding: 16 }}>
            <p id={`csv-edit-${componentId}`} style={{ margin: "0 0 8px", fontWeight: 700 }}>編集権ONの行が含まれています</p>
            <p style={{ margin: 0, fontSize: 13 }}>{csvEditDialog.editOnNames.join("、")}</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>参加者情報だけを取り込みます。編集権は専用画面から付与してください。</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => setCsvEditDialog(null)}>キャンセル</button>
              <button type="button" className="fn-btn fn-btn-primary fn-btn-sm" onClick={() => { mergeCsvMembers(csvEditDialog.members); setCsvEditDialog(null); }}>参加者だけ取り込む</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
