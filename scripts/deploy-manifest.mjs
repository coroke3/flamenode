import fs from "node:fs";
import path from "node:path";

export const DEPLOY_MANIFEST_RELATIVE_PATH =
  ".deploy/flamenode-production-deploy.json";

export const PRODUCTION_DEPLOY_ORDER = Object.freeze([
  "flamenode-content-jobs",
  "flamenode-fast-jobs",
  "flamenode-sync-jobs",
  "flamenode-web",
]);

export function deployManifestPath(repoRoot = process.cwd()) {
  return path.join(repoRoot, DEPLOY_MANIFEST_RELATIVE_PATH);
}

export function createEmptyDeployManifest() {
  return {
    format_version: 1,
    merged_commit_sha: null,
    deployed_at: null,
    workers: Object.fromEntries(
      PRODUCTION_DEPLOY_ORDER.map((service) => [
        service,
        {
          previous_version_id: null,
          new_version_id: null,
        },
      ]),
    ),
    migration: {
      status: "not_started",
      readonly_preflight: null,
      pending: [],
    },
    smoke: {
      status: "pending",
      ran_at: null,
    },
    rollback: {
      target_commit_sha: null,
      notes: "",
    },
  };
}

export function readDeployManifest(repoRoot = process.cwd()) {
  const filePath = deployManifestPath(repoRoot);
  if (!fs.existsSync(filePath)) {
    return createEmptyDeployManifest();
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    ...createEmptyDeployManifest(),
    ...parsed,
    workers: {
      ...createEmptyDeployManifest().workers,
      ...(parsed.workers ?? {}),
    },
    migration: {
      ...createEmptyDeployManifest().migration,
      ...(parsed.migration ?? {}),
    },
    smoke: {
      ...createEmptyDeployManifest().smoke,
      ...(parsed.smoke ?? {}),
    },
    rollback: {
      ...createEmptyDeployManifest().rollback,
      ...(parsed.rollback ?? {}),
    },
  };
}

export function writeDeployManifest(repoRoot, manifest) {
  const filePath = deployManifestPath(repoRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function parseWranglerDeployVersionId(output) {
  const text = String(output ?? "");
  const patterns = [
    /Current Version ID:\s*([0-9a-f-]{36})/i,
    /"id"\s*:\s*"([0-9a-f-]{36})"/i,
    /Uploaded\s+([0-9a-f-]{36})/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function beginDeployManifest(repoRoot, commit) {
  const current = readDeployManifest(repoRoot);
  const workers = { ...current.workers };
  for (const service of PRODUCTION_DEPLOY_ORDER) {
    const previous = workers[service]?.new_version_id ?? null;
    workers[service] = {
      previous_version_id: previous,
      new_version_id: null,
    };
  }
  const manifest = {
    ...current,
    merged_commit_sha: commit,
    deployed_at: new Date().toISOString(),
    workers,
    migration: {
      ...current.migration,
      status: "readonly_preflight_pending",
      readonly_preflight: null,
    },
    smoke: {
      status: "pending",
      ran_at: null,
    },
    rollback: {
      target_commit_sha: current.merged_commit_sha,
      notes: current.merged_commit_sha
        ? "previous production manifest commit"
        : "",
    },
  };
  writeDeployManifest(repoRoot, manifest);
  return manifest;
}

export function recordDeployWorkerVersion(repoRoot, service, versionId) {
  const manifest = readDeployManifest(repoRoot);
  if (!manifest.workers[service]) {
    manifest.workers[service] = {
      previous_version_id: null,
      new_version_id: null,
    };
  }
  manifest.workers[service].new_version_id = versionId;
  writeDeployManifest(repoRoot, manifest);
  return manifest;
}

export function markDeployMigrationPreflightPassed(repoRoot) {
  const manifest = readDeployManifest(repoRoot);
  manifest.migration = {
    ...manifest.migration,
    status: "readonly_preflight_passed",
    readonly_preflight: new Date().toISOString(),
  };
  writeDeployManifest(repoRoot, manifest);
  return manifest;
}

export function markDeploySmokeResult(repoRoot, { ok, ranAt = new Date().toISOString() } = {}) {
  const manifest = readDeployManifest(repoRoot);
  manifest.smoke = {
    status: ok ? "passed" : "failed",
    ran_at: ranAt,
  };
  writeDeployManifest(repoRoot, manifest);
  return manifest;
}
