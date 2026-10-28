export type {
  BucketPort,
  Clock,
  EdgeCachePort,
  EnvValues,
  KvPort,
  QueueWakeHost,
  QueueWakeHostLoader,
  QueueWakePort,
  RethrowFrameworkControl,
  WaitUntilPort,
} from "./ports.ts";

/**
 * MIG-0648: RH-019 read-only suggestion services.
 * Exported through the existing server-core entry while parallel PRs own
 * package.json; replace with explicit subpath exports during U03 integration.
 */
export { loadMemberSuggestionsCandidatesV2FromBucket } from "./memberSuggestion/v2Loader.ts";
export { loadMemberSuggestionsIndexFromBucket } from "./memberSuggestion/loader.ts";
export { searchMemberSuggestions } from "./memberSuggestion/search.ts";
export type { MemberSuggestionItem } from "./memberSuggestion/core.ts";
