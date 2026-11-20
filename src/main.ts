import { getErrorCode, Platform } from "./host";
import { ScannerClient } from "./workers/client";
import { exportName, prepareExport, type ExportFormat } from "./export";
import { validateImageInput } from "./image/input";
import { fullFrame, isConvex } from "./workers/geometry";
import type { Corners, Point, ScanMode } from "./workers/protocol";
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
const modeSelect = element<HTMLSelectElement>("mode");
const rotateButton = element<HTMLButtonElement>("rotate");
const redetectButton = element<HTMLButtonElement>("redetect");
const resetCropButton = element<HTMLButtonElement>("reset-crop");
const cropStage = element<HTMLDivElement>("crop-stage");
const cropOutline = element<HTMLCanvasElement>("crop-outline");
const handles = Array.from(cropStage.querySelectorAll<HTMLButtonElement>(".corner"));
const outputCanvas = element<HTMLCanvasElement>("output");

let client: ScannerClient | null = null;
let selectedFile: File | null = null;
let exportBlob: Blob | null = null;
let exportGeneration = 0;
let busy = false;
let corners: Corners | undefined;
let turns = 0;
let previewReady = false;
let resultReady = false;

function invalidateResult() {
  exportGeneration++;
  exportBlob = null;
  resultReady = false;
}

function drawCrop() {
  const context = cropOutline.getContext("2d")!;
  const { width, height } = cropOutline;
  context.clearRect(0, 0, width, height);
  handles.forEach((handle) => { handle.hidden = !previewReady; });
  if (!previewReady) return;
  context.beginPath();
  (corners ?? fullFrame).forEach(({ x, y }, i) => {
    handles[i].style.left = `${x * 100}%`;
    handles[i].style.top = `${y * 100}%`;
    if (i === 0) context.moveTo(x * width, y * height);
    else context.lineTo(x * width, y * height);
  });
  context.closePath();
  context.strokeStyle = "#1769d2";
  context.lineWidth = 3;
  context.stroke();
}

function moveCorner(index: number, point: Point) {
  const next = [...(corners ?? fullFrame)] as Corners;
  next[index] = {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
  };
  if (!isConvex(next)) return;
  corners = next;
  invalidateResult();
  drawCrop();
  updateButtons();
  status.textContent = "裁切已调整，点击生成扫描件应用";
}

handles.forEach((handle, index) => {
  handle.addEventListener("pointerdown", (event) => {
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!handle.hasPointerCapture(event.pointerId) || busy) return;
    const rect = cropStage.getBoundingClientRect();
    moveCorner(index, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  });
  handle.addEventListener("keydown", (event) => {
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!offset) return;
    event.preventDefault();
    const point = (corners ?? fullFrame)[index];
    const step = event.shiftKey ? 0.025 : 0.005;
    moveCorner(index, { x: point.x + offset[0] * step, y: point.y + offset[1] * step });
  });
});

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
  modeSelect.disabled = busy;
  rotateButton.disabled = redetectButton.disabled = resetCropButton.disabled = busy || !previewReady;
  handles.forEach((handle) => { handle.disabled = busy; });
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
  if (!resultReady || !outputCanvas.width || !outputCanvas.height) return;
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
  invalidateResult();
  corners = undefined;
  turns = 0;
  previewReady = false;
  inputCanvas.width = inputCanvas.height = outputCanvas.width = outputCanvas.height = 1;
  drawCrop();
  fileInfo.textContent = selectedFile
    ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(2)} MiB`
    : "尚未选择图片";
  updateButtons();
});

async function scan() {
  if (!client || !selectedFile || busy) return;
  busy = true;
  invalidateResult();
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
    const { width, height } = bitmap;
    const scale = Math.min(1, 520 / Math.max(width, height));
    inputCanvas.width = cropOutline.width = Math.max(1, Math.round(width * scale));
    inputCanvas.height = cropOutline.height = Math.max(1, Math.round(height * scale));
    cropStage.style.maxWidth = `${inputCanvas.width}px`;
    inputCanvas.getContext("2d")!.drawImage(bitmap, 0, 0, inputCanvas.width, inputCanvas.height);
    previewReady = true;
    drawCrop();
    const original = document.createElement("canvas");
    original.width = width;
    original.height = height;
    const context = original.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;
    const image = context.getImageData(0, 0, width, height);
    original.width = original.height = 1;
    setStatus(`Worker 正在处理 ${width}×${height}…`);
    const automatic = !corners;
    const result = await client.process({
      width, height, rgba: image.data.buffer, corners, turns, mode: modeSelect.value as ScanMode,
    });
    corners = result.corners ?? fullFrame;
    drawCrop();
    outputCanvas.width = result.width;
    outputCanvas.height = result.height;
    const output = outputCanvas.getContext("2d");
    if (!output) throw new Error("无法创建输出 Canvas 上下文");
    output.putImageData(
      new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height),
      0,
      0,
    );
    setStatus(`处理完成：${result.processMs.toFixed(1)}ms；正在准备导出文件…`);
    resultReady = true;
    await updateExport();
    if (exportBlob) {
      const boundary = automatic && !result.corners
        ? "；未找到完整纸边，已保留整张照片，可手动调整四角"
        : "；请核对裁切范围";
      setStatus(`文件已准备 · ${result.width}×${result.height}${boundary}`);
    }
  } catch (error) {
    setStatus(`处理失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    bitmap?.close();
    busy = false;
    updateButtons();
  }
}
processButton.addEventListener("click", () => void scan());
rotateButton.addEventListener("click", () => {
  turns = (turns + 1) % 4;
  void scan();
});
redetectButton.addEventListener("click", () => {
  corners = undefined;
  void scan();
});
resetCropButton.addEventListener("click", () => {
  corners = fullFrame;
  void scan();
});
modeSelect.addEventListener("change", () => {
  if (previewReady) void scan();
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
    .catch((error) => {
      if (getErrorCode(error) === "APP_UNLOADED") {
        setStatus("系统分享已触发，应用随后卸载；请在目标应用确认送达");
      } else {
        setStatus(`分享失败：${error instanceof Error ? error.message : String(error)}`, true);
      }
    });
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
