import type {
  Corners,
  Point,
  ProcessRequest,
  ScannerRequest,
  ScannerResponse,
} from "./protocol";

import { recoverOccluded } from "./occlusion";
import { fullFrame, isConvex, orderCorners } from "./geometry";

interface CvMat {
  data: Uint8Array;
  data32S: Int32Array;
  rows: number;
  cols: number;
  delete(): void;
}

interface CvSize { width: number; height: number }

interface CvModule {
  Mat: new () => CvMat;
  MatVector: new () => { size(): number; get(index: number): CvMat; delete(): void };
  Size: new (width: number, height: number) => CvSize;
  COLOR_RGBA2GRAY: number;
  COLOR_GRAY2RGBA: number;
  CV_32FC2: number;
  MORPH_RECT: number;
  MORPH_CLOSE: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  INTER_AREA: number;
  INTER_LINEAR: number;
  BORDER_DEFAULT: number;
  ADAPTIVE_THRESH_GAUSSIAN_C: number;
  THRESH_BINARY: number;
  matFromImageData(image: { data: Uint8ClampedArray; width: number; height: number }): CvMat;
  matFromArray(rows: number, cols: number, type: number, data: number[]): CvMat;
  cvtColor(source: CvMat, target: CvMat, code: number): void;
  resize(source: CvMat, target: CvMat, size: CvSize, fx: number, fy: number, interpolation: number): void;
  GaussianBlur(source: CvMat, target: CvMat, size: CvSize, sigmaX: number, sigmaY: number, border: number): void;
  Canny(source: CvMat, target: CvMat, low: number, high: number, aperture: number, l2: boolean): void;
  getStructuringElement(shape: number, size: CvSize): CvMat;
  morphologyEx(source: CvMat, target: CvMat, operation: number, kernel: CvMat): void;
  findContours(source: CvMat, contours: InstanceType<CvModule["MatVector"]>, hierarchy: CvMat, mode: number, method: number): void;
  contourArea(contour: CvMat): number;
  arcLength(contour: CvMat, closed: boolean): number;
  approxPolyDP(contour: CvMat, approximation: CvMat, epsilon: number, closed: boolean): void;
  getPerspectiveTransform(source: CvMat, target: CvMat): CvMat;
  warpPerspective(source: CvMat, target: CvMat, matrix: CvMat, size: CvSize): void;
  adaptiveThreshold(source: CvMat, target: CvMat, max: number, method: number, type: number, block: number, c: number): void;
  getBuildInformation?: () => string;
}

declare const cv: (options: { wasmBinary: ArrayBuffer }) => CvModule | Promise<CvModule>;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: Promise<CvModule> | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: ScannerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

async function initialize(id: number, wasm: ArrayBuffer) {
  if (engine) throw new Error("OpenCV 已初始化，请更换文档时重建 Worker");
  const started = performance.now();
  engine = Promise.resolve(cv({ wasmBinary: wasm }));
  try {
    const module = await engine;
    post({
      id,
      type: "initialized",
      initMs: performance.now() - started,
      buildInformation: module.getBuildInformation?.() ?? "OpenCV ready",
    });
  } catch (error) {
    engine = null;
    throw error;
  }
}

function previewSize(module: CvModule, source: CvMat, limit: number) {
  const scale = Math.min(1, limit / Math.max(source.cols, source.rows));
  return new module.Size(
    Math.max(1, Math.round(source.cols * scale)),
    Math.max(1, Math.round(source.rows * scale)),
  );
}

interface DetectionDiagnostics {
  largeContours: number;
  quadrilaterals: number;
  weakEdge: number;
  weakContrast: number;
}

interface ColorImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

function borderScore(points: Corners, gray: CvMat, edge: CvMat, diagnostics?: DetectionDiagnostics, color?: ColorImage) {
  const { cols, rows, data } = gray;
  const edgeData = edge.data;
  const scores = points.map((a, i) => {
    const b = points[(i + 1) % 4];
    const dx = (b.x - a.x) * (cols - 1);
    const dy = (b.y - a.y) * (rows - 1);
    const length = Math.hypot(dx, dy);
    const nx = -dy / length;
    const ny = dx / length;
    const sample = (x: number, y: number) => Math.round(y) * cols + Math.round(x);
    let contrast = 0;
    let supported = 0;
    let colorSupport = 0;
    for (let k = 1; k <= 12; k++) {
      const x = a.x * (cols - 1) + dx * k / 13;
      const y = a.y * (rows - 1) + dy * k / 13;
      if (x < 8 || y < 8 || x >= cols - 8 || y >= rows - 8) continue;
      contrast += data[sample(x + 7 * nx, y + 7 * ny)] - data[sample(x - 7 * nx, y - 7 * ny)];
      if (color) {
        const offset = (px: number, py: number) => 4 * (
          Math.round(py * (color.height - 1) / (rows - 1)) * color.width
          + Math.round(px * (color.width - 1) / (cols - 1)));
        const inside = offset(x + 7 * nx, y + 7 * ny);
        const outside = offset(x - 7 * nx, y - 7 * ny);
        const delta = (channel: number) => color.rgba[inside + channel] - color.rgba[outside + channel];
        if (Math.max(delta(0), delta(1), delta(2)) - Math.min(delta(0), delta(1), delta(2)) >= 24) colorSupport++;
      }
      for (let offset = -4; offset <= 4; offset++) {
        if (edgeData[sample(x + offset * nx, y + offset * ny)]) {
          supported++;
          break;
        }
      }
    }
    return {
      support: supported, colorSupport,
      contrast: contrast / 12,
    };
  });
  // 纸边需要四侧都有边缘证据，且纸面与背景的明暗方向基本一致。
  if (scores.some(({ support }) => support < 7)) {
    if (diagnostics) diagnostics.weakEdge++;
    return 0;
  }
  const light = scores.filter(({ contrast }) => contrast >= 8).length;
  const dark = scores.filter(({ contrast }) => contrast <= -8).length;
  if (Math.max(light, dark) < 3 && !scores.every(side => side.colorSupport >= 8)) {
    if (diagnostics) diagnostics.weakContrast++;
    return 0;
  }
  return scores.reduce((sum, { support, contrast }) => sum + support / 12 + Math.min(60, Math.abs(contrast)) / 60, 0);
}

function detectCorners(cv: CvModule, source: CvMat, rgba: ArrayBuffer): Corners | undefined {
  // A smaller preview suppresses fine print and closes short gaps along faint borders.
  for (const [limit, low] of [[1000, 35], [600, 12], [360, 8]]) {
    const result = detectAtScale(cv, source, limit, low);
    if (result === null) return; // Competing crops require manual review.
    if (result) return result;
  }
  const color = { rgba: new Uint8ClampedArray(rgba), width: source.cols, height: source.rows };
  const result = detectAtScale(cv, source, 600, 12, color);
  if (result !== undefined) return result ?? undefined;

  // Red-blue chroma can retain a closed boundary when foreground and background
  // have similar luminance. A constant offset maps signed differences to bytes.
  const chroma = new cv.Mat();
  try {
    cv.resize(source, chroma, previewSize(cv, source, 600), 0, 0, cv.INTER_AREA);
    const { cols, rows, data } = chroma;
    for (let y = 0; y < rows; y++) {
      const sy = Math.floor((y + 0.5) * source.rows / rows);
      for (let x = 0; x < cols; x++) {
        const sx = Math.floor((x + 0.5) * source.cols / cols);
        const i = 4 * (sy * source.cols + sx);
        data[y * cols + x] = Math.max(0, Math.min(255, 128 + color.rgba[i] - color.rgba[i + 2]));
      }
    }
    const colorResult = detectAtScale(cv, chroma, 600, 12, color);
    if (colorResult !== undefined) return colorResult ?? undefined;
    // A printed box inside a page can also be a strong small rectangle.
    // Consider small or faint candidates only after all full-size passes fail.
    for (const [limit, low] of [[600, 10], [360, 5]]) {
      const small = detectAtScale(cv, source, limit, low, color, 0.05);
      if (small !== undefined) return small ?? undefined;
    }
    const preview = new cv.Mat();
    const luminance = new cv.Mat();
    try {
      cv.resize(chroma, preview, previewSize(cv, chroma, 320), 0, 0, cv.INTER_AREA);
      cv.GaussianBlur(preview, preview, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      cv.resize(source, luminance, new cv.Size(preview.cols, preview.rows), 0, 0, cv.INTER_AREA);
      return recoverOccluded(preview.data, luminance.data, preview.cols, preview.rows);
    } finally {
      preview.delete();
      luminance.delete();
    }
  } finally {
    chroma.delete();
  }
}

function detectAtScale(cv: CvModule, source: CvMat, limit: number, low: number, color?: ColorImage, minimumArea = 0.08): Corners | null | undefined {
  const gray = new cv.Mat();
  const edge = new cv.Mat();
  const closed = new cv.Mat();
  const hierarchy = new cv.Mat();
  const contourList = new cv.MatVector();
  const polygon = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  try {
    const diagnostics = (scope as typeof scope & { debugDetection?: boolean }).debugDetection
      ? { largeContours: 0, quadrilaterals: 0, weakEdge: 0, weakContrast: 0 }
      : undefined;
    cv.resize(source, gray, previewSize(cv, source, limit), 0, 0, cv.INTER_AREA);
    const { cols, rows } = gray;
    if (Math.min(cols, rows) < 32) return;
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(gray, edge, low, 3 * low, 3, false);
    cv.morphologyEx(edge, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contourList, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const candidates: { corners: Corners; score: number }[] = [];
    for (let i = 0; i < contourList.size(); i++) {
      const contour = contourList.get(i);
      try {
        const area = cv.contourArea(contour) / (cols * rows);
        if (area < minimumArea) continue;
        if (diagnostics) diagnostics.largeContours++;
        cv.approxPolyDP(contour, polygon, 0.02 * cv.arcLength(contour, true), true);
        if (polygon.rows !== 4) continue;
        const coordinates = polygon.data32S;
        const corners = orderCorners([0, 2, 4, 6].map((index) => ({
          x: coordinates[index] / (cols - 1),
          y: coordinates[index + 1] / (rows - 1),
        })) as Corners);
        if (!isConvex(corners)) continue;
        if (diagnostics) diagnostics.quadrilaterals++;
        const score = borderScore(corners, gray, edge, diagnostics, color) * area;
        if (score > 0) candidates.push({ corners, score });
      } finally {
        contour.delete();
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // 忽略同一纸边的内外两条轮廓，分数接近的不同裁切范围交给用户。
    const ambiguous = !!best && candidates.slice(1).some(({ corners, score }) =>
      score >= best.score * 0.9 && corners.some((point, i) =>
        Math.hypot(point.x - best.corners[i].x, point.y - best.corners[i].y) > 0.04));
    if (diagnostics) console.debug("detect-pass", JSON.stringify({ limit, ...diagnostics, candidates: candidates.length, ambiguous }));
    return ambiguous ? null : best?.corners;
  } finally {
    for (const mat of [gray, edge, closed, hierarchy, contourList, polygon, kernel]) mat.delete();
  }
}

function rectify(cv: CvModule, source: CvMat, target: CvMat, corners: Corners, turns: number) {
  const points = corners.map(({ x, y }) => ({ x: x * (source.cols - 1), y: y * (source.rows - 1) }));
  const offset = (4 - turns) % 4;
  const [a, b, c, d] = [...points.slice(offset), ...points.slice(0, offset)];
  const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const w = Math.max(distance(a, b), distance(d, c));
  const h = Math.max(distance(a, d), distance(b, c));
  const scale = Math.min(1, Math.sqrt(source.cols * source.rows / ((w + 1) * (h + 1))));
  const width = Math.max(2, Math.round((w + 1) * scale));
  const height = Math.max(2, Math.round((h + 1) * scale));
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [a, b, c, d].flatMap(({ x, y }) => [x, y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  const matrix = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(source, target, matrix, new cv.Size(width, height));
  } finally {
    for (const mat of [from, to, matrix]) mat.delete();
  }
}

function normalizeLighting(cv: CvModule, gray: CvMat) {
  const background = new cv.Mat();
  const size = previewSize(cv, gray, 240);
  const radius = Math.max(3, Math.round(Math.min(size.width, size.height) * 0.09) | 1);
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(radius, radius));
  try {
    // 用低分辨率闭运算压掉细字，再平滑估计纸底亮度。
    cv.resize(gray, background, size, 0, 0, cv.INTER_AREA);
    cv.morphologyEx(background, background, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(background, background, new cv.Size(radius, radius), 0, 0, cv.BORDER_DEFAULT);
    cv.resize(background, background, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
    const data = gray.data;
    const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    const paper = background.data;
    const gains = Float32Array.from({ length: 256 }, (_, value) =>
      0.2 + 0.8 * 245 / Math.max(value, 70));
    for (let i = 0; i < pixels.length; i++) pixels[i] *= gains[paper[i]];
  } finally {
    background.delete();
    kernel.delete();
  }
}

async function process(request: ProcessRequest) {
  if (!engine) throw new Error("请先初始化 OpenCV");
  const cv = await engine;
  const started = performance.now();
  const gray = new cv.Mat();
  const warped = new cv.Mat();
  const result = new cv.Mat();
  try {
    const source = cv.matFromImageData({
      data: new Uint8ClampedArray(request.rgba),
      width: request.width,
      height: request.height,
    });
    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    } finally {
      source.delete();
    }
    const detectStarted = performance.now();
    const corners = request.corners ?? detectCorners(cv, gray, request.rgba);
    const detectMs = request.corners ? undefined : performance.now() - detectStarted;
    const transform = request.turns ||
      (corners && corners.some(({ x, y }, i) => x !== fullFrame[i].x || y !== fullFrame[i].y));
    if (transform && Math.min(gray.cols, gray.rows) >= 2) {
      rectify(cv, gray, warped, corners ?? fullFrame, request.turns);
    }
    const scan = warped.rows ? warped : gray;
    if (request.mode !== "gray") normalizeLighting(cv, scan);
    if (request.mode === "binary") {
      const block = Math.max(3, Math.round(Math.min(scan.cols, scan.rows) / 35) | 1);
      cv.adaptiveThreshold(scan, scan, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 12);
    }
    cv.cvtColor(scan, result, cv.COLOR_GRAY2RGBA);
    const rgba = new Uint8Array(result.data);
    post({
      id: request.id,
      type: "processed",
      width: result.cols,
      height: result.rows,
      corners,
      rgba: rgba.buffer,
      processMs: performance.now() - started,
      detectMs,
    }, [rgba.buffer]);
  } finally {
    for (const mat of [gray, warped, result]) mat.delete();
  }
}

async function handle(request: ScannerRequest) {
  try {
    if (request.type === "init") await initialize(request.id, request.wasm);
    else await process(request);
  } catch (error) {
    post({
      id: request.id,
      type: "error",
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

scope.onmessage = (event: MessageEvent<ScannerRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request));
};
