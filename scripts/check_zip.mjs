#!/usr/bin/env node
/** 解析并检查 ZIP 结构，再把真实内容交给官方 SDK packer 完整复验。 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { assertUploadableId, validateOfficial } from "./official.mjs";

const rawArgs = process.argv.slice(2);
const allowPlaceholder = rawArgs.includes("--allow-placeholder");
const args = rawArgs.filter((arg) => arg !== "--allow-placeholder");
if (args.length !== 1) {
  process.stderr.write("用法: node scripts/check_zip.mjs <app.zip> [--allow-placeholder]\n");
  process.exit(2);
}

function fail(message) {
  throw new Error(message);
}

try {
  const zipPath = args[0];
  const buffer = readFileSync(zipPath);
  if (buffer.length > 32 * 1024 * 1024) fail("原始 ZIP 超过 32 MiB");

  let eocd = -1;
  const tailStart = Math.max(0, buffer.length - 65557);
  for (let index = buffer.length - 22; index >= tailStart; index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) fail("找不到 ZIP 结束目录");
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  if (totalEntries > 1024) fail("ZIP 文件数超过 1024");
  let cursor = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  let expandedBytes = 0;

  for (let index = 0; index < totalEntries; index++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail(`中央目录损坏：条目 ${index}`);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const unixMode = (externalAttributes >>> 16) & 0o170000;
    if (unixMode === 0o120000) fail(`ZIP 内含符号链接：${name}`);
    if (files.has(name.normalize("NFC"))) fail(`ZIP 内重复文件：${name}`);
    if (name.endsWith("/")) fail(`ZIP 内含目录项：${name}`);
    if (name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..")) {
      fail(`ZIP 内含非法路径：${name}`);
    }
    if (uncompressedSize > 32 * 1024 * 1024) fail(`${name} 超过单文件 32 MiB`);
    expandedBytes += uncompressedSize;
    if (expandedBytes > 128 * 1024 * 1024) fail("展开总量超过 128 MiB");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail(`本地文件头损坏：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = inflateRawSync(compressed);
    else fail(`不支持的压缩方法 ${method}：${name}`);
    if (content.length !== uncompressedSize) fail(`解压后大小不符：${name}`);
    files.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) fail("ZIP 内缺少 manifest.json");
  if (manifestBytes.length > 1024 * 1024) fail("manifest.json 超过 1 MiB");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assertUploadableId(manifest, allowPlaceholder);
  files.delete("manifest.json");
  await validateOfficial(manifest, Object.fromEntries(files));

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  process.stdout.write(`OK  ZIP 与官方 packer 校验通过（${manifest.name || manifest.id} ${manifest.version}）\n`);
  process.stdout.write(
    `    文件 ${files.size + 1} 个，展开 ${(expandedBytes / 1024).toFixed(1)} KiB，sha256 ${sha256}\n`,
  );
} catch (error) {
  process.stderr.write(`check_zip 失败: ${error?.message || error}\n`);
  process.exit(1);
}
