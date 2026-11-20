#!/usr/bin/env node
/** 逐项比较本地 CLI 与官方 packer 的通过/拒绝结论。 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderFiles, validateOfficial } from "./official.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const validatePath = join(root, "scripts", "validate.mjs");
const base = {
  format: 1,
  id: "01a1f801-1869-7a35-a7a2-b72ae4d4d7f8",
  name: "conformance",
  version: "1.0.0",
  entry: "index.html",
  script: "app.js",
  style: "app.css",
  permissions: ["theme.read", "workers.create", "files.save"],
  assets: ["workers/scanner.js"],
  code: { workers: ["workers/scanner.js"] },
};

const cases = [
  ["合法 Worker 声明", {}],
  ["非法版本", { version: "1.0" }],
  ["未知权限", { permissions: ["not.aPermission"] }],
  ["重复权限", { permissions: ["theme.read", "theme.read"] }],
  ["缺少 Worker 权限", { permissions: ["theme.read"] }],
  ["Worker 未列入 assets", { assets: [] }],
  ["非法资源路径", { assets: ["../escape.wasm"], code: undefined }],
  ["占位 ID 仅警告", { id: "00000000-0000-7000-8000-000000000000" }],
];

const temp = mkdtempSync(join(tmpdir(), "doculens-conformance-"));
let failed = 0;
try {
  for (const [label, patch] of cases) {
    const manifest = { ...base, ...patch };
    let official;
    try {
      await validateOfficial(manifest, placeholderFiles(manifest));
      official = "PASS";
    } catch {
      official = "FAIL";
    }
    const path = join(temp, "manifest.json");
    writeFileSync(path, JSON.stringify(manifest));
    let local;
    try {
      execFileSync(process.execPath, [validatePath, path], { stdio: "pipe" });
      local = "PASS";
    } catch {
      local = "FAIL";
    }
    const match = official === local;
    if (!match) failed++;
    console.log(`${match ? "OK" : "MISMATCH"}  ${label}: official=${official}, local=${local}`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(`通过 ${cases.length} 项官方 packer 一致性检查`);
