import { getErrorCode, Platform } from "./host";
import { ScannerClient } from "./workers/client";
import { createScanExports, exportName, type ExportFormat } from "./export";
import { validateImageInput } from "./image/input";
import { fullFrame, isConvex } from "./workers/geometry";
import type {
  BlurType,
  Corners,
  Point,
  RestoreDiagnostics,
  ScanMode,
  SpectralDiagnostics,
} from "./workers/protocol";
import "./style.css";

const appStarted = performance.now();

function element<Type extends HTMLElement>(id: string): Type {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少界面元素 #${id}`);
  return found as Type;
}

const platform = new Platform();
const retryButton = element<HTMLButtonElement>("retry-engine");
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
const moireToggle = element<HTMLInputElement>("moire");
const deblurToggle = element<HTMLInputElement>("deblur");
const blurTypeSelect = element<HTMLSelectElement>("blur-type");
const blurTypeField = element<HTMLLabelElement>("blur-type-field");
const rotateButton = element<HTMLButtonElement>("rotate");
const redetectButton = element<HTMLButtonElement>("redetect");
const resetCropButton = element<HTMLButtonElement>("reset-crop");
const cropStage = element<HTMLDivElement>("crop-stage");
const cropOutline = element<HTMLCanvasElement>("crop-outline");
const handles = Array.from(cropStage.querySelectorAll<HTMLButtonElement>(".corner"));
const workspace = element("workspace");
const outputPlaceholder = element("output-placeholder");
const outputSize = element("output-size");
const outputCanvas = element<HTMLCanvasElement>("output");

let client: ScannerClient | null = null;
let startingClient: ScannerClient | null = null;
let engineState: "loading" | "ready" | "failed" = "loading";
let disposed = false;
let selectedFile: File | null = null;
let exportBlob: Blob | null = null;
let exportGeneration = 0;
let busy = false;
let corners: Corners | undefined;
let turns = 0;
let previewReady = false;
let scanExports: ReturnType<typeof createScanExports> | null = null;
let moireEnabled = false;
let deblurEnabled = false;
let blurType: BlurType = "auto";
let engineSupportsDft = false;
let enhanceTimer: number | null = null;

function invalidateResult() {
  exportGeneration++;
  exportBlob = null;
  scanExports = null;
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
  context.strokeStyle = "#14614e";
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
  status.dataset.error = "false";
  status.textContent = "裁切已调整。点击「更新扫描件」应用。";
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

function logSpectral(diagnostics: SpectralDiagnostics) {
  if (diagnostics.applied) {
    log(`计时 C04 频域分析：${diagnostics.ms.toFixed(1)}ms`);
    const sigma = diagnostics.sigmaPx ? `，陷波 σ=${diagnostics.sigmaPx}px` : "";
    log(`C04 峰值 ${diagnostics.peakPairs} 对，置信度 ${diagnostics.confidence.toFixed(2)}，模式 ${diagnostics.mode}${sigma}`);
    if (diagnostics.detail) log(`C04 诊断：${diagnostics.detail}`);
    return;
  }
  const reasons: Record<string, string> = {
    "no-peaks": "未检测到可信周期峰",
    "too-many-peaks": "疑似纹理误判，候选峰过多",
    guard: "处理后文字边缘损失过多，已回退",
    memory: "内存不足",
    error: "当前引擎不支持频域增强",
  };
  const detail = diagnostics.detail ? `（${diagnostics.detail}）` : "";
  log(`频域增强跳过：${reasons[diagnostics.reason ?? ""] ?? "未检测到可信周期峰"}${detail}`);
}

function logRestore(diagnostics: RestoreDiagnostics) {
  if (diagnostics.applied) {
    const method = { "full-wiener": "全图 Wiener", "ola-wiener": "分块 Wiener", fir: "FIR 近似" }[diagnostics.method ?? "fir"];
    log(`计时 C05 模糊复原：${diagnostics.ms.toFixed(1)}ms（${method}，${diagnostics.psfType}）`);
    const psf = diagnostics.psf;
    const detail = psf?.lengthPx !== undefined
      ? `运动长度 ${psf.lengthPx.toFixed(1)}px，角度 ${(psf.angleDeg ?? 0).toFixed(0)}°`
      : `离焦半径 ${(psf?.radiusPx ?? 0).toFixed(1)}px`;
    log(`C05 ${detail}，置信度 ${diagnostics.confidence.toFixed(2)}`);
    return;
  }
  const reasons: Record<string, string> = {
    "psf-low-confidence": "未能可靠估计 PSF",
    "out-of-range": "模糊超出支持范围（运动 3–31px，失焦 1.5–12px）",
    "low-detail": "图像细节不足，无法估计模糊",
    memory: "内存不足",
    error: "当前引擎不支持频域增强",
  };
  const detail = diagnostics.detail ? `（${diagnostics.detail}）` : "";
  log(`模糊复原跳过：${reasons[diagnostics.reason ?? ""] ?? "未能可靠估计 PSF"}${detail}`);
}

function updateButtons() {
  retryButton.hidden = engineState !== "failed";
  workspace.hidden = !previewReady;
  outputCanvas.hidden = !scanExports;
  outputPlaceholder.hidden = !!scanExports;
  outputSize.textContent = scanExports ? `${outputCanvas.width} × ${outputCanvas.height}` : "";
  shareButton.hidden = !platform.canShare;
  processButton.textContent = busy ? "正在处理…" : previewReady ? "更新扫描件" : "生成扫描件";
  fileInput.disabled = busy;
  formatSelect.disabled = busy;
  modeSelect.disabled = busy;
  const enhanceDisabled = busy || !client || !engineSupportsDft;
  moireToggle.disabled = enhanceDisabled;
  deblurToggle.disabled = enhanceDisabled;
  blurTypeField.hidden = !deblurEnabled;
  blurTypeSelect.disabled = busy || !deblurEnabled || !engineSupportsDft;
  rotateButton.disabled = redetectButton.disabled = resetCropButton.disabled = busy || !previewReady;
  handles.forEach((handle) => { handle.disabled = busy; });
  processButton.disabled = busy || !client || !selectedFile;
  saveButton.disabled = busy || !exportBlob;
  shareButton.disabled = busy || !exportBlob || !platform.canShare;
}

async function updateExport() {
  const generation = ++exportGeneration;
  exportBlob = null;
  updateButtons();
  if (!scanExports) return;
  const format = formatSelect.value as ExportFormat;
  try {
    const started = performance.now();
    const { file, reused } = scanExports(format);
    const { blob, pdf } = await file;
    if (generation !== exportGeneration) return;
    exportBlob = blob;
    log(reused
      ? `${format.toUpperCase()} 复用导出文件：${blob.size} bytes`
      : `${format.toUpperCase()} 准备完成：${blob.size} bytes，${(performance.now() - started).toFixed(1)}ms`);
    if (pdf) {
      log(`PDF 页面：${pdf.pageCount} 页，${pdf.width.toFixed(3)} × ${pdf.height.toFixed(3)} pt，宽高比 ${(pdf.width / pdf.height).toFixed(6)}`);
    }
  } catch (error) {
    if (generation !== exportGeneration) return;
    setStatus(`导出准备失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    updateButtons();
  }
}

async function loadEngine() {
  engineState = "loading";
  setStatus("正在准备扫描功能…");
  updateButtons();
  try {
    const wasm = await platform.readWasm();
    if (disposed) return;
    const candidate = await ScannerClient.create(() => platform.createWorker());
    if (disposed) {
      candidate.terminate();
      return;
    }
    startingClient = candidate;
    const initialized = await candidate.initialize(wasm);
    if (disposed) return;
    client = candidate;
    engineState = "ready";
    engineSupportsDft = initialized.dft;
    log(`计时 引擎就绪：${(performance.now() - appStarted).toFixed(1)}ms`);
    log(`OpenCV 初始化完成：${initialized.initMs.toFixed(1)}ms`);
    log(initialized.buildInformation.slice(0, 5000));
    if (!engineSupportsDft) {
      moireToggle.checked = deblurToggle.checked = false;
      moireEnabled = deblurEnabled = false;
      log("当前引擎不支持 dft，频域增强开关已禁用");
    }
    setStatus(selectedFile ? "点击「生成扫描件」开始处理。" : "");
  } catch (error) {
    startingClient?.terminate();
    if (disposed) return;
    engineState = "failed";
    engineSupportsDft = false;
    log(`引擎加载失败：${error instanceof Error ? error.message : String(error)}`);
    setStatus("扫描功能加载失败，请重试。", true);
  } finally {
    startingClient = null;
    if (!disposed) updateButtons();
  }
}

retryButton.addEventListener("click", () => void loadEngine());

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
    : "JPEG、PNG 或 WebP";
  if (engineState === "ready") setStatus(selectedFile ? "点击「生成扫描件」开始处理。" : "");
  updateButtons();
});

async function scan() {
  if (!client || !selectedFile || busy) return;
  const scanStarted = performance.now();
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
    updateButtons();
    log(`计时 原图预览：${(performance.now() - scanStarted).toFixed(1)}ms`);
    const original = document.createElement("canvas");
    original.width = width;
    original.height = height;
    const context = original.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;
    const image = context.getImageData(0, 0, width, height);
    original.width = original.height = 1;
    log(`Worker 正在处理 ${width}×${height}`);
    setStatus("正在生成扫描件…");
    const automatic = !corners;
    const result = await client.process({
      width,
      height,
      rgba: image.data.buffer,
      corners,
      turns,
      mode: modeSelect.value as ScanMode,
      moire: moireEnabled,
      deblur: deblurEnabled,
      blurType: deblurEnabled ? blurType : undefined,
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
    if (result.detectMs !== undefined) log(`计时 自动找边：${result.detectMs.toFixed(1)}ms`);
    if (result.spectral) logSpectral(result.spectral);
    if (result.restore) logRestore(result.restore);
    log(`处理完成：${result.processMs.toFixed(1)}ms`);
    setStatus("正在准备导出文件…");
    scanExports = createScanExports(outputCanvas);
    await updateExport();
    if (exportBlob) {
      log(`计时 完整扫描：${(performance.now() - scanStarted).toFixed(1)}ms`);
      const boundary = automatic && !result.corners
        ? "；未找到完整纸边，已保留整张照片，可手动调整四角"
        : "；请核对裁切范围";
      setStatus(`文件已准备${boundary}`);
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

function scheduleEnhancementScan() {
  invalidateResult();
  updateButtons();
  if (enhanceTimer !== null) clearTimeout(enhanceTimer);
  enhanceTimer = window.setTimeout(() => {
    enhanceTimer = null;
    if (previewReady && !busy) void scan();
  }, 250);
}

for (const toggle of [moireToggle, deblurToggle]) {
  toggle.addEventListener("change", () => {
    moireEnabled = moireToggle.checked;
    deblurEnabled = deblurToggle.checked;
    if (previewReady) scheduleEnhancementScan();
    else updateButtons();
  });
}
blurTypeSelect.addEventListener("change", () => {
  blurType = blurTypeSelect.value as BlurType;
  if (previewReady && deblurEnabled) scheduleEnhancementScan();
});

formatSelect.addEventListener("change", () => void updateExport());

saveButton.addEventListener("click", () => {
  if (!exportBlob) return;
  const name = exportName(formatSelect.value as ExportFormat);
  const saveStarted = performance.now();
  // 不在此处理器中先 await：MApp 需要可信用户动作。
  platform.save(name, exportBlob)
    .then(() => {
      log(`计时 系统保存：${(performance.now() - saveStarted).toFixed(1)}ms`);
      setStatus(`已请求保存 ${name}`);
    })
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

async function start() {
  moireEnabled = moireToggle.checked;
  deblurEnabled = deblurToggle.checked;
  blurType = blurTypeSelect.value as BlurType;
  updateButtons();
  log(`计时 首屏可选图：${(performance.now() - appStarted).toFixed(1)}ms`);
  try {
    await platform.connect((theme) => {
      document.documentElement.dataset.mode = theme.mode;
      document.documentElement.dataset.motion = theme.reducedMotion ? "reduced" : "full";
    });
  } catch (error) {
    log(`平台连接失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (disposed) {
    platform.dispose();
    return;
  }
  try {
    await platform.ready();
  } catch (error) {
    log(`平台就绪通知失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!disposed) await loadEngine();
}
void start();

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  disposed = true;
  startingClient?.terminate();
  client?.terminate();
  platform.dispose();
});
