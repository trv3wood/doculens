import type { CvMat, CvModule } from "../cv";
import {
  gaussianGain,
  hann2d,
  reflect101,
  wrapIndex,
  wienerGain,
  type Peak,
} from "./math";

export const DFT_INVERSE = 1;
export const DFT_SCALE = 2;

export function hasDft(cv: CvModule): boolean {
  return typeof cv.dft === "function" && typeof cv.getOptimalDFTSize === "function";
}

export function optimalSize(cv: CvModule, size: number): number {
  if (cv.getOptimalDFTSize) return cv.getOptimalDFTSize(size);
  let value = 1;
  while (value < size) value <<= 1;
  return value;
}

export function createComplex(cv: CvModule, rows: number, cols: number): CvMat {
  return new cv.Mat(rows, cols, cv.CV_32FC2);
}

export function forward(cv: CvModule, mat: CvMat): void {
  if (!cv.dft) throw new Error("当前引擎不支持 dft");
  cv.dft(mat, mat, 0, 0);
}

export function inverse(cv: CvModule, mat: CvMat): void {
  if (!cv.dft) throw new Error("当前引擎不支持 dft");
  cv.dft(mat, mat, DFT_INVERSE | DFT_SCALE, 0);
}

export function fillComplexFromGray(
  cv: CvModule,
  target: CvMat,
  gray: Uint8Array,
  width: number,
  height: number,
  originX = 0,
  originY = 0,
  window?: Float32Array,
  offset = 128,
): void {
  const { rows, cols, data32F } = target;
  for (let y = 0; y < rows; y++) {
    const sy = reflect101(originY + y, height);
    for (let x = 0; x < cols; x++) {
      const sx = reflect101(originX + x, width);
      const index = y * cols + x;
      const value = gray[sy * width + sx] - offset;
      data32F[2 * index] = window ? value * window[index] : value;
      data32F[2 * index + 1] = 0;
    }
  }
}

export function writeGrayFromComplex(
  target: CvMat,
  output: Uint8Array,
  width: number,
  height: number,
  strength = 1,
  offset = 128,
): void {
  const { cols, data32F } = target;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = data32F[2 * (y * cols + x)] + offset;
      const blended = strength >= 1 ? value : output[index] + strength * (value - output[index]);
      output[index] = blended < 0 ? 0 : blended > 255 ? 255 : Math.round(blended);
    }
  }
}

/** 对复数谱施加成对的高斯陷波；peaks 使用 cycles/pixel。 */
export function applyNotch(target: CvMat, peaks: Peak[], sigma: number): void {
  const { rows, cols, data32F } = target;
  const radius = Math.ceil(4 * sigma);
  for (const peak of peaks) {
    if (Math.hypot(peak.fx, peak.fy) < 0.01) continue;
    const u0 = Math.round(peak.fx * cols);
    const v0 = Math.round(peak.fy * rows);
    for (const sign of [1, -1]) {
      const centerU = wrapIndex(sign * u0, cols);
      const centerV = wrapIndex(sign * v0, rows);
      for (let dv = -radius; dv <= radius; dv++) {
        const v = wrapIndex(centerV + dv, rows);
        for (let du = -radius; du <= radius; du++) {
          const gain = gaussianGain(du, dv, sigma);
          if (gain >= 0.999) continue;
          const u = wrapIndex(centerU + du, cols);
          const index = 2 * (v * cols + u);
          data32F[index] *= gain;
          data32F[index + 1] *= gain;
        }
      }
    }
  }
}

function sampleH(H: Float32Array, grid: number, x: number, y: number): [number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = wrapIndex(x0 + 1, grid);
  const y1 = wrapIndex(y0 + 1, grid);
  const wx0 = wrapIndex(x0, grid);
  const wy0 = wrapIndex(y0, grid);
  const read = (ix: number, iy: number) => {
    const index = 2 * (iy * grid + ix);
    return [H[index], H[index + 1]] as const;
  };
  const a = read(wx0, wy0);
  const b = read(x1, wy0);
  const c = read(wx0, y1);
  const d = read(x1, y1);
  const topR = a[0] + (b[0] - a[0]) * fx;
  const topI = a[1] + (b[1] - a[1]) * fx;
  const bottomR = c[0] + (d[0] - c[0]) * fx;
  const bottomI = c[1] + (d[1] - c[1]) * fx;
  return [topR + (bottomR - topR) * fy, topI + (bottomI - topI) * fy];
}

/** 采样 H 并对频谱做原地复数乘法；H 的网格覆盖 [-0.5, 0.5) cycles/pixel。 */
export function applyWiener(target: CvMat, H: Float32Array, grid: number): void {
  const { rows, cols, data32F } = target;
  for (let v = 0; v < rows; v++) {
    const vn = v < rows / 2 ? v : v - rows;
    const hy = wrapIndex((vn * grid) / rows, grid);
    for (let u = 0; u < cols; u++) {
      const un = u < cols / 2 ? u : u - cols;
      const hx = wrapIndex((un * grid) / cols, grid);
      const [hr, hi] = sampleH(H, grid, hx, hy);
      const index = 2 * (v * cols + u);
      const re = data32F[index];
      const im = data32F[index + 1];
      data32F[index] = re * hr - im * hi;
      data32F[index + 1] = re * hi + im * hr;
    }
  }
}

export function buildWienerH(
  cv: CvModule,
  psf: Float32Array,
  support: number,
  grid: number,
  balance: number,
  gainCap: number,
  bandLimit = 0.45,
): Float32Array {
  const kernel = createComplex(cv, grid, grid);
  try {
    const { data32F } = kernel;
    data32F.fill(0);
    const center = (support - 1) / 2;
    for (let y = 0; y < support; y++) {
      for (let x = 0; x < support; x++) {
        const dy = wrapIndex(y - Math.round(center), grid);
        const dx = wrapIndex(x - Math.round(center), grid);
        data32F[2 * (dy * grid + dx)] += psf[y * support + x];
      }
    }
    forward(cv, kernel);
    const spectrum = kernel.data32F;
    const H = new Float32Array(grid * grid * 2);
    for (let v = 0; v < grid; v++) {
      const vy = v < grid / 2 ? v : v - grid;
      for (let u = 0; u < grid; u++) {
        const ux = u < grid / 2 ? u : u - grid;
        const radius = Math.hypot(ux / grid, vy / grid);
        if (radius > bandLimit) continue;
        const [hr, hi] = wienerGain(spectrum[2 * (v * grid + u)], spectrum[2 * (v * grid + u) + 1], balance, gainCap);
        const taper = radius > bandLimit - 0.03
          ? 0.5 + 0.5 * Math.cos((Math.PI * (radius - bandLimit + 0.03)) / 0.03)
          : 1;
        const index = 2 * (v * grid + u);
        H[index] = hr * taper;
        H[index + 1] = hi * taper;
      }
    }
    return H;
  } finally {
    kernel.delete();
  }
}

/** 由 H 逆变换得到空域核，裁剪为 filter2D 可用的、已翻转的相关核。 */
export function firFromH(cv: CvModule, H: Float32Array, grid: number, support: number): Float32Array {
  const spectrum = createComplex(cv, grid, grid);
  try {
    spectrum.data32F.set(H);
    inverse(cv, spectrum);
    const values = spectrum.data32F;
    const center = (support - 1) >> 1;
    const kernel = new Float32Array(support * support);
    const window = hann2d(support, support);
    let sum = 0;
    for (let y = 0; y < support; y++) {
      for (let x = 0; x < support; x++) {
        const sy = wrapIndex(y - center, grid);
        const sx = wrapIndex(x - center, grid);
        const value = values[2 * (sy * grid + sx)] * window[y * support + x];
        // filter2D 执行相关而不是卷积，因此写入时翻转核。
        kernel[(support - 1 - y) * support + (support - 1 - x)] = value;
        sum += value;
      }
    }
    if (sum !== 0) for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    return kernel;
  } finally {
    spectrum.delete();
  }
}
