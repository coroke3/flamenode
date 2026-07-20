import type { VideoVisibilityStatus } from "@/lib/constants/collaborator-permissions";
import {
  firstSearchParamValue,
  type SearchParamValue,
} from "#utils/next";

export type VideoVisibilityGroupKey = "review" | "public" | "private" | "closed";

type VideoVisibilityGroup = {
  key: VideoVisibilityGroupKey;
  label: string;
  statuses: readonly VideoVisibilityStatus[];
};

export const VIDEO_VISIBILITY_GROUPS: readonly VideoVisibilityGroup[] = [
  { key: "review", label: "審査待ち", statuses: ["pending"] },
  { key: "public", label: "公開", statuses: ["public"] },
  { key: "private", label: "非公開", statuses: ["private"] },
  { key: "closed", label: "無効", statuses: ["voided"] },
];

const LABELS: Record<VideoVisibilityStatus, string> = {
  pending: "審査待ち",
  public: "公開",
  private: "非公開",
  voided: "無効化",
};

const ALL_STATUSES = new Set<VideoVisibilityStatus>(
  VIDEO_VISIBILITY_GROUPS.flatMap((group) => group.statuses),
);

export function isVideoVisibilityStatus(
  status: string,
): status is VideoVisibilityStatus {
  return ALL_STATUSES.has(status as VideoVisibilityStatus);
}

export function isVideoVisibilityGroupKey(
  value: string,
): value is VideoVisibilityGroupKey {
  return VIDEO_VISIBILITY_GROUPS.some((group) => group.key === value);
}

export function videoVisibilityGroupForStatus(
  status: string,
): VideoVisibilityGroupKey | null {
  if (!isVideoVisibilityStatus(status)) return null;
  return (
    VIDEO_VISIBILITY_GROUPS.find((group) => group.statuses.includes(status))
      ?.key ?? null
  );
}

export function videoVisibilityGroupForFilter(
  value: string,
): VideoVisibilityGroupKey | null {
  if (isVideoVisibilityGroupKey(value)) return value;
  return videoVisibilityGroupForStatus(value);
}

export function videoVisibilityStatusesForFilter(
  value: string,
): readonly VideoVisibilityStatus[] | null {
  if (!value) return null;
  const group = VIDEO_VISIBILITY_GROUPS.find((item) => item.key === value);
  if (group) return group.statuses;
  return isVideoVisibilityStatus(value) ? [value] : null;
}

export function normalizeVideoVisibilityFilter(
  value: SearchParamValue,
  fallback = "",
): string {
  const normalized = firstSearchParamValue(value);
  if (!normalized || normalized === "all") return "";
  if (isVideoVisibilityGroupKey(normalized) || isVideoVisibilityStatus(normalized)) {
    return normalized;
  }
  return fallback;
}

export function videoVisibilityLabel(status: string): string {
  return isVideoVisibilityStatus(status) ? LABELS[status] : status;
}

export function videoVisibilityFilterLabel(value: string): string {
  const group = VIDEO_VISIBILITY_GROUPS.find((item) => item.key === value);
  return group?.label ?? videoVisibilityLabel(value);
}

export function videoVisibilityBadgeClass(status: string): string {
  const group = videoVisibilityGroupForStatus(status);
  if (group === "public") return "fn-badge-accent";
  if (group === "review") return "fn-badge-warning";
  if (status === "voided") return "fn-badge-danger";
  return "fn-badge-soft";
}
