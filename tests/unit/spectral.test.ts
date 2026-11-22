import { expect, test, vi } from "vitest";
import type { CvMat, CvModule } from "../../src/workers/cv";
import { runSpectral } from "../../src/workers/enhance/spectral";

test.each(["分配频谱", "执行 DFT"])("C04 在%s时内存不足，保留原图", (stage) => {
  const data = new Uint8Array(128 * 128).fill(123);
  const scan = { rows: 128, cols: 128, data } as CvMat;
  const release = vi.fn();
  const failure = new RangeError("Out of memory");
  const cv = {
    Mat: class {
      data32F = new Float32Array(2 * 128 * 128);
      delete = release;

      constructor() {
        if (stage === "分配频谱") throw failure;
      }
    },
    getOptimalDFTSize: (size: number) => size,
    dft: () => { throw failure; },
  } as unknown as CvModule;

  expect(runSpectral(cv, scan, true)).toMatchObject({ applied: false, reason: "memory" });
  expect(data.every((value) => value === 123)).toBe(true);
  expect(release).toHaveBeenCalledTimes(stage === "分配频谱" ? 0 : 1);
});
