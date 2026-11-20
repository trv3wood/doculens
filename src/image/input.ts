export const INPUT_LIMITS = {
  standardPixels: 12_000_000,
  maximumPixels: 24_000_000,
  warningBytes: 25 * 1024 * 1024,
} as const;

export interface ImageInputInfo {
  width: number;
  height: number;
  sizeBytes: number;
}

export function validateImageInput(info: ImageInputInfo): string[] {
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height)
    || info.width <= 0 || info.height <= 0) {
    throw new Error("图片尺寸无效");
  }
  const pixels = info.width * info.height;
  if (pixels > INPUT_LIMITS.maximumPixels) {
    throw new Error(`图片 ${(pixels / 1e6).toFixed(1)}MP，超过 24MP 限制`);
  }
  const warnings: string[] = [];
  if (pixels > INPUT_LIMITS.standardPixels) {
    warnings.push(`图片 ${(pixels / 1e6).toFixed(1)}MP，属于扩展支持范围`);
  }
  if (info.sizeBytes > INPUT_LIMITS.warningBytes) warnings.push("文件超过 25 MiB");
  return warnings;
}
