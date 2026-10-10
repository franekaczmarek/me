import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSession, setSession } from "@/test/mocks";
import { api, ApiError } from "./api";

vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends the access token as a bearer header", async () => {
    setSession(fakeSession());
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await expect(api("/me")).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/me");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-access-token");
  });

  it("sends no auth header when logged out", async () => {
    setSession(null);
    fetchMock.mockImplementation(async () => jsonResponse(200, {}));

    await api("/health");

    expect(new Headers(fetchMock.mock.calls[0][1].headers).has("Authorization")).toBe(false);
  });

  it("sets JSON content type for string bodies but not for FormData", async () => {
    setSession(null);
    fetchMock.mockImplementation(async () => jsonResponse(200, {}));

    await api("/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    await api("/x", { method: "POST", body: new FormData() });

    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has("Content-Type")).toBe(false);
  });

  it("throws ApiError with the backend's detail message", async () => {
    setSession(null);
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: "Invalid token" }));

    const error = await api("/me").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "Invalid token" });
  });

  it("returns undefined for 204 No Content", async () => {
    setSession(null);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api("/x", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
