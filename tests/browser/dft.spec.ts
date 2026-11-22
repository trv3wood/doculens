import { expect, test } from "@playwright/test";

test("引擎导出 dft 且往返正确", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const worker = new Worker("/workers/scanner.js");
    try {
      const wasm = await (await fetch("/wasm/opencv.wasm")).arrayBuffer();
      const initialized = new Promise<Record<string, unknown>>((resolve) => {
        worker.onmessage = (event) => {
          if (event.data.type === "initialized") resolve(event.data);
        };
      });
      worker.postMessage({ id: 1, type: "init", wasm }, [wasm]);
      const initialization = await initialized;

      const selftest = new Promise<Record<string, unknown>>((resolve) => {
        worker.onmessage = (event) => {
          if (event.data.type === "selftest") resolve(event.data);
        };
      });
      worker.postMessage({ id: 2, type: "selftest" });
      return { initialization, tested: await selftest };
    } finally {
      worker.terminate();
    }
  });

  expect(result.initialization.dft).toBe(true);
  expect(result.tested.dft).toBe(true);
  expect(result.tested.inPlace).toBe(true);
  expect(result.tested.maxError as number).toBeLessThan(1e-2);
  expect(result.tested.optimal4000).toBe(4000);
  expect(result.tested.optimal3000).toBe(3000);
  expect(result.tested.constants).toEqual({ inverse: 1, scale: 2, complexOutput: 16, realOutput: 32 });
});
