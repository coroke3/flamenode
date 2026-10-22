/**
 * FlameNode D1 schemaの唯一の公開正本 (@flamenode/db/schema)。
 *
 * `base.ts` は未変更テーブルの内部定義fragment、
 * `canonical.ts` はDB再編で確定したテーブル定義である。
 * アプリ・Worker・テスト・Hono APIは必ずこのpackageから利用する。
 */
export { accounts, announcements, auditLogs, auditRestoreRuns, eventCustomQuestions, eventGroups, eventTemplates, notificationOutbox, publicVisibilityFences, schemaVersion, sessions, softwareCatalog, spreadsheetImportRuns, staticArtifacts, staticRebuildQueue, termsVersions, userTosConsents, users, verificationTokens, videoCustomAnswers, videoEvents, videoModerationCases, xUserAliases, } from "./base.js";
export { eventGroupEvents, eventStaff, eventYoutubePlaylistItems, eventYoutubePlaylistSync, eventYoutubePlaylistSyncRuns, events, externalApiQuotaUsage, opsIncidentState, slotReservationGroups, slots, softwareAliases, systemSettings, videoChapters, videoInteractions, videoInteractionsAuth, videoMembers, videoSoftwares, videoYoutubeMetadata, videos, workerLeases, xIdentityRequests, xUserAccountLinks, xUsers, } from "./canonical.js";
//# sourceMappingURL=index.js.map