import { expect, type Page, test } from "@playwright/test";

export const API_URL = "http://localhost:8000";

export const testUser = {
  email: process.env.E2E_EMAIL ?? "",
  password: process.env.E2E_PASSWORD ?? "",
};

/** Skip the current test file when no test account is configured in .env.e2e. */
export function requireTestUser() {
  test.skip(!testUser.email || !testUser.password, "Set E2E_EMAIL and E2E_PASSWORD in frontend/.env.e2e");
}

export async function logIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(testUser.email);
  await page.getByLabel("Password").fill(testUser.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/timeline$/);
}

/** Access token of the logged-in session (supabase-js keeps it in localStorage). */
export async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    return key ? JSON.parse(localStorage.getItem(key)!).access_token : "";
  });
}
