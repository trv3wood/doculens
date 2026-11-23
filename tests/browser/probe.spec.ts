import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function selectAndProcess(page: import("@playwright/test").Page, fixture: string) {
  await page.goto("/");
  await page.setInputFiles("#file", fixture);
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

test("小图 Worker/WASM 处理、三种导出与网络边界", async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(`${baseURL}/`) && !url.startsWith("blob:") && !url.startsWith("data:")) {
      externalRequests.push(url);
    }
  });

  await selectAndProcess(page, resolve("testdata/generated/document-640x480.png"));
  await expect(page.locator("#status")).toContainText("已保留整张照片");
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
  await expect(page.locator("#log")).toContainText("PDF 页面：1 页，842.000 × 631.500 pt，宽高比 1.333333");
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("12MP 图片全分辨率 Worker 处理", async ({ page }) => {
  await selectAndProcess(page, resolve("testdata/generated/document-4000x3000.png"));
  const dimensions = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  expect(dimensions).toEqual([4000, 3000]);
  const log = page.locator("#log");
  for (const phase of ["首屏可选图", "引擎就绪", "原图预览", "自动找边", "完整扫描"]) {
    await expect(log).toContainText(new RegExp(`计时 ${phase}：\\d+(?:\\.\\d+)?ms`));
  }
  const jpeg = await downloadExport(page, "jpeg");
  expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});

test("斜拍纸张自动扶正、四角调整及旋转导出", async ({ page }) => {
  await page.goto("/");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 520;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#30363b";
    ctx.fillRect(0, 0, 640, 520);
    ctx.beginPath();
    ctx.moveTo(125, 70);
    ctx.lineTo(560, 112);
    ctx.lineTo(530, 460);
    ctx.lineTo(72, 420);
    ctx.closePath();
    ctx.clip();
    const light = ctx.createLinearGradient(70, 0, 560, 0);
    light.addColorStop(0, "#a4a4a4");
    light.addColorStop(1, "#ececec");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 640, 520);
    ctx.fillStyle = "#202020";
    ctx.fillRect(225, 215, 230, 6);
    return canvas.toDataURL().split(",")[1];
  });
  await page.setInputFiles("#file", {
    name: "tilted.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.click("#process");
  await expect(page.locator("#status")).toContainText("请核对裁切范围");
  const scan = page.locator("#output");
  const size = () => scan.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
  const [width, height] = await size();
  expect(width).toBeGreaterThan(440);
  expect(width).toBeLessThan(475);
  expect(height).toBeGreaterThan(340);
  expect(height).toBeLessThan(370);

  const paper = await scan.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")!;
    return [12, canvas.width - 13].map(x => ctx.getImageData(x, 100, 1, 1).data[0]);
  });
  expect(Math.min(...paper)).toBeGreaterThan(200);
  expect(Math.abs(paper[0] - paper[1])).toBeLessThan(25);

  const corner = page.getByRole("button", { name: "左下角", exact: true });
  await corner.press("Shift+ArrowRight");
  await expect(page.locator("#save")).toBeDisabled();
  await page.selectOption("#format", "pdf");
  await expect(page.locator("#save")).toBeDisabled();
  await page.click("#process");
  await expect(page.locator("#save")).toBeEnabled();
  const [adjustedWidth, adjustedHeight] = await size();
  expect(adjustedWidth).toBeLessThan(width);
  await page.click("#rotate");
  await expect(page.locator("#save")).toBeEnabled();
  expect(await size()).toEqual([adjustedHeight, adjustedWidth]);
  const pdf = await PDFDocument.load(await downloadExport(page, "pdf"));
  const pageSize = pdf.getPage(0).getSize();
  expect(pageSize.width / pageSize.height).toBeCloseTo(adjustedHeight / adjustedWidth, 8);
  await page.getByRole("radio", { name: "黑白" }).check();
  await expect(page.locator("#save")).toBeEnabled();
  const binary = await scan.evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const values = new Set<number>();
    for (let i = 0; i < data.length; i += 4) values.add(data[i]);
    return [...values].sort((a, b) => a - b);
  });
  expect(binary).toEqual([0, 255]);

  await page.click("#reset-crop");
  await expect(page.locator("#save")).toBeEnabled();
  expect(await size()).toEqual([520, 640]);
});


test("窄屏启动时后台加载，选图可先完成，加载失败后可重试", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  let finishFirstLoad!: () => void;
  const firstLoad = new Promise<void>((resolve) => { finishFirstLoad = resolve; });
  let requests = 0;
  await page.route("**/wasm/opencv.wasm", async (route) => {
    if (++requests === 1) {
      await firstLoad;
      await route.fulfill({ status: 503 });
    } else {
      await route.continue();
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator("#retry-engine")).toBeHidden();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(page.locator("#file")).toBeEnabled();
  await page.setInputFiles("#file", resolve("testdata/generated/document-640x480.png"));
  await expect(page.locator("#file-info")).toContainText("document-640x480");
  await expect(page.locator("#process")).toBeDisabled();
  finishFirstLoad();
  await expect(page.locator("#status")).toContainText("扫描功能加载失败");
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.locator("#retry-engine")).toBeHidden();
  await expect(page.locator("#process")).toBeEnabled();
  await page.click("#process");
  await expect(page.locator("#save")).toBeEnabled();
  expect(requests).toBe(2);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth).toBe(360);
});

test("MApp 首屏就绪后自动加载包内资源", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "startupCalls", { value: calls });
    Object.defineProperty(window, "miniApp", { value: {
      ready: Promise.resolve(),
      permissions: { has: (name: string) => name === "workers.create" },
      lifecycle: { ready: () => { calls.push("ready"); } },
      assets: { async readBytes(path: string) {
        calls.push(path);
        const response = await fetch(`/${path}`);
        return new Uint8Array(await response.arrayBuffer());
      } },
      workers: { create(path: string) {
        calls.push(path);
        return new Worker(`/${path}`);
      } },
    } });
  });
  await page.goto("/");
  await page.setInputFiles("#file", resolve("testdata/generated/document-640x480.png"));
  await expect(page.locator("#process")).toBeEnabled();
  const calls = await page.evaluate(() => Reflect.get(window, "startupCalls"));
  expect(calls).toEqual(["ready", "wasm/opencv.wasm", "workers/scanner.js"]);
});

test("切换格式复用编码任务，旋转后按新结果导出", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    const encode = HTMLCanvasElement.prototype.toBlob;
    Object.defineProperty(window, "encodedFormats", { value: calls });
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      calls.push(type!);
      if (type === "image/png" && !Reflect.has(window, "finishFirstPng")) {
        Object.defineProperty(window, "finishFirstPng", {
          value: () => encode.call(this, callback, type, quality),
        });
      } else {
        encode.call(this, callback, type, quality);
      }
    };
  });
  await selectAndProcess(page, resolve("testdata/generated/document-640x480.png"));
  const encodedFormats = () => page.evaluate(() => Reflect.get(window, "encodedFormats"));
  await page.selectOption("#format", "pdf");
  await expect.poll(encodedFormats).toEqual(["image/jpeg", "image/png"]);
  await page.selectOption("#format", "png");
  await page.selectOption("#format", "pdf");
  await expect(page.locator("#save")).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, "finishFirstPng")());
  const firstPdf = await downloadExport(page, "pdf");
  await downloadExport(page, "png");
  expect(await downloadExport(page, "pdf")).toEqual(firstPdf);
  expect(await encodedFormats()).toEqual(["image/jpeg", "image/png"]);

  await page.click("#rotate");
  const rotated = await PDFDocument.load(await downloadExport(page, "pdf"));
  const { width, height } = rotated.getPage(0).getSize();
  expect(width / height).toBeCloseTo(480 / 640, 8);
  expect(await encodedFormats()).toEqual(["image/jpeg", "image/png", "image/png"]);
});

test("跟随宿主主题切换背景、文字、边框与主按钮", async ({ page }) => {
  await page.addInitScript(() => {
    const light = { mode: "light", background: "#fafafa", text: "#202020", border: "#ddd", accent: "#0055aa" };
    const dark = { mode: "dark", background: "#181818", text: "#eee", border: "#555", accent: "#ffee88" };
    Object.defineProperty(window, "miniApp", { value: {
      ready: Promise.resolve(),
      permissions: { has: () => true },
      lifecycle: { ready: () => {} },
      theme: {
        get: () => light,
        onChange: (callback: (theme: typeof dark) => void) => {
          document.addEventListener("switch-theme", () => callback(dark));
          return () => {};
        },
      },
      assets: { async readBytes(path: string) {
        return new Uint8Array(await (await fetch(`/${path}`)).arrayBuffer());
      } },
      workers: { create: (path: string) => new Worker(`/${path}`) },
    } });
  });
  await page.goto("/");
  const process = page.locator("#process");
  await expect(process).toHaveCSS("background-color", "rgb(0, 85, 170)");
  await expect(process).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.evaluate(() => document.dispatchEvent(new Event("switch-theme")));
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(24, 24, 24)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(238, 238, 238)");
  await expect(page.locator(".source")).toHaveCSS("border-top-color", "rgb(85, 85, 85)");
  await expect(process).toHaveCSS("background-color", "rgb(255, 238, 136)");
  await expect(process).toHaveCSS("color", "rgb(0, 0, 0)");
});
