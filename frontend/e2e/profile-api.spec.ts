import { expect, test } from "@playwright/test";
import { API_URL, apiClient, logIn, requireTestUser } from "./helpers";

// Profile API through the real stack. Becomes a UI flow once settings show the profile.
test.beforeEach(() => requireTestUser());

test("a logged-in user sets and clears their birth date", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);

  try {
    const updated = await api.patch("/profile", { birth_date: "1990-03-04", display_name: "E2E" });
    expect(updated.status()).toBe(200);
    expect(await (await api.get("/profile")).json()).toEqual({ display_name: "E2E", birth_date: "1990-03-04" });

    expect((await api.patch("/profile", { birth_date: "2999-01-01" })).status()).toBe(422);
  } finally {
    await api.patch("/profile", { birth_date: null, display_name: null });
  }
  expect(await (await api.get("/profile")).json()).toEqual({ display_name: null, birth_date: null });
});

test("the profile API rejects requests without a token", async ({ request }) => {
  expect((await request.get(`${API_URL}/profile`)).status()).toBe(401);
});
