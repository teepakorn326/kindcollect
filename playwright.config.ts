import { defineConfig, devices } from "@playwright/test";

// One spec = the 90-second demo (HANDOFF §8). Run against BASE_URL (deployed URL or local dev server).
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const user = process.env.BASIC_AUTH_USER;
const pass = process.env.BASIC_AUTH_PASS;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    httpCredentials: user && pass ? { username: user, password: pass } : undefined,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
});
