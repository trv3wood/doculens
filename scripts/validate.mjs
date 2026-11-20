#!/usr/bin/env node
/** 使用项目内官方 SDK packer 预检 manifest，不维护第二套平台规则。 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PLACEHOLDER_ID,
  placeholderFiles,
  validateOfficial,
} from "./official.mjs";

const target = process.argv[2];
if (!target || process.argv.length !== 3) {
  process.stderr.write("用法: node scripts/validate.mjs <项目目录或 manifest.json>\n");
  process.exit(2);
}

try {
  const path = resolve(target);
  const manifestPath = path.endsWith(".json") ? path : resolve(path, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  await validateOfficial(manifest, placeholderFiles(manifest));
  process.stdout.write(`OK  官方 packer 校验通过（${manifest.name || manifest.id}）\n`);
  if (manifest.id === PLACEHOLDER_ID) {
    process.stdout.write("  ! 占位 ID 仅可用于本地测试，上传前必须换成应用页 UUIDv7\n");
  }
} catch (error) {
  process.stderr.write(`validate 失败: ${error?.message || error}\n`);
  process.exit(1);
}
