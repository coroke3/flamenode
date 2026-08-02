#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const REQUIRED_PATTERNS = [
  {
    file: "src/lib/audit/types.ts",
    pattern: /actor_x_user_id\?: string \| null;/,
    message: "WriteAuditLogInput must expose actor_x_user_id",
  },
  {
    file: "src/lib/audit/logger.ts",
    pattern: /validateActorXUserId/,
    message: "audit logger must validate actor_x_user_id for strict audits",
  },
  {
    file: "src/lib/audit/mutate.ts",
    pattern: /actor_x_user_id/,
    message: "mutateWithAudit must persist actor_x_user_id",
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

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function main() {
  const violations = [];
  for (const check of REQUIRED_PATTERNS) {
    const source = read(check.file);
    if (!check.pattern.test(source)) {
      violations.push(`${check.file}: ${check.message}`);
    }
  }

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
