import type { CanonicalLegacyPlan } from "./normalize";

export const MAX_LEGACY_IMPORT_SELECTED_ROWS = 250;
export const MAX_LEGACY_IMPORT_STEP_BYTES = 128 * 1024;
export const MAX_LEGACY_EVENT_STAFF_PER_EVENT = 64;
export const MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO = 16;
export const MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO = 64;
export const MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO = 128;
export const MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO = 32;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function grouped<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const current = result.get(id);
    if (current) current.push(row);
    else result.set(id, [row]);
  }
  return result;
}

/** Cloudflareの1 apply requestで扱う関連行数・JSON量をpreview時にfail closedで固定する。 */
export function legacyImportCpuBudgetErrors(plan: CanonicalLegacyPlan): string[] {
  const errors: string[] = [];
  const staffByEvent = grouped(plan.eventStaff, (row) => row.event_id);
  const eventsByVideo = grouped(plan.videoEvents, (row) => row.video_id);
  const membersByVideo = grouped(plan.videoMembers, (row) => row.video_id);
  const chaptersByVideo = grouped(plan.videoChapters, (row) => row.video_id);
  const softwaresByVideo = grouped(plan.videoSoftwares, (row) => row.video_id);
  const answersByVideo = grouped(plan.videoCustomAnswers, (row) => row.video_id);
  const questionsById = new Map(plan.eventCustomQuestions.map((row) => [row.id, row]));

  for (const event of plan.events) {
    const staff = staffByEvent.get(event.id) ?? [];
    if (staff.length > MAX_LEGACY_EVENT_STAFF_PER_EVENT) {
      errors.push(`イベント ${event.id} の運営メンバーは1回の取込で最大${MAX_LEGACY_EVENT_STAFF_PER_EVENT}件です。`);
      continue;
    }
    if (byteLength({ event, staff }) > MAX_LEGACY_IMPORT_STEP_BYTES) {
      errors.push(`イベント ${event.id} の1ステップデータが128KBを超えています。内容または対象範囲を分割してください。`);
    }
  }

  for (const video of plan.videos) {
    const relations = eventsByVideo.get(video.id) ?? [];
    const members = membersByVideo.get(video.id) ?? [];
    const chapters = chaptersByVideo.get(video.id) ?? [];
    const softwares = softwaresByVideo.get(video.id) ?? [];
    const answers = answersByVideo.get(video.id) ?? [];
    const questions = answers
      .map((answer) => questionsById.get(answer.question_id))
      .filter((row) => row !== undefined);
    const limits: Array<[number, number, string]> = [
      [relations.length, MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO, "所属イベント"],
      [members.length, MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO, "参加メンバー"],
      [chapters.length, MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO, "チャプター"],
      [softwares.length, MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO, "使用ソフト"],
    ];
    for (const [count, limit, label] of limits) {
      if (count > limit) {
        errors.push(`作品 ${video.id} の${label}は1回の取込で最大${limit}件です。`);
      }
    }
    if (byteLength({ video, relations, members, chapters, softwares, answers, questions }) > MAX_LEGACY_IMPORT_STEP_BYTES) {
      errors.push(`作品 ${video.id} の1ステップデータが128KBを超えています。メンバー・チャプター等を整理してください。`);
    }
  }

  return errors.slice(0, 100);
}
