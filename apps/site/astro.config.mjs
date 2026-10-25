import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { eventRedirects } from "./src/integrations/eventRedirects.ts";

export default defineConfig({
  output: "static",
  integrations: [react(), eventRedirects()],
});
