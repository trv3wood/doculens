import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function initializeAndProcess(page: import("@playwright/test").Page, fixture: string) {
  await page.goto("/");
  await page.setInputFiles("#file", fixture);
  await page.click("#initialize");
  await expect(page.locator("#status")).toContainText("OpenCV 初始化完成", { timeout: 120_000 });
  await page.click("#process");
  await expect(page.locator("#status")).toContainText("文件已准备", { timeout: 120_000 });
}

async function downloadExport(page: import("@playwright/test").Page, format: string) {
  await page.selectOption("#format", format);
  await expect(page.locator("#save")).toBeEnabled({ timeout: 120_000 });
  const pending = page.waitForEvent("download");
  await page.click("#save");
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("浏览器没有提供下载文件");
  return readFile(path);
}

test("小图 Worker/WASM 处理、三种导出与网络边界", async ({ page }) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:5191") && !url.startsWith("blob:") && !url.startsWith("data:")) {
      externalRequests.push(url);
    }
  });

  await initializeAndProcess(page, resolve("testdata/generated/document-640x480.png"));
  const dimensions = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  expect(dimensions).toEqual([640, 480]);
  const channels = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2]];
  });
  expect(channels[0]).toBe(channels[1]);
  expect(channels[1]).toBe(channels[2]);

  const jpeg = await downloadExport(page, "jpeg");
  expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  const png = await downloadExport(page, "png");
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const pdfBytes = await downloadExport(page, "pdf");
  expect(pdfBytes.subarray(0, 4).toString()).toBe("%PDF");
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect(width / height).toBeCloseTo(640 / 480, 8);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("12MP 图片全分辨率 Worker 处理", async ({ page }) => {
  await initializeAndProcess(page, resolve("testdata/generated/document-4000x3000.png"));
  const dimensions = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  expect(dimensions).toEqual([4000, 3000]);
  const jpeg = await downloadExport(page, "jpeg");
  expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});
