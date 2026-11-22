import type { CvMat, CvModule } from "../cv";
import type { SpectralDiagnostics } from "../protocol";
import {
  applyNotch,
  createComplex,
  fillComplexFromGray,
  forward,
  hasDft,
  inverse,
  optimalSize,
  writeGrayFromComplex,
} from "./frequency";
import {
  hann2d,
  histogramMedian,
  quantizedKey,
  type Peak,
  type Tile,
} from "./math";

const TILE_LIMIT = 1024;
const MAX_TILES = 5;
const MAX_PEAKS = 8;
const MAX_CANDIDATES = 200;
const MIN_SIGNIFICANCE = 2;
const FULL_DFT_LIMIT = 12_000_000;

function gradientEnergy(gray: Uint8Array, width: number, height: number, tile: Tile): number {
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

function selectTiles(gray: Uint8Array, width: number, height: number): Tile[] {
  const limit = Math.min(TILE_LIMIT, width, height);
  if (limit < 96) return [];
  const size = 2 ** Math.floor(Math.log2(limit));
  const margin = Math.min(32, Math.floor(size * 0.1));
  const maxX = Math.max(0, width - size);
  const maxY = Math.max(0, height - size);
  const marginX = Math.min(margin, Math.floor(maxX / 2));
  const marginY = Math.min(margin, Math.floor(maxY / 2));
  const origins = new Set<string>();
  const candidates: { tile: Tile; energy: number }[] = [];
  for (const fy of [0.5, 0.25, 0.75]) {
    for (const fx of [0.5, 0.25, 0.75]) {
      const x = Math.max(marginX, Math.min(maxX - marginX, Math.round(width * fx - size / 2)));
      const y = Math.max(marginY, Math.min(maxY - marginY, Math.round(height * fy - size / 2)));
      const key = `${x},${y}`;
      if (origins.has(key)) continue;
      origins.add(key);
      const tile = { x, y, width: size, height: size };
      candidates.push({ tile, energy: gradientEnergy(gray, width, height, tile) });
    }
  }
  candidates.sort((a, b) => b.energy - a.energy);
  return candidates.slice(0, MAX_TILES).map(({ tile }) => tile);
}

interface TilePeaks {
  peaks: Peak[];
  median: number;
  maxProminence: number;
  maxima: number;
}

function detectTilePeaks(cv: CvModule, scan: CvMat, tile: Tile): TilePeaks {
  const size = tile.width;
  const window = hann2d(size, size);
  const n = optimalSize(cv, size);
  const magnitude = new Float32Array(n * n);
  const spectrum = createComplex(cv, n, n);
  try {
    const { cols: width } = scan;
    // 大分配可能让 WASM 堆增长，必须在分配之后重新取视图。
    const gray = scan.data;
    const data32F = spectrum.data32F;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const index = y * n + x;
        if (x < size && y < size) {
          const value = gray[(tile.y + y) * width + tile.x + x] - 128;
          data32F[2 * index] = value * window[y * size + x];
        } else {
          data32F[2 * index] = 0;
        }
        data32F[2 * index + 1] = 0;
      }
    }
    forward(cv, spectrum);
    const transformed = spectrum.data32F;
    for (let i = 0; i < n * n; i++) {
      magnitude[i] = Math.log1p(Math.hypot(transformed[2 * i], transformed[2 * i + 1]));
    }
  } finally {
    spectrum.delete();
  }

  const median = histogramMedian(magnitude);
  const candidates: { peak: Peak; u: number; v: number; prominence: number }[] = [];
  const half = n >> 1;
  let maxProminence = 0;
  let maxima = 0;
  for (let v = 0; v < n; v++) {
    const vy = v <= half ? v : v - n;
    for (let u = 1; u <= half; u++) {
      const radius = Math.hypot(u, vy) / n;
      if (radius < 0.01 || radius > 0.45) continue;
      const index = v * n + u;
      const value = magnitude[index];
      if (!Number.isFinite(value)) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        const yy = v + dy;
        if (yy < 0 || yy >= n) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = u + dx;
          if (xx < 0 || xx > half) continue;
          if (magnitude[yy * n + xx] > value) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      maxima++;
      const prominence = value - median;
      if (prominence > maxProminence) maxProminence = prominence;
      if (prominence < MIN_SIGNIFICANCE) continue;
      const conjugate = magnitude[((n - v) % n) * n + ((n - u) % n)];
      if (!Number.isFinite(conjugate)) continue;
      const ratio = Math.abs(Math.log((value + 1e-6) / (conjugate + 1e-6)));
      if (!Number.isFinite(ratio) || ratio > Math.log(3)) continue;
      candidates.push({
        peak: {
          fx: u / n,
          fy: vy / n,
          strength: prominence,
          confidence: Math.min(prominence / 6, 1) * (1 - ratio / Math.log(3)),
        },
        u,
        v,
        prominence,
      });
    }
  }

  candidates.sort((a, b) => b.prominence - a.prominence);
  const accepted: { peak: Peak; u: number; v: number }[] = [];
  for (const candidate of candidates) {
    if (accepted.some(({ u, v }) => Math.hypot(candidate.u - u, candidate.v - v) < 3)) continue;
    accepted.push(candidate);
    if (accepted.length >= MAX_PEAKS) break;
  }
  return { peaks: accepted.map(({ peak }) => peak), median, maxProminence, maxima };
}

interface Vote {
  count: number;
  strength: number;
  confidence: number;
  peak: Peak;
}

function collectPeaks(cv: CvModule, scan: CvMat) {
  const { cols: width, rows: height } = scan;
  const tiles = selectTiles(scan.data, width, height);
  const votes = new Map<string, Vote>();
  let candidateCount = 0;
  let maxProminence = 0;
  let maxima = 0;
  let median = 0;
  for (const tile of tiles) {
    const detected = detectTilePeaks(cv, scan, tile);
    candidateCount += detected.peaks.length;
    maxProminence = Math.max(maxProminence, detected.maxProminence);
    maxima = Math.max(maxima, detected.maxima);
    median = detected.median;
    for (const peak of detected.peaks) {
      const key = quantizedKey(peak.fx, peak.fy);
      const existing = votes.get(key);
      if (existing) {
        existing.count++;
        existing.strength += peak.strength;
        existing.confidence = Math.max(existing.confidence, peak.confidence);
      } else {
        votes.set(key, { count: 1, strength: peak.strength, confidence: peak.confidence, peak });
      }
    }
  }
  const minimumVotes = tiles.length > 1 ? 2 : 1;
  const peaks = [...votes.values()]
    .filter((vote) => vote.count >= minimumVotes || vote.confidence > 0.85)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_PEAKS)
    .map((vote) => ({ ...vote.peak, strength: vote.strength }));
  return {
    peaks,
    candidateCount,
    tiles: tiles.length,
    detail: `tiles=${tiles.length} maxima=${maxima} candidates=${candidateCount} median=${median.toFixed(2)} maxProm=${maxProminence.toFixed(2)}`,
  };
}

/** 窄带周期噪声的全分辨率最小二乘减除，避免 >12MP 时分配全图复数谱。 */
function subtractSinusoids(gray: Uint8Array, width: number, height: number, peaks: Peak[]) {
  const stride = 2;
  for (const peak of peaks) {
    const angleX = 2 * Math.PI * peak.fx;
    const angleY = 2 * Math.PI * peak.fy;
    const cosX = new Float32Array(width);
    const sinX = new Float32Array(width);
    const cosY = new Float32Array(height);
    const sinY = new Float32Array(height);
    for (let x = 0; x < width; x++) {
      cosX[x] = Math.cos(angleX * x);
      sinX[x] = Math.sin(angleX * x);
    }
    for (let y = 0; y < height; y++) {
      cosY[y] = Math.cos(angleY * y);
      sinY[y] = Math.sin(angleY * y);
    }
    // 3×3 正规方程 [cos, sin, 1] 的最小二乘解。
    let cc = 0, ss = 0, cs = 0, c1 = 0, s1 = 0, one = 0, yc = 0, ys = 0, y1 = 0;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const c = cosX[x] * cosY[y] - sinX[x] * sinY[y];
        const s = sinX[x] * cosY[y] + cosX[x] * sinY[y];
        const value = gray[y * width + x];
        cc += c * c; ss += s * s; cs += c * s;
        c1 += c; s1 += s; one++;
        yc += value * c; ys += value * s; y1 += value;
      }
    }
    const matrix = [
      [cc, cs, c1],
      [cs, ss, s1],
      [c1, s1, one],
    ];
    const vector = [yc, ys, y1];
    const solution = solve3(matrix, vector);
    if (!solution) continue;
    const [a, b] = solution;
    const amplitude = Math.hypot(a, b);
    if (amplitude < 0.75 || amplitude > 40) continue;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = cosX[x] * cosY[y] - sinX[x] * sinY[y];
        const s = sinX[x] * cosY[y] + cosX[x] * sinY[y];
        const value = gray[y * width + x] - (a * c + b * s);
        gray[y * width + x] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
      }
    }
  }
}

function solve3(matrix: number[][], vector: number[]): [number, number, number] | null {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-6) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let i = column; i < 4; i++) augmented[column][i] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let i = column; i < 4; i++) augmented[row][i] -= factor * augmented[column][i];
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

/** 选图像中方差最低的 32×32 块，用来区分“全局周期噪声”和“文字行周期”。 */
function chooseBackgroundBlock(gray: Uint8Array, width: number, height: number) {
  const size = 32;
  let best = { x: 0, y: 0, size, std: Infinity };
  let bestVariance = Infinity;
  for (let y = 0; y + size <= height; y += size) {
    for (let x = 0; x + size <= width; x += size) {
      let sum = 0;
      let sumSquares = 0;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const value = gray[(y + j) * width + x + i];
          sum += value;
          sumSquares += value * value;
        }
      }
      const count = size * size;
      const variance = sumSquares / count - (sum / count) ** 2;
      if (variance < bestVariance) {
        bestVariance = variance;
        best = { x, y, size, std: Math.sqrt(variance) };
      }
    }
  }
  return best;
}

function backgroundAmplitude(
  gray: Uint8Array,
  width: number,
  block: { x: number; y: number; size: number },
  peak: Peak,
): number {
  const angleX = 2 * Math.PI * peak.fx;
  const angleY = 2 * Math.PI * peak.fy;
  let cc = 0, ss = 0, cs = 0, c1 = 0, s1 = 0, one = 0, yc = 0, ys = 0, y1 = 0;
  for (let y = block.y; y < block.y + block.size; y++) {
    for (let x = block.x; x < block.x + block.size; x++) {
      const c = Math.cos(angleX * x + angleY * y);
      const s = Math.sin(angleX * x + angleY * y);
      const value = gray[y * width + x];
      cc += c * c; ss += s * s; cs += c * s;
      c1 += c; s1 += s; one++;
      yc += value * c; ys += value * s; y1 += value;
    }
  }
  const solution = solve3(
    [[cc, cs, c1], [cs, ss, s1], [c1, s1, one]],
    [yc, ys, y1],
  );
  return solution ? Math.hypot(solution[0], solution[1]) : 0;
}

/** 只检查强边缘是否保留；周期条纹的梯度远低于文字笔画。 */
function edgePreservation(before: Uint8Array, after: Uint8Array, width: number, height: number): number {
  const stride = 4;
  let strong = 0;
  let preserved = 0;
  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const index = y * width + x;
      const beforeDx = before[index + stride] - before[index - stride];
      const beforeDy = before[index + stride * width] - before[index - stride * width];
      const beforeGradient = Math.hypot(beforeDx, beforeDy);
      if (beforeGradient < 60) continue;
      strong++;
      const afterDx = after[index + stride] - after[index - stride];
      const afterDy = after[index + stride * width] - after[index - stride * width];
      if (Math.hypot(afterDx, afterDy) >= 0.6 * beforeGradient) preserved++;
    }
  }
  return strong ? preserved / strong : 1;
}

export function runSpectral(cv: CvModule, scan: CvMat, requested: boolean): SpectralDiagnostics {
  const started = performance.now();
  const { cols: width, rows: height } = scan;
  const base: SpectralDiagnostics = {
    applied: false,
    mode: "none",
    peakPairs: 0,
    confidence: 0,
    sigmaPx: 0,
    frequencies: [],
    ms: 0,
  };
  if (!requested) return base;
  if (!hasDft(cv)) {
    return { ...base, reason: "error", ms: performance.now() - started };
  }
  let snapshot: Uint8Array | undefined;
  try {
    const collected = collectPeaks(cv, scan);
    const gray = scan.data;
    const candidateCount = collected.candidateCount;
    if (candidateCount > MAX_CANDIDATES) {
      return { ...base, reason: "too-many-peaks", detail: collected.detail, ms: performance.now() - started };
    }
    if (!collected.peaks.length) {
      return { ...base, reason: "no-peaks", detail: collected.detail, ms: performance.now() - started };
    }
    // 文字行也会形成周期峰，但不会出现在空白区域；只保留在低方差块中仍可见的分量。
    const block = chooseBackgroundBlock(gray, width, height);
    const amplitudes = collected.peaks.map((peak) => backgroundAmplitude(gray, width, block, peak));
    const peaks = collected.peaks.filter((_, index) => amplitudes[index] >= 1.2);
    const amplitudeDetail = `${collected.detail} bg=[${amplitudes.map((value) => value.toFixed(1)).join(",")}] bgStd=${block.std.toFixed(1)}`;
    if (!peaks.length || block.std > 35) {
      return { ...base, reason: "no-peaks", detail: amplitudeDetail, ms: performance.now() - started };
    }
    const detail = amplitudeDetail;
    const confidence = peaks.reduce((sum, peak) => sum + peak.confidence, 0) / peaks.length;
    const frequencies = peaks.map(({ fx, fy, strength }) => ({ fx, fy, strength }));
    snapshot = gray.slice();
    let mode: SpectralDiagnostics["mode"] = "full";
    let sigma = 0;
    if (width * height > FULL_DFT_LIMIT) {
      mode = "sine";
      subtractSinusoids(gray, width, height, peaks);
    } else {
      const padWidth = optimalSize(cv, width);
      const padHeight = optimalSize(cv, height);
      sigma = Math.max(2, Math.min(24, Math.round(0.002 * Math.max(padWidth, padHeight))));
      const spectrum = createComplex(cv, padHeight, padWidth);
      try {
        // 分配全图复数谱后重新取扫描图视图。
        fillComplexFromGray(cv, spectrum, scan.data, width, height);
        forward(cv, spectrum);
        applyNotch(spectrum, peaks, sigma);
        inverse(cv, spectrum);
        writeGrayFromComplex(spectrum, scan.data, width, height);
      } finally {
        spectrum.delete();
      }
    }
    if (edgePreservation(snapshot, scan.data, width, height) < 0.85) {
      scan.data.set(snapshot);
      return {
        applied: false,
        reason: "guard",
        mode: "none",
        peakPairs: peaks.length,
        confidence,
        sigmaPx: sigma,
        frequencies,
        detail,
        ms: performance.now() - started,
      };
    }
    return {
      applied: true,
      mode,
      peakPairs: peaks.length,
      confidence,
      sigmaPx: sigma,
      frequencies,
      detail,
      ms: performance.now() - started,
    };
  } catch (error) {
    const detail = String(error);
    if (!/out of memory|insufficient memory|failed to allocate|array buffer allocation failed|invalid typed array length/i.test(detail)) throw error;
    // 大图正弦扣除可能已修改部分像素，回退后继续扫描。
    if (snapshot) scan.data.set(snapshot);
    return { ...base, reason: "memory", detail, ms: performance.now() - started };
  }
}
