import * as React from "react";
import type { VideoEditPermissionViewModel } from "@/lib/video/videoEditPermissionView";
import {
  buildEditableEventSourceLabels,
  buildPermissionSummaryLists,
} from "@/lib/video/videoEditPermissionView";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import styles from "./VideoEditPermissionOverview.module.css";

export interface VideoEditPermissionOverviewProps {
  viewModel: VideoEditPermissionViewModel;
  eventTitleForMode?: string | null;
}

function PermissionList({
  title,
  labels,
  emptyText,
}: {
  title: string;
  labels: string[];
  emptyText: string;
}): React.ReactElement {
  const titleId = React.useId();
  return (
    <section className={styles.listBlock} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.listTitle}>{title}</h3>
      {labels.length > 0 ? (
        <ul className={styles.list}>
          {labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyList}>{emptyText}</p>
      )}
    </section>
  );
}

export function VideoEditPermissionOverview({
  viewModel,
}: VideoEditPermissionOverviewProps): React.ReactElement {
  const { privilegeMode } = viewModel;
  const headingId = React.useId();

  if (privilegeMode === "admin") {
    return (
      <section
        className={cn(styles.panel, styles.admin, "fn-privilege-banner", "fn-privilege-banner--admin")}
        aria-labelledby={headingId}
      >
        <h2 id={headingId} className={styles.heading}>
          <Icon name="alert" size={12} aria-hidden />
          管理者権限で編集中
        </h2>
        <p className={styles.lead}>
          提出主体や所属イベントなど、通常では変更できない項目も編集できます。
        </p>
        <p className={styles.auditNote}>
          管理者権限での変更は監査ログに記録されます。必要な操作のみ行ってください。
        </p>
      </section>
    );
  }

  if (privilegeMode === "event") {
    const { editableLabels, lockedLabels } = buildPermissionSummaryLists(viewModel);
    const sourceLabels = buildEditableEventSourceLabels(viewModel);

    return (
      <section
        className={cn(styles.panel, styles.event, "fn-privilege-banner", "fn-privilege-banner--event")}
        aria-labelledby={headingId}
      >
        <h2 id={headingId} className={styles.heading}>
          <Icon name="users" size={12} aria-hidden />
          イベント運営権限で編集中
        </h2>
        {sourceLabels.length > 0 ? (
          <p className={styles.eventName}>
            権限元イベント: {sourceLabels.join(" / ")}
          </p>
        ) : null}
        {sourceLabels.length > 1 ? (
          <p className={styles.lead}>
            項目ごとに異なるイベントの運営権限が適用されています。
          </p>
        ) : (
          <p className={styles.lead}>
            付与された運営権限の範囲内でのみ、作品情報を編集できます。
          </p>
        )}
        <div className={styles.lists}>
          <PermissionList
            title="編集可能"
            labels={editableLabels}
            emptyText="現在、編集できる項目はありません。"
          />
          <PermissionList
            title="編集不可"
            labels={lockedLabels}
            emptyText="すべての項目が編集可能です。"
          />
        </div>
      </section>
    );
  }

  const { editableLabels, lockedLabels } = buildPermissionSummaryLists(viewModel);

  return (
    <section
      className={cn(styles.panel, styles.normal, "fn-privilege-banner", "fn-privilege-banner--normal")}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className={styles.heading}>
        <Icon name="info" size={11} aria-hidden />
        現在の編集権限
      </h2>
      <p className={styles.lead}>
        {viewModel.ownership.isOwner
          ? "所有者向け一般作品権限が適用されています。編集できる項目とできない項目は以下のとおりです。"
          : viewModel.canOfferEventMode
            ? "通常モードでは編集できません。上部からイベント運営権限へ切り替えると、許可された項目を編集できます。"
            : viewModel.canOfferAdminMode
              ? "通常モードでは編集できません。上部から管理者権限へ明示的に切り替えてください。"
              : "現在の通常モードで編集できる項目とできない項目は以下のとおりです。"}
      </p>
      <div className={styles.lists}>
        <PermissionList
          title="編集可能"
          labels={editableLabels}
          emptyText="現在、編集できる項目はありません。"
        />
        <PermissionList
          title="編集不可"
          labels={lockedLabels}
          emptyText="すべての項目が編集可能です。"
        />
      </div>
    </section>
  );
}
