export interface AnnouncementResult {
  ok: boolean;
  message?: string;
  id?: string;
}

export type AnnouncementSeverity = "info" | "warning" | "danger";
export type AnnouncementTargetAudience = "all" | "creators" | "admins";

export interface ParsedAnnouncementDates {
  publishAt: number | null;
  expireAt: number | null;
}
