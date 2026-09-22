import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1" },
  build: { outDir: mode === "web" ? "dist-web" : "dist" },
}));
