import {
  normalizeNumericUnix as normalizeUnix,
  normalizePresentString as normalizeString,
} from "./normalize.ts";

export interface StaticRulesPayload {
  generated_at?: unknown;
  version_label?: unknown;
  body_markdown?: unknown;
  published_at?: unknown;
  updated_at?: unknown;
}

export interface StaticRulesData {
  versionLabel: string;
  bodyMarkdown: string;
  publishedAt: number | null;
  updatedAt: number | null;
  generatedAt: number | null;
}

export function normalizeStaticRules(
  payload: StaticRulesPayload,
): StaticRulesData | null {
  const bodyMarkdown = normalizeString(payload.body_markdown);
  const versionLabel = normalizeString(payload.version_label);
  if (!bodyMarkdown || !versionLabel) return null;
  return {
    versionLabel,
    bodyMarkdown,
    publishedAt: normalizeUnix(payload.published_at),
    updatedAt: normalizeUnix(payload.updated_at ?? payload.published_at),
    generatedAt: normalizeUnix(payload.generated_at),
  };
}
