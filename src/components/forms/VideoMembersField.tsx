"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { normalizeXId } from "@/lib/utils/xid";

export interface VideoMemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
}

export interface VideoMemberSuggestion {
  name: string;
  x_user_id: string;
}

interface VideoMembersFieldProps {
  initialMembers?: VideoMemberInput[];
  suggestions?: VideoMemberSuggestion[];
  hiddenName?: string;
}

const EMPTY_ROW: VideoMemberInput = {
  name: "",
  x_user_id: "",
  role: "",
  comment: "",
};

export function VideoMembersField({
  initialMembers = [],
  suggestions = [],
  hiddenName = "members_json",
}: VideoMembersFieldProps): React.ReactElement {
  const [rows, setRows] = React.useState<VideoMemberInput[]>(() =>
    initialMembers.length > 0 ? initialMembers : [{ ...EMPTY_ROW }],
  );
  const [copied, setCopied] = React.useState(false);

  // /api/internal/x-users/search からの追加候補 (debounce 検索)
  const [fetched, setFetched] = React.useState<VideoMemberSuggestion[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  React.useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setFetched([]);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/internal/x-users/search?q=${encodeURIComponent(q)}&limit=20`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          items?: { id: string; x_name: string | null }[];
        };
        const items = (json.items ?? []).map((r) => ({
          name: r.x_name ?? r.id,
          x_user_id: r.id,
        }));
        setFetched(items);
      } catch {
        // abort or network error は無視
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [searchQuery]);

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
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const fillFromName = (i: number, name: string) => {
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

  const add = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  const remove = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const copyCsvPrompt = async () => {
    const prompt = [
      "次の情報を FlameNode の合作メンバー CSV に整形してください。",
      "出力は CSV 本文のみ。列は name,x_user_id,role,comment の4列。",
      "x_user_id は @ を外し、不明なら空欄。1行目にヘッダーは入れない。",
      "例: 田中,tanaka,作画,よろしくお願いします",
    ].join("\n");
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text || !/[\n,]/.test(text)) return;
    e.preventDefault();
    const parsed = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): VideoMemberInput => {
        const cols = line.split(/,|\t/).map((c) => c.trim());
        const xid = normalizeXId(cols[1] ?? "");
        const hit = xid ? suggestionsById.get(xid) : null;
        return {
          name: cols[0] || hit?.name || "",
          x_user_id: xid,
          role: cols[2] ?? "",
          comment: cols[3] ?? "",
        };
      });
    if (parsed.length > 0) {
      setRows((prev) => [
        ...prev.filter((r) => r.name || r.x_user_id),
        ...parsed,
      ]);
    }
  };

  const payload = React.useMemo(() => {
    const cleaned = rows
      .map((r) => ({
        name: r.name.trim(),
        x_user_id: normalizeXId(r.x_user_id),
        role: r.role.trim(),
        comment: r.comment.trim(),
      }))
      .filter((r) => r.name || r.x_user_id);
    return JSON.stringify(cleaned);
  }, [rows]);

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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 6,
          alignItems: "center",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        <span>名前</span>
        <span>X ID</span>
        <span>役割</span>
        <span>コメント</span>
        <span></span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 6,
            alignItems: "center",
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
          />
          <input
            type="text"
            value={r.role}
            onChange={(e) => update(i, { role: e.target.value })}
            placeholder="作画 / 編集 / 音響など"
            className="fn-input"
            maxLength={40}
          />
          <input
            type="text"
            value={r.comment}
            onChange={(e) => update(i, { comment: e.target.value })}
            placeholder="任意コメント"
            className="fn-input"
            maxLength={200}
          />
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => remove(i)}
            aria-label="この行を削除"
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
        >
          <Icon name="plus" size={11} aria-hidden /> 行を追加
        </button>
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
          placeholder={"例:\n田中,tanaka,作画,よろしく\n佐藤,sato_design,音響,"}
          onPaste={onPaste}
        />
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={copyCsvPrompt}
          style={{ marginTop: 8 }}
        >
          <Icon name="copy" size={11} aria-hidden />
          {copied ? "コピーしました" : "CSV作成プロンプトをコピー"}
        </button>
      </details>
    </div>
  );
}
