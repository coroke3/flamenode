import type { EnqueueStaticRebuildInput } from "@/lib/staticRebuild/types";

export type SpreadsheetStaticRebuildOperation = "CREATE" | "UPDATE" | "DELETE";

export type SpreadsheetStaticRebuildMutation = {
  table: string;
  operation: SpreadsheetStaticRebuildOperation;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actorUserId: string;
  /** Existing event links for video_members rows, loaded by the mutation caller. */
  eventReleaseEventIds?: readonly string[];
};

/** buildStaticRebuildQueueBatch() の入力上限と同じ。超過時はapply前に分割を要求する。 */
export const SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT = 16;
export const SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED =
  "静的再生成対象が多すぎます。行を分割してください。";

const VIDEO_RANDOM_POOL_FIELDS = [
  "title",
  "youtube_video_id",
  "creator_display_name",
  "creator_icon_url",
  "creator_x_user_id",
  "primary_event_id",
  "scheduled_time",
  "visibility_status",
] as const;

const YOUTUBE_RELATED_STATUS_FIELDS = [
  "youtube_privacy_status",
  "youtube_availability_status",
] as const;

function valueFromMutation(
  mutation: SpreadsheetStaticRebuildMutation,
  key: string,
): string | null {
  const value = mutation.after?.[key] ?? mutation.before?.[key];
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function valuesFromMutation(
  mutation: SpreadsheetStaticRebuildMutation,
  key: string,
): string[] {
  return [mutation.before?.[key], mutation.after?.[key]]
    .map((value) => {
      if (value == null) return null;
      const normalized = String(value).trim();
      return normalized || null;
    })
    .filter(
      (value, index, values): value is string =>
        value !== null && values.indexOf(value) === index,
    );
}

function changed(
  mutation: SpreadsheetStaticRebuildMutation,
  fields: readonly string[],
): boolean {
  if (mutation.operation !== "UPDATE") return true;
  return fields.some(
    (field) => !Object.is(mutation.before?.[field], mutation.after?.[field]),
  );
}

function reasonFor(mutation: SpreadsheetStaticRebuildMutation): string {
  return `admin_spreadsheet_${mutation.table}_${mutation.operation.toLowerCase()}`;
}

function targetKey(target: EnqueueStaticRebuildInput): string {
  return `${target.targetType}:${target.targetId}`;
}

function addVideoCardGlobalTargets(
  mutation: SpreadsheetStaticRebuildMutation,
  add: (
    mutation: SpreadsheetStaticRebuildMutation,
    target: Omit<EnqueueStaticRebuildInput, "reason" | "requestedByUserId">,
  ) => void,
): void {
  add(mutation, {
    targetType: "random_video_pool",
    targetId: "global",
    priority: "low",
  });
  add(mutation, {
    targetType: "list_recent",
    targetId: "global",
  });
  add(mutation, {
    targetType: "list_popular",
    targetId: "global",
  });
  add(mutation, {
    targetType: "search_index",
    targetId: "global",
    priority: "low",
  });
  add(mutation, {
    targetType: "top_recommended",
    targetId: "global",
    priority: "low",
  });
  add(mutation, {
    targetType: "top_latest",
    targetId: "global",
    priority: "low",
  });
  add(mutation, {
    targetType: "top_nostalgic",
    targetId: "global",
    priority: "low",
  });
  add(mutation, {
    targetType: "recommend_core",
    targetId: "global",
    priority: "low",
  });
}

/**
 * Spreadsheetのbefore/after snapshotだけから、同じatomic batchへ含める静的再生成targetを導出する。
 * DB参照や副作用を持たないため、apply前の上限判定にも使用できる。
 */
export function planSpreadsheetStaticRebuildTargets(
  mutations: readonly SpreadsheetStaticRebuildMutation[],
): EnqueueStaticRebuildInput[] {
  const targets = new Map<string, EnqueueStaticRebuildInput>();

  const add = (
    mutation: SpreadsheetStaticRebuildMutation,
    target: Omit<EnqueueStaticRebuildInput, "reason" | "requestedByUserId">,
  ) => {
    const planned: EnqueueStaticRebuildInput = {
      ...target,
      reason: reasonFor(mutation),
      requestedByUserId: mutation.actorUserId,
    };
    targets.set(targetKey(planned), planned);
  };

  for (const mutation of mutations) {
    switch (mutation.table) {
      case "events": {
        const eventId = valueFromMutation(mutation, "id");
        if (!eventId) {
          throw new Error("spreadsheet_static_rebuild_target_id_missing:events");
        }
        // イベントのタイトル・説明・スタッフ表示設定などは event_base に、
        // 枠関連の再計算と公開一覧の波及は専用 target に任せる。公開状態は
        // spreadsheet から編集不可だが、その他の編集でも古い R2 artifact を
        // 残さないため、CREATE/UPDATE の両方で同じ fan-out を行う。
        add(mutation, {
          targetType: "event_base",
          targetId: eventId,
          priority: "high",
        });
        add(mutation, {
          targetType: "event_slots",
          targetId: eventId,
          priority: "high",
        });
        add(mutation, {
          targetType: "event_release",
          targetId: eventId,
          priority: "high",
        });
        add(mutation, {
          targetType: "events_index",
          targetId: "global",
          priority: "low",
        });
        add(mutation, {
          targetType: "search_index",
          targetId: "global",
          priority: "low",
        });
        add(mutation, {
          targetType: "top_events",
          targetId: "global",
        });
        add(mutation, {
          targetType: "top_stats",
          targetId: "global",
        });
        add(mutation, {
          targetType: "top_slot_stats",
          targetId: "global",
        });
        break;
      }
      case "event_groups": {
        add(mutation, {
          targetType: "events_index",
          targetId: "global",
          priority: "low",
        });
        break;
      }
      case "videos": {
        const videoId = valueFromMutation(mutation, "id");
        if (!videoId)
          throw new Error(
            "spreadsheet_static_rebuild_target_id_missing:videos",
          );
        add(mutation, {
          targetType: "video",
          targetId: videoId,
          priority: "high",
        });
        for (const eventId of valuesFromMutation(mutation, "primary_event_id")) {
          add(mutation, {
            targetType: "event_release",
            targetId: eventId,
            priority: "high",
          });
        }
        if (changed(mutation, VIDEO_RANDOM_POOL_FIELDS)) {
          addVideoCardGlobalTargets(mutation, add);
        }
        if (changed(mutation, ["visibility_status"])) {
          add(mutation, {
            targetType: "youtube_related_blocklist",
            targetId: "global",
          });
          // hooks.globalListTargets と同じ: list は通常、search だけ low
          add(mutation, {
            targetType: "list_recent",
            targetId: "global",
          });
          add(mutation, {
            targetType: "list_popular",
            targetId: "global",
          });
          add(mutation, {
            targetType: "search_index",
            targetId: "global",
            priority: "low",
          });
        }
        break;
      }
      case "video_youtube_metadata": {
        const videoId = valueFromMutation(mutation, "video_id");
        if (!videoId) {
          throw new Error(
            "spreadsheet_static_rebuild_target_id_missing:video_youtube_metadata",
          );
        }
        add(mutation, {
          targetType: "video",
          targetId: videoId,
          priority: "high",
        });
        if (changed(mutation, YOUTUBE_RELATED_STATUS_FIELDS)) {
          add(mutation, {
            targetType: "youtube_related_blocklist",
            targetId: "global",
          });
          add(mutation, {
            targetType: "random_video_pool",
            targetId: "global",
            priority: "low",
          });
        }
        break;
      }
      case "video_events": {
        const videoIds = valuesFromMutation(mutation, "video_id");
        if (videoIds.length === 0)
          throw new Error(
            "spreadsheet_static_rebuild_target_id_missing:video_events",
          );
        for (const videoId of videoIds) {
          add(mutation, {
            targetType: "video",
            targetId: videoId,
            priority: "high",
          });
        }
        for (const eventId of valuesFromMutation(mutation, "event_id")) {
          add(mutation, {
            targetType: "event_release",
            targetId: eventId,
            priority: "high",
          });
        }
        add(mutation, {
          targetType: "random_video_pool",
          targetId: "global",
          priority: "low",
        });
        break;
      }
      case "video_members":
      case "video_chapters": {
        const videoId = valueFromMutation(mutation, "video_id");
        if (!videoId) {
          throw new Error(
            `spreadsheet_static_rebuild_target_id_missing:${mutation.table}`,
          );
        }
        add(mutation, {
          targetType: "video",
          targetId: videoId,
          priority: "high",
        });
        if (mutation.table === "video_members") {
          add(mutation, {
            targetType: "users_index",
            targetId: "global",
            priority: "low",
          });
          for (const eventId of mutation.eventReleaseEventIds ?? []) {
            add(mutation, {
              targetType: "event_release",
              targetId: eventId,
              priority: "high",
            });
          }
        }
        break;
      }
      case "x_users": {
        const xUserId = valueFromMutation(mutation, "id");
        if (!xUserId)
          throw new Error(
            "spreadsheet_static_rebuild_target_id_missing:x_users",
          );
        add(mutation, { targetType: "user", targetId: xUserId });
        add(mutation, {
          targetType: "users_index",
          targetId: "global",
          priority: "low",
        });
        break;
      }
      default:
        break;
    }

    if (targets.size > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT) {
      throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
    }
  }

  return [...targets.values()];
}
