import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/playwright",
  timeout: 30000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
