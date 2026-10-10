import { expect, test } from "@playwright/test";
import { apiClient, logIn, requireTestUser } from "./helpers";

// To-do UI on the real stack. Tasks are tagged and removed afterwards.
test.beforeEach(() => requireTestUser());

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test("a user plans, completes and reschedules tasks", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const tag = `e2e-${Date.now()}`;
  const late = await (await api.post("/todo/tasks", { title: `${tag} late`, planned_date: localDay(-2) })).json();

  try {
    await page.getByRole("link", { name: "To-do" }).click();
    const today = page.getByRole("region", { name: /^Today/ });
    await expect(today).toBeVisible();

    // Quick add on today, then check it off.
    await today.getByLabel("Add a task on Today").fill(`${tag} quick`);
    await today.getByLabel("Add a task on Today").press("Enter");
    await expect(today.getByText(`${tag} quick`)).toBeVisible();
    await today.getByRole("checkbox", { name: `Complete ${tag} quick` }).click();
    await expect(today.getByRole("checkbox", { name: `Reopen ${tag} quick` })).toBeVisible();

    // The overdue task sits above today; move it to today.
    const overdue = page.getByRole("region").filter({ hasText: `${tag} late` });
    await expect(overdue.getByText("Not done")).toBeVisible();
    await overdue.getByRole("button", { name: "Move to today" }).click();
    await expect(today.getByText(`${tag} late`)).toBeVisible();

    // A detailed task in the inbox.
    await page.getByRole("button", { name: "Add task" }).click();
    const panel = page.getByRole("complementary", { name: "New task" });
    await panel.getByLabel("Title").fill(`${tag} inbox`);
    await panel.getByLabel("Keep in the inbox (no day yet)").check();
    await panel.getByLabel("Duration").selectOption("30 min");
    await panel.getByRole("button", { name: "Add task" }).click();
    const inbox = page.getByRole("region", { name: "Inbox" });
    await expect(inbox.getByText(`${tag} inbox`)).toBeVisible();
    await expect(inbox.getByRole("listitem").filter({ hasText: `${tag} inbox` }).getByText("30m")).toBeVisible();

    // Edit: plan it for tomorrow.
    await inbox.getByRole("button", { name: `${tag} inbox` }).click();
    const edit = page.getByRole("complementary", { name: "Edit task" });
    await edit.getByLabel("Keep in the inbox (no day yet)").uncheck();
    await edit.getByLabel("Day", { exact: true }).fill(localDay(1));
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: /^Tomorrow/ }).getByText(`${tag} inbox`)).toBeVisible();
    await expect(inbox.getByText(`${tag} inbox`)).toBeHidden();
  } finally {
    const feed = await (await api.get(`/todo/days?today=${localDay()}`)).json();
    const all = [...feed.inbox, ...feed.days.flatMap((d: { tasks: unknown[] }) => d.tasks)] as { id: string; title: string }[];
    for (const t of all.filter((t) => t.title.startsWith(tag))) await api.delete(`/todo/tasks/${t.id}`);
    await api.delete(`/todo/tasks/${late.id}`);
  }
});

test("a user adds a routine that shows up on its days, and sees statistics", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const tag = `e2e-${Date.now()}`;

  try {
    await page.getByRole("link", { name: "To-do" }).click();
    const routines = page.getByRole("region", { name: "Routines" });
    await routines.getByRole("button", { name: /Routines/ }).click();
    await routines.getByLabel("Routine title").fill(`${tag} stretch`);
    await routines.getByLabel("Routine duration").selectOption("15m");
    await routines.getByRole("button", { name: "Add routine" }).click();
    await expect(routines.getByText(`${tag} stretch`)).toBeVisible();
    await expect(routines.getByText("Every day · 15m")).toBeVisible();

    // A daily routine appears today and tomorrow.
    const today = page.getByRole("region", { name: /^Today/ });
    await expect(today.getByText(`${tag} stretch`)).toBeVisible();
    await expect(page.getByRole("region", { name: /^Tomorrow/ }).getByText(`${tag} stretch`)).toBeVisible();

    // Doing it today shows up in the statistics.
    await today.getByRole("checkbox", { name: `Complete ${tag} stretch` }).click();
    const stats = page.getByRole("region", { name: "Statistics" });
    await expect(stats.getByText(/\d+%/)).toBeVisible();

    // Pausing removes the upcoming ones (today's done one stays).
    await routines.getByRole("switch", { name: `${tag} stretch active` }).click();
    await expect(page.getByRole("region", { name: /^Tomorrow/ }).getByText(`${tag} stretch`)).toBeHidden();
    await expect(today.getByText(`${tag} stretch`)).toBeVisible();

    await routines.getByRole("button", { name: `Delete ${tag} stretch` }).click();
    await expect(routines.getByText(`${tag} stretch`)).toBeHidden();
  } finally {
    const all: { id: string; title: string }[] = await (await api.get("/todo/routines")).json();
    for (const r of all.filter((r) => r.title.startsWith(tag))) await api.delete(`/todo/routines/${r.id}?today=${localDay()}`);
    const feed = await (await api.get(`/todo/days?today=${localDay()}`)).json();
    const tasks = [...feed.inbox, ...feed.days.flatMap((d: { tasks: unknown[] }) => d.tasks)] as { id: string; title: string }[];
    for (const t of tasks.filter((t) => t.title.startsWith(tag))) await api.delete(`/todo/tasks/${t.id}`);
  }
});

test("a user drags tasks between the inbox and the days", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const title = `e2e-${Date.now()} drag`;
  const task = await (await api.post("/todo/tasks", { title })).json();

  async function dragTo(target: import("@playwright/test").Locator) {
    const row = page.getByRole("listitem").filter({ hasText: title });
    await row.hover();
    const handle = (await row.locator("[data-drag-handle]").boundingBox())!;
    const box = (await target.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 12 });
    await expect(page.getByTestId("drag-ghost")).toHaveText(title);
    await page.mouse.up();
  }

  try {
    await page.getByRole("link", { name: "To-do" }).click();
    const inbox = page.getByRole("region", { name: "Inbox" });
    const tomorrow = page.getByRole("region", { name: /^Tomorrow/ });
    await expect(inbox.getByText(title)).toBeVisible();

    await dragTo(tomorrow);
    await expect(tomorrow.getByText(title)).toBeVisible();
    await expect(inbox.getByText(title)).toBeHidden();

    await dragTo(inbox);
    await expect(inbox.getByText(title)).toBeVisible();
    await expect(tomorrow.getByText(title)).toBeHidden();
  } finally {
    await api.delete(`/todo/tasks/${task.id}`);
  }
});
