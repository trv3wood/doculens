import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5191",
    headless: true,
    acceptDownloads: true,
  },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:5191",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
