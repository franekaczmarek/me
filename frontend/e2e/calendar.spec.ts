import { expect, test } from "@playwright/test";
import { apiClient, logIn, requireTestUser } from "./helpers";

// The calendar on the real stack: events in the month grid and side cards, work settings that drive to-do capacity.
test.beforeEach(() => requireTestUser());

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test("a user sets work days and a day off, and the to-do list follows", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const original = await (await api.get("/calendar/work-schedule")).json();

  try {
    await page.getByRole("link", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "Work schedule and days off" }).click();
    const schedule = page.getByRole("region", { name: "Work schedule" });
    // Work every day, 2h for tasks.
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      const chip = schedule.getByRole("button", { name: day, exact: true });
      if ((await chip.getAttribute("aria-pressed")) === "false") await chip.click();
    }
    await schedule.getByLabel("Time for tasks on a work day").fill("120");
    await schedule.getByRole("button", { name: "Save schedule" }).click();
    await expect(schedule.getByText("Schedule saved.")).toBeVisible();

    // Tomorrow off.
    const daysOff = page.getByRole("region", { name: "Days off" });
    await daysOff.getByLabel("What is it").fill("E2E day off");
    await daysOff.getByLabel("First day off").fill(localDay(1));
    await daysOff.getByRole("button", { name: "Add days off" }).click();
    await expect(daysOff.getByText("E2E day off")).toBeVisible();

    await page.getByRole("link", { name: "To-do" }).click();
    const today = page.getByRole("region", { name: /^Today/ });
    await expect(today.getByText(/of 2h$/)).toBeVisible();
    const tomorrow = page.getByRole("region", { name: /^Tomorrow/ });
    await expect(tomorrow.getByText("Day off")).toBeVisible();

    await page.getByRole("link", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "Work schedule and days off" }).click();
    await daysOff.getByRole("button", { name: /Remove E2E day off/ }).click();
    await expect(daysOff.getByText("E2E day off")).toBeHidden();
  } finally {
    await api.put("/calendar/work-schedule", original);
    const all: { id: string; label: string }[] = await (await api.get("/calendar/days-off")).json();
    for (const d of all.filter((d) => d.label === "E2E day off")) await api.delete(`/calendar/days-off/${d.id}`);
  }
});

const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00`));

test("a user adds an event in the month grid, sees it coming up, edits and deletes it", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const day = localDay(3);
  try {
    await page.getByRole("link", { name: "Calendar" }).click();
    const grid = page.getByRole("grid", { name: "Month" });
    // The empty top-right corner of the day (events may cover the rest).
    const cell = grid.getByRole("gridcell", { name: longDay(day) });
    const box = (await cell.boundingBox())!;
    await cell.click({ position: { x: box.width - 6, y: 6 } });

    const form = page.getByRole("complementary", { name: "New event" });
    await form.getByLabel("Title").fill("E2E dentist");
    await form.getByLabel("All day").uncheck();
    await form.getByLabel("Start time").fill("15:30");
    await form.getByLabel("End time").fill("16:15");
    await form.getByRole("button", { name: "Add event" }).click();

    await expect(grid.getByRole("button", { name: "E2E dentist, 15:30" })).toBeVisible();
    const upcoming = page.getByRole("region", { name: "Upcoming" });
    await expect(upcoming.getByText("E2E dentist")).toBeVisible();
    await expect(upcoming.getByText("in 3 days").first()).toBeVisible();

    await grid.getByRole("button", { name: "E2E dentist, 15:30" }).click();
    const edit = page.getByRole("complementary", { name: "Edit event" });
    await edit.getByLabel("Title").fill("E2E dentist (moved)");
    await edit.getByLabel("All day").check();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(grid.getByRole("button", { name: "E2E dentist (moved)" })).toBeVisible();

    await grid.getByRole("button", { name: "E2E dentist (moved)" }).click();
    await edit.getByRole("button", { name: "Delete…" }).click();
    await edit.getByRole("button", { name: "Delete event" }).click();
    await expect(grid.getByRole("button", { name: /E2E dentist/ })).toBeHidden();
  } finally {
    const all: { id: string; title: string }[] = await (await api.get(`/calendar/events?start=${localDay(-1)}&end=${localDay(10)}`)).json();
    for (const e of all.filter((e) => e.title.startsWith("E2E"))) await api.delete(`/calendar/events/${e.id}`);
  }
});
