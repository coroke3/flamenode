/**
 * FlameNode D1 schemaの唯一の公開正本。
 *
 * `schema.base.ts` は未変更テーブルの内部定義fragment、
 * `schema.canonical.ts` は今回のDB再編で確定したテーブル定義である。
 * アプリ・Worker・テストは必ずこのmoduleからimportする。
 */
export {
  accounts,
  announcements,
  auditLogs,
  auditRestoreRuns,
  eventCustomQuestions,
  eventGroups,
  eventTemplates,
  notificationOutbox,
  publicVisibilityFences,
  schemaVersion,
  sessions,
  softwareCatalog,
  spreadsheetImportRuns,
  staticArtifacts,
  staticRebuildQueue,
  termsVersions,
  userTosConsents,
  users,
  verificationTokens,
  videoCustomAnswers,
  videoEvents,
  videoModerationCases,
  xUserAliases,
} from "./schema.base.ts";

export {
  eventGroupEvents,
  eventStaff,
  eventYoutubePlaylistItems,
  eventYoutubePlaylistSync,
  events,
  externalApiQuotaUsage,
  slots,
  softwareAliases,
  systemSettings,
  videoChapters,
  videoInteractions,
  videoMembers,
  videoSoftwares,
  videoYoutubeMetadata,
  videos,
  workerLeases,
  xIdentityRequests,
  xUserAccountLinks,
  xUsers,
} from "./schema.canonical.ts";
