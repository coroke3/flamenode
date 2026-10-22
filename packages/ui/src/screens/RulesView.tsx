import React from "react";
import { cx } from "../cx.js";
import { ScreenIcon } from "./parts.js";

/*
 * `/rules` from the registered mock `docs/migration/mock/static/Rules.html` (`split`, `prose`, aside).
 * Texts follow CURRENT `app/(public)/rules/page.tsx`. Display only: the consent form (SA-075) and the
 * `?error=` notice need the MIG-0605 API, so the caller passes them as `consent` when it has them.
 */
export type LegalBlock =
  | { type: "heading2"; text: string }
  | { type: "heading3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: readonly string[] };

export interface RulesViewProps {
  versionLabel: string;
  /** CURRENT `formatUnix(updatedAt, { dateOnly: true })`, shown as ` (更新: …)`. */
  updatedLabel?: string | null;
  blocks: readonly LegalBlock[];
  /** Consent panel Island (MIG-0605). Omitted until the API exists. */
  consent?: React.ReactNode;
  className?: string;
}

function Block({ block }: { block: LegalBlock }): React.ReactElement {
  if (block.type === "heading2") return <h2 className="t-h2">{block.text}</h2>;
  if (block.type === "heading3") return <h3>{block.text}</h3>;
  if (block.type === "list") {
    return (
      <ul>
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p>{block.text}</p>;
}

export function RulesView({ versionLabel, updatedLabel, blocks, consent, className }: RulesViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap split rl-wrap">
        <article className="main prose rl-main">
          <p className="t-label muted">RULES</p>
          <h1 className="t-display">利用規約</h1>
          <p className="t-sm muted rl-ver">
            バージョン: {versionLabel}
            {updatedLabel ? ` (更新: ${updatedLabel})` : ""}
          </p>
          {blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </article>
        <aside className="side stack rl-side">
          {consent}
          <section id="event-host" aria-labelledby="rl-host">
            <h2 id="rl-host" className="t-h3">
              <ScreenIcon name="calendar" /> イベント開催相談
            </h2>
            <p className="t-sm muted">
              第三者主催イベントを開催したい場合は、Discord から運営にご連絡ください。
              管理者が承認した X ID にイベント編集許可者ロールを付与します。
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
