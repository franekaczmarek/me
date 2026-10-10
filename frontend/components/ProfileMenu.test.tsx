import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeSession, setSession, supabaseMock } from "@/test/mocks";
import { AuthProvider } from "./AuthProvider";
import { ProfileMenu } from "./ProfileMenu";

vi.mock("@/lib/supabase", async () => ({ supabase: (await import("@/test/mocks")).supabaseMock }));

async function renderMenu() {
  setSession(fakeSession("franek@example.com"));
  render(
    <AuthProvider>
      <ProfileMenu />
    </AuthProvider>,
  );
  return screen.findByRole("button", { name: "Profile menu" });
}

describe("ProfileMenu", () => {
  it("shows the user's initial and is closed by default", async () => {
    const button = await renderMenu();
    expect(await screen.findByText("F")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("opens with email, settings link and logout", async () => {
    await userEvent.click(await renderMenu());
    expect(screen.getByText("franek@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("logs out via Supabase", async () => {
    await userEvent.click(await renderMenu());
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(supabaseMock.auth.signOut).toHaveBeenCalled();
  });

  it("closes on outside click", async () => {
    await userEvent.click(await renderMenu());
    await userEvent.click(document.body);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });
});
