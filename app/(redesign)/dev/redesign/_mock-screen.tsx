import * as React from "react";
import Link from "next/link";
import type { MockRoute } from "./_catalog";
import styles from "./redesign.module.css";

const works = [
  { title: "Afterimage", creator: "@frame_user", meta: "PVSF 2026 Autumn", status: "公開" },
  { title: "Signal Bloom", creator: "@motionlab", meta: "03:42", status: "公開" },
  { title: "Night Loop", creator: "@nodecreator", meta: "Motion Relay", status: "審査済" },
  { title: "Parallel", creator: "@glassworks", meta: "02:18", status: "公開" },
];

const events = [
  { name: "PVSF 2026 Autumn", status: "受付中", deadline: "10/08 23:59", pending: "3件" },
  { name: "Motion Relay", status: "開催中", deadline: "10/12 20:00", pending: "0件" },
  { name: "Spring Screening", status: "終了", deadline: "—", pending: "0件" },
];

function BrandHeader({ personal = false }: { personal?: boolean }): React.ReactElement {
  return (
    <header className={styles.productHeader}>
      <Link href="/dev/redesign" className={styles.productBrand}>FlameNode</Link>
      <nav aria-label="Public navigation" className={styles.productNav}>
        <span>作品</span>
        <span>イベント</span>
        <span>クリエイター</span>
      </nav>
      <div className={styles.headerAccount}>{personal ? "@frame_user" : "ログイン"}</div>
    </header>
  );
}

function ConsoleSidebar({ mode }: { mode: "manage" | "admin" }): React.ReactElement {
  const groups = mode === "admin"
    ? [
        ["Content", "作品", "お知らせ"],
        ["Events", "イベント", "グループ"],
        ["Users", "ユーザー", "X ID"],
        ["Moderation", "審査", "ケース"],
        ["Operations", "通知", "監査", "同期"],
        ["System", "Health", "Workers", "Security"],
      ]
    : [
        ["Workspace", "Overview", "Notifications"],
        ["PVSF 2026 Autumn", "Overview", "Videos", "Slots", "Review", "Audience", "Staff", "Settings"],
      ];

  return (
    <aside className={styles.consoleSidebar}>
      <div className={styles.consoleBrand}>FlameNode <span>{mode === "admin" ? "ADMIN" : "MANAGE"}</span></div>
      {groups.map(([label, ...items]) => (
        <section key={label} className={styles.navGroup}>
          <h2>{label}</h2>
          {items.map((item, index) => (
            <button key={item} type="button" className={index === 0 ? styles.navActive : undefined}>{item}</button>
          ))}
        </section>
      ))}
    </aside>
  );
}

function PageHeading({ item, compact = false }: { item: MockRoute; compact?: boolean }): React.ReactElement {
  return (
    <header className={compact ? styles.pageHeadingCompact : styles.pageHeading}>
      <div>
        <p className={styles.eyebrow}>{item.category}</p>
        <h1>{item.title}</h1>
        <p>{item.purpose}</p>
      </div>
      <button type="button" className={styles.primaryButton}>{item.primaryAction}</button>
    </header>
  );
}

function WorkGrid({ limit = 4 }: { limit?: number }): React.ReactElement {
  return (
    <div className={styles.workGrid}>
      {works.slice(0, limit).map((work, index) => (
        <article key={`${work.title}-${index}`} className={styles.workTile}>
          <div className={styles.thumbnail} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span></div>
          <h3>{work.title}</h3>
          <p>{work.creator}</p>
          <span>{work.meta}</span>
        </article>
      ))}
    </div>
  );
}

function PublicHome(): React.ReactElement {
  return (
    <main className={styles.publicMain}>
      <section className={styles.firstViewport}>
        <div className={styles.sectionHeadingInline}>
          <div><p className={styles.eyebrow}>LATEST</p><h1>新着作品</h1></div>
          <button type="button" className={styles.textAction}>すべて見る</button>
        </div>
        <WorkGrid />
      </section>
      <section className={styles.eventStrip}>
        <div><strong>受付中</strong><span>PVSF 2026 Autumn</span></div>
        <div><span>締切 10/08 23:59</span><button type="button" className={styles.secondaryButton}>イベントを見る</button></div>
      </section>
      <section className={styles.publicSection}>
        <div className={styles.sectionHeadingInline}><h2>注目の作品</h2><button className={styles.textAction}>ランキング</button></div>
        <WorkGrid />
      </section>
    </main>
  );
}

function publicListLabel(item: MockRoute): string {
  if (item.url.includes("event")) return "イベント";
  if (item.url.includes("user")) return "クリエイター";
  if (item.url.includes("groups")) return "グループ";
  return "作品";
}

function PublicList({ item }: { item: MockRoute }): React.ReactElement {
  const label = publicListLabel(item);
  return (
    <main className={styles.publicMain}>
      <PageHeading item={item} compact />
      <div className={styles.filterBar}>
        <input aria-label="検索" placeholder={`${label}を検索`} />
        <select aria-label="状態"><option>すべて</option><option>公開中</option></select>
        <button type="button" className={styles.secondaryButton}>絞り込み</button>
      </div>
      {label === "作品" ? (
        <WorkGrid />
      ) : (
        <div className={styles.simpleList}>
          {events.map((event) => (
            <article key={event.name} className={styles.simpleRow}>
              <div><strong>{event.name}</strong><span>{label} · 2026</span></div>
              <span className={styles.status}>{event.status}</span>
              <button type="button" className={styles.textAction}>開く</button>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function PublicDetail({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.detailMain}>
      <div className={styles.videoStage}><span>16:9 VIDEO</span></div>
      <div className={styles.detailTitleRow}>
        <div><p className={styles.eyebrow}>WORK</p><h1>Afterimage</h1><p>@frame_user · PVSF 2026 Autumn</p></div>
        <button type="button" className={styles.secondaryButton}>作者を見る</button>
      </div>
      <div className={styles.detailColumns}>
        <section><h2>作品について</h2><p>作品コメントと必要なクレジットだけを、映像の直下で読みやすく表示します。</p></section>
        <dl><div><dt>公開</dt><dd>2026/10/03</dd></div><div><dt>イベント</dt><dd>PVSF 2026 Autumn</dd></div></dl>
      </div>
      <section className={styles.publicSection}><h2>関連作品</h2><WorkGrid limit={3} /></section>
      <span className={styles.srOnly}>{item.primaryAction}</span>
    </main>
  );
}

function PublicEvent({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.publicMain}>
      <header className={styles.eventHeader}>
        <div><span className={styles.status}>開催中</span><h1>{item.title === "イベントグループ詳細" ? "PVSF Series" : "PVSF 2026 Autumn"}</h1><p>2026/10/03 — 10/12 · 作品を主役に、説明は必要最小限にします。</p></div>
        <button type="button" className={styles.primaryButton}>{item.primaryAction}</button>
      </header>
      <nav className={styles.inlineTabs}><button className={styles.tabActive}>Works</button><button>About</button><button>Schedule</button></nav>
      <section className={styles.publicSection}><h2>作品</h2><WorkGrid /></section>
    </main>
  );
}

function PublicProfile({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.publicMain}>
      <header className={styles.profileHeader}><div className={styles.avatar}>F</div><div><p className={styles.eyebrow}>CREATOR</p><h1>@frame_user</h1><p>映像 / Motion Graphics</p></div></header>
      <div className={styles.inlineTabs}><button className={styles.tabActive}>Works</button><button>Events</button><button>About</button></div>
      <section className={styles.publicSection}><div className={styles.sectionHeadingInline}><h2>{item.title}</h2><span>12 works</span></div><WorkGrid /></section>
    </main>
  );
}

function PublicInfo({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.readingMain}>
      <PageHeading item={item} compact />
      <div className={styles.readingLayout}>
        <nav><a href="#summary">概要</a><a href="#usage">使い方</a><a href="#policy">ルール</a></nav>
        <article><h2 id="summary">概要</h2><p>長い装飾的なHeroを置かず、読む必要がある情報だけを見出しと本文で整理します。</p><h2 id="usage">使い方</h2><p>作品を見る、イベントに参加する、作品を投稿する、の順で主要な行動を説明します。</p><h2 id="policy">ルール</h2><p>重要事項は短い段落と区切り線で提示します。</p></article>
      </div>
    </main>
  );
}

function Dashboard({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.personalMain}>
      <PageHeading item={item} compact />
      <section className={styles.actionSection}>
        <div className={styles.sectionHeadingInline}><div><p className={styles.eyebrow}>NEXT ACTION</p><h2>今やること</h2></div><span className={styles.warningText}>締切まで 2日</span></div>
        <article className={styles.actionRow}><div><strong>PVSF 2026 Autumn に作品を提出</strong><span>確保済み枠 · 10/05 21:00まで</span></div><button className={styles.primaryButton}>提出を続ける</button></article>
        <article className={styles.actionRow}><div><strong>X ID 連携申請</strong><span>承認待ち · 操作不要</span></div><span className={styles.status}>確認中</span></article>
      </section>
      <section className={styles.personalSection}><h2>参加中イベント</h2><DataRows rows={events.map((event) => [event.name, event.status, event.deadline, "開く"])} /></section>
      <section className={styles.personalSection}><div className={styles.sectionHeadingInline}><h2>自分の作品</h2><button className={styles.textAction}>すべて見る</button></div><WorkGrid limit={3} /></section>
      <p className={styles.quietStats}>投稿 12 · 累計再生 28,412 · いいね 1,204</p>
    </main>
  );
}

function PersonalList({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.personalMain}>
      <PageHeading item={item} compact />
      <div className={styles.filterBar}><input placeholder="検索" aria-label="検索" /><select aria-label="並び順"><option>更新順</option></select></div>
      <DataRows rows={works.map((work) => [work.title, work.creator, work.status, "開く"])} />
    </main>
  );
}

function fieldsFor(item: MockRoute): string[] {
  if (item.url.includes("permissions")) return ["共同編集者", "編集権限", "公開操作権限"];
  if (item.url.includes("settings")) return ["Active X ID", "表示名", "テーマ"];
  if (item.url.includes("event")) return ["イベント名", "開催期間", "募集期間", "公開状態"];
  if (item.url.includes("announcement")) return ["タイトル", "本文", "公開状態"];
  if (item.url.includes("rules")) return ["規約名", "本文", "適用日"];
  if (item.url.includes("users")) return ["ユーザー", "ロール", "状態"];
  if (item.url.includes("import")) return ["入力データ", "検証モード", "対象"];
  return ["タイトル", "公開状態", "説明", "関連情報"];
}

function FormScreen({ item, entry = false }: { item: MockRoute; entry?: boolean }): React.ReactElement {
  const fields = entry
    ? ["対象", "YouTube URL", "作品タイトル", "作者表記"]
    : fieldsFor(item);
  return (
    <main className={entry ? styles.entryMain : styles.personalMain}>
      <PageHeading item={item} compact />
      {entry ? <div className={styles.steps}><strong>1 入力</strong><span>2 確認</span><span>3 完了</span></div> : null}
      <form className={styles.formLayout}>
        <div className={styles.formFields}>
          {fields.map((field, index) => (
            <label key={field}><span>{field}</span>{index === 2 && field.includes("本文") ? <textarea rows={6} defaultValue="Fixture text" /> : <input defaultValue={index === 0 ? item.title : "Fixture value"} />}</label>
          ))}
        </div>
        <aside className={styles.formAside}><h2>確認</h2><dl><div><dt>状態</dt><dd>下書き</dd></div><div><dt>更新</dt><dd>10/03 23:40</dd></div></dl><button type="button" className={styles.primaryButton}>{item.primaryAction}</button><button type="button" className={styles.secondaryButton}>キャンセル</button></aside>
      </form>
    </main>
  );
}

function Entry({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.entryMain}>
      <PageHeading item={item} compact />
      <section className={styles.entryPriority}><p className={styles.eyebrow}>RESERVED SLOT</p><h2>提出待ちの枠があります</h2><p>PVSF 2026 Autumn · 10/05 21:00 · 締切 10/08 23:59</p><button className={styles.primaryButton}>この枠に提出</button></section>
      <section className={styles.entrySection}><h2>受付中イベント</h2><DataRows rows={events.slice(0, 2).map((event) => [event.name, event.status, `締切 ${event.deadline}`, "参加する"])} /></section>
      <section className={styles.entrySecondary}><div><h2>イベントに紐付けず投稿</h2><p>通常の作品登録はこちら。</p></div><button className={styles.secondaryButton}>通常投稿</button></section>
    </main>
  );
}

function ManageDashboard({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <section className={styles.issueBand}><div><strong>要対応 4件</strong><span>審査 3 · 通知失敗 1</span></div><button className={styles.primaryButton}>審査を開く</button></section>
      <section className={styles.consoleSection}><div className={styles.sectionHeadingInline}><h2>担当イベント</h2><span>3 events</span></div><DataRows rows={events.map((event) => [event.name, event.status, `審査 ${event.pending}`, "開く"])} /></section>
      <section className={styles.consoleSection}><h2>最近の問題</h2><DataRows rows={[["通知送信失敗", "PVSF 2026 Autumn", "5分前", "確認"],["審査待ちが3件", "PVSF 2026 Autumn", "12分前", "審査"]]} /></section>
    </div>
  );
}

function ManageEvent({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <div className={styles.eventStatusLine}><span className={styles.status}>開催中</span><span>受付 10/08まで</span><span>公開作品 24</span><span className={styles.warningText}>審査待ち 3</span></div>
      <nav className={styles.inlineTabs}><button className={styles.tabActive}>Overview</button><button>Videos</button><button>Slots</button><button>Review</button><button>Audience</button><button>Staff</button><button>Settings</button></nav>
      <section className={styles.consoleSection}><h2>要対応</h2><DataRows rows={[["審査待ち", "3件", "高", "Review"],["通知失敗", "1件", "高", "Notifications"],["未提出枠", "4件", "中", "Slots"]]} /></section>
      <section className={styles.consoleSection}><h2>イベント状態</h2><DataRows rows={[["募集", "受付中", "10/08 23:59", "設定"],["開催", "進行中", "10/12 20:00", "公開ページ"]]} /></section>
    </div>
  );
}

function manageRows(item: MockRoute): string[][] {
  if (item.url.includes("staff")) return [["@operator_a", "代表", "有効", "管理"],["@operator_b", "審査", "有効", "管理"],["@operator_c", "閲覧", "有効", "管理"]];
  if (item.url.includes("slots")) return [["10/05 19:00", "reserved", "@frame_user", "開く"],["10/05 19:10", "submitted", "@motionlab", "開く"],["10/05 19:20", "available", "—", "開く"]];
  if (item.url.includes("notifications")) return [["投稿受付", "failed", "2分前", "確認"],["審査完了", "sent", "5分前", "詳細"],["枠確保", "sent", "12分前", "詳細"]];
  if (item.url.includes("review") || item.url.includes("videos")) return works.slice(0, 3).map((work) => [work.title, work.creator, work.status, "開く"]);
  if (item.url.includes("x-link")) return [["@new_creator", "申請中", "10分前", "確認"],["@motion_user", "申請中", "32分前", "確認"]];
  return [[item.title, "正常", "10/03 23:40", "開く"],["関連項目 B", "確認中", "10/03 22:10", "開く"],["関連項目 C", "正常", "10/02 19:30", "開く"]];
}

function ManageList({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <nav className={styles.inlineTabs}><button>Overview</button><button>Videos</button><button>Slots</button><button className={styles.tabActive}>{item.title}</button><button>Staff</button><button>Settings</button></nav>
      <div className={styles.filterBar}><input placeholder="検索" aria-label="検索"/><select aria-label="状態"><option>要対応を先頭</option></select></div>
      <DataRows rows={manageRows(item)} />
    </div>
  );
}

function ManageDetail({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <div className={styles.reviewLayout}><div className={styles.videoStage}><span>VIDEO PREVIEW</span></div><aside><h2>処理</h2><dl><div><dt>状態</dt><dd>審査待ち</dd></div><div><dt>作者</dt><dd>@frame_user</dd></div><div><dt>イベント</dt><dd>PVSF 2026 Autumn</dd></div></dl><button className={styles.primaryButton}>承認</button><button className={styles.secondaryButton}>差し戻し</button></aside></div>
    </div>
  );
}

function adminRows(item: MockRoute): string[][] {
  const url = item.url;
  if (url.includes("workers")) return [["flamenode-web", "正常", "1分前", "詳細"],["flamenode-fast-jobs", "正常", "4分前", "詳細"],["flamenode-sync-jobs", "警告", "8分前", "確認"]];
  if (url.includes("videos")) return works.slice(0, 3).map((work) => [work.title, work.creator, work.status, "開く"]);
  if (url.includes("events")) return events.map((event) => [event.name, event.status, event.deadline, "開く"]);
  if (url.includes("users")) return [["@frame_user", "member", "active", "開く"],["@motionlab", "member", "active", "開く"],["@operator", "admin", "active", "開く"]];
  if (url.includes("audit") || url.includes("history")) return [["video.update", "@operator", "23:40", "詳細"],["slot.reserve", "@frame_user", "23:31", "詳細"],["event.staff.add", "@owner", "22:58", "詳細"]];
  if (url.includes("notifications")) return [["作品受付", "failed", "23:41", "確認"],["審査完了", "sent", "23:35", "詳細"],["枠確保", "sent", "22:52", "詳細"]];
  if (url.includes("youtube")) return [["metadata sync", "正常", "23:38", "詳細"],["playlist sync", "警告", "23:20", "確認"],["quota", "62%", "23:00", "詳細"]];
  if (url.includes("moderation")) return [["case-104", "high", "open", "開く"],["case-103", "medium", "open", "開く"],["case-102", "low", "resolved", "詳細"]];
  if (url.includes("x-")) return [["@new_creator", "pending", "12分前", "確認"],["@archive_user", "pending", "38分前", "確認"]];
  return [[item.title, "正常", "23:40", "開く"],["関連項目 B", "確認中", "22:10", "開く"],["関連項目 C", "正常", "10/02", "開く"]];
}

function AdminDashboard({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <section className={styles.adminPriority}><div><p className={styles.eyebrow}>INBOX</p><h2>対応が必要な項目</h2></div><span>8 items</span></section>
      <DataRows rows={[["通知失敗", "1件", "critical", "開く"],["期限切れケース", "2件", "high", "開く"],["承認待ち作品", "3件", "normal", "審査"],["X ID申請", "2件", "normal", "確認"]]} />
      <section className={styles.consoleSection}><div className={styles.sectionHeadingInline}><h2>System</h2><span>補助情報</span></div><DataRows rows={[["operation mode", "normal", "—", "設定"],["Health", "正常", "1分前", "詳細"],["Workers", "1 warning", "8分前", "確認"]]} /></section>
    </div>
  );
}

function AdminTable({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <div className={styles.filterBar}><input placeholder="検索" aria-label="検索"/><select aria-label="状態"><option>すべての状態</option><option>要対応</option></select><button className={styles.secondaryButton}>Filter</button></div>
      <DataRows rows={adminRows(item)} />
    </div>
  );
}

function AdminDetail({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <div className={styles.consoleMain}>
      <PageHeading item={item} compact />
      <section className={styles.definitionPanel}><dl><div><dt>状態</dt><dd><span className={styles.status}>正常</span></dd></div><div><dt>最終更新</dt><dd>2026/10/03 23:40</dd></div><div><dt>対象</dt><dd>{item.url}</dd></div><div><dt>注意</dt><dd>破壊的操作は確認ダイアログを必須にする</dd></div></dl></section>
      <section className={styles.consoleSection}><h2>関連情報</h2><DataRows rows={adminRows(item)} /></section>
    </div>
  );
}

function SystemScreen({ item }: { item: MockRoute }): React.ReactElement {
  return (
    <main className={styles.systemMain}>
      <div className={styles.systemMark}>FN</div>
      <p className={styles.eyebrow}>SYSTEM</p>
      <h1>{item.title}</h1>
      <p>{item.purpose}</p>
      <button className={styles.primaryButton}>{item.primaryAction}</button>
      <p className={styles.systemHelp}>問題が続く場合に必要な説明だけを表示します。</p>
    </main>
  );
}

function DataRows({ rows }: { rows: string[][] }): React.ReactElement {
  return (
    <div className={styles.dataRows} role="table">
      {rows.map((row, rowIndex) => (
        <div key={`${row[0]}-${rowIndex}`} className={styles.dataRow} role="row">
          {row.map((cell, index) => (
            <span key={`${cell}-${index}`} role="cell" data-label={index === 0 ? "対象" : index === row.length - 1 ? "操作" : index === 1 ? "状態" : "情報"} className={index === 0 ? styles.dataPrimary : undefined}>
              {index === row.length - 1 ? <button className={styles.textAction}>{cell}</button> : cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function StateLab({ item }: { item: MockRoute }): React.ReactElement | null {
  const formLike = item.kind.includes("form") || item.kind === "entry-form";
  const dataLike = item.kind.includes("list") || item.kind.includes("dashboard") || item.kind.includes("table") || item.kind === "manage-event";
  const restricted = item.category === "Manage" || item.category === "Admin";
  if (!formLike && !dataLike && !restricted && item.kind !== "system") return null;

  return (
    <section className={styles.stateLab} aria-label="重要状態のモック">
      <div className={styles.stateLabHead}><div><p className={styles.eyebrow}>STATE LAB</p><h2>重要状態</h2></div><span>実画面外のレビュー用</span></div>
      <div className={styles.stateGrid}>
        {dataLike ? <article><strong>Empty</strong><p>対象データはありません。</p><button className={styles.secondaryButton}>条件を解除</button></article> : null}
        <article><strong>{formLike ? "Disabled" : "Loading"}</strong><p>{formLike ? "権限または前提条件が満たされるまで操作不可。" : "必要な領域だけSkeleton表示。"}</p></article>
        <article><strong>Error</strong><p>失敗理由と再試行だけを提示。</p><button className={styles.secondaryButton}>再試行</button></article>
        {restricted ? <article><strong>Permission denied</strong><p>必要権限と戻り先を明示。</p><button className={styles.secondaryButton}>戻る</button></article> : null}
        {formLike ? <article><strong>Success</strong><p>保存完了。次に行う操作を1つ提示。</p></article> : null}
      </div>
    </section>
  );
}

function ScreenBody({ item }: { item: MockRoute }): React.ReactElement {
  switch (item.kind) {
    case "public-home": return <PublicHome />;
    case "public-list": return <PublicList item={item} />;
    case "public-detail": return <PublicDetail item={item} />;
    case "public-event": return <PublicEvent item={item} />;
    case "public-profile": return <PublicProfile item={item} />;
    case "public-info": return <PublicInfo item={item} />;
    case "dashboard": return <Dashboard item={item} />;
    case "personal-list": return <PersonalList item={item} />;
    case "personal-form": return <FormScreen item={item} />;
    case "entry": return <Entry item={item} />;
    case "entry-form": return <FormScreen item={item} entry />;
    case "manage-dashboard": return <ManageDashboard item={item} />;
    case "manage-event": return <ManageEvent item={item} />;
    case "manage-list": return <ManageList item={item} />;
    case "manage-form": return <FormScreen item={item} />;
    case "manage-detail": return <ManageDetail item={item} />;
    case "admin-dashboard": return <AdminDashboard item={item} />;
    case "admin-table": return <AdminTable item={item} />;
    case "admin-form": return <FormScreen item={item} />;
    case "admin-detail": return <AdminDetail item={item} />;
    case "system": return <SystemScreen item={item} />;
  }
}

export function MockScreen({ item }: { item: MockRoute }): React.ReactElement {
  const consoleMode = item.category === "Manage" ? "manage" : item.category === "Admin" ? "admin" : null;
  const personal = item.category === "Personal" || item.category === "Entry";

  return (
    <>
      <div className={styles.mockCanvas} data-mock-surface={item.category.toLowerCase()}>
        {consoleMode ? (
          <div className={styles.consoleLayout}>
            <ConsoleSidebar mode={consoleMode} />
            <div className={styles.consoleContent}>
              <header className={styles.consoleTopbar}><span>{consoleMode === "admin" ? "Site Administration" : "Event Operations"}</span><span>@operator</span></header>
              <ScreenBody item={item} />
            </div>
          </div>
        ) : (
          <>
            {item.kind !== "system" ? <BrandHeader personal={personal} /> : null}
            <ScreenBody item={item} />
          </>
        )}
      </div>
      <StateLab item={item} />
    </>
  );
}
