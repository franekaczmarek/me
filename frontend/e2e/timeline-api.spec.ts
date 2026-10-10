import { type APIRequestContext, expect, test } from "@playwright/test";
import { accessToken, API_URL, logIn, requireTestUser } from "./helpers";

// Timeline API through the real stack: browser login -> FastAPI -> Supabase.
// Becomes a UI flow once the timeline UI exists.
test.beforeEach(() => requireTestUser());

function client(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    get: (path: string) => request.get(`${API_URL}${path}`, { headers }),
    post: (path: string, data: object) => request.post(`${API_URL}${path}`, { headers, data }),
    patch: (path: string, data: object) => request.patch(`${API_URL}${path}`, { headers, data }),
    delete: (path: string) => request.delete(`${API_URL}${path}`, { headers }),
  };
}

test("a logged-in user manages categories and events", async ({ page, request }) => {
  await logIn(page);
  const api = client(request, await accessToken(page));
  const tag = `e2e-${Date.now()}`;

  const categoryResponse = await api.post("/timeline/categories", { name: tag, color: "#22AA66" });
  expect(categoryResponse.status()).toBe(201);
  const category = await categoryResponse.json();
  expect(category.color).toBe("#22aa66");

  try {
    const eventResponse = await api.post("/timeline/events", {
      title: "High school",
      start: "2015",
      end: "2018-06",
      category_id: category.id,
    });
    expect(eventResponse.status()).toBe(201);
    const event = await eventResponse.json();
    expect(event).toMatchObject({ start: "2015", end: "2018-06", category_id: category.id });

    const listed = await (await api.get("/timeline/events")).json();
    expect(listed.map((e: { id: string }) => e.id)).toContain(event.id);

    const updated = await api.patch(`/timeline/events/${event.id}`, { title: "Secondary school", end: null });
    expect(await updated.json()).toMatchObject({ title: "Secondary school", end: null });

    expect((await api.post("/timeline/events", { title: "x", start: "2018", end: "2015" })).status()).toBe(422);

    expect((await api.delete(`/timeline/events/${event.id}`)).status()).toBe(204);
    expect((await api.get(`/timeline/events/${event.id}`)).status()).toBe(404);
  } finally {
    await api.delete(`/timeline/categories/${category.id}`);
  }
});

test("the timeline API rejects requests without a token", async ({ request }) => {
  expect((await request.get(`${API_URL}/timeline/events`)).status()).toBe(401);
  expect((await request.post(`${API_URL}/timeline/categories`, { data: {} })).status()).toBe(401);
});
