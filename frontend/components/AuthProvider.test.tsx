import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeSession, routerMock, setSession } from "@/test/mocks";
import { AuthGate, AuthProvider } from "./AuthProvider";

vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));
vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);

function renderGate(requireAuth: boolean) {
  return render(
    <AuthProvider>
      <AuthGate requireAuth={requireAuth}>
        <p>secret content</p>
      </AuthGate>
    </AuthProvider>,
  );
}

describe("AuthGate", () => {
  it("shows a loading state before the session is known", () => {
    setSession(null);
    renderGate(true);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("redirects logged-out users to /login on protected pages", async () => {
    setSession(null);
    renderGate(true);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("renders protected content for logged-in users", async () => {
    setSession(fakeSession());
    renderGate(true);
    expect(await screen.findByText("secret content")).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("sends logged-in users away from login/signup pages", async () => {
    setSession(fakeSession());
    renderGate(false);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/timeline"));
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("shows login/signup pages to logged-out users", async () => {
    setSession(null);
    renderGate(false);
    expect(await screen.findByText("secret content")).toBeInTheDocument();
  });
});
