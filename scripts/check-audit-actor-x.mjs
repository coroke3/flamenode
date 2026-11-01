#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = process.cwd();
const REQUIRED_PATTERNS = [
  {
    file: "packages/server-core/src/audit/types.ts",
    pattern: /actor_x_user_id\?: string \| null;/,
    message: "WriteAuditLogInput must expose actor_x_user_id",
  },
  {
    file: "packages/server-core/src/audit/logger.ts",
    pattern:
      /loadApprovedActorXPairs\(db, activeInputs\)[\s\S]*?if \(!linked && input\.strict\) \{[\s\S]*?throw new Error\("actor_x_user_id is not linked to actor_user_id"\)/,
    message: "audit logger must validate actor_x_user_id for strict audits",
  },
  {
    file: "packages/server-core/src/audit/mutate.ts",
    pattern: /actor_x_user_id/,
    message: "mutateWithAudit must persist actor_x_user_id",
  },
  {
    file: "src/lib/actions/xid.ts",
    pattern: /actor_x_user_id:/,
    message: "xid actions must set actor_x_user_id on audits",
  },
  {
    file: "src/lib/actions/xid.ts",
    pattern: /xLinkDeletionAllowedSql/,
    message: "deleteLinkedXId must re-check blockers in DELETE SQL",
  },
  {
    file: "src/lib/actions/xid-admin.ts",
    pattern: /buildXIdentityDecisionFields/,
    message: "xid-admin must persist decision metadata",
  },
];

// A textual contract marker in a comment is not evidence of executable wiring.
// Use the TS lexer instead of a comment regex so URLs, strings and templates
// containing // or /* remain intact. Preserve offsets and newlines for patterns.
export function withoutComments(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const chars = source.split(""); // TS scanner offsets count UTF-16 code units.
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia &&
        token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    for (let i = scanner.getTokenPos(); i < scanner.getTextPos(); i++) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    }
  }
  return chars.join("");
}

export function findAuditActorXViolations(readSource) {
  const violations = [];
  for (const check of REQUIRED_PATTERNS) {
    const source = withoutComments(readSource(check.file));
    if (!check.pattern.test(source)) {
      violations.push(`${check.file}: ${check.message}`);
    }
  }
  return violations;
}

function main() {
  const violations = findAuditActorXViolations((relPath) =>
    fs.readFileSync(path.join(root, relPath), "utf8"),
  );
  if (violations.length === 0) {
    console.log("[check:audit-actor-x] OK: actor X audit wiring present.");
    process.exit(0);
  }

  for (const violation of violations) {
    console.error(violation);
  }
  console.error(`[check:audit-actor-x] ${violations.length} issue(s) found.`);
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
