import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pack } from "@discourse-mini-app/sdk/pack";

export const PLACEHOLDER_ID = "00000000-0000-7000-8000-000000000000";
export const BASE_FILES = ["index.html", "app.js", "app.css", "strings.json"];

/** 用官方 packer 校验；临时 ZIP 只用于取得与平台一致的 verdict。 */
export async function validateOfficial(manifest, files) {
  const outputDirectory = mkdtempSync(join(tmpdir(), "doculens-official-pack-"));
  try {
    return await pack({ manifest, files, outputDirectory });
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

/** manifest 预检使用最小合法基础文件，ZIP 校验则传真实文件。 */
export function placeholderFiles(manifest) {
  const files = {
    "index.html": '<div id="app"></div>',
    "app.js": "",
    "app.css": "",
    "strings.json": "{}",
  };
  for (const path of manifest.assets || []) files[path] = new Uint8Array([0]);
  const remote = new Set(Object.keys(manifest.remote_assets || {}));
  for (const declaration of Object.values(manifest.media || {})) {
    if (declaration?.path && !remote.has(declaration.path)) {
      files[declaration.path] = new Uint8Array([0]);
    }
  }
  return files;
}

export function assertUploadableId(manifest, allowPlaceholder) {
  if (manifest.id === PLACEHOLDER_ID && !allowPlaceholder) {
    throw new Error(
      "拒绝使用脚手架占位 ID 打包或上传。请从社区应用页原样复制 UUIDv7；" +
        "仅本地布局测试可显式传 --allow-placeholder。",
    );
  }
}
