import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const enginePath = "engine/opencv.js";
const workerPath = "public/.worker-build/scanner.js";
const outputPath = "public/workers/scanner.js";

const [engine, worker] = await Promise.all([
  readFile(enginePath, "utf8"),
  readFile(workerPath, "utf8"),
]);
const combined = `${engine}\n;\n${worker}\n`;
for (const forbidden of ["new Function(", "eval(", "importScripts("]) {
  if (combined.includes(forbidden)) {
    throw new Error(`Worker 含禁止的动态加载/执行路径：${forbidden}`);
  }
}
await mkdir("public/workers", { recursive: true });
await writeFile(outputPath, combined);
await rm("public/.worker-build", { recursive: true, force: true });
console.log(`Created ${outputPath} (${Buffer.byteLength(combined)} bytes)`);
