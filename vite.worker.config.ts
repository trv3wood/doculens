import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "public/.worker-build",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL("./src/workers/scanner.ts", import.meta.url)),
      name: "DocuLensScanner",
      formats: ["iife"],
      fileName: () => "scanner.js",
    },
  },
});
