import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const actionsDirectory = new URL("./", import.meta.url);

test("audited actions isolate cache revalidation from committed mutations", async () => {
  const names = (await readdir(actionsDirectory)).filter((name) =>
    name.endsWith(".ts"),
  );
  const sources = await Promise.all(
    names.map(async (name) => ({
      name,
      source: await readFile(new URL(name, actionsDirectory), "utf8"),
    })),
  );
  const targets = sources.filter(
    ({ source }) =>
      source.includes("mutateWithAudit(") && source.includes("revalidatePath("),
  );

  for (const { name, source } of targets) {
    if (name === "slot-admin-danger.ts") {
      assert.match(
        source,
        /try \{\s*revalidateForceReleasedPaths\([\s\S]*?\} catch \(error\) \{/,
        `${name} must keep its explicit post-commit revalidation boundary`,
      );
      continue;
    }

    assert.match(
      source,
      /runPostCommitBestEffort/,
      `${name} must not let revalidation report a committed mutation as failed`,
    );
  }

  assert.ok(targets.length >= 10, "expected broad audited-action coverage");
});
