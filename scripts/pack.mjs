#!/usr/bin/env node
/** Node 备用打包路径：只负责收集文件，校验和 ZIP 生成全部交给官方 SDK。 */

import { lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  BASE_FILES,
  assertUploadableId,
} from "./official.mjs";
import { pack } from "@discourse-mini-app/sdk/pack";

const rawArgs = process.argv.slice(2);
const allowPlaceholder = rawArgs.includes("--allow-placeholder")
  || process.env.MINI_APP_ALLOW_PLACEHOLDER_ID === "1";
const args = rawArgs.filter((arg) => arg !== "--allow-placeholder");
if (args.length !== 3) {
  process.stderr.write("用法: node scripts/pack.mjs <manifest.json> <web目录> <输出目录> [--allow-placeholder]\n");
  process.exit(2);
}

function readPackageFiles(webDir, manifest) {
  const files = {};
  const remote = new Set(Object.keys(manifest.remote_assets || {}));
  const paths = [
    ...BASE_FILES,
    ...(manifest.assets || []),
    ...Object.values(manifest.media || {})
      .map((declaration) => declaration?.path)
      .filter((path) => path && !remote.has(path)),
  ];
  for (const path of paths) {
    const full = resolve(webDir, path);
    if (!full.startsWith(resolve(webDir) + sep)) throw new Error(`资源路径越界: ${path}`);
    const stat = lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`只允许普通文件: ${path}`);
    files[path] = readFileSync(full);
  }
  return files;
}

try {
  const [manifestArg, webArg, outArg] = args;
  const manifest = JSON.parse(readFileSync(resolve(manifestArg), "utf8"));
  if (process.env.MINI_APP_ID) manifest.id = process.env.MINI_APP_ID;
  if (process.env.MINI_APP_VERSION) manifest.version = process.env.MINI_APP_VERSION;
  assertUploadableId(manifest, allowPlaceholder);
  const files = readPackageFiles(resolve(webArg), manifest);
  const result = await pack({ manifest, files, outputDirectory: resolve(outArg) });
  process.stdout.write(
    `Created ${result.file} (${result.size} bytes), app ${manifest.id}, ` +
      `version ${manifest.version}, sha256 ${result.zipSha256}\n`,
  );
} catch (error) {
  process.stderr.write(`打包失败: ${error?.message || error}\n`);
  process.exit(1);
}
