"use client";

import * as React from "react";

/**
 * 紹介コメントの常時表示ブロック。
 *
 * - 初期状態は line-clamp: 3 で省略表示。
 * - 内容が 3 行を超える場合だけ「もっと見る」ボタンを出す。
 * - クリックで全文展開。
 *
 * 完全折りたたみ (details) にすると、動画詳細を開いた瞬間にコメントの存在が
 * 視認できないという UX 課題があったため、常時冒頭が見える設計にした。
 */
export function IntroCommentBlock({
  text,
}: {
  text: string;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);
  const ref = React.useRef<HTMLParagraphElement>(null);

  // クライアントマウント後に実際の clientHeight / scrollHeight で省略判定する。
  // 行数で判定する方法もあるが、改行や日本語折り返しを考えると ScrollHeight 比較が安定。
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 一度 clamp 状態で測る (expanded を強制的に false 相当として)。
    // 初期 render では state が false なので clamped、ここで scrollHeight > clientHeight なら省略中。
    if (!expanded && el.scrollHeight > el.clientHeight + 1) {
      setOverflowing(true);
    }
  }, [expanded, text]);

  return (
    <div>
      <p
        ref={ref}
        className={expanded ? undefined : "fn-line-clamp-3"}
        style={{ margin: 0, lineHeight: 1.7 }}
      >
        {text}
      </p>
      {overflowing ? (
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 6 }}
        >
          {expanded ? "閉じる" : "もっと見る"}
        </button>
      ) : null}
    </div>
  );
}
