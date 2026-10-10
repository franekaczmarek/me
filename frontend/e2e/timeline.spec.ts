import { expect, test } from "@playwright/test";
import { apiClient, logIn, requireTestUser } from "./helpers";

// Timeline UI on the real stack. Data is seeded through the API and removed afterwards.
test.beforeEach(() => requireTestUser());

test("the timeline shows the user's events and their details", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  await api.patch("/profile", { birth_date: null });
  const tag = `e2e-${Date.now()}`;
  const category = await (await api.post("/timeline/categories", { name: tag, color: "#2563eb" })).json();
  const school = await (
    await api.post("/timeline/events", {
      title: `${tag} school`,
      start: "2006",
      end: "2009-06",
      category_id: category.id,
      description: "Class 3B",
    })
  ).json();
  const born = await (await api.post("/timeline/events", { title: `${tag} born`, start: "1990-03-04" })).json();

  try {
    // Without a birth date the timeline suggests setting it.
    await page.reload();
    await expect(page.getByText(/set your birth date/)).toBeVisible();

    // Birth date set in Settings drives the initial view.
    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("banner").getByRole("link", { name: "Settings" }).click();
    await page.getByLabel("Birth date").fill("1990-03-04");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();

    await page.getByRole("link", { name: "Timeline" }).click();
    const timeline = page.getByTestId("timeline");
    await expect(timeline.getByText(`${tag} school`)).toBeVisible();
    await expect(timeline.getByText(`${tag} born`)).toBeVisible();
    await expect(page.getByText(/set your birth date/)).toBeHidden();

    await timeline.getByText(`${tag} school`).click();
    const details = page.getByRole("complementary", { name: "Event details" });
    await expect(details).toContainText("2006 – June 2009");
    await expect(details).toContainText(tag);
    await expect(details).toContainText("Class 3B");

    await page.getByRole("button", { name: "Close details" }).click();
    await expect(details).toBeHidden();
  } finally {
    await api.delete(`/timeline/events/${school.id}`);
    await api.delete(`/timeline/events/${born.id}`);
    await api.delete(`/timeline/categories/${category.id}`);
    await api.patch("/profile", { birth_date: null });
  }
});
