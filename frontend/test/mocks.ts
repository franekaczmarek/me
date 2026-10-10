// Shared mocks for unit tests. vi.mock is hoisted above imports, so load them
// inside the factory:
//   vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));
//   vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
import type { Session } from "@supabase/supabase-js";
import { vi } from "vitest";

export const routerMock = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };

export const navigationMock = {
  useRouter: () => routerMock,
  usePathname: vi.fn(() => "/timeline"),
  redirect: vi.fn(),
};

export const supabaseMock = {
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
  },
};

export function fakeSession(email = "user@example.com"): Session {
  return {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "user-1", email, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
  } as Session;
}

/** Make supabase.auth.getSession resolve to the given session (or none). */
export function setSession(session: Session | null) {
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
}
