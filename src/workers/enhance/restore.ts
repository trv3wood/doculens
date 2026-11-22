import type { CvMat, CvModule } from "../cv";
import type { BlurType, RestoreDiagnostics } from "../protocol";
import {
  applyWiener,
  buildWienerH,
  createComplex,
  fillComplexFromGray,
  firFromH,
  forward,
  hasDft,
  inverse,
  optimalSize,
  writeGrayFromComplex,
} from "./frequency";
import { defocusPsf, estimateComplexBytes, motionPsf } from "./math";
import { estimatePsfCandidates, type PsfEstimate } from "./psf";

const FULL_WIENER_LIMIT = 12_000_000;
const FIR_SUPPORT = 15;
const PSF_SUPPORT = 65;
const BALANCE = 0.02;
const GAIN_CAP = 6;
const STRENGTH = 0.75;
const MIN_CONFIDENCE = 0.55;

function inRange(estimate: PsfEstimate): boolean {
  if (estimate.kind === "motion") {
    const length = estimate.length ?? 0;
    return length >= 3 && length <= 31;
  }
  const radius = estimate.radius ?? 0;
  return radius >= 1.5 && radius <= 12;
}

function buildPsf(estimate: PsfEstimate): Float32Array {
  if (estimate.kind === "motion") {
    return motionPsf(estimate.length ?? 9, estimate.angleDeg ?? 0, PSF_SUPPORT);
  }
  return defocusPsf(estimate.radius ?? 4, PSF_SUPPORT);
}

function formatEstimate(estimate: PsfEstimate | null): string {
  if (!estimate) return "无";
  const value = estimate.kind === "motion"
    ? `运动 ${(estimate.length ?? 0).toFixed(1)}px @ ${(estimate.angleDeg ?? 0).toFixed(0)}°`
    : `离焦 ${(estimate.radius ?? 0).toFixed(1)}px`;
  return `${value} 置信度 ${estimate.confidence.toFixed(2)}`;
}

function diagnosticsFor(
  requested: BlurType,
  estimate: PsfEstimate | null,
  started: number,
  detail?: string,
): RestoreDiagnostics {
  return {
    applied: false,
    requested,
    psfType: estimate?.kind,
    psf: estimate
      ? { lengthPx: estimate.length, radiusPx: estimate.radius, angleDeg: estimate.angleDeg }
      : undefined,
    confidence: estimate?.confidence ?? 0,
    balance: BALANCE,
    gainCap: GAIN_CAP,
    detail,
    ms: performance.now() - started,
  };
}

/** 全分辨率 Wiener；返回新的灰度 Mat，调用方负责 delete。 */
function fullWiener(cv: CvModule, scan: CvMat, psf: Float32Array, grid: number): CvMat | null {
  const { cols: width, rows: height } = scan;
  const padWidth = optimalSize(cv, width);
  const padHeight = optimalSize(cv, height);
  const H = buildWienerH(cv, psf, PSF_SUPPORT, grid, BALANCE, GAIN_CAP);
  const spectrum = createComplex(cv, padHeight, padWidth);
  let output: CvMat | null = null;
  try {
    fillComplexFromGray(cv, spectrum, scan.data, width, height);
    forward(cv, spectrum);
    applyWiener(spectrum, H, grid);
    inverse(cv, spectrum);
    // 大分配之后创建输出并重新取视图。
    output = new cv.Mat(height, width, cv.CV_8UC1);
    output.data.set(scan.data);
    writeGrayFromComplex(spectrum, output.data, width, height, STRENGTH);
    return output;
  } catch {
    output?.delete();
    return null;
  } finally {
    spectrum.delete();
  }
}

/** 小 FIR 降级：由 Wiener H 生成空域核，再用 filter2D 一次卷积。 */
function firRestore(cv: CvModule, scan: CvMat, psf: Float32Array, grid: number): CvMat | null {
  if (!cv.filter2D) return null;
  const { cols: width, rows: height } = scan;
  const H = buildWienerH(cv, psf, PSF_SUPPORT, grid, BALANCE, GAIN_CAP);
  const kernel = firFromH(cv, H, grid, FIR_SUPPORT);
  const kernelMat = cv.matFromArray(FIR_SUPPORT, FIR_SUPPORT, cv.CV_32F, Array.from(kernel));
  const filtered = new cv.Mat();
  let output: CvMat | null = null;
  try {
    cv.filter2D(scan, filtered, -1, kernelMat);
    // filter2D 与输出分配都可能触发堆增长，全部完成后再取视图。
    output = new cv.Mat(height, width, cv.CV_8UC1);
    const source = scan.data;
    const filteredData = filtered.data;
    const target = output.data;
    for (let i = 0; i < source.length; i++) {
      const value = source[i] + STRENGTH * (filteredData[i] - source[i]);
      target[i] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
    }
    return output;
  } catch {
    output?.delete();
    return null;
  } finally {
    filtered.delete();
    kernelMat.delete();
  }
}

export function runRestore(cv: CvModule, scan: CvMat, requested: BlurType): {
  mat: CvMat | null;
  diagnostics: RestoreDiagnostics;
} {
  const started = performance.now();
  if (!hasDft(cv)) {
    return { mat: null, diagnostics: { ...diagnosticsFor(requested, null, started), reason: "error" } };
  }
  const candidates = estimatePsfCandidates(cv, scan, requested);
  const detail = `运动 ${formatEstimate(candidates.motion)}；离焦 ${formatEstimate(candidates.defocus)}（${scan.cols}×${scan.rows}, ${candidates.debug}）`;
  const estimate = candidates.chosen;
  if (!estimate) {
    return { mat: null, diagnostics: { ...diagnosticsFor(requested, null, started, detail), reason: "low-detail" } };
  }
  const base = diagnosticsFor(requested, estimate, started, detail);
  // 用户显式选择模糊类型时接受较低的置信度；自动模式保持保守。
  const threshold = requested === "auto" ? MIN_CONFIDENCE : 0.2;
  if (estimate.confidence < threshold) {
    return { mat: null, diagnostics: { ...base, reason: "psf-low-confidence" } };
  }
  if (!inRange(estimate)) {
    return { mat: null, diagnostics: { ...base, reason: "out-of-range" } };
  }
  const area = scan.cols * scan.rows;
  const grid = (estimate.kind === "motion" && (estimate.length ?? 0) > 15)
    || (estimate.kind === "defocus" && (estimate.radius ?? 0) > 8)
    ? 512
    : 256;
  const psf = buildPsf(estimate);
  const padWidth = optimalSize(cv, scan.cols);
  const padHeight = optimalSize(cv, scan.rows);
  const estimatedBytes = estimateComplexBytes(padWidth, padHeight) + scan.data.length * 3 + 64 * 1024 * 1024;
  const method = area <= FULL_WIENER_LIMIT && estimatedBytes <= 0.75 * 1024 ** 3
    ? "full-wiener"
    : "fir";
  const mat = method === "full-wiener"
    ? fullWiener(cv, scan, psf, grid)
    : firRestore(cv, scan, psf, grid);
  if (!mat) {
    return { mat: null, diagnostics: { ...base, reason: "memory" } };
  }
  return {
    mat,
    diagnostics: {
      ...base,
      applied: true,
      method,
      ms: performance.now() - started,
    },
  };
}
