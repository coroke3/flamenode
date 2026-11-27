import * as React from "react";
import type { EditAccess } from "@flamenode/contracts";
import { Icon } from "../../routes/ui/Icon.js";

const SECTION_LABELS = [
  ["identity", "提出者情報"],
  ["basics", "作品タイトル・基本情報"],
  ["youtube", "YouTube URL"],
  ["credits", "楽曲・クレジット"],
  ["descriptions", "紹介文・振り返り"],
  ["members", "合作メンバー"],
  ["memberChapters", "メンバーチャプター"],
  ["primaryEvent", "所属イベント"],
  ["visibility", "公開状態"],
  ["permissions", "共同編集権限"],
] as const satisfies ReadonlyArray<readonly [keyof EditAccess["sections"], string]>;

function describeSections(access: EditAccess) {
  const editableLabels: string[] = [];
  const lockedLabels: string[] = [];
  const eventTitles = new Set<string>();
  for (const [key, label] of SECTION_LABELS) {
    if (!access.sections[key]) {
      lockedLabels.push(label);
      continue;
    }
    editableLabels.push(label);
    if (access.privilegeMode === "event") {
      const title = (access.sectionEventSources?.[key]?.eventTitle ?? access.eventTitleForMode)?.trim();
      if (title) eventTitles.add(title);
    }
  }
  return { editableLabels, lockedLabels, eventTitles: [...eventTitles] };
}

function normalLead(access: EditAccess): string {
  if (access.ownership.isOwner) {
    return "所有者向け一般作品権限が適用されています。編集できる項目とできない項目は以下のとおりです。";
  }
  if (access.canOfferEventMode) {
    return "通常モードでは編集できません。上部からイベント運営権限へ切り替えると、許可された項目を編集できます。";
  }
  if (access.canOfferAdminMode) {
    return "通常モードでは編集できません。上部から管理者権限へ明示的に切り替えてください。";
  }
  return "現在の通常モードで編集できる項目とできない項目は以下のとおりです。";
}

function PermissionList({ title, labels, emptyText }: {
  title: string;
  labels: readonly string[];
  emptyText: string;
}): React.ReactElement {
  const titleId = React.useId();
  return (
    <section className="vedit-overview-listBlock" aria-labelledby={titleId}>
      <h3 id={titleId} className="vedit-overview-listTitle">{title}</h3>
      {labels.length > 0 ? (
        <ul className="vedit-overview-list">
          {labels.map((label) => <li key={label}>{label}</li>)}
        </ul>
      ) : (
        <p className="vedit-overview-emptyList">{emptyText}</p>
      )}
    </section>
  );
}

// Keep the CURRENT mode heading, copy and list layout together. The API supplies all permission decisions.
export function VideoEditPermissionOverview({ access }: { access: EditAccess }): React.ReactElement {
  const headingId = React.useId();
  const mode = access.privilegeMode;
  const className = `vedit-overview-panel vedit-overview-${mode} fn-privilege-banner fn-privilege-banner--${mode}`;
  if (mode === "admin") {
    return (
      <section className={className} aria-labelledby={headingId}>
        <h2 id={headingId} className="vedit-overview-heading">
          <Icon name="alert" size={12} aria-hidden />
          管理者権限で編集中
        </h2>
        <p className="vedit-overview-lead">
          提出主体や所属イベントなど、通常では変更できない項目も編集できます。
        </p>
        <p className="vedit-overview-auditNote">
          管理者権限での変更は監査ログに記録されます。必要な操作のみ行ってください。
        </p>
      </section>
    );
  }

  const { editableLabels, lockedLabels, eventTitles } = describeSections(access);
  const isEvent = mode === "event";
  const lead = isEvent
    ? eventTitles.length > 1
      ? "項目ごとに異なるイベントの運営権限が適用されています。"
      : "付与された運営権限の範囲内でのみ、作品情報を編集できます。"
    : normalLead(access);
  return (
    <section className={className} aria-labelledby={headingId}>
      <h2 id={headingId} className="vedit-overview-heading">
        <Icon name={isEvent ? "users" : "info"} size={isEvent ? 12 : 11} aria-hidden />
        {isEvent ? "イベント運営権限で編集中" : "現在の編集権限"}
      </h2>
      {eventTitles.length > 0 ? (
        <p className="vedit-overview-eventName">権限元イベント: {eventTitles.join(" / ")}</p>
      ) : null}
      <p className="vedit-overview-lead">{lead}</p>
      <div className="vedit-overview-lists">
        <PermissionList title="編集可能" labels={editableLabels} emptyText="現在、編集できる項目はありません。" />
        <PermissionList title="編集不可" labels={lockedLabels} emptyText="すべての項目が編集可能です。" />
      </div>
    </section>
  );
}
