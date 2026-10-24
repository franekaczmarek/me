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

test("a user summarizes new mail and reads the summary, proposed tasks and emails", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  // The latest digest comes from the real backend (none yet); Gmail and Claude are stubbed.
  expect(await (await api.get("/mail/digest/latest")).json()).toBeNull();
  await page.route("**/mail/accounts**", (route) =>
    route.fulfill({ json: [{ id: "acc-1", email: "e2e@gmail.com", label: "E2E inbox", color: "#4cc9a0", created_at: "2026-10-24T10:00:00Z" }] }),
  );
  const mail = (id: string, subject: string, importance: string, category: string) => ({
    id,
    account_id: "acc-1",
    sender: "Ann <ann@example.com>",
    subject,
    received_at: "2026-10-24T08:00:00Z",
    category,
    summary: `About ${subject}`,
    importance,
    marked_read: false,
  });
  let digests = 0;
  await page.route("**/mail/digest", (route) => {
    digests += 1;
    return route.fulfill({
      json:
        digests === 1
          ? {
              digest: {
                id: "dig-1",
                summary: "E2E: an invoice to pay and one newsletter.",
                created_at: "2026-10-24T17:00:00Z",
                applied_at: null,
                messages: [mail("m1", "E2E invoice", "high", "primary"), mail("m2", "E2E newsletter", "low", "updates")],
                proposals: [
                  { id: "p1", title: "E2E pay the invoice", planned_date: "2026-10-26", deadline: null, duration_min: 10, priority: "normal", reason: "Due soon", mail_ids: ["m1"], status: "pending" },
                ],
              },
              warnings: [],
            }
          : { digest: null, warnings: [] },
    });
  });

  await page.getByRole("link", { name: "Mail" }).click();
  await page.getByRole("button", { name: "✨ Summarize new mail" }).click();
  await expect(page.getByText("E2E: an invoice to pay and one newsletter.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tasks from your mail" }).getByRole("listitem", { name: "E2E pay the invoice" })).toContainText("From: E2E invoice");
  const emails = page.getByRole("region", { name: "Emails" });
  await expect(emails.getByRole("heading", { name: /E2E inbox/ })).toBeVisible();
  await expect(emails.getByRole("listitem", { name: "E2E newsletter" })).toContainText("Updates");

  await page.getByRole("button", { name: "✨ Summarize new mail" }).click();
  await expect(page.getByText("No new unread mail since the last summary.")).toBeVisible();
  await expect(page.getByText("E2E: an invoice to pay and one newsletter.")).toBeVisible();
});
