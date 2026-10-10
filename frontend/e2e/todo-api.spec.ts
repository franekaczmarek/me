import { expect, test } from "@playwright/test";
import { API_URL, apiClient, logIn, requireTestUser } from "./helpers";

// To-do and work-calendar API through the real stack. Becomes a UI flow with the To-do UI.
test.beforeEach(() => requireTestUser());

const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

test("a logged-in user plans, completes and removes tasks", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const tag = `e2e-${Date.now()}`;

  const planned = await (await api.post("/todo/tasks", { title: `${tag} today`, planned_date: today, duration_min: 30 })).json();
  const inbox = await (await api.post("/todo/tasks", { title: `${tag} inbox` })).json();
  try {
    const feed = await (await api.get(`/todo/days?today=${today}`)).json();
    const todayCard = feed.days.find((d: { is_today: boolean }) => d.is_today);
    expect(todayCard.tasks.map((t: { title: string }) => t.title)).toContain(`${tag} today`);
    expect(feed.inbox.map((t: { title: string }) => t.title)).toContain(`${tag} inbox`);

    const done = await (await api.post(`/todo/tasks/${planned.id}/complete`, { today })).json();
    expect(done.status).toBe("done");

    expect((await api.post("/todo/tasks", { title: "x", fixed_day: true })).status()).toBe(422);
  } finally {
    await api.delete(`/todo/tasks/${planned.id}`);
    await api.delete(`/todo/tasks/${inbox.id}`);
  }
});

test("the work schedule has sensible defaults", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const schedule = await (await api.get("/calendar/work-schedule")).json();
  expect(schedule.work_days.length).toBeGreaterThan(0);
  expect(schedule).toHaveProperty("task_minutes_workday");
});

test("the to-do API rejects requests without a token", async ({ request }) => {
  expect((await request.get(`${API_URL}/todo/days`)).status()).toBe(401);
  expect((await request.get(`${API_URL}/calendar/work-schedule`)).status()).toBe(401);
});
