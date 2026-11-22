import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Degradation = "clean" | "periodic" | "motion" | "defocus";

interface ScanOptions {
  moire?: boolean;
  deblur?: boolean;
  blurType?: "auto" | "motion" | "defocus";
  mode?: "enhanced" | "gray" | "binary";
  fullFrame?: boolean;
}

async function makeImage(page: import("@playwright/test").Page, degradation: Degradation) {
  const base64 = await page.evaluate((kind) => {
    const width = 640;
    const height = 480;
    const clean = document.createElement("canvas");
    clean.width = width;
    clean.height = height;
    const source = clean.getContext("2d")!;
    source.fillStyle = "#f4f4f4";
    source.fillRect(0, 0, width, height);
    source.fillStyle = "#202020";
    source.font = "bold 28px monospace";
    source.fillText("DocuLens C04/C05", 40, 70);
    source.font = "16px monospace";
    for (let line = 0; line < 16; line++) {
      source.fillText(`Line ${line + 1}: readable text 0123456789.`, 40, 120 + line * 20);
    }

    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d")!;
    if (kind === "periodic") {
      context.drawImage(clean, 0, 0);
      const image = context.getImageData(0, 0, width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          const stripe = 22 * Math.sin(2 * Math.PI * (0.08 * x + 0.03 * y));
          for (let channel = 0; channel < 3; channel++) {
            image.data[index + channel] = Math.max(0, Math.min(255, image.data[index + channel] + stripe));
          }
        }
      }
      context.putImageData(image, 0, 0);
    } else if (kind === "motion") {
      context.fillStyle = "#f4f4f4";
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1 / 9;
      for (let offset = -4; offset <= 4; offset++) context.drawImage(clean, offset, 0);
      context.globalAlpha = 1;
    } else if (kind === "defocus") {
      const pattern = document.createElement("canvas");
      pattern.width = width;
      pattern.height = height;
      const draw = pattern.getContext("2d")!;
      draw.fillStyle = "#f4f4f4";
      draw.fillRect(0, 0, width, height);
      draw.fillStyle = "#101010";
      draw.fillRect(90, 90, 460, 300);
      draw.fillStyle = "#f4f4f4";
      draw.fillRect(130, 130, 380, 40);
      draw.fillRect(130, 210, 300, 24);
      context.fillStyle = "#f4f4f4";
      context.fillRect(0, 0, width, height);
      const samples = 25;
      context.globalAlpha = 1 / samples;
      for (let sy = -2; sy <= 2; sy++) {
        for (let sx = -2; sx <= 2; sx++) {
          if (Math.hypot(sx * 1.6, sy * 1.6) > 4) continue;
          context.drawImage(pattern, sx * 1.6, sy * 1.6);
        }
      }
      context.globalAlpha = 1;
    } else {
      context.drawImage(clean, 0, 0);
    }
    return output.toDataURL("image/png").split(",")[1];
  }, degradation);
  return Buffer.from(base64, "base64");
}

async function scan(
  page: import("@playwright/test").Page,
  input: { buffer: Buffer; name?: string } | string,
  options: ScanOptions = {},
) {
  await page.goto("/");
  const file = typeof input === "string"
    ? { name: input.split("/").pop()!, mimeType: "image/png", buffer: await readFile(input) }
    : { name: input.name ?? "synthetic.png", mimeType: "image/png", buffer: input.buffer };
  await page.setInputFiles("#file", file);
  if (options.mode) await page.selectOption("#mode", options.mode);
  if (options.moire) await page.check("#moire");
  if (options.deblur) {
    await page.check("#deblur");
    if (options.blurType) await page.selectOption("#blur-type", options.blurType);
  }

  const run = async () => {
    await page.click("#process");
    await expect(page.locator("#save")).toBeEnabled({ timeout: 180_000 });
  };
  await run();
  if (options.fullFrame) {
    await page.click("#reset-crop");
    await expect(page.locator("#save")).toBeEnabled({ timeout: 180_000 });
  }
  return (await page.locator("#log").textContent()) ?? "";
}

function outputSize(page: import("@playwright/test").Page) {
  return page.locator("#output").evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
}

test("C04 去除合成周期条纹并保持输出尺寸", async ({ page }) => {
  const log = await scan(page, { buffer: await makeImage(page, "periodic") }, { moire: true });
  expect(log).toContain("C04 峰值");
  expect(log).toContain("模式 full");
  expect(await outputSize(page)).toEqual([640, 480]);
});

test("C04 对清晰文字图不做处理", async ({ page }) => {
  const log = await scan(page, { buffer: await makeImage(page, "clean") }, { moire: true });
  expect(log).toContain("频域增强跳过");
  expect(log).not.toContain("C04 峰值");
});

test("C05 运动模糊估计并复原", async ({ page }) => {
  const log = await scan(page, { buffer: await makeImage(page, "motion") }, { deblur: true, blurType: "motion" });
  expect(log).toContain("C05 运动长度 9.0px");
  expect(log).toContain("全图 Wiener");
  expect(await outputSize(page)).toEqual([640, 480]);
});

test("C05 离焦模糊估计并复原", async ({ page }) => {
  const log = await scan(
    page,
    { buffer: await makeImage(page, "defocus") },
    { deblur: true, blurType: "defocus", fullFrame: true },
  );
  expect(log).toContain("C05 离焦半径");
  expect(log).toContain("全图 Wiener");
  const match = log.match(/C05 离焦半径 ([\d.]+)px/);
  expect(Number(match?.[1])).toBeGreaterThan(1.5);
  expect(Number(match?.[1])).toBeLessThan(8);
});

test("增强开关跨文件保留、页面重载恢复默认关闭", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#moire")).not.toBeChecked();
  await expect(page.locator("#deblur")).not.toBeChecked();
  await page.check("#moire");
  await page.setInputFiles("#file", resolve("testdata/generated/document-640x480.png"));
  await expect(page.locator("#moire")).toBeChecked();
  await page.reload();
  await expect(page.locator("#moire")).not.toBeChecked();
  await expect(page.locator("#deblur")).not.toBeChecked();
});

test("12MP 同时开启两个增强仍保持全分辨率", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const log = await scan(
    page,
    resolve("testdata/generated/document-4000x3000.png"),
    { moire: true, deblur: true, blurType: "auto" },
  );
  expect(log).toContain("处理完成");
  expect(await outputSize(page)).toEqual([4000, 3000]);
  expect(errors).toEqual([]);
});

test("黑白模式应用增强后仍为纯二值输出", async ({ page }) => {
  const log = await scan(
    page,
    { buffer: await makeImage(page, "motion") },
    { moire: true, deblur: true, blurType: "motion", mode: "binary", fullFrame: true },
  );
  expect(log).toContain("处理完成");
  const values = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) seen.add(data[i]);
    return [...seen].sort((a, b) => a - b);
  });
  expect(values).toEqual([0, 255]);
});
