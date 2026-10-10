import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/components/AuthProvider";
import { fakeSession, setSession, supabaseMock } from "@/test/mocks";
import SettingsPage from "./page";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));

function renderPage() {
  render(
    <AuthProvider>
      <SettingsPage />
    </AuthProvider>,
  );
}

async function changePassword(password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText("New password"), password);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Change password" }));
}

beforeEach(() => {
  setSession(fakeSession("me@example.com"));
  apiMock.mockResolvedValue({ id: "user-1" });
});

describe("SettingsPage", () => {
  it("shows the account email", async () => {
    renderPage();
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
  });

  it("reports the backend as connected when /me succeeds", async () => {
    renderPage();
    expect(await screen.findByText(/connected/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/me");
  });

  it("reports the backend as unreachable when /me fails", async () => {
    apiMock.mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByText(/not reachable/)).toBeInTheDocument();
  });

  it("rejects mismatched passwords without calling Supabase", async () => {
    renderPage();
    await changePassword("newpass123", "different1");
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it("changes the password and clears the form", async () => {
    supabaseMock.auth.updateUser.mockResolvedValue({ error: null });
    renderPage();
    await changePassword("newpass123", "newpass123");
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: "newpass123" });
    expect(await screen.findByText("Password changed.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("shows the error returned by Supabase", async () => {
    supabaseMock.auth.updateUser.mockResolvedValue({ error: { message: "Password is too weak" } });
    renderPage();
    await changePassword("newpass123", "newpass123");
    expect(await screen.findByText("Password is too weak")).toBeInTheDocument();
  });
});
