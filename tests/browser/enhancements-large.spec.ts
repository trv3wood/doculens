import { expect, test } from "@playwright/test";

test("12.8MP 运动模糊走 FIR 降级并保持全分辨率", async ({ page }) => {
  const base64 = await page.evaluate(() => {
    const width = 4000, height = 3200;
    const clean = document.createElement("canvas");
    clean.width = width;
    clean.height = height;
    const source = clean.getContext("2d")!;
    source.fillStyle = "#f4f4f4";
    source.fillRect(0, 0, width, height);
    source.fillStyle = "#101010";
    source.fillRect(400, 400, 3200, 2400);
    source.fillStyle = "#f4f4f4";
    source.fillRect(700, 700, 2600, 300);
    source.fillRect(700, 1400, 2200, 200);
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d")!;
    context.fillStyle = "#f4f4f4";
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1 / 9;
    for (let offset = -4; offset <= 4; offset++) context.drawImage(clean, offset, 0);
    context.globalAlpha = 1;
    return output.toDataURL("image/png").split(",")[1];
  });
  await page.goto("/");
  await page.setInputFiles("#file", {
    name: "large-motion.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await page.check("#deblur");
  await page.selectOption("#blur-type", "motion");
  await page.click("#process");
  await expect(page.locator("#save")).toBeEnabled({ timeout: 120_000 });
  await page.click("#reset-crop");
  await expect(page.locator("#save")).toBeEnabled({ timeout: 120_000 });
  const log = (await page.locator("#log").textContent()) ?? "";
  expect(log).toContain("FIR 近似");
  const stats = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    return { width: canvas.width, height: canvas.height, min, max };
  });
  expect(stats).toEqual({ width: 4000, height: 3200, min: expect.any(Number), max: expect.any(Number) });
  expect(stats.max).toBeGreaterThan(stats.min);
});
