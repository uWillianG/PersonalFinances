import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.CLARA_CHROME_EXECUTABLE_PATH || (
  process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: process.env.CLARA_TEST_BASE_URL || "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: { executablePath },
    },
  }],
});
