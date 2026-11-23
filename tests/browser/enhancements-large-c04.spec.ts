import { expect, test } from "@playwright/test";

test("12MP C04 全图陷波计时", async ({ page }) => {
  test.setTimeout(180_000);
  const base64 = await page.evaluate(() => {
    const width = 4000, height = 3000;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#f4f4f4";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#202020";
    context.font = "bold 90px monospace";
    context.fillText("DocuLens 12MP", 200, 300);
    context.font = "44px monospace";
    for (let line = 0; line < 30; line++) context.fillText(`Line ${line + 1}: readable text 0123456789.`, 200, 500 + line * 70);
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
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.goto("/");
  await page.setInputFiles("#file", {
    name: "large-periodic.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await page.click("#enhancement-options");
  await page.check("#moire");
  await page.click("#process");
  await expect(page.locator("#save")).toBeEnabled({ timeout: 180_000 });
  await page.click("#reset-crop");
  await expect(page.locator("#save")).toBeEnabled({ timeout: 180_000 });
  const log = (await page.locator("#log").textContent()) ?? "";
  expect(log).toContain("C04 峰值");
  expect(log).toContain("模式 full");
  expect(log).toContain("计时 C04 频域分析");
  const size = await page.locator("#output").evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
  expect(size).toEqual([4000, 3000]);
});
