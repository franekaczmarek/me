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

test("a user drags out an event in the week view and moves it to a later time", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const day = localDay(0);
  try {
    await page.getByRole("link", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    const hours = page.getByLabel(`Hours of ${longDay(day)}`);
    const box = (await hours.boundingBox())!;
    const y = (minutes: number) => box.y + (minutes * 48) / 60;
    await page.mouse.move(box.x + box.width / 2, y(10 * 60 + 5));
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, y(11 * 60), { steps: 5 });
    await page.mouse.move(box.x + box.width / 2, y(11 * 60 + 25), { steps: 5 });
    await page.mouse.up();

    const form = page.getByRole("complementary", { name: "New event" });
    await expect(form.getByLabel("Start time")).toHaveValue("10:00");
    await expect(form.getByLabel("End time")).toHaveValue("11:30");
    await form.getByLabel("Title").fill("E2E focus");
    await form.getByRole("button", { name: "Add event" }).click();

    const event = page.getByRole("button", { name: "E2E focus, 10:00 – 11:30" });
    await expect(event).toBeVisible();
    const e = (await event.boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + 10);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2, e.y + 10 + 48, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "E2E focus, 11:00 – 12:30" })).toBeVisible();

    // Shown at once; saved in the background.
    await expect
      .poll(async () => {
        const saved: { title: string; start_time: string; end_time: string }[] = await (await api.get(`/calendar/events?start=${day}&end=${day}`)).json();
        const focus = saved.find((o) => o.title === "E2E focus");
        return focus && `${focus.start_time}–${focus.end_time}`;
      })
      .toBe("11:00:00–12:30:00");
  } finally {
    const all: { id: string; title: string }[] = await (await api.get(`/calendar/events?start=${localDay(-1)}&end=${localDay(10)}`)).json();
    for (const e of all.filter((e) => e.title.startsWith("E2E"))) await api.delete(`/calendar/events/${e.id}`);
  }
});

test("calendar events show in the to-do list, and tasks can be dragged between calendar days", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const today = localDay(0);
  const tomorrow = localDay(1);
  const event = await (
    await api.post("/calendar/events", { title: "E2E dinner", start_date: today, end_date: today, start_time: "19:00", end_time: "21:00" })
  ).json();
  const task = await (await api.post("/todo/tasks", { title: "E2E wine", planned_date: today })).json();
  try {
    await page.getByRole("link", { name: "To-do" }).click();
    const todayCard = page.getByRole("region", { name: /^Today/ });
    await expect(todayCard.getByRole("link", { name: "E2E dinner, 19:00" })).toBeVisible();

    await page.getByRole("link", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const grid = page.getByRole("grid", { name: "Month" });
    const chip = grid.getByRole("button", { name: "Task: E2E wine" });
    await expect(chip).toBeVisible();
    const target = grid.getByRole("gridcell", { name: longDay(tomorrow) });
    const from = (await chip.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 12, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const tasks: { id: string; planned_date: string }[] = await (await api.get(`/todo/tasks?start=${today}&end=${tomorrow}`)).json();
        return tasks.find((t) => t.id === task.id)?.planned_date;
      })
      .toBe(tomorrow);
    await grid.getByRole("checkbox", { name: "Complete E2E wine" }).click();
    await expect(grid.getByRole("checkbox", { name: "Reopen E2E wine" })).toBeVisible();
  } finally {
    await api.delete(`/calendar/events/${event.id}`);
    await api.delete(`/todo/tasks/${task.id}`);
  }
});
