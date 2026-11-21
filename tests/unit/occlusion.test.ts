import { describe, expect, it } from "vitest";
import { recoverOccluded } from "../../src/workers/occlusion";

describe("partial page boundaries", () => {
  const width = 160;
  const height = 120;

  function interruptedPage(luminance: number) {
    const color = new Uint8Array(width * height).fill(130);
    const gray = new Uint8Array(width * height).fill(130);
    for (let y = 20; y <= 99; y++) {
      for (let x = 45; x <= 110; x++) {
        // Four occluders hide short sections, one on each edge.
        const verticalGap = x >= 69 && x <= 78 && (y < 31 || y > 85);
        const horizontalGap = y >= 52 && y <= 63 && (x < 53 || x > 102);
        if (verticalGap || horizontalGap) continue;
        color[y * width + x] = 96;
        gray[y * width + x] = luminance;
      }
    }
    return recoverOccluded(color, gray, width, height);
  }

  it("intersects separated runs of the four page edges", () => {
    const corners = interruptedPage(185);
    expect(corners).toBeDefined();
    const expected = [[45, 20], [110, 20], [110, 99], [45, 99]];
    corners!.forEach((p, i) => {
      expect(Math.hypot(p.x * (width - 1) - expected[i][0], p.y * (height - 1) - expected[i][1])).toBeLessThan(5);
    });
  });

  it("rejects a dark object with the same outline", () => {
    expect(interruptedPage(50)).toBeUndefined();
  });
});
