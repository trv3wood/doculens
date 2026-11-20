import { describe, expect, it } from "vitest";
import { INPUT_LIMITS, validateImageInput } from "../../src/image/input";

describe("图片输入边界", () => {
  it("接受 12MP 且不警告", () => {
    expect(validateImageInput({ width: 4000, height: 3000, sizeBytes: 1 })).toEqual([]);
  });

  it("12–24MP 仅警告", () => {
    expect(validateImageInput({ width: 6000, height: 3000, sizeBytes: 1 })).toHaveLength(1);
  });

  it("拒绝超过 24MP", () => {
    expect(() => validateImageInput({ width: 6001, height: 4000, sizeBytes: 1 })).toThrow(/24MP/);
  });

  it("超过 25MiB 仅警告", () => {
    const warnings = validateImageInput({ width: 100, height: 100, sizeBytes: INPUT_LIMITS.warningBytes + 1 });
    expect(warnings).toEqual(["文件超过 25 MiB"]);
  });

  it("拒绝无效尺寸", () => {
    expect(() => validateImageInput({ width: 0, height: 100, sizeBytes: 1 })).toThrow(/尺寸/);
  });
});
