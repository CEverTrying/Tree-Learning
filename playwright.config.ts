import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:5197",
    viewport: { width: 1440, height: 960 },
    screenshot: "only-on-failure",
    launchOptions: process.env.TREELEARNING_CHROMIUM
      ? {
          executablePath: process.env.TREELEARNING_CHROMIUM,
          args: ["--no-sandbox"],
        }
      : {},
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5197/api/tree",
    env: {
      PORT: "5197",
      TREELEARNING_DATA_DIR: process.env.TREELEARNING_TEST_DATA || ".local/e2e",
    },
    reuseExistingServer: false,
  },
  workers: 1,
  reporter: "list",
  timeout: 30000,
});
