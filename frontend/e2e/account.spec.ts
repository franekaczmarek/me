import { expect, test } from "@playwright/test";
import { logIn, requireTestUser, testUser } from "./helpers";

// Flows for a logged-in user. Needs a confirmed test account in .env.e2e.
test.beforeEach(() => requireTestUser());

test("logs in and lands on the timeline with all module tabs", async ({ page }) => {
  await logIn(page);
  for (const tab of ["Timeline", "To-do", "Calendar"]) {
    await expect(page.getByRole("link", { name: tab })).toBeVisible();
  }
});

test("navigates between module tabs", async ({ page }) => {
  await logIn(page);
  await page.getByRole("link", { name: "To-do" }).click();
  await expect(page).toHaveURL(/\/todo$/);
  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.getByRole("link", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/\/timeline$/);
});

test("keeps the session after a reload", async ({ page }) => {
  await logIn(page);
  await page.reload();
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible();
});

test("is sent from /login to the app when already logged in", async ({ page }) => {
  await logIn(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/timeline$/);
});

test("settings show the account and a backend that accepts the real token", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Profile menu" }).click();
  await expect(page.getByText(testUser.email)).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // Full stack: Supabase-issued JWT verified by FastAPI via JWKS.
  await expect(page.getByText("Backend: connected")).toBeVisible();
});

test("logs out and protects pages again", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/timeline");
  await expect(page).toHaveURL(/\/login$/);
});
