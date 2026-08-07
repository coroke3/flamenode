import * as React from "react";
import type { VideoEditPermissionViewModel } from "@/lib/video/videoEditPermissionView";
import { buildPermissionSummaryLists } from "@/lib/video/videoEditPermissionView";
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
  return (
    <div className={styles.listBlock}>
      <p className={styles.listTitle}>{title}</p>
      {labels.length > 0 ? (
        <ul className={styles.list}>
          {labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyList}>{emptyText}</p>
      )}
    </div>
  );
}

export function VideoEditPermissionOverview({
  viewModel,
  eventTitleForMode,
}: VideoEditPermissionOverviewProps): React.ReactElement {
  const { privilegeMode } = viewModel;

  if (privilegeMode === "admin") {
    return (
      <section
        role="status"
        className={cn(styles.panel, styles.admin, "fn-privilege-banner", "fn-privilege-banner--admin")}
        aria-label="管理者権限での編集"
      >
        <p className={styles.heading}>
          <Icon name="alert" size={12} aria-hidden />
          管理者権限で編集中
        </p>
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
    const sourceLabels = Array.from(
      new Set(
        [
          viewModel.identity,
          viewModel.basics,
          viewModel.youtube,
          viewModel.credits,
          viewModel.descriptions,
          viewModel.members,
          viewModel.memberChapters,
          viewModel.primaryEvent,
          viewModel.visibility,
          viewModel.permissions,
        ]
          .filter((field) => field.editable && field.eventTitle)
          .map((field) => field.eventTitle as string),
      ),
    );

    return (
      <section
        role="status"
        className={cn(styles.panel, styles.event, "fn-privilege-banner", "fn-privilege-banner--event")}
        aria-label="イベント運営権限での編集"
      >
        <p className={styles.heading}>
          <Icon name="users" size={12} aria-hidden />
          イベント運営権限で編集中
        </p>
        {eventTitleForMode ? (
          <p className={styles.eventName}>権限元イベント: {eventTitleForMode}</p>
        ) : null}
        {sourceLabels.length > 1 ? (
          <p className={styles.lead}>
            項目ごとの権限元: {sourceLabels.join(" / ")}
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
      role="status"
      className={cn(styles.panel, styles.normal, "fn-privilege-banner", "fn-privilege-banner--normal")}
      aria-label="現在の編集権限"
    >
      <p className={styles.heading}>
        <Icon name="info" size={11} aria-hidden />
        現在の編集権限
      </p>
      <p className={styles.lead}>
        所有者向け一般作品権限が適用されています。編集できる項目とできない項目は以下のとおりです。
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
