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

    await page.getByRole("button", { name: "Close panel" }).click();
    await expect(details).toBeHidden();
  } finally {
    await api.delete(`/timeline/events/${school.id}`);
    await api.delete(`/timeline/events/${born.id}`);
    await api.delete(`/timeline/categories/${category.id}`);
    await api.patch("/profile", { birth_date: null });
  }
});

test("a user adds, edits and deletes an event in the UI", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const title = `e2e-${Date.now()} first job`;

  try {
    await page.getByRole("button", { name: "Add event" }).click();
    const form = page.getByRole("complementary", { name: "New event" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Date year").fill(String(new Date().getFullYear() - 1));
    await form.getByLabel("Date month").selectOption("September");
    await form.getByLabel("Period (has an end date)").check();
    await form.getByLabel("End year").fill(String(new Date().getFullYear()));
    await form.getByLabel("Description").fill("Junior developer");
    await form.getByRole("button", { name: "Add event" }).click();

    const details = page.getByRole("complementary", { name: "Event details" });
    await expect(details).toContainText(title);
    await expect(details).toContainText(`September ${new Date().getFullYear() - 1} – ${new Date().getFullYear()}`);
    const timeline = page.getByTestId("timeline");
    await expect(timeline.getByText(title)).toBeVisible();

    await details.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("complementary", { name: "Edit event" });
    await edit.getByLabel("Title").fill(`${title} (edited)`);
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(details).toContainText(`${title} (edited)`);
    await expect(timeline.getByText(`${title} (edited)`)).toBeVisible();

    // Survives a reload: it was really saved.
    await page.reload();
    await page.getByTestId("timeline").getByText(`${title} (edited)`).click();
    await details.getByRole("button", { name: "Delete…" }).click();
    await details.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(details).toBeHidden();
    await expect(timeline.getByText(title)).toBeHidden();
  } finally {
    const events: { id: string; title: string }[] = await (await api.get("/timeline/events")).json();
    for (const e of events.filter((e) => e.title.startsWith(title))) await api.delete(`/timeline/events/${e.id}`);
  }
});

test("double-clicking the timeline starts a new event on that day", async ({ page }) => {
  await logIn(page);
  await page.getByTestId("timeline").locator(".vis-center").dblclick();
  const form = page.getByRole("complementary", { name: "New event" });
  await expect(form.getByLabel("Date year")).not.toHaveValue("");
  await expect(form.getByLabel("Date day")).not.toHaveValue("");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
});
