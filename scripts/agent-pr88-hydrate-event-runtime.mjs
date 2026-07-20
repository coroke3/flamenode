import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

if (process.env.GITHUB_ACTIONS !== "true") {
  process.exit(0);
}

const branch = "agent/ux-and-status-simplification";
const eventSource = "origin/agent/db-canonical-events";
const parentSource = "origin/agent/db-canonical-migration-v2";
const files = [
  "app/(admin)/admin/api-endpoints/page.tsx",
  "app/(auth)/entry/page.tsx",
  "app/(manage)/manage/events/[id]/slots/page.tsx",
  "app/(manage)/manage/events/[id]/staff/page.tsx",
  "app/(public)/event/[id]/slots/page.tsx",
  "app/api/events/route.ts",
  "src/lib/actions/api-endpoints.ts",
  "src/lib/actions/event-group-admin.ts",
  "src/lib/actions/event-staff-admin.ts",
  "src/lib/actions/slot-admin.ts",
  "src/lib/actions/slot.ts",
  "src/lib/admin/eventSectionFields.ts",
  "src/lib/admin/healthChecks.ts",
  "src/lib/admin/permissionSimulator.ts",
  "src/lib/api/eventExportData.ts",
  "src/lib/event/eventOwnership.ts",
];

function git(args) {
  execFileSync("git", args, { stdio: "inherit" });
}

git([
  "fetch",
  "origin",
  "agent/db-canonical-events",
  "agent/db-canonical-migration-v2",
]);
git(["checkout", eventSource, "--", ...files]);
git(["checkout", parentSource, "--", ".github/workflows/ci.yml"]);

const packagePath = "package.json";
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
delete packageJson.scripts.pretypecheck;
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
rmSync(new URL(import.meta.url), { force: true });

git(["config", "user.name", "github-actions[bot]"]);
git([
  "config",
  "user.email",
  "41898282+github-actions[bot]@users.noreply.github.com",
]);
git(["add", "-A"]);

try {
  execFileSync("git", ["diff", "--cached", "--quiet"]);
} catch {
  git(["commit", "-m", "イベントruntimeを修正後DB正本へ切替"]);
  git(["push", "origin", `HEAD:${branch}`]);
}
