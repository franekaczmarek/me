import { expect, test } from "@playwright/test";
import { apiClient, logIn, requireTestUser } from "./helpers";

// Work calendar settings on the real stack; they drive the to-do capacity.
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
    await daysOff.getByRole("button", { name: /Remove E2E day off/ }).click();
    await expect(daysOff.getByText("E2E day off")).toBeHidden();
  } finally {
    await api.put("/calendar/work-schedule", original);
    const all: { id: string; label: string }[] = await (await api.get("/calendar/days-off")).json();
    for (const d of all.filter((d) => d.label === "E2E day off")) await api.delete(`/calendar/days-off/${d.id}`);
  }
});
