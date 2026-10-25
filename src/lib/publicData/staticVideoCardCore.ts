import type { VideoCardData } from "@/components/video/VideoCard";
import {
  normalizeStaticVideoCardBase,
  normalizePublicVideoCard as normalizePublicVideoCardCore,
  normalizePublicVideoCardList as normalizePublicVideoCardListCore,
  type StaticVideoCardBase,
  type StaticVideoCardData,
} from "@flamenode/server-core/publicData/videoCardCore";

export type { StaticVideoCardBase, StaticVideoCardData };

// MIG-0634 U01: the core card shape and the UI VideoCardData must stay mutually assignable.
const cardShapesMatch: [StaticVideoCardData] extends [VideoCardData]
  ? [VideoCardData] extends [StaticVideoCardData]
    ? true
    : false
  : false = true;
void cardShapesMatch;
export { normalizeStaticVideoCardBase };

export function normalizePublicVideoCard(value: unknown): VideoCardData | null {
  return normalizePublicVideoCardCore(value) as VideoCardData | null;
}

export function normalizePublicVideoCardList(value: unknown): VideoCardData[] {
  return normalizePublicVideoCardListCore(value) as VideoCardData[];
}
