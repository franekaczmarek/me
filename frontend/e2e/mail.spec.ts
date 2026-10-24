import { expect, test } from "@playwright/test";
import { apiClient, logIn, requireTestUser } from "./helpers";

test.beforeEach(() => requireTestUser());

test("a user opens the Mail tab, connects a Gmail inbox and removes it", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  // The test account has no inboxes; Gmail can't be reached from tests, so changes to inboxes are stubbed
  // below while the first load goes to the real backend.
  expect(await (await api.get("/mail/accounts")).json()).toEqual([]);

  await page.getByRole("link", { name: "Mail" }).click();
  await expect(page).toHaveURL(/\/mail$/);
  const card = page.getByRole("region", { name: "Inboxes" });
  const form = card.getByRole("form", { name: "Add a Gmail inbox" });
  await expect(form).toBeVisible();
  await expect(page.getByText("Connect a Gmail inbox to get a short summary")).toBeVisible();

  let accounts: object[] = [];
  await page.route("**/mail/accounts**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ email: "e2e@gmail.com", app_password: "abcd efgh ijkl mnop", label: "E2E inbox" });
      accounts = [{ id: "e2e-1", email: body.email, label: body.label, color: body.color, created_at: "2026-10-24T10:00:00Z" }];
      return route.fulfill({ status: 201, json: accounts[0] });
    }
    if (method === "DELETE") {
      accounts = [];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: accounts });
  });

  await form.getByLabel("Gmail address").fill("e2e@gmail.com");
  await form.getByLabel("App password").fill("abcd efgh ijkl mnop");
  await form.getByLabel("Name").fill("E2E inbox");
  await form.getByRole("button", { name: "Connect inbox" }).click();

  const row = card.getByRole("listitem", { name: "E2E inbox" });
  await expect(row).toContainText("e2e@gmail.com");
  await expect(form).toBeHidden();

  await row.getByRole("button", { name: "Remove E2E inbox" }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).toBeHidden();
  await expect(card.getByRole("form", { name: "Add a Gmail inbox" })).toBeVisible();
});
