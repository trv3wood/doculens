import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { productionTemplate } from "../../scripts/production-template.ts";

describe("生产模板", () => {
  it("移除开发专用的诊断日志控件", () => {
    const template = readFileSync("src/template.html", "utf8");
    expect(template).toContain('id="log"');

    const production = productionTemplate(template);
    expect(production).not.toContain('id="log"');
    expect(production).not.toContain("class=\"diagnostics\"");
    expect(production).not.toContain("diagnostics:dev-only");
    expect(production).toContain('id="workspace"');
  });

  it("拒绝未标记的诊断日志块", () => {
    expect(() => productionTemplate('<details class="diagnostics"><pre id="log"></pre></details>'))
      .toThrow("诊断日志");
  });
});
