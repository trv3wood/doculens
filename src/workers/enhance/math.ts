/** 频域/复原的纯数学工具，不依赖 OpenCV，可在 Node 中单测。 */

export interface Peak {
  fx: number;
  fy: number;
  strength: number;
  confidence: number;
}

export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function reflect101(index: number, length: number): number {
  if (length <= 1) return 0;
  const period = 2 * (length - 1);
  let value = index % period;
  if (value < 0) value += period;
  return value < length ? value : period - value;
}

export function wrapIndex(index: number, size: number): number {
  const value = index % size;
  return value < 0 ? value + size : value;
}

/** 返回带符号的环形距离，范围 [-size/2, size/2)。 */
export function wrapDelta(index: number, size: number): number {
  const value = wrapIndex(index, size);
  return value >= size / 2 ? value - size : value;
}

export function hann1d(length: number): Float32Array {
  const window = new Float32Array(length);
  if (length <= 1) {
    window[0] = 1;
    return window;
  }
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return window;
}

export function hann2d(width: number, height: number): Float32Array {
  const horizontal = hann1d(width);
  const vertical = hann1d(height);
  const window = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) window[y * width + x] = horizontal[x] * vertical[y];
  }
  return window;
}

export function gaussianGain(du: number, dv: number, sigma: number): number {
  return 1 - Math.exp(-(du * du + dv * dv) / (2 * sigma * sigma));
}

export function medianOf(values: Float32Array | Float64Array): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort();
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 大数组用直方图求中位数，避免每次峰值检测都完整排序。 */
export function histogramMedian(values: Float32Array, bins = 512): number {
  let min = Infinity;
  let max = -Infinity;
  let finite = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    finite++;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!finite) return 0;
  if (max - min < 1e-6) return min;
  const counts = new Uint32Array(bins);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    counts[Math.round((value - min) * scale)]++;
  }
  const target = finite >> 1;
  let cumulative = 0;
  for (let bin = 0; bin < bins; bin++) {
    cumulative += counts[bin];
    if (cumulative >= target) return min + bin / scale;
  }
  return max;
}

export function quantizedKey(fx: number, fy: number, scale = 1024): string {
  return `${Math.round(fx * scale)},${Math.round(fy * scale)}`;
}

function splatBilinear(psf: Float32Array, grid: number, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const add = (px: number, py: number, weight: number) => {
    if (px >= 0 && px < grid && py >= 0 && py < grid) psf[py * grid + px] += weight;
  };
  add(x0, y0, (1 - fx) * (1 - fy));
  add(x0 + 1, y0, fx * (1 - fy));
  add(x0, y0 + 1, (1 - fx) * fy);
  add(x0 + 1, y0 + 1, fx * fy);
}

export function motionPsf(length: number, angleDeg: number, grid = 65): Float32Array {
  const psf = new Float32Array(grid * grid);
  const center = (grid - 1) / 2;
  const angle = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const steps = Math.max(2, Math.ceil(length * 2));
  for (let step = 0; step <= steps; step++) {
    const offset = -length / 2 + (length * step) / steps;
    splatBilinear(psf, grid, center + dx * offset, center + dy * offset);
  }
  let sum = 0;
  for (const value of psf) sum += value;
  if (sum > 0) for (let i = 0; i < psf.length; i++) psf[i] /= sum;
  return psf;
}

export function defocusPsf(radius: number, grid = 65): Float32Array {
  const psf = new Float32Array(grid * grid);
  const center = (grid - 1) / 2;
  const samples = 4;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - center;
          const py = y + (sy + 0.5) / samples - center;
          if (px * px + py * py <= radius * radius) covered++;
        }
      }
      psf[y * grid + x] = covered / (samples * samples);
    }
  }
  let sum = 0;
  for (const value of psf) sum += value;
  if (sum > 0) for (let i = 0; i < psf.length; i++) psf[i] /= sum;
  return psf;
}

/** 与频率域实现一致的 Wiener 增益，返回 [实部, 虚部]；热循环中应内联。 */
export function wienerGain(re: number, im: number, balance: number, gainCap: number): [number, number] {
  const denominator = re * re + im * im + balance;
  let real = re / denominator;
  let imag = -im / denominator;
  const magnitude = Math.hypot(real, imag);
  if (magnitude > gainCap) {
    real *= gainCap / magnitude;
    imag *= gainCap / magnitude;
  }
  return [real, imag];
}

/** 按核心区域划分重叠块；每块向外扩 halo，用于 overlap-save。 */
export function planTiles(width: number, height: number, core = 448, halo = 32): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += core) {
    for (let x = 0; x < width; x += core) {
      tiles.push({
        x,
        y,
        width: Math.min(core, width - x),
        height: Math.min(core, height - y),
      });
    }
  }
  if (halo < 0) throw new Error("halo 不能为负");
  return tiles;
}

export function estimateComplexBytes(width: number, height: number): number {
  return width * height * 8;
}
