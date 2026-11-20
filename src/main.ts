import { Platform } from "./host";
import { ScannerClient } from "./workers/client";
import { exportName, prepareExport, type ExportFormat } from "./export";
import { validateImageInput } from "./image/input";
import "./style.css";

function element<Type extends HTMLElement>(id: string): Type {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少界面元素 #${id}`);
  return found as Type;
}

const platform = new Platform();
const initializeButton = element<HTMLButtonElement>("initialize");
const processButton = element<HTMLButtonElement>("process");
const saveButton = element<HTMLButtonElement>("save");
const shareButton = element<HTMLButtonElement>("share");
const fileInput = element<HTMLInputElement>("file");
const fileInfo = element<HTMLParagraphElement>("file-info");
const formatSelect = element<HTMLSelectElement>("format");
const status = element<HTMLParagraphElement>("status");
const logView = element<HTMLPreElement>("log");
const inputCanvas = element<HTMLCanvasElement>("input");
const outputCanvas = element<HTMLCanvasElement>("output");

let client: ScannerClient | null = null;
let selectedFile: File | null = null;
let exportBlob: Blob | null = null;
let exportGeneration = 0;
let busy = false;

function log(message: string) {
  const time = new Date().toLocaleTimeString();
  logView.textContent += `[${time}] ${message}\n`;
  logView.scrollTop = logView.scrollHeight;
}

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.dataset.error = error ? "true" : "false";
  log(message);
}

function updateButtons() {
  const format = formatSelect.value as ExportFormat;
  initializeButton.disabled = busy || !!client;
  fileInput.disabled = busy;
  formatSelect.disabled = busy;
  processButton.disabled = busy || !client || !selectedFile;
  saveButton.disabled = busy || !exportBlob;
  shareButton.disabled = busy || !exportBlob || !platform.canShare;
  saveButton.textContent = exportBlob
    ? `保存 ${exportName(format)}（${(exportBlob.size / 1024).toFixed(0)} KiB）`
    : "保存已准备文件";
}

async function updateExport() {
  const generation = ++exportGeneration;
  exportBlob = null;
  updateButtons();
  if (outputCanvas.width <= 1 || outputCanvas.height <= 1) return;
  const format = formatSelect.value as ExportFormat;
  try {
    const started = performance.now();
    const blob = await prepareExport(outputCanvas, format);
    if (generation !== exportGeneration) return;
    exportBlob = blob;
    log(`${format.toUpperCase()} 准备完成：${blob.size} bytes，${(performance.now() - started).toFixed(1)}ms`);
  } catch (error) {
    setStatus(`导出准备失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    updateButtons();
  }
}

initializeButton.addEventListener("click", async () => {
  if (client || busy) return;
  busy = true;
  updateButtons();
  setStatus(platform.sdk ? "正在创建 SDK Worker 并读取包内 WASM…" : "正在创建本地 Worker 并读取 WASM…");
  let worker: Worker | null = null;
  try {
    [worker] = await Promise.all([platform.createWorker()]);
    const wasm = await platform.readWasm();
    client = await ScannerClient.create(() => Promise.resolve(worker!));
    const initialized = await client.initialize(wasm);
    setStatus(`OpenCV 初始化完成：${initialized.initMs.toFixed(1)}ms`);
    log(initialized.buildInformation.slice(0, 5000));
  } catch (error) {
    worker?.terminate();
    client?.terminate();
    client = null;
    setStatus(`初始化失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    busy = false;
    updateButtons();
  }
});

fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files?.[0] ?? null;
  exportGeneration++;
  exportBlob = null;
  fileInfo.textContent = selectedFile
    ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(2)} MiB`
    : "尚未选择图片";
  updateButtons();
});

processButton.addEventListener("click", async () => {
  if (!client || !selectedFile || busy) return;
  busy = true;
  exportGeneration++;
  exportBlob = null;
  updateButtons();
  let bitmap: ImageBitmap | null = null;
  try {
    setStatus("正在解码原图…");
    bitmap = await createImageBitmap(selectedFile, { imageOrientation: "from-image" });
    const warnings = validateImageInput({
      width: bitmap.width,
      height: bitmap.height,
      sizeBytes: selectedFile.size,
    });
    for (const warning of warnings) log(`警告：${warning}`);
    inputCanvas.width = outputCanvas.width = bitmap.width;
    inputCanvas.height = outputCanvas.height = bitmap.height;
    const context = inputCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建 Canvas 2D 上下文");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;
    const image = context.getImageData(0, 0, inputCanvas.width, inputCanvas.height);
    setStatus(`Worker 正在处理 ${inputCanvas.width}×${inputCanvas.height}…`);
    const result = await client.process(inputCanvas.width, inputCanvas.height, image.data.buffer);
    const output = outputCanvas.getContext("2d");
    if (!output) throw new Error("无法创建输出 Canvas 上下文");
    output.putImageData(
      new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height),
      0,
      0,
    );
    setStatus(`处理完成：${result.processMs.toFixed(1)}ms；正在准备导出文件…`);
    await updateExport();
    if (exportBlob) setStatus("文件已准备，可点击保存");
  } catch (error) {
    setStatus(`处理失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    bitmap?.close();
    busy = false;
    updateButtons();
  }
});

formatSelect.addEventListener("change", () => void updateExport());

saveButton.addEventListener("click", () => {
  if (!exportBlob) return;
  const name = exportName(formatSelect.value as ExportFormat);
  // 不在此处理器中先 await：MApp 需要可信用户动作。
  platform.save(name, exportBlob)
    .then(() => setStatus(`已请求保存 ${name}`))
    .catch((error) => setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, true));
});

shareButton.addEventListener("click", () => {
  if (!exportBlob) return;
  const name = exportName(formatSelect.value as ExportFormat);
  platform.share(name, exportBlob)
    .then(() => setStatus(`已请求分享 ${name}`))
    .catch((error) => setStatus(`分享失败：${error instanceof Error ? error.message : String(error)}`, true));
});

shareButton.hidden = !platform.canShare;
updateButtons();
platform.connect((theme) => {
  document.documentElement.dataset.mode = theme.mode;
  document.documentElement.dataset.motion = theme.reducedMotion ? "reduced" : "full";
}).then(async () => {
  setStatus(platform.sdk ? "MApp 已连接；请初始化引擎" : "本地预览；保存使用浏览器下载");
  await platform.ready();
}).catch(async (error) => {
  setStatus(`平台连接失败：${error instanceof Error ? error.message : String(error)}`, true);
  await platform.ready();
});

window.addEventListener("pagehide", () => {
  client?.terminate();
  platform.dispose();
});
