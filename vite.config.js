import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  publicDir: "../public",
  envDir: "..",
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
  server: { fs: { allow: [".."] } },
});
