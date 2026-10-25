import type { VideoCardData } from "@/components/video/VideoCard";
import {
  normalizeStaticVideoCardBase,
  normalizePublicVideoCard as normalizePublicVideoCardCore,
  normalizePublicVideoCardList as normalizePublicVideoCardListCore,
  type StaticVideoCardBase,
  type StaticVideoCardData,
} from "@flamenode/server-core/publicData/videoCardCore";

export type { StaticVideoCardBase, StaticVideoCardData };
export { normalizeStaticVideoCardBase };

export function normalizePublicVideoCard(value: unknown): VideoCardData | null {
  return normalizePublicVideoCardCore(value) as VideoCardData | null;
}

export function normalizePublicVideoCardList(value: unknown): VideoCardData[] {
  return normalizePublicVideoCardListCore(value) as VideoCardData[];
}
