import fs from "fs";
import path from "path";

const dir = "src/lib/actions";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
let changed = 0;

for (const file of files) {
  const fp = path.join(dir, file);
  let c = fs.readFileSync(fp, "utf8");
  if (!c.includes("historyLogs")) continue;
  const orig = c;

  if (!c.includes("auditAction")) {
    c = c.replace(
      /^"use server";\r?\n/,
      '"use server";\nimport { auditAction } from "@/lib/audit/helpers";\n',
    );
  }

  c = c.replace(/await db\.insert\(historyLogs\)\.values\(/g, "await auditAction(db, ");

  c = c.replace(/(\n\s*retention_class:[^\n]+\n)\s*created_at: now,\n/g, "$1");
  c = c.replace(/(\n\s*operator_discord_id:[^\n]+\n)\s*created_at: now,\n/g, "$1");

  c = c.replace(/import \{([^}]*)\} from "@\/lib\/db\/schema";/g, (m, inner) => {
    const parts = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => p !== "historyLogs");
    if (parts.length === 0) return "";
    return `import { ${parts.join(", ")} } from "@/lib/db/schema";`;
  });

  if (c !== orig) {
    fs.writeFileSync(fp, c);
    changed++;
    console.log("updated", file);
  }
}

console.log("total", changed);
