import type { Config } from "drizzle-kit";

export default {
  schema: "./packages/db/src/schema/index.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;
