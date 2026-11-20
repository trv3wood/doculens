import { describe, expect, it } from "vitest";
import { getErrorCode } from "../../src/host";

describe("MApp 错误码识别", () => {
  it("读取结构化错误码", () => {
    expect(getErrorCode({ code: "APP_UNLOADED" })).toBe("APP_UNLOADED");
  });

  it("兼容只有消息的错误", () => {
    expect(getErrorCode(new Error("分享失败：APP_UNLOADED"))).toBe("APP_UNLOADED");
  });

  it("不把其他错误识别为卸载", () => {
    expect(getErrorCode(new Error("TIMEOUT"))).toBe("TIMEOUT");
    expect(getErrorCode(null)).toBeNull();
  });
});
