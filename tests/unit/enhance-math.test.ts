import { describe, expect, it } from "vitest";
import {
  defocusPsf,
  estimateComplexBytes,
  gaussianGain,
  hann1d,
  hann2d,
  motionPsf,
  planTiles,
  reflect101,
  wienerGain,
  wrapDelta,
  wrapIndex,
} from "../../src/workers/enhance/math";

describe("频域数学工具", () => {
  it("reflect-101 边界映射", () => {
    expect([-3, -2, -1, 0, 1, 2, 3, 4, 5].map((index) => reflect101(index, 4)))
      .toEqual([3, 2, 1, 0, 1, 2, 3, 2, 1]);
  });

  it("环形索引与带符号距离", () => {
    expect(wrapIndex(-1, 8)).toBe(7);
    expect(wrapIndex(9, 8)).toBe(1);
    expect(wrapDelta(7, 8)).toBe(-1);
    expect(wrapDelta(4, 8)).toBe(-4);
  });

  it("Hann 窗端点为 0、中心为 1", () => {
    const window = hann1d(9);
    expect(window[0]).toBeCloseTo(0);
    expect(window[4]).toBeCloseTo(1);
    expect(window[8]).toBeCloseTo(0);
    const plane = hann2d(5, 5);
    expect(plane[2 * 5 + 2]).toBeCloseTo(1);
  });

  it("运动 PSF 归一化且方向正确", () => {
    const psf = motionPsf(9, 0, 33);
    expect(psf.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    let weightedX = 0;
    let weightedY = 0;
    for (let y = 0; y < 33; y++) {
      for (let x = 0; x < 33; x++) {
        weightedX += x * psf[y * 33 + x];
        weightedY += y * psf[y * 33 + x];
      }
    }
    expect(weightedY).toBeCloseTo(16, 1);
    expect(Math.abs(weightedX - 16)).toBeLessThan(0.5);
  });

  it("离焦 PSF 归一化且中心对称", () => {
    const psf = defocusPsf(4, 33);
    expect(psf.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(psf[16 * 33 + 16]).toBeGreaterThan(0);
    expect(psf[16 * 33 + 13]).toBeGreaterThan(0);
    expect(psf[16 * 33 + 10]).toBe(0);
  });

  it("Wiener 增益受上限约束", () => {
    const [real, imag] = wienerGain(0.001, 0.001, 0.02, 6);
    expect(Math.hypot(real, imag)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it("高斯陷波中心完全抑制、远处基本保留", () => {
    expect(gaussianGain(0, 0, 4)).toBeCloseTo(0);
    expect(gaussianGain(100, 100, 4)).toBeCloseTo(1);
  });

  it("分块计划覆盖全部像素", () => {
    const tiles = planTiles(1000, 700, 448, 32);
    const covered = new Uint8Array(1000 * 700);
    for (const tile of tiles) {
      for (let y = tile.y; y < tile.y + tile.height; y++) {
        for (let x = tile.x; x < tile.x + tile.width; x++) covered[y * 1000 + x]++;
      }
    }
    expect(covered.every((value) => value === 1)).toBe(true);
  });

  it("复数谱内存估算", () => {
    expect(estimateComplexBytes(4000, 3000)).toBe(4000 * 3000 * 8);
  });
});
