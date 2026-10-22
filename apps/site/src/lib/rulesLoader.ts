/**
 * Build-time terms loader for `/rules` (MIG-0501 / Recipe R-PAGE / Runtime S0).
 * CURRENT reads `rules/current.json` per request (`loadStaticRulesPage`) and falls back to the built-in
 * terms when the object is absent or blank. Here the same choice is made once at build time.
 * A source that throws fails the build; an empty rules page is never emitted.
 *
 * The pure helpers below are imported from CURRENT `src/` so the text, version label and date
 * format cannot drift while both sites exist. Phase 9 deletes `src/`: copy them here then.
 */
import fs from "node:fs";
import { normalizeStaticRules } from "../../../../src/lib/publicData/staticRulesCore.ts";
import { DEFAULT_TERMS_MARKDOWN, DEFAULT_TERMS_VERSION_LABEL } from "../../../../src/lib/terms/defaultTerms.ts";
import { parseLegalMarkdown, type LegalMarkdownBlock } from "../../../../src/lib/terms/legalMarkdown.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";

/** Returns the `rules/current.json` payload, or null when none is published. Throws when unreadable. */
export type RulesBuildSource = Readonly<{ read(): Promise<unknown | null> }>;

export type RulesPageData = Readonly<{
  versionLabel: string;
  /** CURRENT `formatUnix(publishedAt ?? updatedAt, { dateOnly: true })`; null when there is no date. */
  updatedLabel: string | null;
  blocks: readonly LegalMarkdownBlock[];
}>;

export class RulesBuildError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RulesBuildError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadRulesForBuild(source: RulesBuildSource): Promise<RulesPageData> {
  let payload: unknown;
  try {
    payload = await source.read();
  } catch {
    throw new RulesBuildError("SOURCE_UNAVAILABLE", "Rules source unavailable; refusing to build /rules");
  }
  if (payload != null && !isRecord(payload)) {
    throw new RulesBuildError("INVALID_PAYLOAD", "Rules payload is not an object");
  }
  const rules = payload ? normalizeStaticRules(payload) : null;
  const body = rules?.bodyMarkdown ?? DEFAULT_TERMS_MARKDOWN;
  const updatedAt = rules?.publishedAt ?? rules?.updatedAt ?? null;
  return {
    versionLabel: rules?.versionLabel ?? DEFAULT_TERMS_VERSION_LABEL,
    updatedLabel: updatedAt ? formatUnix(updatedAt, { dateOnly: true }) : null,
    blocks: parseLegalMarkdown(body),
  };
}

/**
 * Source for the site build. `FLAMENODE_RULES_SNAPSHOT_FILE` points at a downloaded `rules/current.json`;
 * unset means "no published rules" (CURRENT's built-in terms). A set but unreadable path fails the build.
 */
export function rulesSourceFromEnv(env: Record<string, string | undefined> = process.env): RulesBuildSource {
  const file = env.FLAMENODE_RULES_SNAPSHOT_FILE?.trim();
  return {
    async read() {
      if (!file) return null;
      return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    },
  };
}
