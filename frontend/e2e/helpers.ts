import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

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

/** Backend API client authorized as the user logged in on `page`. */
export async function apiClient(page: Page, request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };
  return {
    get: (path: string) => request.get(`${API_URL}${path}`, { headers }),
    post: (path: string, data: object) => request.post(`${API_URL}${path}`, { headers, data }),
    patch: (path: string, data: object) => request.patch(`${API_URL}${path}`, { headers, data }),
    put: (path: string, data: object) => request.put(`${API_URL}${path}`, { headers, data }),
    delete: (path: string) => request.delete(`${API_URL}${path}`, { headers }),
    upload: (path: string, file: { name: string; mimeType: string; buffer: Buffer }, caption = "") =>
      request.post(`${API_URL}${path}`, { headers, multipart: { file, caption } }),
  };
}

/** Supabase REST client as the logged-in user (RLS applies), for seeding rows the UI can't create in tests. */
export async function supabaseRest(page: Page, request: APIRequestContext) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    Authorization: `Bearer ${await accessToken(page)}`,
    Prefer: "return=representation",
  };
  return {
    insert: async (table: string, data: object) => {
      const response = await request.post(`${url}/${table}`, { headers, data });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json())[0];
    },
    update: (table: string, id: string, data: object) => request.patch(`${url}/${table}?id=eq.${id}`, { headers, data }),
    delete: (table: string, id: string) => request.delete(`${url}/${table}?id=eq.${id}`, { headers }),
  };
}

/** 1x1 transparent PNG for upload tests. */
export const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
