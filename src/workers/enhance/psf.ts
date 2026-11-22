import type { CvMat, CvModule } from "../cv";
import { createComplex, forward, inverse, optimalSize } from "./frequency";
import { hann2d, type Tile } from "./math";

export interface PsfEstimate {
  kind: "motion" | "defocus";
  length?: number;
  angleDeg?: number;
  radius?: number;
  confidence: number;
}

interface Analysis {
  logMag: Float32Array;
  size: number;
  tile: Tile;
}

function tileEnergy(gray: Uint8Array, width: number, height: number, tile: Tile): number {
  let energy = 0;
  const stride = 8;
  for (let y = tile.y + stride; y < tile.y + tile.height - stride; y += stride) {
    for (let x = tile.x + stride; x < tile.x + tile.width - stride; x += stride) {
      const index = y * width + x;
      const dx = gray[index + stride] - gray[index - stride];
      const dy = gray[index + stride * width] - gray[index - stride * width];
      energy += dx * dx + dy * dy;
    }
  }
  return energy;
}

export function selectRois(gray: Uint8Array, width: number, height: number, maximum = 2): Tile[] {
  const limit = Math.min(1024, width, height);
  if (limit < 128) return [];
  const size = 2 ** Math.floor(Math.log2(limit));
  const margin = Math.min(32, Math.floor(size * 0.08));
  const maxX = Math.max(0, width - size);
  const maxY = Math.max(0, height - size);
  const marginX = Math.min(margin, Math.floor(maxX / 2));
  const marginY = Math.min(margin, Math.floor(maxY / 2));
  const seen = new Set<string>();
  const candidates: { tile: Tile; energy: number }[] = [];
  for (const fy of [0.5, 0.25, 0.75]) {
    for (const fx of [0.5, 0.25, 0.75]) {
      const x = Math.max(marginX, Math.min(maxX - marginX, Math.round(width * fx - size / 2)));
      const y = Math.max(marginY, Math.min(maxY - marginY, Math.round(height * fy - size / 2)));
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tile = { x, y, width: size, height: size };
      candidates.push({ tile, energy: tileEnergy(gray, width, height, tile) });
    }
  }
  candidates.sort((a, b) => b.energy - a.energy);
  return candidates.slice(0, maximum).map(({ tile }) => tile);
}

function analyzeTile(cv: CvModule, scan: CvMat, tile: Tile): Analysis {
  const size = tile.width;
  const n = optimalSize(cv, size);
  const window = hann2d(size, size);
  const spectrum = createComplex(cv, n, n);
  const logMag = new Float32Array(n * n);
  try {
    const { cols: width } = scan;
    const gray = scan.data;
    const data32F = spectrum.data32F;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const index = y * n + x;
        if (x < size && y < size) {
          const value = gray[(tile.y + y) * width + tile.x + x] - 128;
          data32F[2 * index] = value * window[y * size + x];
        }
        data32F[2 * index + 1] = 0;
      }
    }
    forward(cv, spectrum);
    const transformed = spectrum.data32F;
    for (let i = 0; i < n * n; i++) {
      logMag[i] = Math.log1p(Math.hypot(transformed[2 * i], transformed[2 * i + 1]));
    }
  } finally {
    spectrum.delete();
  }
  return { logMag, size: n, tile };
}

function radialProfile(values: Float32Array, n: number): Float32Array {
  const half = n >> 1;
  const sums = new Float64Array(half + 1);
  const counts = new Uint32Array(half + 1);
  for (let v = 0; v < n; v++) {
    const vy = v <= half ? v : v - n;
    for (let u = 0; u <= half; u++) {
      const radius = Math.round(Math.hypot(u, vy));
      if (radius > half) continue;
      sums[radius] += values[v * n + u];
      counts[radius]++;
    }
  }
  const profile = new Float32Array(half + 1);
  for (let r = 0; r <= half; r++) profile[r] = counts[r] ? sums[r] / counts[r] : 0;
  return profile;
}

interface Cepstrum {
  values: Float32Array;
  size: number;
}

function cepstrumOf(cv: CvModule, analysis: Analysis): Cepstrum {
  const { logMag, size: n } = analysis;
  const profile = radialProfile(logMag, n);
  const spectrum = createComplex(cv, n, n);
  try {
    const { data32F } = spectrum;
    for (let v = 0; v < n; v++) {
      const vy = v <= n / 2 ? v : v - n;
      for (let u = 0; u < n; u++) {
        const ux = u <= n / 2 ? u : u - n;
        const radius = Math.min(Math.round(Math.hypot(ux, vy)), profile.length - 1);
        const index = v * n + u;
        data32F[2 * index] = logMag[index] - profile[radius];
        data32F[2 * index + 1] = 0;
      }
    }
    inverse(cv, spectrum);
    const transformed = spectrum.data32F;
    const values = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) values[i] = transformed[2 * i];
    return { values, size: n };
  } finally {
    spectrum.delete();
  }
}

function confidenceFromZ(zScore: number): number {
  return Math.max(0, Math.min(1, (zScore - 2) / 3.5));
}

function estimateMotion(cepstrum: Cepstrum): PsfEstimate | null {
  const { values, size: n } = cepstrum;
  const limit = Math.min(31, n >> 2);
  let minimum = Infinity;
  let minX = 0;
  let minY = 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let v = 0; v < n; v++) {
    const vy = v <= n / 2 ? v : v - n;
    for (let u = 0; u <= n / 2; u++) {
      const radius = Math.hypot(u, vy);
      if (radius < 3 || radius > limit) continue;
      const value = values[v * n + u];
      if (!Number.isFinite(value)) continue;
      sum += value;
      sumSquares += value * value;
      count++;
      if (value < minimum) {
        minimum = value;
        minX = u;
        minY = vy;
      }
    }
  }
  if (!count) return null;
  const mean = sum / count;
  const variance = Math.max(1e-9, sumSquares / count - mean * mean);
  const zScore = (mean - minimum) / Math.sqrt(variance);
  const length = Math.hypot(minX, minY);
  const angle = (Math.atan2(minY, minX) * 180) / Math.PI;
  return {
    kind: "motion",
    length,
    angleDeg: ((angle % 180) + 180) % 180,
    confidence: confidenceFromZ(zScore),
  };
}

/** 离焦核的倒谱在半径约等于核半径处出现负环，比单纯找频谱零点更耐文字纹理。 */
function estimateDefocusCepstrum(cepstrum: Cepstrum): PsfEstimate | null {
  const { values, size: n } = cepstrum;
  const maximumRadius = Math.min(12, n >> 2);
  const sums = new Float64Array(maximumRadius + 2);
  const counts = new Uint32Array(maximumRadius + 2);
  for (let v = 0; v < n; v++) {
    const vy = v <= n / 2 ? v : v - n;
    for (let u = 0; u <= n / 2; u++) {
      const radius = Math.round(Math.hypot(u, vy));
      if (radius > maximumRadius + 1) continue;
      const value = values[v * n + u];
      if (!Number.isFinite(value)) continue;
      sums[radius] += value;
      counts[radius]++;
    }
  }
  const profile = new Float32Array(maximumRadius + 2);
  for (let r = 0; r < profile.length; r++) profile[r] = counts[r] ? sums[r] / counts[r] : 0;
  let minimum = Infinity;
  let bestRadius = 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let r = 2; r <= maximumRadius; r++) {
    const value = profile[r];
    sum += value;
    sumSquares += value * value;
    count++;
    if (value < minimum) {
      minimum = value;
      bestRadius = r;
    }
  }
  if (!count || bestRadius === 0) return null;
  const mean = sum / count;
  const variance = Math.max(1e-9, sumSquares / count - mean * mean);
  const zScore = (mean - minimum) / Math.sqrt(variance);
  return {
    kind: "defocus",
    radius: bestRadius,
    confidence: confidenceFromZ(zScore),
  };
}

/** 频谱第一零点法，作为倒谱法的互补候选。 */
function estimateDefocusSpectral(analysis: Analysis): PsfEstimate | null {
  const { logMag, size: n } = analysis;
  const profile = radialProfile(logMag, n);
  const half = n >> 1;
  const smoothed = new Float32Array(profile.length);
  for (let r = 0; r < profile.length; r++) {
    let sum = 0;
    let count = 0;
    for (let k = -3; k <= 3; k++) {
      const index = r + k;
      if (index >= 0 && index <= half) {
        sum += profile[index];
        count++;
      }
    }
    smoothed[r] = sum / count;
  }
  const minimumRadius = Math.max(2, Math.round(0.04 * n));
  const maximumRadius = Math.min(half - 2, Math.round(0.2 * n));
  let bestRadius = 0;
  let bestDip = -Infinity;
  for (let r = minimumRadius; r <= maximumRadius; r++) {
    if (profile[r] > profile[r - 1] || profile[r] > profile[r + 1]) continue;
    const dip = smoothed[r - 1] - profile[r];
    if (dip > bestDip) {
      bestDip = dip;
      bestRadius = r;
    }
  }
  if (!bestRadius) return null;
  const radius = 0.61 / (bestRadius / n);
  return {
    kind: "defocus",
    radius,
    confidence: Math.max(0, Math.min(1, (bestDip - 0.25) / 0.6)),
  };
}

/** 直接测量强边缘的 10%–90% 上升宽度；对文字文档比频谱零点更稳。 */
function estimateDefocusEdge(
  gray: Uint8Array,
  width: number,
  height: number,
  tile: Tile,
): PsfEstimate | null {
  const widths: number[] = [];
  const sample = (x: number, y: number) => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    return gray[py * width + px];
  };
  for (let y = tile.y + 6; y < tile.y + tile.height - 6; y += 2) {
    for (let x = tile.x + 6; x < tile.x + tile.width - 6; x += 2) {
      const gx = gray[y * width + x + 1] - gray[y * width + x - 1];
      const gy = gray[(y + 1) * width + x] - gray[(y - 1) * width + x];
      const gradient = Math.hypot(gx, gy);
      if (gradient < 45) continue;
      const dx = gx / gradient;
      const dy = gy / gradient;
      let minimum = 255;
      let maximum = 0;
      for (let t = -8; t <= 8; t += 0.5) {
        const value = sample(x + dx * t, y + dy * t);
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
      if (maximum - minimum < 60) continue;
      const low = minimum + 0.1 * (maximum - minimum);
      const high = minimum + 0.9 * (maximum - minimum);
      let lowT: number | null = null;
      let highT: number | null = null;
      for (let t = -8; t <= 8; t += 0.25) {
        const value = sample(x + dx * t, y + dy * t);
        if (lowT === null && value >= low) lowT = t;
        if (value >= high) {
          highT = t;
          break;
        }
      }
      if (lowT === null || highT === null || highT <= lowT) continue;
      widths.push(highT - lowT);
    }
  }
  if (widths.length < 20) return null;
  widths.sort((a, b) => a - b);
  const median = widths[widths.length >> 1];
  const low = widths[Math.floor(widths.length * 0.25)];
  const high = widths[Math.floor(widths.length * 0.75)];
  const spread = high - low;
  const confidence = Math.max(0, Math.min(1, (1 - spread / Math.max(1e-3, median)) * Math.min(1, widths.length / 200)));
  return {
    kind: "defocus",
    radius: Math.max(1.5, Math.min(12, median / 1.6)),
    confidence,
  };
}

function better(a: PsfEstimate | null, b: PsfEstimate | null): PsfEstimate | null {
  if (!a) return b;
  if (!b) return a;
  return a.confidence >= b.confidence ? a : b;
}

function combine(estimates: PsfEstimate[]): PsfEstimate | null {
  if (!estimates.length) return null;
  const kind = estimates[0].kind;
  const same = estimates.filter((estimate) => estimate.kind === kind);
  const confidence = same.reduce((sum, estimate) => sum + estimate.confidence, 0) / same.length;
  let penalized = confidence;
  if (same.length > 1) {
    const key = kind === "motion" ? "length" : "radius";
    const first = same[0][key] ?? 0;
    const second = same[1][key] ?? first;
    const difference = Math.abs(first - second) / Math.max(1e-6, Math.max(first, second));
    if (difference > 0.2) penalized *= 0.5;
  }
  const weight = same.reduce((sum, estimate) => sum + estimate.confidence, 0);
  if (weight <= 0) return same[0];
  const average = (key: "length" | "angleDeg" | "radius") => {
    if (same.every((estimate) => estimate[key] === undefined)) return undefined;
    return same.reduce((sum, estimate) => sum + (estimate[key] ?? 0) * estimate.confidence, 0) / weight;
  };
  return {
    kind,
    length: average("length"),
    angleDeg: average("angleDeg"),
    radius: average("radius"),
    confidence: penalized,
  };
}

export interface PsfCandidates {
  motion: PsfEstimate | null;
  defocus: PsfEstimate | null;
  chosen: PsfEstimate | null;
  debug: string;
}

export function estimatePsfCandidates(
  cv: CvModule,
  scan: CvMat,
  requested: "auto" | "motion" | "defocus",
): PsfCandidates {
  const { cols: width, rows: height } = scan;
  const rois = selectRois(scan.data, width, height);
  if (!rois.length) return { motion: null, defocus: null, chosen: null, debug: "rois=0" };
  const analyses = rois.map((tile) => analyzeTile(cv, scan, tile));
  const motion: PsfEstimate[] = [];
  const defocus: PsfEstimate[] = [];
  const details: string[] = [];
  for (const analysis of analyses) {
    const cepstrum = cepstrumOf(cv, analysis);
    if (requested !== "defocus") {
      const estimate = estimateMotion(cepstrum);
      if (estimate) motion.push(estimate);
    }
    if (requested !== "motion") {
      const cep = estimateDefocusCepstrum(cepstrum);
      const spectral = estimateDefocusSpectral(analysis);
      const edge = estimateDefocusEdge(scan.data, width, height, analysis.tile);
      const estimate = better(better(cep, spectral), edge);
      if (estimate) {
        defocus.push(estimate);
        const describe = (value: PsfEstimate | null) =>
          value ? `${value.radius?.toFixed(1)}@${value.confidence.toFixed(2)}` : "-";
        details.push(`cep=${describe(cep)} spec=${describe(spectral)} edge=${describe(edge)}`);
      }
    }
  }
  const motionEstimate = combine(motion);
  const defocusEstimate = combine(defocus);
  const chosen = requested === "motion"
    ? motionEstimate
    : requested === "defocus"
      ? defocusEstimate
      : !motionEstimate
        ? defocusEstimate
        : !defocusEstimate
          ? motionEstimate
          : motionEstimate.confidence >= defocusEstimate.confidence ? motionEstimate : defocusEstimate;
  return {
    motion: motionEstimate,
    defocus: defocusEstimate,
    chosen,
    debug: `rois=${rois.length} motion=${motion.length} defocus=${defocus.length}${details.length ? ` [${details.join("; ")}]` : ""}`,
  };
}

export function estimatePsf(
  cv: CvModule,
  scan: CvMat,
  requested: "auto" | "motion" | "defocus",
): PsfEstimate | null {
  return estimatePsfCandidates(cv, scan, requested).chosen;
}
