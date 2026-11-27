import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: "/",
  // NEXT_PUBLIC_SITE_URL is public configuration, not a secret or runtime binding.
  // Missing configuration stays empty so the permission grant preview fails closed.
  define: {
    __FLAMENODE_PUBLIC_SITE_URL__: JSON.stringify(process.env.NEXT_PUBLIC_SITE_URL ?? ""),
    __FLAMENODE_RUNTIME_MODE__: JSON.stringify(command === "build" ? "production" : "development"),
  },
  build: {
    assetsDir: "_personal_assets",
  },
}));
