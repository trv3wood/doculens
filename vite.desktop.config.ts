import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { productionTemplate } from "./scripts/production-template.ts";

export default defineConfig({
  plugins: [
    {
      name: "desktop-html",
      transformIndexHtml(html) {
        const template = readFileSync(new URL("./src/template.html", import.meta.url), "utf8");
        return html
          .replace("<title>DocuLens · 本地预览</title>", "<title>DocuLens</title>")
          .replace("<!--app-->", () => productionTemplate(template));
      },
    },
  ],
  build: {
    outDir: "dist/desktop",
    target: "es2022",
  },
});
