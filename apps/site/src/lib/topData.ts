/**
 * Build-time model for `/` (MIG-0506). Reads the `top` and `trending` snapshots (same verified envelope as every
 * kind) and applies CURRENT `app/(public)/page.tsx` rules with CURRENT's pure helpers: `normalizeStaticTop`,
 * `pickHeroEvents`, `computeEventStatus`, `formatRemainingTimeMetric`, `shuffledCopy`. The recruit-card state and
 * countdown are CURRENT `EventRecruitCard`'s (copied: that file is a React component), evaluated at build time;
 * the hourly rebuild (MIG-0410/0411) keeps them current.
 * No snapshot configured = null (the caller shows CURRENT's empty shelves). A configured but broken snapshot throws.
 */
import type { TopAnnouncement, TopEventCard, TopRecruit, TopShelf, TopViewProps } from "@flamenode/ui";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import {
  normalizeStaticTop,
  type StaticTopData,
  type StaticTopEvent,
} from "../../../../src/lib/publicData/staticTopCore.ts";
import {
  normalizeStaticTrending,
  TRENDING_TOO_OLD_FOR_HOME_SEC,
  type TrendingItem,
} from "../../../../src/lib/publicData/staticTrendingCore.ts";
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
} from "../../../../src/lib/utils/eventStatusCore.ts";
import { pickHeroEvents, isHeroCandidate } from "../../../../src/lib/utils/pickHeroEvents.ts";
import { formatRemainingTimeMetric } from "../../../../src/lib/utils/remainingTime.ts";
import { shuffledCopy } from "../../../../src/lib/utils/shuffle.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";
import { TOP_KEY, TRENDING_KEY, loadListingPayload } from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";
import { toListVideo, toTrendingRow } from "./videoCards.ts";

/** Per-shelf display count (CURRENT `TOP_SHELF_DISPLAY_LIMIT`). */
export const TOP_SHELF_DISPLAY_LIMIT = 8;
const MAX_RECRUIT_CARDS = 3;
const DAY = 86400;

export class TopBuildError extends Error {
  readonly code = "TOP_INVALID";
  constructor(key: string) {
    super(`Top snapshot ${key} is not in the CURRENT artifact shape`);
    this.name = "TopBuildError";
  }
}

type RecruitState = "before_entry" | "accepting" | "after_entry" | "soon" | "ongoing" | "ended" | "full";

const STATE_LABEL: Record<RecruitState, string> = {
  before_entry: "募集開始前",
  accepting: "募集期間中",
  after_entry: "公開前作品受付中",
  soon: "近日公開",
  ongoing: "開催中",
  ended: "終了",
  full: "満枠",
};

const KIND: Record<RecruitState, TopRecruit["kind"]> = {
  before_entry: "pre",
  accepting: "entry",
  full: "entry",
  after_entry: "submit",
  soon: "submit",
  ongoing: "submit",
  ended: "ended",
};

const md = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
const compactDate = (ts: number): string => md.format(new Date(ts * 1000));
function range(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null && end == null) return "-";
  return `${start != null ? compactDate(start) : "-"} — ${end != null ? compactDate(end) : "-"}`;
}

/** CURRENT `resolveState`. */
export function recruitState(event: StaticTopEvent, available: number | null, now: number): RecruitState {
  const status = computeEventStatus(event, now);
  if (status === "ended" || status === "private") return "ended";
  if (isAcceptingEntries(event, now)) return available === 0 ? "full" : "accepting";
  if (status === "active") return "ongoing";
  const point = event.start_time ?? event.end_time;
  if (event.entry_end_time != null && now >= event.entry_end_time && point) {
    return (point - now) / DAY <= 3 ? "soon" : "after_entry";
  }
  return "before_entry";
}

/** CURRENT `resolveCountdown`. */
export function recruitCountdown(event: StaticTopEvent, now: number, state: RecruitState) {
  const post = range(event.start_time, event.end_time);
  const entry = range(event.entry_start_time ?? null, event.entry_end_time ?? null);
  if (state === "before_entry" && event.entry_start_time != null && event.entry_start_time > now) {
    return { heading: "募集開始まで", seconds: event.entry_start_time - now, range: entry };
  }
  if ((state === "accepting" || state === "full") && event.entry_end_time != null && event.entry_end_time > now) {
    return { heading: "募集締切まで", seconds: event.entry_end_time - now, range: entry };
  }
  if (event.start_time != null && event.start_time > now) return { heading: "投稿期間まで", seconds: event.start_time - now, range: post };
  if (event.end_time != null && event.end_time > now) return { heading: "投稿期間終了まで", seconds: event.end_time - now, range: post };
  return { heading: "終了済み", seconds: null, range: post };
}

export function toRecruit(event: StaticTopEvent, stat: { available: number; total: number } | undefined, now: number): TopRecruit {
  const available = stat ? stat.available : null;
  const total = stat ? stat.total : null;
  const state = recruitState(event, available, now);
  const countdown = recruitCountdown(event, now, state);
  const metric = formatRemainingTimeMetric(countdown.seconds);
  return {
    id: event.id,
    title: event.title,
    statusLabel: STATE_LABEL[state],
    kind: KIND[state],
    imageUrl: cachedGoogleImageUrl(event.img_url),
    countdownHeading: countdown.heading,
    countdownRange: countdown.range,
    countdownValue: metric?.value ?? null,
    countdownUnit: metric?.unit ?? null,
    slotFilled: total != null && available != null ? Math.max(0, total - available) : null,
    slotTotal: total,
    ctaHref: `/event/${event.id}`,
    ctaLabel: "詳細ページへ",
  };
}

/** CURRENT `PublicEventCard` header: pill tone, status label and `formatRange`. */
export function toEventCard(event: StaticTopEvent, now: number): TopEventCard {
  const status = computeEventStatus(event, now);
  const accepting = isAcceptingEntries(event, now);
  const start = formatUnix(event.start_time, { dateOnly: true });
  const end = formatUnix(event.end_time, { dateOnly: true });
  return {
    id: event.id,
    title: event.title,
    statusLabel: eventStatusLabel(status),
    tone: accepting ? "accent" : status === "scheduled" ? "warn" : "muted",
    rangeLabel: start && end ? `${start} - ${end}` : start || end || "日程未定",
    imageUrl: cachedGoogleImageUrl(event.img_url),
  };
}

const announcementBody = (body: string): string => (body.length > 180 ? `${body.slice(0, 179)}...` : body);

const isPublicRow = (v: { status?: string | null }): boolean => v.status === "public";

export function buildTopView(
  data: StaticTopData | null,
  trendingItems: readonly TrendingItem[],
  now: number,
  random: () => number = Math.random,
): TopViewProps {
  const d = data;
  const activeEvents = d?.activeEvents ?? [];
  const latest = (d?.latest ?? []).filter(isPublicRow);
  const stats = d?.stats ?? { publicVideos: latest.length, activeEvents: activeEvents.length, creators: d?.creators.length ?? 0 };
  const topSlotStats = d?.topSlotStats ?? new Map();
  const take = <T,>(rows: readonly T[]): T[] => rows.slice(0, TOP_SHELF_DISPLAY_LIMIT);

  const picks = shuffledCopy(take((d?.recommended ?? []).filter(isPublicRow)), random);
  const latestLoop = shuffledCopy(take(latest), random);
  const nostalgic = take((d?.nostalgic ?? []).filter(isPublicRow));

  const heroEvents = pickHeroEvents(activeEvents, undefined, now) as StaticTopEvent[];
  const primaryEvent = heroEvents[0] ?? null;
  const recruitEvents = (pickHeroEvents(activeEvents, MAX_RECRUIT_CARDS, now) as StaticTopEvent[]).filter((e) => e.id !== primaryEvent?.id);
  const hasMore = activeEvents.filter((e) => isHeroCandidate(e, now)).length > MAX_RECRUIT_CARDS;

  const shelves: TopShelf[] = [];
  if (trendingItems.length > 0) {
    shelves.push({
      id: "trending",
      eyebrow: "TRENDING",
      title: "FlameNodeで注目",
      description: "FlameNode内で最近よく視聴されている作品",
      moreHref: "/trending",
      moreLabel: "ランキングを見る",
      items: take(trendingItems).map((item, i) => toTrendingRow(item, i)).map((row) => ({
        id: row.id, href: row.href, title: row.title, thumbnailUrl: row.thumbnailUrl, creatorName: row.creatorName, creatorIconUrl: row.creatorIconUrl, rank: row.rank,
      })),
      emptyMessage: "",
    });
  }
  shelves.push(
    { id: "recommend", eyebrow: "PICKS", title: "今週のピックアップ", moreHref: "/recommend", moreLabel: "一覧を見る", items: picks.map(toListVideo), emptyMessage: "おすすめできる作品がまだありません。" },
    { id: "latest", eyebrow: "LATEST", title: "新着アップロード", moreHref: "/list", moreLabel: "すべて見る", items: latestLoop.map(toListVideo), emptyMessage: "公開作品がまだありません。" },
    { id: "nostalgic", eyebrow: "ARCHIVE", title: "懐かしの映像", description: "公開から3年以上たった作品を、アーカイブから再発見。", moreHref: "/list?sort=old", moreLabel: "過去の作品を見る", items: nostalgic.map(toListVideo), emptyMessage: "対象になる作品がまだありません。" },
  );

  const announcements: TopAnnouncement[] = (d?.announcements ?? []).map((a) => ({ id: a.id, title: a.title, body: announcementBody(a.body) }));
  return {
    stats: { publicVideos: stats.publicVideos, creators: stats.creators, activeEvents: stats.activeEvents },
    primary: primaryEvent ? toRecruit(primaryEvent, topSlotStats.get(primaryEvent.id), now) : null,
    recruits: recruitEvents.map((e) => toRecruit(e, topSlotStats.get(e.id), now)),
    moreRecruitCount: hasMore ? recruitEvents.length : null,
    announcements,
    shelves,
    events: take(d?.latestEvents ?? []).map((e) => toEventCard(e, now)),
    eventsEmptyMessage: "公開中のイベントがまだありません。",
  };
}

export async function loadTopForBuild(
  env: Record<string, string | undefined> = process.env,
  now: number = Math.floor(Date.now() / 1000),
  random: () => number = Math.random,
): Promise<TopViewProps> {
  const access = snapshotAccessFromEnv(env);
  if (!access) return buildTopView(null, [], now, random);
  const read = (key: string) => loadListingPayload(access.source, key, access.options);
  const top = normalizeStaticTop((await read(TOP_KEY)) as Parameters<typeof normalizeStaticTop>[0]);
  if (!top) throw new TopBuildError(TOP_KEY);
  const trending = normalizeStaticTrending((await read(TRENDING_KEY)) as Parameters<typeof normalizeStaticTrending>[0]);
  if (!trending) throw new TopBuildError(TRENDING_KEY);
  // CURRENT: trending joins the top page only while it is fresh enough for it.
  const tooOld = now - trending.generatedAt > TRENDING_TOO_OLD_FOR_HOME_SEC;
  return buildTopView(top, tooOld ? [] : trending.items, now, random);
}
