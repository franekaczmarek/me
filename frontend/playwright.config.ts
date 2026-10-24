import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Test-account credentials (E2E_EMAIL, E2E_PASSWORD) live in the git-ignored .env.e2e.
if (existsSync(".env.e2e")) process.loadEnvFile(".env.e2e");
// Supabase URL + publishable key, for seeding rows the UI can't create in tests (see `supabaseRest`).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// E2E tests run the real stack: Next.js + FastAPI + the Supabase project.
// Already-running dev servers are reused.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: ".venv/bin/uvicorn app.main:app --port 8000",
      cwd: "../backend",
      url: "http://localhost:8000/health",
      reuseExistingServer: true,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000/login",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
