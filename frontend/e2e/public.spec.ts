import { expect, test } from "@playwright/test";
import { API_URL } from "./helpers";

// Flows that need no account.

test.describe("logged-out user", () => {
  for (const path of ["/", "/timeline", "/todo", "/calendar", "/settings"]) {
    test(`is redirected from ${path} to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    });
  }

  test("can switch between login and signup", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  test("sees an error for wrong credentials (real Supabase)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("gets a validation error for mismatched signup passwords", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("someone@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password1");
    await page.getByLabel("Confirm password").fill("password2");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();
  });
});

test.describe("backend API", () => {
  test("health check responds", async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("rejects /me without a token", async ({ request }) => {
    expect((await request.get(`${API_URL}/me`)).status()).toBe(401);
  });

  test("rejects /me with a forged token", async ({ request }) => {
    const response = await request.get(`${API_URL}/me`, {
      headers: { Authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.AAAA" },
    });
    expect(response.status()).toBe(401);
  });
});
