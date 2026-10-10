import { expect, test } from "@playwright/test";
import { API_URL, apiClient, logIn, PIXEL_PNG, requireTestUser } from "./helpers";

// Timeline API through the real stack: browser login -> FastAPI -> Supabase.
// Becomes a UI flow once the timeline UI exists.
test.beforeEach(() => requireTestUser());

test("a logged-in user manages categories and events", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
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

test("a logged-in user adds, views and removes an event photo", async ({ page, request }) => {
  await logIn(page);
  const api = await apiClient(page, request);
  const event = await (await api.post("/timeline/events", { title: "Photo test", start: "2020-05" })).json();

  try {
    const uploaded = await api.upload(
      `/timeline/events/${event.id}/media`,
      { name: "pixel.png", mimeType: "image/png", buffer: PIXEL_PNG },
      "Tiny",
    );
    expect(uploaded.status()).toBe(201);
    const photo = await uploaded.json();
    expect(photo).toMatchObject({ caption: "Tiny", width: 1, height: 1 });

    // The signed URL serves the stored WebP file directly from Supabase Storage.
    const file = await request.get(photo.url);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toBe("image/webp");

    const listed = await (await api.get(`/timeline/events/${event.id}/media`)).json();
    expect(listed.map((p: { id: string }) => p.id)).toEqual([photo.id]);

    const notImage = await api.upload(`/timeline/events/${event.id}/media`, {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    expect(notImage.status()).toBe(422);

    expect((await api.delete(`/timeline/media/${photo.id}`)).status()).toBe(204);
    expect(await (await api.get(`/timeline/events/${event.id}/media`)).json()).toEqual([]);
  } finally {
    await api.delete(`/timeline/events/${event.id}`);
  }
});
